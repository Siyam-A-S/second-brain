import type { AiSettings } from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jsonObject";
import { agentMethods, type AgentMethodConfig } from "./AgentRuntimeConfig";
import type { LocalToolSpec } from "./LocalToolRegistry";

export type GraphifyMcpToolSpec = {
  name: string;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
};
export type GraphCardDefinitionInput = {
  id: string;
  title: string;
  type: string;
  summary: string;
  sourceFile: string;
  sourceContext: string;
  community: string;
  related: string[];
};
export type GraphCardDefinition = {
  id: string;
  definition: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PlannedLocalToolCall = {
  tool: string;
  input: unknown;
  reason?: string | undefined;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null | undefined;
      reasoning_content?: string | null | undefined;
    };
  }>;
};

const defaultEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultModel = "local-model";
const requestTimeoutMs = Number(process.env.SECOND_BRAIN_LLM_TIMEOUT_MS ?? 120_000);
const fallbackMaxTokens = 4096;
const placeholderApiKey = "local-dev-placeholder";

type AiSettingsProvider = () => Promise<AiSettings>;

function normalizeOptionalLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeDefinition(value: unknown): string {
  const normalized = normalizeOptionalLine(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .slice(0, 360);
}

function shouldRetryWithFallback(message: string): boolean {
  return /context|token|too large|max_tokens|max_completion_tokens|400|413|422|valid JSON|truncat/i.test(message);
}

export class LlmService {
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settingsProvider: AiSettingsProvider = async () => ({
      endpoint: process.env.SECOND_BRAIN_LLM_ENDPOINT ?? defaultEndpoint,
      apiKey: process.env.SECOND_BRAIN_LLM_API_KEY ?? placeholderApiKey,
      model: process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? defaultModel,
      updatedAt: new Date().toISOString()
    })
  ) {}

  async completeJsonObject(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<Record<string, unknown>> {
    const content = await this.completeText(input);

    try {
      return parseLocalModelJsonObject(content);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (!input.method || input.method.maxTokens <= fallbackMaxTokens || !shouldRetryWithFallback(detail)) {
        throw error;
      }

      const retryContent = await this.completeText({
        ...input,
        method: {
          ...input.method,
          maxTokens: fallbackMaxTokens
        }
      });

      return parseLocalModelJsonObject(retryContent);
    }
  }

  async planLocalToolCall(input: {
    systemPrompt: string;
    userPrompt: string;
    tools: LocalToolSpec[];
    method?: AgentMethodConfig | undefined;
  }): Promise<PlannedLocalToolCall> {
    const parsed = await this.completeJsonObject({
      method: input.method,
      messages: [
        {
          role: "system",
          content: [
            input.systemPrompt,
            "",
            "Enabled local tools:",
            JSON.stringify(
              input.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchemaJson
              }))
            )
          ].join("\n")
        },
        {
          role: "user",
          content: input.userPrompt
        }
      ]
    });

    const tool = parsed.tool ?? parsed.name;
    if (typeof tool !== "string" || !tool.trim()) {
      throw new Error("Local AI server did not return a tool name.");
    }

    const toolInput = parsed.input ?? parsed.arguments ?? parsed.parameters;
    if (!toolInput || typeof toolInput !== "object") {
      throw new Error(`Local AI server did not return input for tool "${tool}".`);
    }

    return {
      tool: tool.trim(),
      input: toolInput,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined
    };
  }

  async defineGraphCards(cards: GraphCardDefinitionInput[]): Promise<GraphCardDefinition[]> {
    if (cards.length === 0) {
      return [];
    }

    const parsed = await this.completeJsonObject({
      method: agentMethods.cardDefinition,
      messages: [
        {
          role: "system",
          content: [
            "You write flashcard definitions for Second Brain graph cards.",
            "Return exactly one raw minified JSON object.",
            "No markdown, prose, explanations, or code fences.",
            "Schema: {\"definitions\":[{\"id\":\"string\",\"definition\":\"one or two sentences\"}]}",
            "Each definition must explain what the card means in this user's source context, not a generic dictionary definition.",
            "Mention the source context only when it helps disambiguate the card.",
            "Keep each definition under 45 words."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({ cards })
        }
      ]
    });
    const rawDefinitions = Array.isArray(parsed.definitions) ? parsed.definitions : [];

    return rawDefinitions
      .map((value) => {
        if (!value || typeof value !== "object") {
          return null;
        }

        const record = value as Record<string, unknown>;
        const id = normalizeOptionalLine(record.id);
        const definition = normalizeDefinition(record.definition);

        return id && definition ? { id, definition } : null;
      })
      .filter((value): value is GraphCardDefinition => Boolean(value));
  }

  private async completeText(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<string> {
    return this.enqueue(() => this.completeTextWithRetry(input));
  }

  private async completeTextWithRetry(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<string> {
    const maxTokens = input.method?.maxTokens ?? 1024;

    try {
      return await this.completeTextAttempt(input, maxTokens);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (maxTokens <= fallbackMaxTokens || !shouldRetryWithFallback(detail)) {
        throw error;
      }

      console.warn(`AI request failed at ${maxTokens} tokens; retrying with ${fallbackMaxTokens}.`, error);
      return this.completeTextAttempt(input, fallbackMaxTokens);
    }
  }

  private async completeTextAttempt(
    input: {
      messages: ChatMessage[];
      method?: AgentMethodConfig | undefined;
    },
    maxTokens: number
  ): Promise<string> {
    const settings = await this.settingsProvider();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(settings.endpoint || defaultEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiKey || placeholderApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: settings.model || defaultModel,
          temperature: input.method?.temperature ?? 0,
          max_tokens: maxTokens,
          stream: false,
          messages: input.messages
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Local AI server responded with ${response.status}.`);
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const message = payload.choices?.[0]?.message;
      const content = message?.content?.trim() || message?.reasoning_content?.trim();

      if (!content) {
        throw new Error("Local AI server returned an empty response.");
      }

      return content;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI server timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. ${detail}`);
      }

      if (detail.includes("valid JSON")) {
        throw new Error(detail);
      }

      throw new Error(`AI server is unavailable. ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(task, task);
    this.requestQueue = run.catch(() => undefined);
    return run;
  }

}

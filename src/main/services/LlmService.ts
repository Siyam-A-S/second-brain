import { randomUUID } from "node:crypto";
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
  output_text?: string | null | undefined;
  choices?: Array<{
    text?: string | null | undefined;
    message?: {
      content?:
        | string
        | Array<{
            type?: string | undefined;
            text?: string | undefined;
            content?: string | undefined;
          }>
        | null
        | undefined;
      reasoning_content?: string | null | undefined;
    };
  }>;
  error?: {
    message?: string | undefined;
    type?: string | undefined;
    code?: string | undefined;
  };
};

type ProxyChatResponse = ChatCompletionResponse & {
  text?: string | null | undefined;
  groundingMetadata?: unknown;
  grounding_metadata?: unknown;
  usage?: unknown;
  model?: string | undefined;
  requestId?: string | undefined;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?:
        | string
        | Array<{
            text?: string | undefined;
            content?: string | undefined;
          }>
        | null
        | undefined;
    };
    text?: string | null | undefined;
  }>;
  error?: {
    message?: string | undefined;
  };
};

const defaultEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultModel = "local-model";
const requestTimeoutMs = Number(process.env.SECOND_BRAIN_LLM_TIMEOUT_MS ?? 120_000);
const fallbackMaxTokens = 4096;
const placeholderApiKey = "local-dev-placeholder";
const maxErrorBodyLength = 2400;

type AiSettingsProvider = () => Promise<AiSettings>;
type TokenParameterName = "max_tokens" | "max_completion_tokens";

type ChatAttemptOptions = {
  maxTokens: number;
  tokenParameter: TokenParameterName;
  includeTemperature: boolean;
  useJsonMode: boolean;
};

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

function sanitizeErrorText(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, maxErrorBodyLength);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerRejectsMaxTokens(detail: string): boolean {
  return /max_tokens.+(unsupported|unrecognized|unknown|invalid|not supported)|unsupported.+max_tokens|use max_completion_tokens/i.test(detail);
}

function providerRejectsTemperature(detail: string): boolean {
  return /temperature.+(unsupported|unrecognized|unknown|invalid|not supported)|unsupported.+temperature|only.*default.*temperature/i.test(detail);
}

function providerRejectsJsonMode(detail: string): boolean {
  return /response_format.+(unsupported|unrecognized|unknown|invalid|not supported)|json_object.+(unsupported|not supported)|unsupported.+response_format/i.test(detail);
}

function extractContentPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractChatContent(payload: ChatCompletionResponse): string {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  return (
    extractContentPart(message?.content).trim() ||
    normalizeOptionalLine(message?.reasoning_content) ||
    normalizeOptionalLine(choice?.text) ||
    normalizeOptionalLine(payload.output_text)
  );
}

function extractProxyChatContent(payload: ProxyChatResponse): string {
  return normalizeOptionalLine(payload.text) || extractChatContent(payload);
}

function extractChunkDelta(payload: ChatCompletionChunk): string {
  const choice = payload.choices?.[0];
  const content = choice?.delta?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? part.content ?? "")
      .filter(Boolean)
      .join("");
  }

  return typeof choice?.text === "string" ? choice.text : "";
}

function parseSseLines(raw: string): Array<string> {
  return raw
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

export class LlmService {
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settingsProvider: AiSettingsProvider = async () => ({
      mode: "local",
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
      const detail = errorText(error);

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
      throw new Error("AI endpoint did not return a tool name.");
    }

    const toolInput = parsed.input ?? parsed.arguments ?? parsed.parameters;
    if (!toolInput || typeof toolInput !== "object") {
      throw new Error(`AI endpoint did not return input for tool "${tool}".`);
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

  async completeText(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<string> {
    return this.enqueue(() => this.completeTextWithRetry(input));
  }

  async streamText(
    input: {
      messages: ChatMessage[];
      method?: AgentMethodConfig | undefined;
    },
    onDelta: (delta: string, content: string) => void,
    abortSignal?: AbortSignal
  ): Promise<string> {
    return this.enqueue(() => this.streamTextAttempt(input, onDelta, abortSignal));
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
    let options: ChatAttemptOptions = {
      maxTokens,
      tokenParameter: "max_tokens",
      includeTemperature: input.method?.temperature !== undefined,
      useJsonMode: Boolean(input.method?.jsonMode)
    };
    const tried = new Set<string>();
    let lastError = "";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = JSON.stringify(options);
      if (tried.has(key)) {
        break;
      }
      tried.add(key);

      try {
        return await this.requestChatCompletion(input, settings, options);
      } catch (error) {
        const detail = errorText(error);
        lastError = detail;

        if (options.tokenParameter === "max_tokens" && providerRejectsMaxTokens(detail)) {
          options = { ...options, tokenParameter: "max_completion_tokens" };
          continue;
        }

        if (options.includeTemperature && providerRejectsTemperature(detail)) {
          options = { ...options, includeTemperature: false };
          continue;
        }

        if (options.useJsonMode && providerRejectsJsonMode(detail)) {
          options = { ...options, useJsonMode: false };
          continue;
        }

        throw error;
      }
    }

    throw new Error(lastError || "AI endpoint request failed before a response could be parsed.");
  }

  private async requestChatCompletion(
    input: {
      messages: ChatMessage[];
      method?: AgentMethodConfig | undefined;
    },
    settings: AiSettings,
    options: ChatAttemptOptions
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      if (settings.mode === "proxy") {
        return await this.requestProxyChat(input, settings, controller.signal);
      }

      const body: Record<string, unknown> = {
        model: settings.model || defaultModel,
        [options.tokenParameter]: options.maxTokens,
        stream: false,
        messages: input.messages
      };

      if (options.includeTemperature) {
        body.temperature = input.method?.temperature ?? 0;
      }

      if (options.useJsonMode) {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch(settings.endpoint.trim() || defaultEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiKey || placeholderApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `AI endpoint responded with ${response.status} ${response.statusText}: ${sanitizeErrorText(responseText)}`
        );
      }

      let payload: ChatCompletionResponse;
      try {
        payload = JSON.parse(responseText) as ChatCompletionResponse;
      } catch {
        throw new Error(`AI endpoint returned non-JSON response: ${sanitizeErrorText(responseText)}`);
      }

      if (payload.error?.message) {
        throw new Error(`AI endpoint returned an error: ${sanitizeErrorText(payload.error.message)}`);
      }

      const content = extractChatContent(payload);
      if (!content) {
        throw new Error(`AI endpoint returned an empty response: ${sanitizeErrorText(responseText)}`);
      }

      return content;
    } catch (error) {
      const detail = errorText(error);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI endpoint timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. ${detail}`);
      }

      if (detail.includes("valid JSON") || detail.startsWith("AI endpoint")) {
        throw new Error(detail);
      }

      throw new Error(`AI endpoint is unavailable. ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async streamTextAttempt(
    input: {
      messages: ChatMessage[];
      method?: AgentMethodConfig | undefined;
    },
    onDelta: (delta: string, content: string) => void,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const settings = await this.settingsProvider();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const forwardAbort = (): void => controller.abort();
    abortSignal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      if (settings.mode === "proxy") {
        const content = await this.requestProxyChat(input, settings, controller.signal);
        if (content) {
          onDelta(content, content);
        }
        return content;
      }

      const body: Record<string, unknown> = {
        model: settings.model || defaultModel,
        max_tokens: input.method?.maxTokens ?? 1024,
        stream: true,
        messages: input.messages
      };

      if (input.method?.temperature !== undefined) {
        body.temperature = input.method.temperature;
      }

      const response = await fetch(settings.endpoint.trim() || defaultEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiKey || placeholderApiKey}`,
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `AI endpoint responded with ${response.status} ${response.statusText}: ${sanitizeErrorText(detail)}`
        );
      }

      if (!response.body) {
        throw new Error("AI endpoint did not return a streaming response body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const splitIndex = Math.max(buffer.lastIndexOf("\n\n"), buffer.lastIndexOf("\r\n\r\n"));
        if (splitIndex < 0) {
          continue;
        }

        const ready = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex).replace(/^\r?\n\r?\n/, "");

        for (const data of parseSseLines(ready)) {
          if (data === "[DONE]") {
            return content;
          }

          let payload: ChatCompletionChunk;
          try {
            payload = JSON.parse(data) as ChatCompletionChunk;
          } catch {
            continue;
          }

          if (payload.error?.message) {
            throw new Error(`AI endpoint returned an error: ${sanitizeErrorText(payload.error.message)}`);
          }

          const delta = extractChunkDelta(payload);
          if (delta) {
            content += delta;
            onDelta(delta, content);
          }
        }
      }

      for (const data of parseSseLines(buffer)) {
        if (data === "[DONE]") {
          break;
        }
        try {
          const delta = extractChunkDelta(JSON.parse(data) as ChatCompletionChunk);
          if (delta) {
            content += delta;
            onDelta(delta, content);
          }
        } catch {
          // Ignore trailing malformed chunks from providers that close abruptly.
        }
      }

      if (!content) {
        throw new Error("AI endpoint returned an empty streaming response.");
      }

      return content;
    } catch (error) {
      const detail = errorText(error);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI endpoint stream was aborted. ${detail}`);
      }

      if (detail.startsWith("AI endpoint")) {
        throw new Error(detail);
      }

      throw new Error(`AI endpoint stream is unavailable. ${detail}`);
    } finally {
      abortSignal?.removeEventListener("abort", forwardAbort);
      clearTimeout(timeout);
    }
  }

  private async requestProxyChat(
    input: {
      messages: ChatMessage[];
      method?: AgentMethodConfig | undefined;
    },
    settings: AiSettings,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const requestId = randomUUID();
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey || placeholderApiKey}`,
        "Content-Type": "application/json",
        "X-Second-Brain-Request-Id": requestId
      },
      body: JSON.stringify({
        userIdOrKey: settings.apiKey || placeholderApiKey,
        model: settings.model || defaultModel,
        groundingEnabled: true,
        requestId,
        messages: input.messages
      })
    };

    if (abortSignal) {
      requestInit.signal = abortSignal;
    }

    const response = await fetch(settings.endpoint.trim() || defaultEndpoint, requestInit);

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AI endpoint responded with ${response.status} ${response.statusText}: ${sanitizeErrorText(responseText)}`);
    }

    let payload: ProxyChatResponse;
    try {
      payload = JSON.parse(responseText) as ProxyChatResponse;
    } catch {
      throw new Error(`AI endpoint returned non-JSON response: ${sanitizeErrorText(responseText)}`);
    }

    if (payload.error?.message) {
      throw new Error(`AI endpoint returned an error: ${sanitizeErrorText(payload.error.message)}`);
    }

    const content = extractProxyChatContent(payload);
    if (!content) {
      throw new Error(`AI endpoint returned an empty response: ${sanitizeErrorText(responseText)}`);
    }

    return content;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(task, task);
    this.requestQueue = run.catch(() => undefined);
    return run;
  }

}

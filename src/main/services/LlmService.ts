import type { JobTrackerRecord } from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jobJson";
import { agentMethods, agentPrompts, type AgentMethodConfig } from "./AgentRuntimeConfig";
import type { LocalToolSpec } from "./LocalToolRegistry";

export type ExtractedJobMetadata = Pick<JobTrackerRecord, "company" | "role" | "job_posted" | "description_summary">;

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
const requestTimeoutMs = 10_000;
const placeholderApiKey = "local-dev-placeholder";

function normalizeDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function normalizeOptionalDate(value: unknown): string {
  return normalizeDate(value, "");
}

function normalizeLine(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.replace(/\s+/g, " ").trim() || fallback;
}

function normalizeSummary(value: unknown): string {
  const normalized = normalizeLine(value, "Responsibilities and requirements were parsed from the dropped job description.");
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);

  return sentences.slice(0, 2).join(" ").slice(0, 420);
}

export class LlmService {
  constructor(private readonly endpoint = process.env.SECOND_BRAIN_LLM_ENDPOINT ?? defaultEndpoint) {}

  async completeJsonObject(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<Record<string, unknown>> {
    const content = await this.completeText({
      messages: input.messages,
      method: input.method
    });

    return parseLocalModelJsonObject(content);
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

  async extractJobMetadata(rawContent: string): Promise<ExtractedJobMetadata> {
    const parsed = await this.completeJsonObject({
      method: agentMethods.jobMetadataExtraction,
      messages: [
        {
          role: "system",
          content: agentPrompts.jobMetadataExtractor
        },
        {
          role: "user",
          content: rawContent
        }
      ]
    });

    return {
      company: normalizeLine(parsed.company, "Unknown company"),
      role: normalizeLine(parsed.role, "Unknown role"),
      job_posted: normalizeOptionalDate(parsed.job_posted ?? parsed.date),
      description_summary: normalizeSummary(parsed.description_summary)
    };
  }

  private async completeText(input: {
    messages: ChatMessage[];
    method?: AgentMethodConfig | undefined;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SECOND_BRAIN_LLM_API_KEY ?? placeholderApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          temperature: input.method?.temperature ?? 0,
          max_tokens: input.method?.maxTokens ?? 1024,
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
        throw new Error(`Local AI server timed out after 10 seconds. ${detail}`);
      }

      if (detail.includes("valid JSON")) {
        throw new Error(detail);
      }

      throw new Error(`Local AI server is unavailable. ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

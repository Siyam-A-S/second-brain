import type { JobTrackerRecord } from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jobJson";
import { agentMethods, agentPrompts, type AgentMethodConfig } from "./AgentRuntimeConfig";
import type { LocalToolSpec } from "./LocalToolRegistry";

export type ExtractedJobMetadata = Pick<JobTrackerRecord, "company" | "role" | "job_posted" | "description_summary">;
export type GraphifyMcpToolSpec = {
  name: string;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
};
export type GraphifyJobDraft = Pick<
  JobTrackerRecord,
  "company" | "role" | "job_posted" | "application_date" | "status" | "resume" | "description_summary" | "raw_content"
> & {
  source_file?: string | undefined;
  updated_at?: string | undefined;
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

function normalizeGraphifyJobDraft(value: unknown): GraphifyJobDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const company = normalizeLine(parsed.company, "Unknown company");
  const role = normalizeLine(parsed.role, "Unknown role");
  const descriptionSummary = normalizeSummary(parsed.description_summary ?? parsed.summary);

  if (company === "Unknown company" && role === "Unknown role") {
    return null;
  }

  return {
    company,
    role,
    job_posted: normalizeOptionalDate(parsed.job_posted ?? parsed.date),
    application_date: normalizeDate(parsed.application_date, new Date().toISOString().slice(0, 10)),
    status: "Applied",
    resume: typeof parsed.resume === "string" ? parsed.resume : "",
    description_summary: descriptionSummary,
    raw_content: typeof parsed.raw_content === "string" ? parsed.raw_content : "",
    source_file: typeof parsed.source_file === "string" ? parsed.source_file : undefined,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined
  };
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

  async planGraphifyJobQuery(tools: GraphifyMcpToolSpec[]): Promise<PlannedLocalToolCall> {
    const parsed = await this.completeJsonObject({
      method: agentMethods.jobMetadataExtraction,
      messages: [
        {
          role: "system",
          content: [
            "You are the Second Brain Graphify MCP planner.",
            "Choose exactly one Graphify MCP tool call that retrieves job descriptions, companies, roles, posting dates, source files, and modified timestamps from graph topology.",
            "Return exactly one raw JSON object with schema {\"tool\":\"string\",\"input\":{},\"reason\":\"string\"}.",
            "Use the tool input schema literally. Do not search files manually."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Query Graphify for Job Descriptions and Companies in the generated graph.json topology.",
            tools
          })
        }
      ]
    });

    const tool = parsed.tool ?? parsed.name;
    const input = parsed.input ?? parsed.arguments ?? parsed.parameters;

    if (typeof tool !== "string" || !tool.trim()) {
      throw new Error("Local AI server did not choose a Graphify MCP tool.");
    }

    if (!input || typeof input !== "object") {
      throw new Error(`Local AI server did not return input for Graphify MCP tool "${tool}".`);
    }

    return {
      tool: tool.trim(),
      input,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined
    };
  }

  async extractJobsFromGraphifyContext(context: string): Promise<GraphifyJobDraft[]> {
    const parsed = await this.completeJsonObject({
      method: agentMethods.jobMetadataExtraction,
      messages: [
        {
          role: "system",
          content: [
            "You extract Job Tracker rows from Graphify MCP output.",
            "Return exactly one raw JSON object with schema {\"jobs\":[{\"company\":\"string\",\"role\":\"string\",\"job_posted\":\"YYYY-MM-DD or empty string\",\"application_date\":\"YYYY-MM-DD\",\"description_summary\":\"string\",\"source_file\":\"string\",\"updated_at\":\"ISO timestamp or empty string\",\"raw_content\":\"string\"}]}",
            "Only include rows supported by the graph context. Use source_file and updated_at when the MCP output provides them.",
            "Do not include markdown, prose, explanations, or code fences."
          ].join(" ")
        },
        {
          role: "user",
          content: context
        }
      ]
    });
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];

    return jobs.map(normalizeGraphifyJobDraft).filter((job): job is GraphifyJobDraft => Boolean(job));
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

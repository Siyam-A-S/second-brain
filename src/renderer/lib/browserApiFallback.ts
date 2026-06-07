import type {
  JobIngestionStatus,
  JobTrackerRecord,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  SecondBrainApi,
  UpdateJobTrackerInput
} from "../../shared/ipc";
import { parseLocalModelJsonObject } from "../../shared/jobJson";

type ExtractedJobMetadata = Pick<JobTrackerRecord, "company" | "role" | "job_posted" | "description_summary">;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null | undefined;
      reasoning_content?: string | null | undefined;
    };
  }>;
};

const localEndpoint = import.meta.env.VITE_LOCAL_LLM_ENDPOINT ?? "/local-llm/v1/chat/completions";
const timeoutMs = 10_000;
const jobStatusHandlers = new Set<(status: JobIngestionStatus) => void>();
const browserJobs: JobTrackerRecord[] = [];

function todayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLine(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? compact(value) : fallback;
}

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

function normalizeSummary(value: unknown): string {
  const normalized = normalizeLine(value, "Responsibilities and requirements were parsed from the dropped job description.");
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(" ").slice(0, 420);
}

function looksLikeJobDescription(content: string): boolean {
  const lower = content.toLowerCase();
  const signals = [
    "job description",
    "responsibilities",
    "requirements",
    "qualifications",
    "apply",
    "salary",
    "benefits",
    "full-time",
    "internship",
    "about the role",
    "we are hiring"
  ];

  return signals.filter((signal) => lower.includes(signal)).length >= 2;
}

function emitJobStatus(status: JobIngestionStatus): void {
  for (const handler of jobStatusHandlers) {
    handler(status);
  }
}

function readDroppedContent(items: ProcessDroppedItem[]): string {
  return items
    .map((item) => item.text ?? item.content ?? item.name ?? item.path ?? "")
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();
}

async function extractJobMetadata(rawContent: string, date = new Date()): Promise<ExtractedJobMetadata> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(localEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: [
              "You extract job application metadata for Second Brain.",
              "Return exactly one raw minified JSON object.",
              "Do not include markdown, prose, explanations, or code fences.",
              "Use this schema: {\"company\":\"string\",\"role\":\"string\",\"job_posted\":\"YYYY-MM-DD or empty string\",\"description_summary\":\"string\"}.",
              "In role string, append Job ID/ Role number if available",
              "The job_posted field is the original posting date found in the dropped content. Use an empty string if no posting date appears.",
              "The description_summary must be one JSON string containing keyword-heavy jargons of tech stack required for this role.",
              "Do not put raw line breaks inside string values."
            ].join(" ")
          },
          {
            role: "user",
            content: rawContent
          }
        ],
        temperature: 0,
        max_tokens: 4098,
        stream: false
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

    const parsed = parseLocalModelJsonObject(content);

    return {
      company: normalizeLine(parsed.company, "Unknown company"),
      role: normalizeLine(parsed.role, "Unknown role"),
      job_posted: normalizeOptionalDate(parsed.job_posted ?? parsed.date),
      description_summary: normalizeSummary(parsed.description_summary)
    };
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
    window.clearTimeout(timeout);
  }
}

async function processDroppedItemsInBrowser(items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
  const rawContent = readDroppedContent(items);
  const now = new Date().toISOString();
  const createdNode = {
    uuid: `browser-preview-${crypto.randomUUID()}`,
    title: compact(rawContent.split(/\r?\n/).find(Boolean) ?? "Browser Preview Fragment").slice(0, 80),
    type: "fragment",
    summary: compact(rawContent).slice(0, 220) || "Preview-only dropped item.",
    parent_uuid: null,
    connections: [],
    tags: [],
    content: rawContent,
    path: "/browser-preview",
    updatedAt: now,
    created_at: now,
    importance: 0.5,
    user_validation: "unreviewed" as const,
    context_hints: []
  };
  const baseResult = {
    prompt: `Browser preview received ${items.length} dropped item(s).`,
    createdNode,
    routing: {
      strategy: "new-topic" as const,
      parent_uuid: "browser-preview-topic",
      parent_title: "Browser Preview",
      confidence: 0,
      reasons: ["Browser preview fallback."]
    }
  };

  if (!rawContent) {
    return baseResult;
  }

  if (!looksLikeJobDescription(rawContent)) {
    return baseResult;
  }

  emitJobStatus({
    stage: "extracting",
    message: "Calling local AI server at localhost:8080..."
  });

  try {
    const metadata = await extractJobMetadata(rawContent);
    const job: JobTrackerRecord = {
      uuid: `browser-job-${crypto.randomUUID()}`,
      ...metadata,
      application_date: todayString(),
      status: "Applied",
      resume: "",
      raw_content: rawContent,
      createdAt: now,
      updatedAt: new Date().toISOString()
    };

    browserJobs.unshift(job);
    emitJobStatus({
      stage: "saved",
      message: `Saved ${job.role} at ${job.company}`,
      job
    });

    return {
      prompt: baseResult.prompt,
      job
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local job extraction failed.";
    emitJobStatus({
      stage: "error",
      message,
      error: message
    });

    return {
      prompt: baseResult.prompt,
      jobError: message
    };
  }
}

const browserApiFallback: SecondBrainApi = {
  window: {
    minimize: async () => undefined,
    maximize: async () => false,
    close: async () => undefined,
    restore: async () => undefined,
    getWidgetBounds: async () => ({
      x: 0,
      y: 0,
      width: 96,
      height: 96
    }),
    moveWidget: async (payload) => ({
      x: payload.x,
      y: payload.y,
      width: 96,
      height: 96
    })
  },
  files: {
    dropped: async (payload) => {
      console.info("Browser renderer drop payload", payload);
    }
  },
  brain: {
    writeNode: async (input) => ({
      uuid: input.uuid ?? "browser-preview",
      title: input.title,
      type: input.type,
      summary: input.summary,
      parent_uuid: input.parent_uuid ?? null,
      connections: input.connections ?? [],
      tags: input.tags ?? [],
      content: input.content,
      path: "/browser-preview",
      updatedAt: new Date().toISOString(),
      created_at: input.created_at ?? new Date().toISOString(),
      importance: input.importance ?? 0.5,
      user_validation: input.user_validation ?? "unreviewed",
      context_hints: input.context_hints ?? []
    }),
    readNode: async (uuid) => {
      throw new Error(`Browser preview cannot read node "${uuid}".`);
    },
    listNodes: async () => [],
    searchNodes: async () => [],
    getMcpStatus: async () => ({
      running: false,
      url: "http://127.0.0.1:4127/mcp",
      port: 4127
    }),
    processDroppedItems: processDroppedItemsInBrowser,
    getOrganizedBoard: async () => [],
    exportBoardPlaintext: async () => "# Browser Preview Board",
    updateNodeSignals: async (input) => ({
      uuid: input.uuid,
      title: "Browser Preview",
      type: "fragment",
      summary: "Preview-only node.",
      parent_uuid: null,
      connections: [],
      tags: [],
      content: "",
      path: "/browser-preview",
      updatedAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      importance: input.importance ?? 0.5,
      user_validation: input.user_validation ?? "unreviewed",
      context_hints: input.context_hints ?? []
    })
  },
  jobs: {
    list: async () => browserJobs,
    update: async (input: UpdateJobTrackerInput) => {
      const jobIndex = browserJobs.findIndex((job) => job.uuid === input.uuid);

      if (jobIndex < 0) {
        throw new Error(`Browser preview cannot find job "${input.uuid}".`);
      }

      const current = browserJobs[jobIndex] as JobTrackerRecord;
      const updated = {
        ...current,
        status: input.status ?? current.status,
        resume: input.resume ?? current.resume,
        updatedAt: new Date().toISOString()
      };

      browserJobs.splice(jobIndex, 1);
      browserJobs.unshift(updated);
      return updated;
    },
    onIngestionStatus: (handler) => {
      jobStatusHandlers.add(handler);
      return () => {
        jobStatusHandlers.delete(handler);
      };
    }
  }
};

export function installBrowserApiFallback(): void {
  if (window.api || !import.meta.env.DEV) {
    return;
  }

  window.api = browserApiFallback;
}

import type { AiSettings, TrackerRecord } from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jsonObject";
import { agentMethods, agentPrompts, type AgentMethodConfig } from "./AgentRuntimeConfig";
import type { LocalToolSpec } from "./LocalToolRegistry";

export type ExtractedTrackerMetadata = Pick<
  TrackerRecord,
  "title" | "date" | "time" | "endTime" | "timezone" | "location" | "link" | "context"
> & {
  trackable: boolean;
};
export type GraphifyMcpToolSpec = {
  name: string;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
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
const trackerChunkCharLimit = 10_000;
const trackerEventGroupSize = 6;
const placeholderApiKey = "local-dev-placeholder";

type AiSettingsProvider = () => Promise<AiSettings>;

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

function normalizeOptionalLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function shouldRetryWithFallback(message: string): boolean {
  return /context|token|too large|max_tokens|max_completion_tokens|400|413|422|valid JSON|truncat/i.test(message);
}

function compactText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function splitParagraphs(value: string): string[] {
  return compactText(value)
    .split(/\n{2,}|(?=\n\s*(?:event name|event date|hackathon|webinar|conference|meeting|deadline|due)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasTrackerDateSignal(value: string): boolean {
  return (
    /\b(?:today|tomorrow|tonight|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(value) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i.test(value) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(value) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(value)
  );
}

function splitTrackerChunks(rawContent: string): string[] {
  const compact = compactText(rawContent);
  if (compact.length <= trackerChunkCharLimit && splitParagraphs(compact).filter(hasTrackerDateSignal).length < trackerEventGroupSize) {
    return [compact];
  }

  const eventLike = splitParagraphs(compact);
  const units = eventLike.length > 1 ? eventLike : compact.split(/\n(?=\s*[-*]?\s*\S)/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  let currentEvents = 0;

  for (const unit of units) {
    const nextLength = currentLength + unit.length + 2;
    const nextEvents = currentEvents + Number(hasTrackerDateSignal(unit));

    if (current.length > 0 && (nextLength > trackerChunkCharLimit || nextEvents > trackerEventGroupSize)) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLength = 0;
      currentEvents = 0;
    }

    current.push(unit);
    currentLength += unit.length + 2;
    currentEvents += Number(hasTrackerDateSignal(unit));
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.length > 0 ? chunks : [compact];
}

function normalizeTrackerItem(value: unknown): ExtractedTrackerMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const title = normalizeLine(parsed.title ?? parsed.name ?? parsed.event_name ?? parsed.meeting_name, "Track item");
  const date = normalizeOptionalDate(parsed.date);
  const time = normalizeOptionalLine(parsed.time ?? parsed.start_time);
  const endTime = normalizeOptionalLine(parsed.endTime ?? parsed.end_time);
  const timezone = normalizeOptionalLine(parsed.timezone);
  const location = normalizeOptionalLine(parsed.location ?? parsed.place);
  const link = normalizeUrl(parsed.link ?? parsed.join_link ?? parsed.url);
  const context = normalizeLine(parsed.context ?? parsed.description ?? parsed.summary, title);
  const trackable = parsed.trackable !== false && Boolean(date || time);

  if (!trackable) {
    return null;
  }

  return {
    trackable,
    title,
    date,
    time,
    ...(endTime ? { endTime } : {}),
    ...(timezone ? { timezone } : {}),
    ...(location ? { location } : {}),
    ...(link ? { link } : {}),
    context
  };
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

  async extractTrackerMetadata(rawContent: string, source = ""): Promise<ExtractedTrackerMetadata[]> {
    const today = new Date().toISOString().slice(0, 10);
    const chunks = splitTrackerChunks(rawContent);
    const items: ExtractedTrackerMetadata[] = [];

    for (const [index, chunk] of chunks.entries()) {
      const parsed = await this.completeJsonObject({
        method: agentMethods.trackerExtraction,
        messages: [
          {
            role: "system",
            content: [
              "You extract tracker rows from calendar-like text, event descriptions, hackathon lists, emails, reminders, deadlines, meetings, webinars, appointments, due dates, and follow-ups.",
              "Return exactly one raw minified JSON object.",
              "No markdown, prose, explanations, or code fences.",
              "Schema: {\"items\":[{\"trackable\":boolean,\"title\":\"meeting/event/hackathon name\",\"date\":\"YYYY-MM-DD or empty string\",\"time\":\"HH:MM or empty string\",\"endTime\":\"HH:MM or empty string\",\"timezone\":\"string or empty string\",\"location\":\"place or empty string\",\"link\":\"join/application/details URL or empty string\",\"context\":\"short useful context\"}]}",
              "Create one item for each distinct event, meeting, hackathon, deadline, or follow-up. Preserve event names, places, join links, and useful surrounding context.",
              "For Outlook/Gmail event descriptions, use Event name as title, Event date and time as date/time/endTime/timezone, Link to join event as link, and More about the event as context/link when useful.",
              `Today is ${today}. Resolve simple relative dates like today, tomorrow, next week, and Friday when the content gives enough context.`,
              "Set items to [] when the chunk has no real date, time, deadline, event, schedule, or follow-up.",
              source ? `Source hint: ${source}` : "",
              `Chunk ${index + 1} of ${chunks.length}.`
            ]
              .filter(Boolean)
              .join(" ")
          },
          {
            role: "user",
            content: chunk
          }
        ]
      });

      const rawItems = Array.isArray(parsed.items) ? parsed.items : parsed.trackable ? [parsed] : [];
      items.push(...rawItems.map(normalizeTrackerItem).filter((item): item is ExtractedTrackerMetadata => Boolean(item)));
    }

    return this.dedupeTrackerItems(items);
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

  private dedupeTrackerItems(items: ExtractedTrackerMetadata[]): ExtractedTrackerMetadata[] {
    const seen = new Set<string>();
    const deduped: ExtractedTrackerMetadata[] = [];

    for (const item of items) {
      const key = [item.title.toLowerCase(), item.date, item.time, item.link ?? ""].join("|");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(item);
    }

    return deduped;
  }
}

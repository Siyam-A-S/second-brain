import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppSettings,
  ChatArtifact,
  ChatArtifactActionResult,
  ChatMessage,
  ChatSemanticRouting,
  ChatResponse,
  ChatSendInput,
  ChatStreamEvent,
  ChatThread,
  GraphifyContextResult,
  GraphifyIngestionResult,
  ProcessDroppedItem,
  ProposedTrackerDraft,
  SaveChatArtifactInput
} from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jsonObject";
import type { CreateToolArtifactInput } from "./ArtifactToolService";
import { LlmService, type ChatMessage as LlmChatMessage, type PlannedLocalToolCall } from "./LlmService";
import { LocalMcpServer } from "./LocalMcpServer";
import type { LocalToolName, LocalToolSpec } from "./LocalToolRegistry";

type AppSettingsProvider = () => Promise<AppSettings>;
type AccessTokenProvider = () => Promise<string | null>;
type ArtifactIngestor = (items: ProcessDroppedItem[]) => Promise<GraphifyIngestionResult>;

type ChatState = {
  threads: ChatThread[];
};

type ProxyResponse = {
  text?: string | undefined;
  output_text?: string | undefined;
  groundingMetadata?: unknown;
  grounding_metadata?: unknown;
  usage?: unknown;
  model?: string | undefined;
  requestId?: string | undefined;
  choices?: Array<{
    text?: string | undefined;
    message?: {
      content?:
        | string
        | Array<{
            text?: string | undefined;
            content?: string | undefined;
          }>
        | undefined;
    };
  }>;
  attachments?: ProxyAttachment[] | undefined;
  artifacts?: ProxyAttachment[] | undefined;
  files?: ProxyAttachment[] | undefined;
  error?: {
    message?: string | undefined;
  };
};

type ProxyAttachment = {
  filename?: string | undefined;
  name?: string | undefined;
  mimeType?: string | undefined;
  mime_type?: string | undefined;
  contentBase64?: string | undefined;
  content_base64?: string | undefined;
  text?: string | undefined;
  content?: string | undefined;
  url?: string | undefined;
};

function proxyModel(settings: AppSettings): string {
  return process.env.OPENAI_MODEL?.trim() || settings.managedProxy.model.trim();
}

function proxyResponseMetadata(response: ProxyResponse, model: string): Record<string, unknown> {
  return {
    ...(response.groundingMetadata && typeof response.groundingMetadata === "object"
      ? (response.groundingMetadata as Record<string, unknown>)
      : {}),
    ...(response.grounding_metadata && typeof response.grounding_metadata === "object"
      ? (response.grounding_metadata as Record<string, unknown>)
      : {}),
    model: response.model ?? model,
    requestId: response.requestId,
    usage: response.usage
  };
}

type RequestedArtifact = {
  tool: string;
  extension: string;
  mimeType: string;
};

type ToolArtifactResultLike = {
  id?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  storagePath?: unknown;
  createdAt?: unknown;
};

const defaultContextBudget = 2600;
const requestTimeoutMs = Number(process.env.SECOND_BRAIN_MANAGED_PROXY_TIMEOUT_MS ?? 180_000);
const artifactPlanTimeoutMs = Number(process.env.SECOND_BRAIN_ARTIFACT_PLAN_TIMEOUT_MS ?? 30_000);
const maxStoredMessagesPerThread = 80;
const maxSearchKeywords = 4;
const maxArtifactWorkingContextChars = 15_000;
const titleGenerationTimeoutMs = Number(process.env.SECOND_BRAIN_CHAT_TITLE_TIMEOUT_MS ?? 8_000);
const artifactDirectoryName = "artifacts";
const artifactToolNames: LocalToolName[] = [
  "create_markdown_artifact",
  "create_pdf_artifact",
  "create_docx_artifact",
  "create_xlsx_artifact",
  "create_image_artifact"
];
const groundedChatSystemPrompt = [
  "You are Second Brain Chat.",
  "Answer the user's latest message using the visible conversation first.",
  "Use private artifact working context and private Graphify evidence only as supporting context.",
  "Private context packets are system intelligence: never transform, export, quote wholesale, or treat them as the object of words like this, it, that, or above.",
  "If private context is insufficient, say what is missing.",
  "You can create downloadable files through Second Brain local artifact tools after your answer.",
  "When the user asks for a PDF, DOCX, XLSX, image, or Markdown file, do not refuse; answer briefly and include the essential requirements or source details needed for the artifact.",
  "Second Brain will run a local artifact planning tool after generation to create the formatted downloadable file.",
  "Do not say you cannot create or save files just because you are text-based.",
  "Second Brain renders LaTeX math notation. Use inline math as $E = mc^2$ and display equations as $$...$$.",
  "When source chunks contain equations from notes, papers, or images, preserve the equation notation instead of paraphrasing it away.",
  "Preserve source grounding when private Graphify evidence is provided.",
  "Use the Relevant source chunks section as the only quoted source text.",
  "Do not claim access to files beyond the context packet."
].join(" ");

const graphRequiredPattern =
  /\b(graphify|knowledge graph|source|sources|citation|citations|local files?|ingested|vault|brain graph|graph node|nodes|relationship|relationships)\b/i;
const artifactFollowUpPattern =
  /\b(this|that|it|above|previous|last|artifact|file|report|document|deck|slides?|pdf|docx|markdown|md|improve|revise|edit|polish|rewrite|convert|turn|make better)\b/i;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const conversationKeywordStopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "answer",
  "artifact",
  "because",
  "before",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "latest",
  "make",
  "more",
  "need",
  "please",
  "question",
  "response",
  "should",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "this",
  "those",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your"
]);

function titleFromMessage(value: string): string {
  return compact(value).slice(0, 80) || "New Chat";
}

function createFreshThread(title = "New Chat"): ChatThread {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function isFreshUnusedThread(thread: ChatThread): boolean {
  return thread.messages.length === 0;
}

export const chatServiceTestUtils = {
  buildChatMessagesForTest: (
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    artifactWorkingContext = ""
  ) => buildChatMessagesForPrompt(thread, question, graphify, artifactWorkingContext),
  buildConversationSearchScope,
  extractConversationKeywords,
  normalizeGeneratedChatTitle,
  normalizeSearchQuery,
  shouldPreferConversationContext
};

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

function extractProxyText(payload: ProxyResponse): string {
  const choice = payload.choices?.[0];
  return (
    payload.text?.trim() ||
    payload.output_text?.trim() ||
    extractContentPart(choice?.message?.content) ||
    choice?.text?.trim() ||
    ""
  );
}

function normalizeSearchQuery(value: string, fallback: string): string {
  const cleaned = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(keywords?|query|search query):\s*/i, "")
    .replace(/^[\s*•-]+/gm, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[,\[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const keywords = extractConversationKeywords(cleaned || fallback, maxSearchKeywords);
  return keywords.length ? keywords.join(" ") : compact(fallback);
}

function extractConversationKeywords(value: string, limit = maxSearchKeywords): string[] {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .flatMap((token) => token.split(/[./-]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 36 && !conversationKeywordStopWords.has(token));

  tokens.forEach((token, index) => {
    const current = counts.get(token);
    counts.set(token, {
      count: (current?.count ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1].count - left[1].count || left[1].firstIndex - right[1].firstIndex)
    .map(([token]) => token)
    .slice(0, limit);
}

function hasGeneratedFileArtifacts(artifacts: ChatArtifact[] | undefined): boolean {
  return Boolean(artifacts?.some((artifact) => artifact.source === "local-tool" || artifact.source === "proxy-attachment"));
}

function threadHasRecentGeneratedArtifact(thread: ChatThread, question: string): boolean {
  return recentThreadWithoutCurrentQuestion(thread, question)
    .slice(-8)
    .some((message) => message.role === "assistant" && hasGeneratedFileArtifacts(message.artifacts));
}

function shouldPreferConversationContext(thread: ChatThread, question: string): boolean {
  return threadHasRecentGeneratedArtifact(thread, question) && artifactFollowUpPattern.test(question) && !graphRequiredPattern.test(question);
}

function normalizeGroundingMode(value: unknown, thread: ChatThread, question: string): "conversation" | "graph" {
  if (shouldPreferConversationContext(thread, question)) {
    return "conversation";
  }

  if (value === "conversation" || value === "graph") {
    return value;
  }

  return graphRequiredPattern.test(question) ? "graph" : "conversation";
}

function normalizeTargetArtifactIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))
  ).slice(0, 6);
}

function artifactChatConfirmation(artifacts: ChatArtifact[]): string {
  return artifacts.length === 1 ? "I generated the file." : `I generated ${artifacts.length} files.`;
}

function formatMessageForScopedSearch(message: ChatMessage): string {
  const parts = [`${message.role}: ${compact(message.content).slice(0, 900)}`];
  const artifacts = message.artifacts
    ?.map((artifact) => `${artifact.id} ${artifact.filename} ${artifact.mimeType}`)
    .filter(Boolean)
    .join("; ");
  if (artifacts) {
    parts.push(`artifacts: ${artifacts}`);
  }

  const trackers = message.semantic?.proposedTrackers
    ?.map((tracker) => `${tracker.title} ${(tracker.contextKeywords ?? []).join(" ")}`)
    .filter(Boolean)
    .join("; ");
  if (trackers) {
    parts.push(`tracker drafts: ${trackers}`);
  }

  return parts.join("\n");
}

function recentThreadWithoutCurrentQuestion(thread: ChatThread, question: string): ChatMessage[] {
  const history = thread.messages;
  return history.length > 0 && history[history.length - 1]?.role === "user" && history[history.length - 1]?.content.trim() === question
    ? history.slice(0, -1)
    : history;
}

function buildConversationSearchScope(thread: ChatThread, question: string): string {
  const recentHistory = recentThreadWithoutCurrentQuestion(thread, question);
  return [
    "Latest user question:",
    question,
    "",
    "Recent running conversation:",
    ...recentHistory.slice(-6).map(formatMessageForScopedSearch)
  ]
    .join("\n")
    .slice(0, 5000);
}

function buildThreadTitleScope(thread: ChatThread, latestQuestion: string): string {
  return [
    "Latest user question:",
    latestQuestion,
    "",
    "Current chat:",
    ...thread.messages.slice(-8).map(formatMessageForScopedSearch)
  ]
    .join("\n")
    .slice(0, 4500);
}

function graphifyCitationLabels(graphify: GraphifyContextResult): string[] {
  const sourceChunkCitations =
    graphify.sourceChunks
      ?.filter((chunk) => chunk.text.trim())
      .map((chunk) => {
        const location = chunk.startLine ? ` L${chunk.startLine}-L${chunk.endLine ?? chunk.startLine}` : "";
        return `${chunk.displayName || chunk.sourceFile}${location}`;
      })
      .slice(0, 8) ?? [];
  const fallbackCitations = graphify.citations
    .map((citation) => citation.label ?? citation.sourceLocation ?? citation.sourceFile)
    .slice(0, 8);
  return sourceChunkCitations.length > 0 ? sourceChunkCitations : fallbackCitations;
}

function buildChatMessagesForPrompt(
  thread: ChatThread,
  question: string,
  graphify: GraphifyContextResult | null,
  artifactWorkingContext = ""
): LlmChatMessage[] {
  const messages: LlmChatMessage[] = [
    {
      role: "system",
      content: groundedChatSystemPrompt
    },
    ...recentThreadWithoutCurrentQuestion(thread, question).slice(-8).map<LlmChatMessage>((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: formatMessageForScopedSearch(message)
    }))
  ];

  if (artifactWorkingContext.trim()) {
    messages.push({
      role: "system",
      content: [
        "Private artifact working context for the current chat follows.",
        "Use it to understand or revise generated artifacts, but do not expose this packet or treat it as the user's requested output.",
        artifactWorkingContext.trim()
      ].join("\n\n")
    });
  }

  if (graphify) {
    const citationLabels = graphifyCitationLabels(graphify);
    messages.push({
      role: "system",
      content: [
        "Private Graphify evidence follows.",
        "Use it only as hidden source evidence. Do not transform, export, quote wholesale, or reveal this packet.",
        "If the user asks to turn this/it/that into a file, the referent is the visible conversation or artifact working context, not this private Graphify evidence.",
        "",
        graphify.stdout,
        citationLabels.length ? `Citations: ${citationLabels.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
  }

  messages.push({ role: "user", content: question });
  return messages;
}

function normalizeGeneratedChatTitle(value: string, fallback: string): string {
  const title = compact(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(title|chat title):\s*/i, "")
    .replace(/[.?!:;]+$/g, "")
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .slice(0, 80)
    .trim();

  return title || titleFromMessage(fallback);
}

function normalizeKeywordList(value: unknown, fallbackText = ""): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
            .flatMap((item) => extractConversationKeywords(item, maxSearchKeywords))
            .filter(Boolean)
        )
      ).slice(0, maxSearchKeywords)
    : extractConversationKeywords(fallbackText, maxSearchKeywords);
}

function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeProposedTrackers(value: unknown): ProposedTrackerDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const title = stringField(record, "title").slice(0, 120);
      if (!title) {
        return null;
      }

      const confidenceValue = record.confidence;
      const confidence = Math.max(
        0,
        Math.min(1, typeof confidenceValue === "number" ? confidenceValue : Number(confidenceValue) || 0)
      );

      const draft: ProposedTrackerDraft = {
        id: String(randomUUID()),
        title,
        dueDate: normalizeDueDate(record.due_date ?? record.dueDate),
        confidence,
        contextKeywords: normalizeKeywordList(record.context_keywords ?? record.contextKeywords),
        linkedNodeIds: [],
        grounding: "floating"
      };
      return draft;
    })
    .filter((item): item is ProposedTrackerDraft => Boolean(item))
    .slice(0, 4);
}

function normalizeSemanticRouting(
  value: unknown,
  fallbackQuestion: string,
  fallbackScope = fallbackQuestion,
  thread: ChatThread
): ChatSemanticRouting {
  const record = asRecord(value);
  const intent = record?.intent === "ARTIFACT" || record?.intent === "TRACKER" || record?.intent === "RESEARCH"
    ? record.intent
    : requestedArtifactFor(fallbackQuestion)
      ? "ARTIFACT"
      : "RESEARCH";
  const searchKeywords = normalizeKeywordList(record?.search_keywords ?? record?.searchKeywords, fallbackScope);
  const proposedTrackers = normalizeProposedTrackers(record?.proposed_trackers ?? record?.proposedTrackers);
  const groundingMode = normalizeGroundingMode(record?.grounding_mode ?? record?.groundingMode, thread, fallbackQuestion);
  const targetArtifactIds = normalizeTargetArtifactIds(record?.target_artifact_ids ?? record?.targetArtifactIds);
  const fallbackDraft: ProposedTrackerDraft = {
    id: String(randomUUID()),
    title: titleFromMessage(fallbackQuestion),
    confidence: 0.72,
    contextKeywords: searchKeywords,
    linkedNodeIds: [],
    grounding: "floating"
  };

  return {
    intent,
    groundingMode,
    searchKeywords,
    targetArtifactIds,
    proposedTrackers: intent === "TRACKER" && proposedTrackers.length === 0 ? [fallbackDraft] : proposedTrackers
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeFilePart(value: string): string {
  const parsed = path.parse(value || "artifact");
  const base = (parsed.name || "artifact")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 18);
  return `${base || "artifact"}${ext}`;
}

function artifactMimeFromName(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".txt") {
    return "text/plain";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

function markdownArtifactBody(message: ChatMessage, override?: { title?: string | undefined; content?: string | undefined }): string {
  return [
    `# ${override?.title?.trim() || "Chat Response"}`,
    "",
    `Message: ${message.id}`,
    `Created: ${message.createdAt}`,
    "",
    (override?.content ?? message.content).trim(),
    ""
  ].join("\n");
}

function truncateForWorkingContext(value: string, limit = 50_000): string {
  const compacted = value.replace(/\r/g, "").trim();
  return compacted.length > limit ? `${compacted.slice(0, limit)}\n\n[Truncated]` : compacted;
}

function astPayloadToPlainText(value: unknown): string {
  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const meta = asRecord(record.meta);
  const lines: string[] = [];
  const title = typeof meta?.title === "string" ? meta.title.trim() : "";
  if (title) {
    lines.push(`# ${title}`, "");
  }

  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  for (const nodeValue of nodes) {
    const node = asRecord(nodeValue);
    if (!node) {
      continue;
    }

    const type = typeof node.type === "string" ? node.type.toUpperCase() : "";
    const text = typeof node.text === "string" ? node.text.trim() : "";
    if (type === "SLIDE_BREAK") {
      lines.push("", "---", "");
      continue;
    }

    if (Array.isArray(node.spans)) {
      const spanText = node.spans
        .map((spanValue) => {
          const span = asRecord(spanValue);
          return typeof span?.text === "string" ? span.text : "";
        })
        .join("")
        .trim();
      if (spanText) {
        lines.push(spanText);
      }
      continue;
    }

    if (type === "BULLET_ITEM") {
      const prefix =
        typeof node.bold_prefix === "string"
          ? node.bold_prefix
          : typeof node.boldPrefix === "string"
            ? node.boldPrefix
            : "";
      lines.push(`- ${[prefix.trim(), text].filter(Boolean).join(" ")}`.trim());
      continue;
    }

    if (type === "NUMBERED_ITEM") {
      lines.push(text ? `1. ${text}` : "");
      continue;
    }

    if (type === "BAR_CHART") {
      if (text) {
        lines.push(text);
      }
      const data = Array.isArray(node.data) ? node.data : Array.isArray(node.items) ? node.items : [];
      for (const itemValue of data) {
        const item = asRecord(itemValue);
        const label = typeof item?.label === "string" ? item.label.trim() : "";
        const itemValueText = item?.value === undefined ? "" : String(item.value);
        if (label || itemValueText) {
          lines.push(`- ${label}: ${itemValueText}`);
        }
      }
      continue;
    }

    if (type === "MATH_INLINE") {
      if (text) {
        lines.push(`$${text}$`);
      }
      continue;
    }

    if (type === "MATH_BLOCK") {
      if (text) {
        lines.push("$$", text, "$$");
      }
      continue;
    }

    if (text) {
      lines.push(text);
    }
  }

  return truncateForWorkingContext(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function collectProxyAttachments(payload: ProxyResponse): ProxyAttachment[] {
  return [...(payload.attachments ?? []), ...(payload.artifacts ?? []), ...(payload.files ?? [])];
}

function requestedArtifactFor(question: string): RequestedArtifact | null {
  const normalized = question.toLowerCase();
  if (/\b(pdf|\.pdf|deck|slides?|presentation)\b/.test(normalized)) {
    return { tool: "create_pdf_artifact", extension: ".pdf", mimeType: "application/pdf" };
  }
  if (/\b(docx|\.docx|word document|microsoft word)\b/.test(normalized)) {
    return {
      tool: "create_docx_artifact",
      extension: ".docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
  }
  if (/\b(xlsx|\.xlsx|spreadsheet|excel workbook|excel file)\b/.test(normalized)) {
    return {
      tool: "create_xlsx_artifact",
      extension: ".xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    };
  }
  if (/\b(image|diagram|svg|\.svg|picture)\b/.test(normalized)) {
    return { tool: "create_image_artifact", extension: ".svg", mimeType: "image/svg+xml" };
  }
  if (/\b(markdown|\.md)\b/.test(normalized)) {
    return { tool: "create_markdown_artifact", extension: ".md", mimeType: "text/markdown" };
  }

  return null;
}

function requestedDocumentType(question: string): string {
  const normalized = question.toLowerCase();
  if (/\b(cover letter|letter)\b/.test(normalized)) {
    return "letter";
  }
  if (/\b(resume|résumé|cv|curriculum vitae)\b/.test(normalized)) {
    return "resume";
  }
  if (/\b(summary|summarize|brief)\b/.test(normalized)) {
    return "summary";
  }
  if (/\b(report|analysis|memo)\b/.test(normalized)) {
    return "report";
  }
  if (/\b(deck|slides?|presentation)\b/.test(normalized)) {
    return "presentation";
  }
  if (/\b(proposal|pitch)\b/.test(normalized)) {
    return "proposal";
  }
  if (/\b(invoice|receipt)\b/.test(normalized)) {
    return "invoice";
  }
  if (/\b(spreadsheet|xlsx|excel|table)\b/.test(normalized)) {
    return "spreadsheet";
  }
  if (/\b(image|diagram|svg|picture)\b/.test(normalized)) {
    return "diagram";
  }
  return "document";
}

function artifactTitleFromQuestion(question: string): string {
  return (
    compact(question)
      .replace(
        /\b(please|create|generate|make|build|export|downloadable|file|pdf|docx|xlsx|markdown|image|diagram|resume|summary|letter|report|proposal)\b/gi,
        " "
      )
      .replace(/[^\w .-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "chat-artifact"
  );
}

function artifactFileName(title: string, extension: string): string {
  const base = safeFilePart(title).replace(/\.[^.]+$/, "");
  return `${base || "chat-artifact"}${extension}`;
}

function artifactPlannerSystemPrompt(tools: LocalToolSpec[]): string {
  return [
    "You are Second Brain's local artifact planner.",
    "Choose exactly one enabled local MCP artifact tool and return one raw JSON object only.",
    "Schema: {\"tool\":\"tool_name\",\"input\":{\"title\":\"string\",\"filename\":\"string\",\"documentType\":\"letter|summary|resume|report|proposal|invoice|spreadsheet|diagram|presentation|document\",\"text\":\"complete artifact body as Markdown or SVG\",\"astPayload\":{\"meta\":{\"filename\":\"same filename\",\"title\":\"string\",\"layout_mode\":\"PORTRAIT|LANDSCAPE\",\"primary_color\":\"#006666\"},\"nodes\":[{\"type\":\"HEADING_1|HEADING_2|BODY_TEXT|BULLET_ITEM|NUMBERED_ITEM|QUOTE|SLIDE_TITLE|SLIDE_BREAK|SPACER|BAR_CHART|MATH_INLINE|MATH_BLOCK\",\"text\":\"string\",\"spans\":[{\"text\":\"string\",\"bold\":true,\"italic\":false}],\"bold_prefix\":\"string\",\"data\":[{\"label\":\"string\",\"value\":42}]}]}},\"reason\":\"short reason\"}.",
    "The artifact body must be the actual downloadable document content, not a transcript of the chat answer.",
    "The artifact name must be short and based of chat message.",
    "For create_pdf_artifact, provide astPayload, not Markdown. Do not put raw Markdown markers such as **, ###, or ``` inside astPayload text.",
    "For report, letter, resume, summary, proposal, invoice, and document PDFs use astPayload.meta.layout_mode PORTRAIT.",
    "For deck, slides, or presentation PDFs use astPayload.meta.layout_mode LANDSCAPE and insert SLIDE_BREAK nodes between slides.",
    "Use BODY_TEXT spans for bold and italic emphasis. For bullet labels, use BULLET_ITEM.bold_prefix such as \"Risk:\" and put only the remaining sentence in text.",
    "For PDF bar charts, use BAR_CHART nodes with data items instead of text bars or Unicode block characters.",
    "For mathematical notation, use MATH_INLINE for short inline equations and MATH_BLOCK for display equations. Preserve LaTeX notation such as \\frac, superscripts, subscripts, Greek symbols, and integrals in the text field.",
    "For DOCX and Markdown math, preserve inline $...$ and display $$...$$ delimiters in text.",
    "For DOCX and Markdown, write structured Markdown with headings, sections, bullets, and tables where useful.",
    "For letters, use date, recipient or salutation when known, body paragraphs, closing, and signature placeholder.",
    "For summaries, use Overview, Key Points, Details, and Next Steps.",
    "For resumes, use name/contact if known, Professional Summary, Skills, Experience, Education, and Projects or Certifications when useful.",
    "For reports, use Executive Summary, Findings, Recommendations, and Appendix/Notes when useful.",
    "For spreadsheets, make the text a Markdown table.",
    "For diagrams/images, provide complete SVG markup in text unless binary contentBase64 is available.",
    "Use the enabled tool schema literally. Do not include prose, markdown fences, or explanations outside JSON.",
    "",
    "Enabled local artifact tools:",
    JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchemaJson
      }))
    )
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export class ChatService {
  private readonly chatPath: string;
  private readonly artifactRootPath: string;
  private state: ChatState | null = null;
  private readonly activeGenerations = new Map<string, AbortController>();

  constructor(
    projectRootPath: string,
    private readonly mcpServer: LocalMcpServer,
    private readonly settingsProvider: AppSettingsProvider,
    private readonly artifactIngestor?: ArtifactIngestor,
    private readonly accessTokenProvider?: AccessTokenProvider
  ) {
    this.chatPath = path.join(projectRootPath, "chat", "threads.json");
    this.artifactRootPath = path.join(projectRootPath, "chat", artifactDirectoryName);
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.chatPath), { recursive: true });
    await this.loadState();
    await this.writeState();
  }

  async listThreads(): Promise<ChatThread[]> {
    return [...(await this.requireState()).threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createThread(input: { title?: string | undefined } = {}): Promise<ChatThread> {
    const state = await this.requireState();
    const existingFreshThread = state.threads.find(isFreshUnusedThread);
    if (existingFreshThread) {
      return existingFreshThread;
    }

    const thread = createFreshThread(input.title?.trim() || "New Chat");

    state.threads.unshift(thread);
    await this.writeState();
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    const state = await this.requireState();
    state.threads = state.threads.filter((thread) => thread.id !== threadId);
    await this.writeState();
  }

  async getGrounding(messageId: string): Promise<GraphifyContextResult | null> {
    const state = await this.requireState();
    for (const thread of state.threads) {
      const message = thread.messages.find((candidate) => candidate.id === messageId);
      if (message?.grounding?.graphify) {
        return message.grounding.graphify;
      }
    }

    return null;
  }

  async saveMessageArtifact(input: SaveChatArtifactInput): Promise<ChatArtifactActionResult> {
    const messageId = input.messageId;
    const { thread, message } = await this.findMessage(messageId);
    if (message.role !== "assistant") {
      throw new Error("Only assistant responses can be saved as chat artifacts.");
    }

    const isWholeMessage = !input.content || input.content.trim() === message.content.trim();
    if (isWholeMessage && hasGeneratedFileArtifacts(message.artifacts)) {
      throw new Error("This response already has a generated file. Add, open, or download the file card instead.");
    }

    const existing = isWholeMessage ? message.artifacts?.find((artifact) => artifact.source === "assistant-text") : undefined;
    const artifact = existing ?? (await this.createTextArtifact(thread.id, message, input));
    if (!existing) {
      message.artifacts = [...(message.artifacts ?? []), artifact];
      thread.updatedAt = new Date().toISOString();
      await this.writeState();
    }

    return { thread, message, artifact };
  }

  async ingestArtifact(messageId: string, artifactId: string): Promise<ChatArtifactActionResult> {
    const { thread, message } = await this.findMessage(messageId);
    const artifact = this.requireArtifact(message, artifactId);
    if (!this.artifactIngestor) {
      throw new Error("Chat artifact ingestion is not available.");
    }

    const ingestion = await this.artifactIngestor([
      {
        name: artifact.filename,
        path: artifact.storagePath,
        type: artifact.mimeType
      }
    ]);
    return { thread, message, artifact, ingestion };
  }

  async downloadArtifact(messageId: string, artifactId: string, destinationPath: string): Promise<ChatArtifactActionResult> {
    const { thread, message } = await this.findMessage(messageId);
    const artifact = this.requireArtifact(message, artifactId);
    await copyFile(artifact.storagePath, destinationPath);
    return { thread, message, artifact, downloadedPath: destinationPath };
  }

  async getArtifactPath(messageId: string, artifactId: string): Promise<string> {
    const { message } = await this.findMessage(messageId);
    return this.requireArtifact(message, artifactId).storagePath;
  }

  async sendMessage(input: ChatSendInput): Promise<ChatResponse> {
    const state = await this.requireState();
    const text = input.message.trim();
    if (!text) {
      throw new Error("Chat message is required.");
    }

    const now = new Date().toISOString();
    let thread = input.threadId ? state.threads.find((candidate) => candidate.id === input.threadId) : undefined;
    if (!thread) {
      thread = {
        id: randomUUID(),
        title: titleFromMessage(text),
        messages: [],
        createdAt: now,
        updatedAt: now
      };
      state.threads.unshift(thread);
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: text,
      createdAt: now
    };
    thread.messages.push(userMessage);

    const settings = await this.settingsProvider();
    const semantic = await this.formulateSemanticRoute(thread, text, settings);
    const graphify = await this.queryGraphifyForSemantic(semantic, thread, text, settings, input.budget);
    semantic.proposedTrackers = graphify
      ? this.attachGraphNodesToDrafts(semantic.proposedTrackers, graphify)
      : this.attachGraphNodesToDrafts(semantic.proposedTrackers, null);
    let assistant: ChatMessage =
      semantic.intent === "TRACKER"
        ? {
            id: randomUUID(),
            role: "assistant",
            content:
              semantic.proposedTrackers.some((draft) => draft.grounding === "grounded")
                ? "I drafted grounded tracker items for review."
                : "I drafted a floating tracker item for review.",
            createdAt: new Date().toISOString(),
            grounding: graphify && !graphify.error ? { graphify } : undefined,
            semantic
          }
        : semantic.intent === "ARTIFACT"
          ? await this.completeWithArtifactOnly(thread, text, graphify, settings, semantic)
          : await this.completeWithSelectedProvider(thread, text, graphify, settings, semantic);

    thread.messages.push(assistant);
    thread.messages = thread.messages.slice(-maxStoredMessagesPerThread);
    thread.updatedAt = new Date().toISOString();

    await this.updateThreadTitleBestEffort(thread, text, settings);

    await this.writeState();
    return {
      thread,
      message: assistant
    };
  }

  async sendMessageStream(input: ChatSendInput, emit: (event: ChatStreamEvent) => void): Promise<ChatResponse> {
    const state = await this.requireState();
    const text = input.message.trim();
    if (!text) {
      throw new Error("Chat message is required.");
    }

    const generationId = randomUUID();
    const abortController = new AbortController();
    this.activeGenerations.set(generationId, abortController);

    const now = new Date().toISOString();
    let thread = input.threadId ? state.threads.find((candidate) => candidate.id === input.threadId) : undefined;
    if (!thread) {
      thread = {
        id: randomUUID(),
        title: titleFromMessage(text),
        messages: [],
        createdAt: now,
        updatedAt: now
      };
      state.threads.unshift(thread);
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: text,
      createdAt: now
    };
    const assistant: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    };

    thread.messages.push(userMessage);
    emit({
      type: "started",
      generationId,
      thread: { ...thread, messages: [...thread.messages, assistant] },
      userMessage,
      assistantMessage: assistant
    });

    try {
      const settings = await this.settingsProvider();
      const semantic = await this.formulateSemanticRoute(thread, text, settings);
      assistant.semantic = semantic;
      emit({ type: "semantic", generationId, messageId: assistant.id, semantic });

      const graphify = await this.queryGraphifyForSemantic(semantic, thread, text, settings, input.budget);
      semantic.proposedTrackers = graphify
        ? this.attachGraphNodesToDrafts(semantic.proposedTrackers, graphify)
        : this.attachGraphNodesToDrafts(semantic.proposedTrackers, null);
      assistant.semantic = semantic;
      assistant.grounding = graphify && !(graphify.error && semantic.intent === "TRACKER") ? { graphify } : undefined;
      emit({ type: "semantic", generationId, messageId: assistant.id, semantic });
      if (graphify) {
        emit({
          type: "grounding",
          generationId,
          messageId: assistant.id,
          grounding: graphify
        });
      }

      if (semantic.intent === "TRACKER") {
        assistant.content = semantic.proposedTrackers.some((draft) => draft.grounding === "grounded")
          ? "I drafted grounded tracker items for review."
          : "I drafted a floating tracker item for review.";
        emit({
          type: "delta",
          generationId,
          messageId: assistant.id,
          delta: assistant.content,
          content: assistant.content
        });
      } else if (graphify?.error) {
        assistant.content = "Graphify context retrieval failed, so I did not send this question to the configured AI endpoint.";
        assistant.error = graphify.error;
      } else if (semantic.intent === "ARTIFACT") {
          const artifactMessage = await this.completeWithArtifactOnly(thread, text, graphify, settings, semantic);
          assistant.content = artifactMessage.content;
          assistant.artifacts = artifactMessage.artifacts;
          assistant.error = artifactMessage.error;
          assistant.grounding = artifactMessage.grounding;
          emit({
            type: "delta",
            generationId,
            messageId: assistant.id,
            delta: assistant.content,
            content: assistant.content
          });
          for (const artifact of assistant.artifacts ?? []) {
            emit({ type: "artifact", generationId, messageId: assistant.id, artifact });
          }
      } else {
        if (settings.aiMode === "proxy") {
          const response = await this.requestProxy(thread, text, graphify, settings, semantic);
          const model = proxyModel(settings);
          const content = extractProxyText(response);
          if (!content) {
            throw new Error("Managed proxy returned an empty answer.");
          }

          assistant.content = content;
          assistant.grounding = graphify ? { graphify, api: proxyResponseMetadata(response, model) } : undefined;
          assistant.artifacts = await this.createProxyArtifacts(thread.id, assistant.id, response);
          const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, text);
          const toolArtifact =
            assistant.artifacts.length === 0
              ? await this.createRequestedArtifact(thread.id, assistant.id, text, content, graphify, settings, undefined, artifactWorkingContext)
              : null;
          if (toolArtifact) {
            assistant.artifacts = [...(assistant.artifacts ?? []), toolArtifact];
          }
          assistant.content = assistant.artifacts.length ? artifactChatConfirmation(assistant.artifacts) : content;
          emit({
            type: "delta",
            generationId,
            messageId: assistant.id,
            delta: assistant.content,
            content: assistant.content
          });
          for (const artifact of assistant.artifacts) {
            emit({ type: "artifact", generationId, messageId: assistant.id, artifact });
          }
        } else {
          const llm = new LlmService(async () => settings.ai, this.accessTokenProvider);
          assistant.content = await llm.streamText(
            {
              method: {
                temperature: 0.4,
                maxTokens: 4096
              },
              messages: await this.buildChatMessages(thread, text, graphify, semantic)
            },
            (delta, content) => {
              assistant.content = content;
              emit({
                type: "delta",
                generationId,
                messageId: assistant.id,
                delta,
                content
              });
            },
            abortController.signal
          );
          const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, text);
          const toolArtifact = await this.createRequestedArtifact(
            thread.id,
            assistant.id,
            text,
            assistant.content,
            graphify,
            settings,
            undefined,
            artifactWorkingContext
          );
          if (toolArtifact) {
            assistant.artifacts = [...(assistant.artifacts ?? []), toolArtifact];
            assistant.content = artifactChatConfirmation(assistant.artifacts);
            emit({
              type: "delta",
              generationId,
              messageId: assistant.id,
              delta: assistant.content,
              content: assistant.content
            });
            emit({ type: "artifact", generationId, messageId: assistant.id, artifact: toolArtifact });
          }
        }
      }

      thread.messages.push(assistant);
      thread.messages = thread.messages.slice(-maxStoredMessagesPerThread);
      thread.updatedAt = new Date().toISOString();
      await this.updateThreadTitleBestEffort(thread, text, settings);
      await this.writeState();
      emit({ type: "done", generationId, thread, message: assistant });

      return { thread, message: assistant };
    } catch (error) {
      const detail = errorMessage(error);
      assistant.error = detail;
      assistant.content = assistant.content || "The AI endpoint could not generate an answer.";
      thread.messages.push(assistant);
      thread.messages = thread.messages.slice(-maxStoredMessagesPerThread);
      thread.updatedAt = new Date().toISOString();
      await this.writeState();

      if (abortController.signal.aborted) {
        emit({ type: "aborted", generationId, thread, message: assistant });
      } else {
        emit({ type: "error", generationId, thread, message: assistant, error: detail });
      }

      return { thread, message: assistant };
    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  async abortGeneration(generationId: string): Promise<void> {
    this.activeGenerations.get(generationId)?.abort();
  }

  private async queryGraphify(question: string, budget?: number): Promise<GraphifyContextResult> {
    const result = (await this.mcpServer.callLocalTool("query_graphify_context", {
      question,
      budget: budget ?? defaultContextBudget
    })) as GraphifyContextResult;

    return result;
  }

  private async queryGraphifyForSemantic(
    semantic: ChatSemanticRouting,
    thread: ChatThread,
    question: string,
    settings: AppSettings,
    budget?: number
  ): Promise<GraphifyContextResult | null> {
    if (semantic.groundingMode !== "graph") {
      return null;
    }

    const searchQuery = semantic.searchKeywords.join(" ") || (await this.formulateSearchQuery(thread, question, settings));
    return this.queryGraphify(searchQuery, budget);
  }

  private async formulateSemanticRoute(
    thread: ChatThread,
    question: string,
    settings: AppSettings
  ): Promise<ChatSemanticRouting> {
    const searchScope = buildConversationSearchScope(thread, question);
    const messages: LlmChatMessage[] = [
      {
        role: "system",
        content: [
          "You are Second Brain's fast semantic router.",
          "Do not answer the user.",
          "Return exactly one raw JSON object and no markdown.",
          "Schema: {\"intent\":\"ARTIFACT\"|\"TRACKER\"|\"RESEARCH\",\"grounding_mode\":\"conversation\"|\"graph\",\"search_keywords\":[\"string\"],\"target_artifact_ids\":[\"string\"],\"proposed_trackers\":[{\"title\":\"string\",\"due_date\":\"ISO8601 string optional\",\"confidence\":0.0,\"context_keywords\":[\"string\"]}]}",
          "Use TRACKER only when the user is explicitly asking to remember, schedule, track, follow up, create a task, or set a deadline.",
          "Use ARTIFACT when the user asks to create/export a file such as PDF, DOCX, XLSX, image, diagram, markdown, resume, letter, or report.",
          "Use RESEARCH for normal questions and explanations.",
          "Use grounding_mode conversation for follow-ups that refer to this, it, that, the previous answer, or a generated artifact/file/report.",
          "Use grounding_mode graph only when the user asks about ingested sources, local files, citations, Graphify, the knowledge graph, or a new topic requiring project/source knowledge.",
          "Search keywords must be 3-4 precise terms for semantic graph retrieval.",
          "Choose keywords only from the provided running conversation scope: the latest user question, recent assistant answers, proposed tracker context, and generated artifact names or types.",
          "Do not use outside synonyms or unrelated graph-wide topics.",
          `Current local system time: ${new Date().toString()}. Resolve relative dates from this time.`
        ].join(" ")
      },
      { role: "user", content: searchScope }
    ];

    try {
      if (settings.aiMode === "proxy") {
        const proxy = settings.managedProxy;
        const secret = await this.proxySecret(settings);
        const model = proxyModel(settings);
        if (!proxy.endpoint.trim() || !secret) {
          return normalizeSemanticRouting({}, question, searchScope, thread);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const requestId = randomUUID();
        try {
          const response = await fetch(proxy.endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${secret}`,
              "Content-Type": "application/json",
              "X-Second-Brain-Request-Id": requestId
            },
            body: JSON.stringify({
              model,
              requestId,
              messages,
              temperature: 0.1,
              max_tokens: 420,
              response_format: { type: "json_object" }
            }),
            signal: controller.signal
          });

          const responseText = await response.text();
          if (!response.ok) {
            console.warn(`Semantic router failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`);
            return normalizeSemanticRouting({}, question, searchScope, thread);
          }

          const parsed = JSON.parse(responseText) as ProxyResponse;
          return normalizeSemanticRouting(parseLocalModelJsonObject(extractProxyText(parsed) || responseText), question, searchScope, thread);
        } finally {
          clearTimeout(timeout);
        }
      }

      const llm = new LlmService(async () => settings.ai, this.accessTokenProvider);
      return normalizeSemanticRouting(
        await llm.completeJsonObject({
          messages,
          method: { temperature: 0.1, maxTokens: 420, jsonMode: true }
        }),
        question,
        searchScope,
        thread
      );
    } catch (error) {
      console.warn("Semantic router failed; falling back to research route.", error);
      return normalizeSemanticRouting({}, question, searchScope, thread);
    }
  }

  private async updateThreadTitleBestEffort(thread: ChatThread, latestQuestion: string, settings: AppSettings): Promise<void> {
    const scope = buildThreadTitleScope(thread, latestQuestion);
    const fallback = titleFromMessage(latestQuestion);
    const messages: LlmChatMessage[] = [
      {
        role: "system",
        content:
          "You name Second Brain chats. Return only a concise 3-6 word title based on the chat topic, goal, plan, tracker items, or generated artifacts. No quotes, punctuation suffixes, markdown, or filler."
      },
      { role: "user", content: scope }
    ];

    try {
      if (settings.aiMode === "proxy") {
        const proxy = settings.managedProxy;
        const secret = await this.proxySecret(settings);
        const model = proxyModel(settings);
        if (!proxy.endpoint.trim() || !secret) {
          thread.title = fallback;
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), titleGenerationTimeoutMs);
        const requestId = randomUUID();
        try {
          const response = await fetch(proxy.endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${secret}`,
              "Content-Type": "application/json",
              "X-Second-Brain-Request-Id": requestId
            },
            body: JSON.stringify({
              model,
              requestId,
              messages,
              temperature: 0.1,
              max_tokens: 24
            }),
            signal: controller.signal
          });

          const responseText = await response.text();
          if (response.ok) {
            const parsed = JSON.parse(responseText) as ProxyResponse;
            thread.title = normalizeGeneratedChatTitle(extractProxyText(parsed) || responseText, latestQuestion);
            return;
          }

          console.warn(`Chat title generation failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`);
        } finally {
          clearTimeout(timeout);
        }
      } else {
        const llm = new LlmService(async () => settings.ai, this.accessTokenProvider);
        const text = await llm.completeText({
          messages,
          method: { temperature: 0.1, maxTokens: 24 }
        });
        thread.title = normalizeGeneratedChatTitle(text, latestQuestion);
        return;
      }
    } catch (error) {
      console.warn("Chat title generation failed; using local fallback.", error);
    }

    thread.title = fallback;
  }

  private attachGraphNodesToDrafts(
    drafts: ProposedTrackerDraft[],
    graphify: GraphifyContextResult | null
  ): ProposedTrackerDraft[] {
    const nodes = (graphify?.nodeHits ?? []).map((hit) => hit.id).filter(Boolean).slice(0, 8);
    if (nodes.length === 0) {
      return drafts.map((draft) => ({ ...draft, linkedNodeIds: [], grounding: "floating" }));
    }

    return drafts.map((draft) => ({
      ...draft,
      linkedNodeIds: draft.linkedNodeIds.length ? draft.linkedNodeIds : nodes,
      grounding: "grounded"
    }));
  }

  private async completeWithSelectedProvider(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    settings?: AppSettings,
    semantic?: ChatSemanticRouting
  ): Promise<ChatMessage> {
    const effectiveSettings = settings ?? (await this.settingsProvider());
    if (effectiveSettings.aiMode !== "proxy") {
      return this.completeWithLocalEndpoint(thread, question, graphify, effectiveSettings, semantic);
    }

    return this.completeWithManagedProxy(thread, question, graphify, effectiveSettings, semantic);
  }

  private async formulateSearchQuery(thread: ChatThread, question: string, settings: AppSettings): Promise<string> {
    const searchScope = buildConversationSearchScope(thread, question);
    const messages: LlmChatMessage[] = [
      {
        role: "system",
        content:
          "You are a search optimizer. Generate only 3-4 precise keywords to find relevant context in a semantic graph. Use only terms from the provided running conversation scope: latest user question, recent assistant answers, generated artifact filenames/types, and tracker context. Do NOT answer. Return ONLY keywords separated by spaces, without quotes or filler."
      },
      { role: "user", content: searchScope }
    ];

    try {
      if (settings.aiMode === "proxy") {
        const proxy = settings.managedProxy;
        const secret = await this.proxySecret(settings);
        const model = proxyModel(settings);
        if (!proxy.endpoint.trim() || !secret) {
          return extractConversationKeywords(searchScope, maxSearchKeywords).join(" ") || question;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const requestId = randomUUID();
        try {
          const response = await fetch(proxy.endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${secret}`,
              "Content-Type": "application/json",
              "X-Second-Brain-Request-Id": requestId
            },
            body: JSON.stringify({
              model,
              requestId,
              messages,
              temperature: 0.1,
              max_tokens: 30
            }),
            signal: controller.signal
          });

          const responseText = await response.text();
          if (!response.ok) {
            console.warn(`Proxy search formulation failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`);
            return extractConversationKeywords(searchScope, maxSearchKeywords).join(" ") || question;
          }

          const parsed = JSON.parse(responseText) as ProxyResponse;
          const text = extractProxyText(parsed);
          return text ? normalizeSearchQuery(text, question) : question;
        } catch (error) {
          console.warn("Proxy search formulation failed, falling back to original question.", error);
        } finally {
          clearTimeout(timeout);
        }

        return extractConversationKeywords(searchScope, maxSearchKeywords).join(" ") || question;
      }

      const llm = new LlmService(async () => settings.ai, this.accessTokenProvider);
      const text = await llm.completeText({
        messages,
        method: { temperature: 0.1, maxTokens: 30 }
      });
      return normalizeSearchQuery(text, question);
    } catch (error) {
      console.warn("Search formulation failed, using raw question.", error);
      return extractConversationKeywords(searchScope, maxSearchKeywords).join(" ") || question;
    }
  }

  private async completeWithArtifactOnly(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    semantic: ChatSemanticRouting
  ): Promise<ChatMessage> {
    const messageId = randomUUID();
    const createdAt = new Date().toISOString();
    if (graphify?.error) {
      return {
        id: messageId,
        role: "assistant",
        content: "I could not generate the artifact because graph context retrieval failed.",
        createdAt,
        grounding: { graphify },
        semantic,
        error: graphify.error
      };
    }

    const request = requestedArtifactFor(question) ?? { tool: "create_markdown_artifact", extension: ".md", mimeType: "text/markdown" };
    const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, question);
    const artifactSeed = [
      "Generate the requested artifact silently.",
      `User request: ${question}`,
      artifactWorkingContext ? ["", "Relevant generated artifact working context:", artifactWorkingContext].join("\n") : "",
      graphify ? ["", "Relevant Graphify source evidence:", graphify.stdout.slice(0, 7000)].join("\n") : ""
    ].filter(Boolean).join("\n");
    const artifact = await this.createRequestedArtifact(
      thread.id,
      messageId,
      question,
      artifactSeed,
      graphify,
      settings,
      request,
      artifactWorkingContext
    );

    return {
      id: messageId,
      role: "assistant",
      content: artifact ? "I generated the file." : "I could not generate a file from that request.",
      createdAt,
      artifacts: artifact ? [artifact] : [],
      grounding: graphify ? { graphify } : undefined,
      semantic,
      error: artifact ? undefined : "Artifact generation did not return a local file."
    };
  }

  private async completeWithLocalEndpoint(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    semantic?: ChatSemanticRouting
  ): Promise<ChatMessage> {
    const createdAt = new Date().toISOString();

    if (graphify?.error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Graphify context retrieval failed, so I did not send this question to the local AI endpoint.",
        createdAt,
        grounding: { graphify },
        semantic,
        error: graphify.error
      };
    }

    try {
      const llm = new LlmService(async () => settings.ai, this.accessTokenProvider);
      const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, question);
      const text = await llm.completeText({
        method: {
          temperature: 0.4,
          maxTokens: 4096
        },
        messages: buildChatMessagesForPrompt(thread, question, graphify, artifactWorkingContext)
      });
      const messageId = randomUUID();
      const artifacts = await this.createRequestedArtifactList(
        thread.id,
        messageId,
        question,
        text,
        graphify,
        settings,
        artifactWorkingContext
      );

      return {
        id: messageId,
        role: "assistant",
        content: artifacts.length ? artifactChatConfirmation(artifacts) : text,
        createdAt,
        artifacts,
        semantic,
        grounding: graphify ? { graphify } : undefined
      };
    } catch (error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "The local AI endpoint could not generate an answer.",
        createdAt,
        grounding: graphify ? { graphify } : undefined,
        semantic,
        error: errorMessage(error)
      };
    }
  }

  private async completeWithManagedProxy(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    semantic?: ChatSemanticRouting
  ): Promise<ChatMessage> {
    const proxy = settings.managedProxy;
    const secret = await this.proxySecret(settings);
    const createdAt = new Date().toISOString();

    if (settings.aiMode !== "proxy" || !proxy.endpoint.trim()) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Managed proxy is not configured yet.",
        createdAt,
        grounding: graphify ? { graphify } : undefined,
        semantic,
        error: "Managed proxy is disabled or missing an endpoint."
      };
    }

    if (!secret) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Your account session is not ready. Sign in again to continue.",
        createdAt,
        grounding: graphify ? { graphify } : undefined,
        semantic,
        error: "Managed proxy credential is missing."
      };
    }

    if (graphify?.error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Graphify context retrieval failed, so I did not send this question to the managed proxy.",
        createdAt,
        grounding: { graphify },
        semantic,
        error: graphify.error
      };
    }

    try {
      const response = await this.requestProxy(thread, question, graphify, settings, semantic);
      const model = proxyModel(settings);
      const text = extractProxyText(response);

      if (!text) {
        throw new Error("Managed proxy returned an empty answer.");
      }

      const messageId = randomUUID();
      const artifacts = await this.createProxyArtifacts(thread.id, messageId, response);
      const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, question);
      const toolArtifact =
        artifacts.length === 0
          ? await this.createRequestedArtifact(thread.id, messageId, question, text, graphify, settings, undefined, artifactWorkingContext)
          : null;
      const allArtifacts = toolArtifact ? [...artifacts, toolArtifact] : artifacts;

      return {
        id: messageId,
        role: "assistant",
        content: allArtifacts.length ? artifactChatConfirmation(allArtifacts) : text,
        createdAt,
        artifacts: allArtifacts,
        semantic,
        grounding: graphify ? { graphify, api: proxyResponseMetadata(response, model) } : undefined
      };
    } catch (error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "The managed proxy could not generate an answer.",
        createdAt,
        grounding: graphify ? { graphify } : undefined,
        semantic,
        error: errorMessage(error)
      };
    }
  }

  private async requestProxy(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    semantic?: ChatSemanticRouting
  ): Promise<ProxyResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const proxy = settings.managedProxy;
    const secret = await this.proxySecret(settings);
    const model = proxyModel(settings);
    const requestId = randomUUID();

    try {
      const response = await fetch(proxy.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
          "X-Second-Brain-Request-Id": requestId
        },
        body: JSON.stringify({
          model,
          groundingEnabled: proxy.groundingEnabled,
          requestId,
          messages: await this.buildChatMessages(thread, question, graphify, semantic)
        }),
        signal: controller.signal
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Managed proxy responded with ${response.status} ${response.statusText}: ${responseText.slice(0, 2000)}`);
      }

      const parsed = JSON.parse(responseText) as ProxyResponse;
      if (parsed.error?.message) {
        throw new Error(parsed.error.message);
      }

      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Managed proxy timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async proxySecret(settings: AppSettings): Promise<string> {
    return (
      process.env.OPENAI_API_KEY?.trim() ||
      (await this.accessTokenProvider?.()) ||
      settings.managedProxy.secretKey.trim()
    );
  }

  private async buildChatMessages(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult | null,
    semantic?: ChatSemanticRouting
  ): Promise<LlmChatMessage[]> {
    const artifactWorkingContext = await this.buildArtifactWorkingContext(thread, semantic, question);
    return buildChatMessagesForPrompt(thread, question, graphify, artifactWorkingContext);
  }

  private async buildArtifactWorkingContext(
    thread: ChatThread,
    semantic: ChatSemanticRouting | undefined,
    question: string
  ): Promise<string> {
    const history = recentThreadWithoutCurrentQuestion(thread, question);
    const recentArtifacts = history
      .flatMap((message) => message.artifacts ?? [])
      .filter((artifact) => artifact.source === "local-tool" || artifact.source === "proxy-attachment" || artifact.source === "assistant-text");

    if (recentArtifacts.length === 0) {
      return "";
    }

    const targetIds = new Set(semantic?.targetArtifactIds ?? []);
    const targeted = targetIds.size ? recentArtifacts.filter((artifact) => targetIds.has(artifact.id)) : [];
    const shouldIncludeRecent =
      targeted.length > 0 ||
      semantic?.groundingMode === "conversation" ||
      shouldPreferConversationContext(thread, question) ||
      requestedArtifactFor(question) !== null;

    if (!shouldIncludeRecent) {
      return "";
    }

    const selected = (targeted.length ? targeted : recentArtifacts.slice(-4)).reverse();
    const sections: string[] = [];
    let remaining = maxArtifactWorkingContextChars;

    for (const artifact of selected) {
      if (remaining <= 0) {
        break;
      }

      const content = await this.readArtifactWorkingContent(artifact);
      if (!content.trim()) {
        continue;
      }

      const header = `--- Artifact ${artifact.id}: ${artifact.filename} (${artifact.mimeType}) ---`;
      const allowance = Math.max(0, remaining - header.length - 8);
      if (allowance <= 0) {
        break;
      }

      const body = content.length > allowance ? `${content.slice(0, allowance)}\n[Truncated]` : content;
      sections.push(`${header}\n${body}`);
      remaining -= header.length + body.length + 8;
    }

    return sections.join("\n\n").trim();
  }

  private async readArtifactWorkingContent(artifact: ChatArtifact): Promise<string> {
    const candidates = [artifact.contextPath, artifact.kind === "text" ? artifact.storagePath : undefined].filter(
      (candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim())
    );

    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, "utf8");
        return truncateForWorkingContext(content, maxArtifactWorkingContextChars);
      } catch {
        // Try the next candidate. Binary artifacts without sidecars intentionally fall back to preview only.
      }
    }

    return artifact.contextPreview?.trim() ?? "";
  }

  private artifactContextFromInput(input: CreateToolArtifactInput, fallback: string): string {
    const astText = astPayloadToPlainText(input.astPayload ?? (input as CreateToolArtifactInput & { ast_payload?: unknown }).ast_payload);
    if (astText) {
      return astText;
    }

    if (typeof input.text === "string" && input.text.trim()) {
      return truncateForWorkingContext(input.text);
    }

    return truncateForWorkingContext(fallback);
  }

  private async writeArtifactContextFile(
    threadId: string,
    messageId: string,
    filename: string,
    content: string
  ): Promise<Pick<ChatArtifact, "contextPath" | "contextPreview">> {
    const normalized = truncateForWorkingContext(content);
    if (!normalized) {
      return {};
    }

    const contextFilename = `${safeFilePart(filename).replace(/\.[^.]+$/, "")}.context.md`;
    const contextPath = await this.writeArtifactFile(threadId, messageId, contextFilename, Buffer.from(`${normalized}\n`, "utf8"));
    return {
      contextPath,
      contextPreview: normalized.slice(0, 500)
    };
  }

  private async findMessage(messageId: string): Promise<{ thread: ChatThread; message: ChatMessage }> {
    const state = await this.requireState();
    for (const thread of state.threads) {
      const message = thread.messages.find((candidate) => candidate.id === messageId);
      if (message) {
        return { thread, message };
      }
    }

    throw new Error(`Chat message not found: ${messageId}`);
  }

  private requireArtifact(message: ChatMessage, artifactId: string): ChatArtifact {
    const artifact = message.artifacts?.find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new Error(`Chat artifact not found: ${artifactId}`);
    }

    return artifact;
  }

  private async createTextArtifact(
    threadId: string,
    message: ChatMessage,
    override?: { title?: string | undefined; content?: string | undefined }
  ): Promise<ChatArtifact> {
    const id = randomUUID();
    const title = override?.title?.trim() || "chat-response";
    const filename = safeFilePart(`${title}-${message.id}.md`);
    const content = markdownArtifactBody(message, override);
    const storagePath = await this.writeArtifactFile(threadId, message.id, filename, Buffer.from(content, "utf8"));
    const context = await this.writeArtifactContextFile(threadId, message.id, filename, override?.content ?? message.content);
    const fileStat = await stat(storagePath);
    return {
      id,
      messageId: message.id,
      filename,
      mimeType: "text/markdown",
      sizeBytes: fileStat.size,
      kind: "text",
      storagePath,
      contextPath: context.contextPath,
      contextPreview: context.contextPreview,
      createdAt: new Date().toISOString(),
      source: "assistant-text"
    };
  }

  private async createRequestedArtifactList(
    threadId: string,
    messageId: string,
    question: string,
    content: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    artifactWorkingContext = ""
  ): Promise<ChatArtifact[]> {
    const artifact = await this.createRequestedArtifact(threadId, messageId, question, content, graphify, settings, undefined, artifactWorkingContext);
    return artifact ? [artifact] : [];
  }

  private async createRequestedArtifact(
    threadId: string,
    messageId: string,
    question: string,
    content: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    fallbackRequest?: RequestedArtifact,
    artifactWorkingContext = ""
  ): Promise<ChatArtifact | null> {
    const request = requestedArtifactFor(question) ?? fallbackRequest;
    if (!request || !content.trim()) {
      return null;
    }

    const availableTools = new Set<string>(this.mcpServer.listToolSpecs(artifactToolNames).map((tool) => tool.name));
    if (!availableTools.has(request.tool)) {
      return null;
    }

    const planned = await this.planRequestedArtifact(question, content, graphify, settings, request, artifactWorkingContext);
    const title = planned?.input.title?.trim() || artifactTitleFromQuestion(question);
    const toolName = planned?.tool && availableTools.has(planned.tool) ? planned.tool : request.tool;
    const input: CreateToolArtifactInput = {
      title,
      filename: planned?.input.filename?.trim() || artifactFileName(title, request.extension),
      text: planned?.input.text?.trim() || content,
      astPayload: planned?.input.astPayload ?? planned?.input.ast_payload,
      contentBase64: planned?.input.contentBase64,
      mimeType: planned?.input.mimeType?.trim() || request.mimeType,
      documentType: planned?.input.documentType?.trim() || requestedDocumentType(question)
    };

    const result = (await this.mcpServer.callLocalTool(toolName, input)) as ToolArtifactResultLike;

    const storagePath = typeof result.storagePath === "string" ? result.storagePath : "";
    if (!storagePath) {
      return null;
    }

    const filename = typeof result.filename === "string" ? result.filename : artifactFileName(title, request.extension);
    const mimeType = typeof result.mimeType === "string" ? result.mimeType : request.mimeType;
    const fileStat = await stat(storagePath);
    const context = await this.writeArtifactContextFile(
      threadId,
      messageId,
      filename,
      this.artifactContextFromInput(input, content)
    );

    return {
      id: typeof result.id === "string" ? result.id : randomUUID(),
      messageId,
      filename,
      mimeType,
      sizeBytes: typeof result.sizeBytes === "number" ? result.sizeBytes : fileStat.size,
      kind: mimeType.startsWith("text/") ? "text" : "binary",
      storagePath,
      contextPath: context.contextPath,
      contextPreview: context.contextPreview,
      createdAt: typeof result.createdAt === "string" ? result.createdAt : new Date().toISOString(),
      source: "local-tool"
    };
  }

  private async planRequestedArtifact(
    question: string,
    answer: string,
    graphify: GraphifyContextResult | null,
    settings: AppSettings,
    request: RequestedArtifact,
    artifactWorkingContext = ""
  ): Promise<{ tool: string; input: CreateToolArtifactInput } | null> {
    const tools = this.mcpServer.listToolSpecs(artifactToolNames);
    if (tools.length === 0) {
      return null;
    }

    const prompt = JSON.stringify({
      user_request: question,
      preferred_tool: request.tool,
      preferred_document_type: requestedDocumentType(question),
      preferred_filename: artifactFileName(artifactTitleFromQuestion(question), request.extension),
      assistant_answer: answer,
      artifact_working_context: artifactWorkingContext.slice(0, 7000) || undefined,
      graphify_source_evidence: graphify ? graphify.stdout.slice(0, 5000) : undefined,
      instruction:
        "Create the actual artifact content. Prefer artifact_working_context for follow-up conversions or revisions. Use graphify_source_evidence only when the user asked about source-backed project knowledge. Keep chat framing and private context labels out of the artifact. Preserve useful source facts, but write a polished document layout for the requested artifact type."
    });

    try {
      const planned =
        settings.aiMode === "proxy"
          ? await this.planProxyArtifactToolCall(settings, tools, prompt)
          : await new LlmService(async () => settings.ai, this.accessTokenProvider).planLocalToolCall({
              systemPrompt: artifactPlannerSystemPrompt(tools),
              userPrompt: prompt,
              tools,
              method: {
                temperature: 0.2,
                maxTokens: 3500,
                jsonMode: true
              }
            });

      return this.normalizeArtifactPlan(planned, request, question, answer);
    } catch (error) {
      console.warn("Artifact planning failed, falling back to formatted assistant content.", error);
      return null;
    }
  }

  private async planProxyArtifactToolCall(
    settings: AppSettings,
    tools: LocalToolSpec[],
    userPrompt: string
  ): Promise<PlannedLocalToolCall> {
    const proxy = settings.managedProxy;
    const secret = await this.proxySecret(settings);
    const model = proxyModel(settings);
    if (!proxy.endpoint.trim() || !secret) {
      throw new Error("Managed proxy artifact planning is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), artifactPlanTimeoutMs);
    const requestId = randomUUID();

    try {
      const response = await fetch(proxy.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
          "X-Second-Brain-Request-Id": requestId
        },
        body: JSON.stringify({
          model,
          requestId,
          messages: [
            {
              role: "system",
              content: artifactPlannerSystemPrompt(tools)
            },
            {
              role: "user",
              content: userPrompt
            }
          ],
          temperature: 0.2,
          max_tokens: 3500
        }),
        signal: controller.signal
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Managed proxy artifact planning failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 1000)}`);
      }

      const parsed = parseLocalModelJsonObject(extractProxyText(JSON.parse(responseText) as ProxyResponse) || responseText);
      const tool = parsed.tool ?? parsed.name;
      const input = parsed.input ?? parsed.arguments ?? parsed.parameters;
      if (typeof tool !== "string" || !tool.trim() || !input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Managed proxy did not return a valid local artifact tool call.");
      }

      return {
        tool: tool.trim(),
        input,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Managed proxy artifact planning timed out after ${Math.round(artifactPlanTimeoutMs / 1000)} seconds.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeArtifactPlan(
    planned: PlannedLocalToolCall,
    request: RequestedArtifact,
    question: string,
    answer: string
  ): { tool: string; input: CreateToolArtifactInput } | null {
    const inputRecord = asRecord(planned.input);
    if (!inputRecord) {
      return null;
    }

    const title = stringField(inputRecord, "title") || artifactTitleFromQuestion(question);
    const text = stringField(inputRecord, "text") || stringField(inputRecord, "markdown") || stringField(inputRecord, "content") || answer;
    const documentType = stringField(inputRecord, "documentType") || stringField(inputRecord, "document_type") || requestedDocumentType(question);
    const filename = stringField(inputRecord, "filename") || artifactFileName(title, request.extension);
    const mimeType = stringField(inputRecord, "mimeType") || stringField(inputRecord, "mime_type") || request.mimeType;
    const contentBase64 = stringField(inputRecord, "contentBase64") || stringField(inputRecord, "content_base64") || undefined;
    const astPayload = inputRecord.astPayload ?? inputRecord.ast_payload;

    return {
      tool: planned.tool || request.tool,
      input: {
        title,
        filename,
        text,
        astPayload,
        contentBase64,
        mimeType,
        documentType
      }
    };
  }

  private async createProxyArtifacts(threadId: string, messageId: string, response: ProxyResponse): Promise<ChatArtifact[]> {
    const artifacts: ChatArtifact[] = [];
    for (const [index, attachment] of collectProxyAttachments(response).entries()) {
      if (attachment.url && !attachment.contentBase64 && !attachment.content_base64 && !attachment.text && !attachment.content) {
        continue;
      }

      const filename = safeFilePart(attachment.filename ?? attachment.name ?? `proxy-artifact-${index + 1}.bin`);
      const mimeType = attachment.mimeType ?? attachment.mime_type ?? artifactMimeFromName(filename);
      const text = attachment.text ?? attachment.content;
      const base64 = attachment.contentBase64 ?? attachment.content_base64;
      const buffer = text !== undefined ? Buffer.from(text, "utf8") : base64 ? Buffer.from(base64, "base64") : null;
      if (!buffer) {
        continue;
      }

      const storagePath = await this.writeArtifactFile(threadId, messageId, filename, buffer);
      const context =
        text !== undefined
          ? await this.writeArtifactContextFile(threadId, messageId, filename, text)
          : {};
      artifacts.push({
        id: randomUUID(),
        messageId,
        filename,
        mimeType,
        sizeBytes: buffer.byteLength,
        kind: text !== undefined || mimeType.startsWith("text/") ? "text" : "binary",
        storagePath,
        contextPath: context.contextPath,
        contextPreview: context.contextPreview,
        createdAt: new Date().toISOString(),
        source: "proxy-attachment"
      });
    }

    return artifacts;
  }

  private async writeArtifactFile(threadId: string, messageId: string, filename: string, content: Buffer): Promise<string> {
    const directory = path.join(this.artifactRootPath, safeFilePart(threadId), safeFilePart(messageId));
    await mkdir(directory, { recursive: true });
    const parsed = path.parse(filename);
    const outputPath = path.join(directory, `${parsed.name}-${Date.now()}-${randomUUID().slice(0, 8)}${parsed.ext || ".bin"}`);
    await writeFile(outputPath, content);
    return outputPath;
  }

  private async loadState(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.chatPath, "utf8")) as ChatState;
      this.state = {
        threads: Array.isArray(parsed.threads) ? parsed.threads : []
      };
    } catch {
      this.state = { threads: [] };
    }

    const freshThread = this.state.threads.find(isFreshUnusedThread);
    if (freshThread) {
      freshThread.updatedAt = new Date().toISOString();
    } else {
      this.state.threads.unshift(createFreshThread());
    }
  }

  private async requireState(): Promise<ChatState> {
    if (!this.state) {
      await this.loadState();
    }

    if (!this.state) {
      this.state = { threads: [] };
    }

    return this.state;
  }

  private async writeState(): Promise<void> {
    const state = await this.requireState();
    await mkdir(path.dirname(this.chatPath), { recursive: true });
    await writeFile(this.chatPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

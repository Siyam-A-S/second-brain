import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppSettings,
  ChatArtifact,
  ChatArtifactActionResult,
  ChatMessage,
  ChatResponse,
  ChatSendInput,
  ChatStreamEvent,
  ChatThread,
  GraphifyContextResult,
  GraphifyIngestionResult,
  ProcessDroppedItem,
  SaveChatArtifactInput
} from "../../shared/brain";
import { parseLocalModelJsonObject } from "../../shared/jsonObject";
import type { CreateToolArtifactInput } from "./ArtifactToolService";
import { LlmService, type ChatMessage as LlmChatMessage, type PlannedLocalToolCall } from "./LlmService";
import { LocalMcpServer } from "./LocalMcpServer";
import type { LocalToolName, LocalToolSpec } from "./LocalToolRegistry";

type AppSettingsProvider = () => Promise<AppSettings>;
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

function proxySecret(settings: AppSettings): string {
  return process.env.OPENAI_API_KEY?.trim() || settings.managedProxy.secretKey.trim();
}

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
const artifactDirectoryName = "artifacts";
const artifactToolNames: LocalToolName[] = [
  "create_markdown_artifact",
  "create_pdf_artifact",
  "create_docx_artifact",
  "create_xlsx_artifact",
  "create_image_artifact"
];

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleFromMessage(value: string): string {
  return compact(value).slice(0, 80) || "New Chat";
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

  return cleaned || fallback;
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

function collectProxyAttachments(payload: ProxyResponse): ProxyAttachment[] {
  return [...(payload.attachments ?? []), ...(payload.artifacts ?? []), ...(payload.files ?? [])];
}

function requestedArtifactFor(question: string): RequestedArtifact | null {
  const normalized = question.toLowerCase();
  if (/\b(pdf|\.pdf)\b/.test(normalized)) {
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
    "Schema: {\"tool\":\"tool_name\",\"input\":{\"title\":\"string\",\"filename\":\"string\",\"documentType\":\"letter|summary|resume|report|proposal|invoice|spreadsheet|diagram|document\",\"text\":\"complete artifact body as Markdown or SVG\"},\"reason\":\"short reason\"}.",
    "The artifact body must be the actual downloadable document content, not a transcript of the chat answer.",
    "For PDF, DOCX, and Markdown, write structured Markdown with headings, sections, bullets, and tables where useful.",
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
    private readonly artifactIngestor?: ArtifactIngestor
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
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id: randomUUID(),
      title: input.title?.trim() || "New Chat",
      messages: [],
      createdAt: now,
      updatedAt: now
    };

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
    const searchQuery = await this.formulateSearchQuery(thread, text, settings);
    const graphify = await this.queryGraphify(searchQuery, input.budget);
    const assistant = await this.completeWithSelectedProvider(thread, text, graphify, settings);
    await this.saveGraphifyResultBestEffort(text, assistant.content, graphify, assistant.error);
    thread.messages.push(assistant);
    thread.messages = thread.messages.slice(-maxStoredMessagesPerThread);
    thread.updatedAt = new Date().toISOString();

    if (thread.title === "New Chat") {
      thread.title = titleFromMessage(text);
    }

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
      const searchQuery = await this.formulateSearchQuery(thread, text, settings);
      const graphify = await this.queryGraphify(searchQuery, input.budget);
      assistant.grounding = { graphify };
      emit({
        type: "grounding",
        generationId,
        messageId: assistant.id,
        grounding: graphify
      });

      if (graphify.error) {
        assistant.content = "Graphify context retrieval failed, so I did not send this question to the configured AI endpoint.";
        assistant.error = graphify.error;
      } else {
        if (settings.aiMode === "proxy") {
          const response = await this.requestProxy(thread, text, graphify, settings);
          const model = proxyModel(settings);
          const content = extractProxyText(response);
          if (!content) {
            throw new Error("Managed proxy returned an empty answer.");
          }

          assistant.content = content;
          assistant.grounding = {
            graphify,
            api: proxyResponseMetadata(response, model)
          };
          assistant.artifacts = await this.createProxyArtifacts(thread.id, assistant.id, response);
          const toolArtifact =
            assistant.artifacts.length === 0
              ? await this.createRequestedArtifact(thread.id, assistant.id, text, content, graphify, settings)
              : null;
          if (toolArtifact) {
            assistant.artifacts = [...(assistant.artifacts ?? []), toolArtifact];
          }
          emit({
            type: "delta",
            generationId,
            messageId: assistant.id,
            delta: content,
            content
          });
          for (const artifact of assistant.artifacts) {
            emit({ type: "artifact", generationId, messageId: assistant.id, artifact });
          }
        } else {
          const llm = new LlmService(async () => settings.ai);
          assistant.content = await llm.streamText(
            {
              method: {
                temperature: 0.4,
                maxTokens: 4096
              },
              messages: this.buildGroundedMessages(thread, text, graphify)
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
          const toolArtifact = await this.createRequestedArtifact(thread.id, assistant.id, text, assistant.content, graphify, settings);
          if (toolArtifact) {
            assistant.artifacts = [...(assistant.artifacts ?? []), toolArtifact];
            emit({ type: "artifact", generationId, messageId: assistant.id, artifact: toolArtifact });
          }
        }
      }

      thread.messages.push(assistant);
      thread.messages = thread.messages.slice(-maxStoredMessagesPerThread);
      thread.updatedAt = new Date().toISOString();
      if (thread.title === "New Chat") {
        thread.title = titleFromMessage(text);
      }
      await this.saveGraphifyResultBestEffort(text, assistant.content, graphify, assistant.error);
      await this.writeState();
      emit({ type: "done", generationId, thread, message: assistant });

      return { thread, message: assistant };
    } catch (error) {
      const detail = errorMessage(error);
      assistant.error = detail;
      assistant.content = assistant.content || "The AI endpoint could not generate an answer. Local Graphify context is still available.";
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

  private async saveGraphifyResultBestEffort(
    question: string,
    answer: string,
    graphify: GraphifyContextResult,
    assistantError?: string | undefined
  ): Promise<void> {
    if (assistantError || graphify.error || !answer.trim()) {
      return;
    }

    const nodes = [...new Set((graphify.nodeHits ?? []).map((hit) => hit.id).filter(Boolean))].slice(0, 24);
    try {
      await this.mcpServer.callLocalTool("save_graphify_result", {
        question,
        answer,
        type: "query",
        nodes
      });
    } catch (error) {
      console.warn("Unable to save Graphify chat result.", error);
    }
  }

  private async completeWithSelectedProvider(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult,
    settings?: AppSettings
  ): Promise<ChatMessage> {
    const effectiveSettings = settings ?? (await this.settingsProvider());
    if (effectiveSettings.aiMode !== "proxy") {
      return this.completeWithLocalEndpoint(thread, question, graphify, effectiveSettings);
    }

    return this.completeWithManagedProxy(thread, question, graphify, effectiveSettings);
  }

  private async formulateSearchQuery(thread: ChatThread, question: string, settings: AppSettings): Promise<string> {
    const history = thread.messages;
    const recentHistory =
      history.length > 0 && history[history.length - 1]?.role === "user" && history[history.length - 1]?.content.trim() === question
        ? history.slice(0, -1)
        : history;
    const messages: LlmChatMessage[] = [
      {
        role: "system",
        content:
          "You are a search optimizer. Generate a concise search query (3-6 keywords) to find relevant context for the user's latest message in a semantic graph. Consider the conversation history. Do NOT answer the question. Return ONLY the keywords separated by spaces, without quotes or conversational filler."
      },
      ...recentHistory.slice(-4).map<LlmChatMessage>((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      })),
      { role: "user", content: question }
    ];

    try {
      if (settings.aiMode === "proxy") {
        const proxy = settings.managedProxy;
        const secret = proxySecret(settings);
        const model = proxyModel(settings);
        if (!proxy.endpoint.trim() || !secret) {
          return question;
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
              userIdOrKey: secret,
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
            return question;
          }

          const parsed = JSON.parse(responseText) as ProxyResponse;
          const text = extractProxyText(parsed);
          return text ? normalizeSearchQuery(text, question) : question;
        } catch (error) {
          console.warn("Proxy search formulation failed, falling back to original question.", error);
        } finally {
          clearTimeout(timeout);
        }

        return question;
      }

      const llm = new LlmService(async () => settings.ai);
      const text = await llm.completeText({
        messages,
        method: { temperature: 0.1, maxTokens: 30 }
      });
      return normalizeSearchQuery(text, question);
    } catch (error) {
      console.warn("Search formulation failed, using raw question.", error);
      return question;
    }
  }

  private async completeWithLocalEndpoint(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult,
    settings: AppSettings
  ): Promise<ChatMessage> {
    const createdAt = new Date().toISOString();

    if (graphify.error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Graphify context retrieval failed, so I did not send this question to the local AI endpoint.",
        createdAt,
        grounding: { graphify },
        error: graphify.error
      };
    }

    try {
      const llm = new LlmService(async () => settings.ai);
      const text = await llm.completeText({
        method: {
          temperature: 0.4,
          maxTokens: 4096
        },
        messages: this.buildGroundedMessages(thread, question, graphify)
      });
      const messageId = randomUUID();
      const artifacts = await this.createRequestedArtifactList(thread.id, messageId, question, text, graphify, settings);

      return {
        id: messageId,
        role: "assistant",
        content: text,
        createdAt,
        artifacts,
        grounding: { graphify }
      };
    } catch (error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "The local AI endpoint could not generate an answer. Local Graphify context is still available below.",
        createdAt,
        grounding: { graphify },
        error: errorMessage(error)
      };
    }
  }

  private async completeWithManagedProxy(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult,
    settings: AppSettings
  ): Promise<ChatMessage> {
    const proxy = settings.managedProxy;
    const secret = proxySecret(settings);
    const createdAt = new Date().toISOString();

    if (settings.aiMode !== "proxy" || !proxy.endpoint.trim()) {
      return {
        id: randomUUID(),
        role: "assistant",
        content:
          "Managed proxy is not configured yet. Local Graphify context was retrieved, but remote answer generation is disabled.",
        createdAt,
        grounding: { graphify },
        error: "Managed proxy is disabled or missing an endpoint."
      };
    }

    if (!secret) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Managed proxy secret key is missing. Add the beta key in Settings or set OPENAI_API_KEY to enable chat answers.",
        createdAt,
        grounding: { graphify },
        error: "Managed proxy secret key is missing."
      };
    }

    if (graphify.error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Graphify context retrieval failed, so I did not send this question to the managed proxy.",
        createdAt,
        grounding: { graphify },
        error: graphify.error
      };
    }

    try {
      const response = await this.requestProxy(thread, question, graphify, settings);
      const model = proxyModel(settings);
      const text = extractProxyText(response);

      if (!text) {
        throw new Error("Managed proxy returned an empty answer.");
      }

      const messageId = randomUUID();
      const artifacts = await this.createProxyArtifacts(thread.id, messageId, response);
      const toolArtifact =
        artifacts.length === 0 ? await this.createRequestedArtifact(thread.id, messageId, question, text, graphify, settings) : null;
      const allArtifacts = toolArtifact ? [...artifacts, toolArtifact] : artifacts;

      return {
        id: messageId,
        role: "assistant",
        content: text,
        createdAt,
        artifacts: allArtifacts,
        grounding: {
          graphify,
          api: proxyResponseMetadata(response, model)
        }
      };
    } catch (error) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "The managed proxy could not generate an answer. Local Graphify context is still available below.",
        createdAt,
        grounding: { graphify },
        error: errorMessage(error)
      };
    }
  }

  private async requestProxy(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult,
    settings: AppSettings
  ): Promise<ProxyResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const proxy = settings.managedProxy;
    const secret = proxySecret(settings);
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
          userIdOrKey: secret,
          model,
          groundingEnabled: proxy.groundingEnabled,
          requestId,
          messages: this.buildGroundedMessages(thread, question, graphify)
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

  private buildGroundedMessages(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult
  ): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You are Second Brain Chat.",
          "Answer using the local Graphify context first.",
          "If the context is insufficient, say what is missing.",
          "You can create downloadable files through Second Brain local artifact tools after your answer.",
          "When the user asks for a PDF, DOCX, XLSX, image, or Markdown file, do not refuse; answer briefly and include the essential requirements or source details needed for the artifact.",
          "Second Brain will run a local artifact planning tool after generation to create the formatted downloadable file.",
          "Do not say you cannot create or save files just because you are text-based.",
          "Preserve source grounding from the provided Graphify output.",
          "Use the Relevant local excerpts section as the only quoted source text.",
          "Do not claim access to files beyond the context packet."
        ].join(" ")
      },
      ...thread.messages.slice(-8).map<LlmChatMessage>((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      })),
      {
        role: "user",
        content: [
          `Question: ${question}`,
          "",
          "Local Graphify context:",
          graphify.stdout,
          "",
          `Graphify command: ${graphify.command}`,
          `Context budget: ${graphify.budget}`,
          graphify.citations.length
            ? `Citations: ${graphify.citations
                .map((citation) => citation.label ?? citation.sourceLocation ?? citation.sourceFile)
                .join(", ")}`
            : ""
        ].join("\n")
      }
    ];
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
    const title = override?.title?.trim() || "chat-response";
    const filename = safeFilePart(`${title}-${message.id}.md`);
    const content = markdownArtifactBody(message, override);
    const storagePath = await this.writeArtifactFile(threadId, message.id, filename, Buffer.from(content, "utf8"));
    const fileStat = await stat(storagePath);
    return {
      id: randomUUID(),
      messageId: message.id,
      filename,
      mimeType: "text/markdown",
      sizeBytes: fileStat.size,
      kind: "text",
      storagePath,
      createdAt: new Date().toISOString(),
      source: "assistant-text"
    };
  }

  private async createRequestedArtifactList(
    threadId: string,
    messageId: string,
    question: string,
    content: string,
    graphify: GraphifyContextResult,
    settings: AppSettings
  ): Promise<ChatArtifact[]> {
    const artifact = await this.createRequestedArtifact(threadId, messageId, question, content, graphify, settings);
    return artifact ? [artifact] : [];
  }

  private async createRequestedArtifact(
    threadId: string,
    messageId: string,
    question: string,
    content: string,
    graphify: GraphifyContextResult,
    settings: AppSettings
  ): Promise<ChatArtifact | null> {
    const request = requestedArtifactFor(question);
    if (!request || !content.trim()) {
      return null;
    }

    const availableTools = new Set<string>(this.mcpServer.listToolSpecs(artifactToolNames).map((tool) => tool.name));
    if (!availableTools.has(request.tool)) {
      return null;
    }

    const planned = await this.planRequestedArtifact(question, content, graphify, settings, request);
    const title = planned?.input.title?.trim() || artifactTitleFromQuestion(question);
    const toolName = planned?.tool && availableTools.has(planned.tool) ? planned.tool : request.tool;
    const input: CreateToolArtifactInput = {
      title,
      filename: planned?.input.filename?.trim() || artifactFileName(title, request.extension),
      text: planned?.input.text?.trim() || content,
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

    return {
      id: typeof result.id === "string" ? result.id : randomUUID(),
      messageId,
      filename,
      mimeType,
      sizeBytes: typeof result.sizeBytes === "number" ? result.sizeBytes : fileStat.size,
      kind: mimeType.startsWith("text/") ? "text" : "binary",
      storagePath,
      createdAt: typeof result.createdAt === "string" ? result.createdAt : new Date().toISOString(),
      source: "local-tool"
    };
  }

  private async planRequestedArtifact(
    question: string,
    answer: string,
    graphify: GraphifyContextResult,
    settings: AppSettings,
    request: RequestedArtifact
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
      graphify_context_excerpt: graphify.stdout.slice(0, 5000),
      instruction:
        "Create the actual artifact content. Keep chat framing out of the artifact. Preserve useful source facts, but write a polished document layout for the requested artifact type."
    });

    try {
      const planned =
        settings.aiMode === "proxy"
          ? await this.planProxyArtifactToolCall(settings, tools, prompt)
          : await new LlmService(async () => settings.ai).planLocalToolCall({
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
    const secret = proxySecret(settings);
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
          userIdOrKey: secret,
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

    return {
      tool: planned.tool || request.tool,
      input: {
        title,
        filename,
        text,
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
      artifacts.push({
        id: randomUUID(),
        messageId,
        filename,
        mimeType,
        sizeBytes: buffer.byteLength,
        kind: text !== undefined || mimeType.startsWith("text/") ? "text" : "binary",
        storagePath,
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

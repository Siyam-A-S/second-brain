import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppSettings,
  ChatMessage,
  ChatResponse,
  ChatSendInput,
  ChatThread,
  GraphifyContextResult
} from "../../shared/brain";
import { LlmService, type ChatMessage as LlmChatMessage } from "./LlmService";
import { LocalMcpServer } from "./LocalMcpServer";

type AppSettingsProvider = () => Promise<AppSettings>;

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
  error?: {
    message?: string | undefined;
  };
};

const defaultContextBudget = 2600;
const requestTimeoutMs = Number(process.env.SECOND_BRAIN_MANAGED_PROXY_TIMEOUT_MS ?? 180_000);
const maxStoredMessagesPerThread = 80;

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ChatService {
  private readonly chatPath: string;
  private state: ChatState | null = null;

  constructor(
    projectRootPath: string,
    private readonly mcpServer: LocalMcpServer,
    private readonly settingsProvider: AppSettingsProvider
  ) {
    this.chatPath = path.join(projectRootPath, "chat", "threads.json");
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

    const graphify = await this.queryGraphify(text, input.budget);
    const assistant = await this.completeWithSelectedProvider(thread, text, graphify);
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

  private async queryGraphify(question: string, budget?: number): Promise<GraphifyContextResult> {
    const result = (await this.mcpServer.callLocalTool("query_graphify_context", {
      question,
      budget: budget ?? defaultContextBudget
    })) as GraphifyContextResult;

    return result;
  }

  private async completeWithSelectedProvider(
    thread: ChatThread,
    question: string,
    graphify: GraphifyContextResult
  ): Promise<ChatMessage> {
    const settings = await this.settingsProvider();
    if (!settings.managedProxy.enabled) {
      return this.completeWithLocalEndpoint(thread, question, graphify, settings);
    }

    return this.completeWithManagedProxy(thread, question, graphify, settings);
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

      return {
        id: randomUUID(),
        role: "assistant",
        content: text,
        createdAt,
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
    const createdAt = new Date().toISOString();

    if (!proxy.enabled || !proxy.endpoint.trim()) {
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

    if (!proxy.secretKey.trim()) {
      return {
        id: randomUUID(),
        role: "assistant",
        content: "Managed proxy secret key is missing. Add the beta key in Settings to enable chat answers.",
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
      const text = extractProxyText(response);

      if (!text) {
        throw new Error("Managed proxy returned an empty answer.");
      }

      return {
        id: randomUUID(),
        role: "assistant",
        content: text,
        createdAt,
        grounding: {
          graphify,
          api: response.groundingMetadata ?? response.grounding_metadata
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
    const requestId = randomUUID();

    try {
      const response = await fetch(proxy.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${proxy.secretKey}`,
          "Content-Type": "application/json",
          "X-Second-Brain-Request-Id": requestId
        },
        body: JSON.stringify({
          userIdOrKey: proxy.secretKey,
          model: proxy.model,
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
          graphify.citations.length ? `Citations: ${graphify.citations.join(", ")}` : ""
        ].join("\n")
      }
    ];
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

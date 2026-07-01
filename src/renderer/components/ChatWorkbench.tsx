import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  DatabaseZap,
  Download,
  FilePlus,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  SearchCheck,
  Send,
  Trash2,
  User
} from "lucide-react";
import type { ChatStreamEvent, ChatThread, GraphifyContextResult } from "../../shared/ipc";

type ChatWorkbenchProps = {
  refreshKey: number;
};

type MarkdownBlock =
  | { kind: "code"; language: string; content: string }
  | { kind: "heading"; level: number; content: string }
  | { kind: "math"; content: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; content: string };

type ResponseSection = {
  id: string;
  title: string;
  content: string;
};

function sortedThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isFreshUnusedThread(thread: ChatThread | null | undefined): boolean {
  return Boolean(thread && thread.messages.length === 0);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function apiModelName(api: unknown): string {
  if (!api || typeof api !== "object" || Array.isArray(api)) {
    return "";
  }

  const model = (api as Record<string, unknown>).model;
  return typeof model === "string" ? model.trim() : "";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";
}

function splitResponseSections(content: string): ResponseSection[] {
  const lines = content.split(/\r?\n/);
  const sections: ResponseSection[] = [];
  let currentTitle = "Response";
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading && currentLines.some((candidate) => candidate.trim())) {
      const sectionContent = currentLines.join("\n").trim();
      sections.push({
        id: `${slug(currentTitle)}-${sections.length}`,
        title: currentTitle,
        content: sectionContent
      });
      currentTitle = heading[2]?.trim() || "Section";
      currentLines = [line];
      continue;
    }

    if (heading && currentLines.length === 0) {
      currentTitle = heading[2]?.trim() || "Section";
    }

    currentLines.push(line);
  }

  const tail = currentLines.join("\n").trim();
  if (tail) {
    sections.push({
      id: `${slug(currentTitle)}-${sections.length}`,
      title: currentTitle,
      content: tail
    });
  }

  if (sections.length > 0) {
    return sections;
  }

  return content
    .split(/\n{2,}/)
    .map((part, index) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({
      id: `part-${index}`,
      title: index === 0 ? "Response" : `Part ${index + 1}`,
      content: part
    }));
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];
  let codeLanguage = "";
  let codeLines: string[] | null = null;
  let mathLines: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", content: paragraph.join("\n").trim() });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const line of lines) {
    const codeFence = line.match(/^```([\w.+-]*)\s*$/);
    if (codeFence) {
      if (codeLines) {
        blocks.push({ kind: "code", language: codeLanguage, content: codeLines.join("\n") });
        codeLines = null;
        codeLanguage = "";
      } else {
        flushParagraph();
        flushList();
        codeLanguage = codeFence[1] ?? "";
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "$$") {
      if (mathLines) {
        blocks.push({ kind: "math", content: mathLines.join("\n").trim() });
        mathLines = null;
      } else {
        flushParagraph();
        flushList();
        mathLines = [];
      }
      continue;
    }

    if (mathLines) {
      mathLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 2, content: heading[2]?.trim() ?? "" });
      continue;
    }

    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]?.trim() ?? "");
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (codeLines) {
    blocks.push({ kind: "code", language: codeLanguage, content: codeLines.join("\n") });
  }
  if (mathLines) {
    blocks.push({ kind: "math", content: mathLines.join("\n").trim() });
  }
  flushParagraph();
  flushList();

  return blocks;
}

function InlineMarkdown({ text, inverted = false }: { text: string; inverted?: boolean }): JSX.Element {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\$[^$\n]+\$)/g;
  const parts = text.split(pattern).filter((part) => part.length > 0);
  return (
    <>
      {parts.map((part, index) => {
        if (/^`[^`]+`$/.test(part)) {
          return (
            <code key={index} className={`${inverted ? "bg-white/15 text-white" : "bg-slate-100 text-slate-900"} rounded px-1 py-0.5 font-mono text-[0.9em]`}>
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (/^\*[^*]+\*$/.test(part)) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        if (/^\$[^$\n]+\$$/.test(part)) {
          return (
            <span key={index} className={`${inverted ? "text-white" : "text-slate-900"} font-serif italic`}>
              {part.slice(1, -1)}
            </span>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function highlightedCode(content: string, language: string): ReactNode[] {
  const keywords =
    /^(ts|tsx|js|jsx|python|py|bash|sh|json)$/i.test(language)
      ? new Set([
          "async",
          "await",
          "const",
          "let",
          "function",
          "return",
          "import",
          "export",
          "from",
          "class",
          "type",
          "if",
          "else",
          "for",
          "while",
          "try",
          "catch",
          "true",
          "false",
          "null",
          "def",
          "in",
          "echo"
        ])
      : new Set<string>();
  const tokenPattern = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\d+(?:\.\d+)?|[{}[\]().,:;=+\-*/<>])/g;
  const parts = content.split(tokenPattern).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const className =
      /^["'`]/.test(part)
        ? "text-emerald-200"
        : keywords.has(part)
          ? "text-sky-200"
          : /^\d/.test(part)
            ? "text-amber-200"
            : /^[{}[\]().,:;=+\-*/<>]$/.test(part)
              ? "text-slate-400"
              : "text-slate-100";
    return (
      <span key={index} className={className}>
        {part}
      </span>
    );
  });
}

function MessageContent({
  content,
  inverted,
  canAddParts,
  onAddPart
}: {
  content: string;
  inverted: boolean;
  canAddParts: boolean;
  onAddPart?: (part: ResponseSection) => void;
}): JSX.Element {
  const sections = canAddParts ? splitResponseSections(content) : [{ id: "message", title: "Message", content }];
  return (
    <div className={`space-y-4 text-sm leading-7 ${inverted ? "text-white" : "text-slate-800"}`}>
      {sections.map((section, sectionIndex) => (
        <section key={section.id} className="group/section">
          {canAddParts && sections.length > 1 ? (
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className={`text-xs font-semibold uppercase ${inverted ? "text-white/55" : "text-slate-400"}`}>
                {section.title}
              </span>
              <button
                className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold opacity-0 transition group-hover/section:opacity-100 ${
                  inverted
                    ? "border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                    : "border-slate-200 bg-white/80 text-slate-500 hover:text-slate-950"
                }`}
                type="button"
                onClick={() => onAddPart?.(section)}
              >
                <FilePlus size={12} />
                Add part
              </button>
            </div>
          ) : sectionIndex > 0 ? null : null}
          <div className="space-y-3">
            {parseMarkdownBlocks(section.content).map((block, index) => {
              if (block.kind === "heading") {
                const Heading = block.level <= 1 ? "h2" : block.level === 2 ? "h3" : "h4";
                return (
                  <Heading key={index} className={`${block.level <= 2 ? "text-base" : "text-sm"} font-semibold ${inverted ? "text-white" : "text-slate-950"}`}>
                    <InlineMarkdown text={block.content} inverted={inverted} />
                  </Heading>
                );
              }
              if (block.kind === "list") {
                return (
                  <ul key={index} className="list-disc space-y-1 pl-5">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <InlineMarkdown text={item} inverted={inverted} />
                      </li>
                    ))}
                  </ul>
                );
              }
              if (block.kind === "math") {
                return (
                  <div key={index} className={`${inverted ? "bg-white/10 text-white" : "bg-slate-50 text-slate-900"} overflow-auto rounded-md px-3 py-2 font-serif text-sm italic`}>
                    {block.content}
                  </div>
                );
              }
              if (block.kind === "code") {
                return (
                  <pre key={index} className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 shadow-inner">
                    <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500">{block.language || "code"}</div>
                    <code>{highlightedCode(block.content, block.language)}</code>
                  </pre>
                );
              }
              return (
                <p key={index} className="whitespace-pre-wrap">
                  <InlineMarkdown text={block.content} inverted={inverted} />
                </p>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}


export function ChatWorkbench({ refreshKey }: ChatWorkbenchProps): JSX.Element {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isSending, setIsSending] = useState(false);
  const [selectedGrounding, setSelectedGrounding] = useState<GraphifyContextResult | null>(null);
  const [artifactBusyId, setArtifactBusyId] = useState("");
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [groundingCollapsed, setGroundingCollapsed] = useState(true);
  const [activeGenerationId, setActiveGenerationId] = useState("");

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads]
  );
  const hasFreshUnusedThread = useMemo(() => threads.some(isFreshUnusedThread), [threads]);

  useEffect(() => {
    void loadThreads();
  }, [refreshKey]);

  useEffect(() => {
    return window.api.chat.onStreamEvent(handleStreamEvent);
  }, []);

  function upsertThread(nextThread: ChatThread): void {
    setThreads((current) => sortedThreads([nextThread, ...current.filter((thread) => thread.id !== nextThread.id)]));
    setActiveThreadId(nextThread.id);
  }

  function updateStreamingMessage(event: Extract<ChatStreamEvent, { type: "delta" | "artifact" | "grounding" }>): void {
    setThreads((current) =>
      current.map((thread) => ({
        ...thread,
        messages: thread.messages.map((message) => {
          if (message.id !== event.messageId) {
            return message;
          }

          if (event.type === "delta") {
            return { ...message, content: event.content };
          }

          if (event.type === "grounding") {
            return { ...message, grounding: { ...message.grounding, graphify: event.grounding } };
          }

          return { ...message, artifacts: [...(message.artifacts ?? []), event.artifact] };
        })
      }))
    );
  }

  function handleStreamEvent(event: ChatStreamEvent): void {
    if (event.type === "started") {
      setActiveGenerationId(event.generationId);
      upsertThread(event.thread);
      setStatus("Querying local Graphify context...");
      return;
    }

    if (event.type === "grounding") {
      setSelectedGrounding(event.grounding);
      updateStreamingMessage(event);
      setStatus("Composing answer...");
      return;
    }

    if (event.type === "delta" || event.type === "artifact") {
      updateStreamingMessage(event);
      return;
    }

    if (event.type === "done") {
      upsertThread(event.thread);
      setSelectedGrounding(event.message.grounding?.graphify ?? null);
      setStatus(event.message.error ? event.message.error : "Answer generated.");
      setActiveGenerationId("");
      setIsSending(false);
      return;
    }

    if (event.type === "aborted") {
      if (event.thread) {
        upsertThread(event.thread);
      }
      setStatus("Generation stopped.");
      setActiveGenerationId("");
      setIsSending(false);
      return;
    }

    if (event.thread) {
      upsertThread(event.thread);
    }
    setStatus(event.error);
    setActiveGenerationId("");
    setIsSending(false);
  }

  async function loadThreads(): Promise<void> {
    try {
      const loaded = sortedThreads(await window.api.chat.listThreads());
      setThreads(loaded);
      setActiveThreadId((current) => current || loaded[0]?.id || "");
      setStatus("Ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load chat.");
    }
  }

  async function createThread(): Promise<void> {
    const existingFreshThread = threads.find(isFreshUnusedThread);
    if (existingFreshThread) {
      setActiveThreadId(existingFreshThread.id);
      setSelectedGrounding(null);
      setStatus("Fresh chat already open.");
      return;
    }

    try {
      const thread = await window.api.chat.createThread();
      setThreads((current) => sortedThreads([thread, ...current]));
      setActiveThreadId(thread.id);
      setSelectedGrounding(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create chat.");
    }
  }

  async function deleteThread(threadId: string): Promise<void> {
    try {
      await window.api.chat.deleteThread(threadId);
      const next = threads.filter((thread) => thread.id !== threadId);
      setThreads(next);
      setActiveThreadId(next[0]?.id ?? "");
      setSelectedGrounding(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete chat.");
    }
  }

  async function sendMessage(): Promise<void> {
    const message = draft.trim();
    if (!message || isSending) {
      return;
    }

    setDraft("");
    setIsSending(true);
    setStatus("Querying local Graphify context...");

    try {
      const response = await window.api.chat.sendMessageStream({
        threadId: activeThread?.id,
        message,
        budget: 2600
      });
      upsertThread(response.thread);
      setSelectedGrounding(response.message.grounding?.graphify ?? null);
      setStatus(response.message.error ? response.message.error : "Answer generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  async function stopGeneration(): Promise<void> {
    if (!activeGenerationId) {
      return;
    }

    setStatus("Stopping generation...");
    await window.api.chat.abortGeneration(activeGenerationId);
  }

  async function showGrounding(messageId: string): Promise<void> {
    try {
      setSelectedGrounding(await window.api.chat.getGrounding(messageId));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load grounding.");
    }
  }

  async function addResponseToBrain(messageId: string): Promise<void> {
    setArtifactBusyId(messageId);
    setStatus("Saving response artifact...");
    try {
      const saved = await window.api.chat.saveMessageArtifact({ messageId });
      const ingested = await window.api.chat.ingestArtifact(messageId, saved.artifact.id);
      const nextThreads = sortedThreads([ingested.thread, ...threads.filter((thread) => thread.id !== ingested.thread.id)]);
      setThreads(nextThreads);
      setActiveThreadId(ingested.thread.id);
      setStatus("Response artifact added to Graphify ingestion.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add response artifact.");
    } finally {
      setArtifactBusyId("");
    }
  }

  async function addResponsePartToBrain(messageId: string, part: ResponseSection): Promise<void> {
    const busyId = `${messageId}:${part.id}`;
    setArtifactBusyId(busyId);
    setStatus("Saving response section...");
    try {
      const saved = await window.api.chat.saveMessageArtifact({
        messageId,
        title: part.title,
        content: part.content
      });
      const ingested = await window.api.chat.ingestArtifact(messageId, saved.artifact.id);
      const nextThreads = sortedThreads([ingested.thread, ...threads.filter((thread) => thread.id !== ingested.thread.id)]);
      setThreads(nextThreads);
      setActiveThreadId(ingested.thread.id);
      setStatus("Response section added to Graphify ingestion.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add response section.");
    } finally {
      setArtifactBusyId("");
    }
  }

  async function ingestArtifact(messageId: string, artifactId: string): Promise<void> {
    setArtifactBusyId(artifactId);
    try {
      const result = await window.api.chat.ingestArtifact(messageId, artifactId);
      setStatus(result.ingestion ? "Artifact added to Graphify ingestion." : "Artifact saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to ingest artifact.");
    } finally {
      setArtifactBusyId("");
    }
  }

  async function downloadArtifact(messageId: string, artifactId: string): Promise<void> {
    setArtifactBusyId(artifactId);
    try {
      const result = await window.api.chat.downloadArtifact(messageId, artifactId);
      setStatus(result.downloadedPath ? `Artifact downloaded to ${result.downloadedPath}` : "Download canceled.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download artifact.");
    } finally {
      setArtifactBusyId("");
    }
  }

  return (
    <div
      className={`grid min-h-0 flex-1 border-b border-slate-900/5 bg-floral ${
        historyCollapsed && groundingCollapsed
          ? "grid-cols-[minmax(0,1fr)]"
          : historyCollapsed
            ? "grid-cols-[minmax(0,1fr)_360px]"
            : groundingCollapsed
              ? "grid-cols-[280px_minmax(0,1fr)]"
              : "grid-cols-[280px_minmax(0,1fr)_360px]"
      }`}
    >
      {!historyCollapsed ? (
      <aside className="min-h-0 border-r border-slate-900/5 bg-white/30 p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">Chat</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white/75 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={hasFreshUnusedThread}
              title={
                hasFreshUnusedThread
                  ? "Use the fresh chat before opening another one"
                  : "Open new chat"
              }
              type="button"
              onClick={() => void createThread()}
            >
              <Plus size={13} />
              New
            </button>
            <button
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
              title="Collapse chat history"
              type="button"
              onClick={() => setHistoryCollapsed(true)}
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
        </div>
        <div className="space-y-1 overflow-y-auto">
          {threads.map((thread) => (
            <button
              key={thread.id}
              className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition ${
                activeThread?.id === thread.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/55"
              }`}
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setSelectedGrounding(null);
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{thread.title}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {thread.messages.length} messages · {formatTime(thread.updatedAt)}
                </span>
              </span>
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteThread(thread.id);
                }}
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
          {threads.length === 0 ? <p className="px-2 py-4 text-sm text-slate-500">No chats yet.</p> : null}
        </div>
      </aside>
      ) : null}

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-900/5 bg-white/20 px-5">
          <div className="flex min-w-0 items-center gap-2">
            {historyCollapsed ? (
              <button
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
                title="Show chat history"
                type="button"
                onClick={() => setHistoryCollapsed(false)}
              >
                <PanelLeftOpen size={15} />
              </button>
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{activeThread?.title ?? "New Chat"}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                Graphify query retrieves a bounded local context packet before the model answers.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-white/65 hover:text-slate-900"
              type="button"
              onClick={() => void loadThreads()}
            >
              <RefreshCcw size={13} />
              Refresh
            </button>
            <button
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
              title={groundingCollapsed ? "Show grounding" : "Collapse grounding"}
              type="button"
              onClick={() => setGroundingCollapsed((value) => !value)}
            >
              {groundingCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {activeThread?.messages.map((message) => {
            const modelName = apiModelName(message.grounding?.api);

            return (
              <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role !== "user" ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
                    <BrainCircuit className="-rotate-90" size={15} />
                  </span>
                ) : null}
                <div
                  className={`max-w-[min(58rem,92%)] rounded-2xl border px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "border-slate-900/10 bg-slate-950 text-white"
                      : "border-slate-200 bg-white/75 text-slate-900"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span
                      className={`text-xs font-semibold ${message.role === "user" ? "text-white/70" : "text-slate-500"}`}
                    >
                      {message.role === "user" ? "You" : "Second Brain"}
                    </span>
                    <span className={`text-xs ${message.role === "user" ? "text-white/45" : "text-slate-400"}`}>
                      {formatTime(message.createdAt)}
                    </span>
                  </div>
                  <MessageContent
                    canAddParts={message.role === "assistant"}
                    content={message.content}
                    inverted={message.role === "user"}
                    onAddPart={(part) => void addResponsePartToBrain(message.id, part)}
                  />
                  {message.error ? (
                    <p
                      className={`mt-3 flex items-center gap-2 text-xs font-semibold ${
                        message.role === "user" ? "text-amber-100" : "text-amber-700"
                      }`}
                    >
                      <AlertTriangle size={14} />
                      {message.error}
                    </p>
                  ) : null}
                  {message.grounding?.graphify ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {modelName ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            message.role === "user"
                              ? "border-white/20 bg-white/10 text-white/75"
                              : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          Model: {modelName}
                        </span>
                      ) : null}
                      <button
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          message.role === "user"
                            ? "border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                        type="button"
                        onClick={() => void showGrounding(message.id)}
                      >
                        <SearchCheck size={13} />
                        Local graph context used
                      </button>
                      {message.role === "assistant" ? (
                        <button
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:opacity-50"
                          disabled={Boolean(artifactBusyId)}
                          title="Add response to ingestion"
                          type="button"
                          onClick={() => void addResponseToBrain(message.id)}
                        >
                          {artifactBusyId === message.id ? (
                            <Loader2 className="animate-spin" size={13} />
                          ) : (
                            <FilePlus size={13} />
                          )}
                          Add
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                {message.artifacts?.length ? (
                  <div className="mt-3 space-y-2">
                    {message.artifacts.map((artifact) => (
                      <div
                        key={artifact.id}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-2.5 py-2 text-xs text-slate-600"
                      >
                        <FilePlus size={13} className="shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">{artifact.filename}</span>
                        <button
                          className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:opacity-50"
                          disabled={Boolean(artifactBusyId)}
                          title="Add artifact to ingestion"
                          type="button"
                          onClick={() => void ingestArtifact(message.id, artifact.id)}
                        >
                          {artifactBusyId === artifact.id ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
                        </button>
                        <button
                          className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:opacity-50"
                          disabled={Boolean(artifactBusyId)}
                          title="Download artifact"
                          type="button"
                          onClick={() => void downloadArtifact(message.id, artifact.id)}
                        >
                          <Download size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {message.role === "user" ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm">
                  <User size={15} />
                </span>
              ) : null}
            </div>
            );
          })}
          {isSending ? (
            <div className="flex justify-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
                <BrainCircuit className="-rotate-90" size={15} />
              </span>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-500 shadow-sm">
                <Loader2 className="animate-spin" size={15} />
                Querying graph and composing answer
              </div>
            </div>
          ) : null}
          {!activeThread || activeThread.messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-md">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-800 shadow-sm">
                  <DatabaseZap size={22} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-950">Ask across the active project</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Second Brain asks Graphify for a compact local subgraph, hydrates readable excerpts, then sends only that context packet to the selected model.
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-slate-900/5 bg-white/20 p-4">
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm">
            <textarea
              className="min-h-12 max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Ask about papers, code, notes, experiments..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 py-1.5">
              <p className="truncate text-xs text-slate-500">{status}</p>
              {isSending && activeGenerationId ? (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                  onClick={() => void stopGeneration()}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  disabled={isSending || !draft.trim()}
                  type="button"
                  onClick={() => void sendMessage()}
                >
                  {isSending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {!groundingCollapsed ? (
      <aside className="min-h-0 border-l border-slate-900/5 bg-white/25 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DatabaseZap size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">Grounding</h2>
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
            title="Collapse grounding"
            type="button"
            onClick={() => setGroundingCollapsed(true)}
          >
            <PanelRightClose size={15} />
          </button>
        </div>
        {selectedGrounding ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Command</p>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-slate-700">{selectedGrounding.command}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Citations</p>
              {selectedGrounding.citations.length ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {selectedGrounding.citations.map((citation) => (
                    <li key={`${citation.sourceFile}:${citation.sourceLocation ?? ""}`} className="break-words">
                      {citation.label ?? citation.sourceFile}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No source locations were returned by Graphify.</p>
              )}
            </div>
            <pre className="max-h-[56vh] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
              {selectedGrounding.stdout || selectedGrounding.error}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Select an answer with local graph context to inspect the query, citations, and hydrated excerpts.
          </p>
        )}
      </aside>
      ) : null}
    </div>
  );
}

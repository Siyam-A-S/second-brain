import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  DatabaseZap,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCcw,
  SearchCheck,
  Send,
  Trash2,
  User
} from "lucide-react";
import type { ChatThread, GraphifyContextResult } from "../../shared/ipc";

type ChatWorkbenchProps = {
  refreshKey: number;
};

function sortedThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

export function ChatWorkbench({ refreshKey }: ChatWorkbenchProps): JSX.Element {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isSending, setIsSending] = useState(false);
  const [selectedGrounding, setSelectedGrounding] = useState<GraphifyContextResult | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads]
  );

  useEffect(() => {
    void loadThreads();
  }, [refreshKey]);

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
      const response = await window.api.chat.sendMessage({
        threadId: activeThread?.id,
        message,
        budget: 2600
      });
      const nextThreads = sortedThreads([response.thread, ...threads.filter((thread) => thread.id !== response.thread.id)]);
      setThreads(nextThreads);
      setActiveThreadId(response.thread.id);
      setSelectedGrounding(response.message.grounding?.graphify ?? null);
      setStatus(response.message.error ? response.message.error : "Answer generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  async function showGrounding(messageId: string): Promise<void> {
    try {
      setSelectedGrounding(await window.api.chat.getGrounding(messageId));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load grounding.");
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px] border-b border-slate-900/5 bg-floral">
      <aside className="min-h-0 border-r border-slate-900/5 bg-white/30 p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">Chat</h2>
          </div>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white/75 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
            type="button"
            onClick={() => void createThread()}
          >
            <Plus size={13} />
            New
          </button>
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

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-900/5 bg-white/20 px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{activeThread?.title ?? "New Chat"}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              Graphify query retrieves a bounded local context packet before the model answers.
            </p>
          </div>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-white/65 hover:text-slate-900"
            type="button"
            onClick={() => void loadThreads()}
          >
            <RefreshCcw size={13} />
            Refresh
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {activeThread?.messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role !== "user" ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
                  <Bot size={15} />
                </span>
              ) : null}
              <div
                className={`max-w-[min(46rem,80%)] rounded-2xl border px-4 py-3 shadow-sm ${
                  message.role === "user"
                    ? "border-slate-900/10 bg-slate-950 text-white"
                    : "border-slate-200 bg-white/75 text-slate-900"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className={`text-xs font-semibold ${message.role === "user" ? "text-white/70" : "text-slate-500"}`}>
                    {message.role === "user" ? "You" : "Second Brain"}
                  </span>
                  <span className={`text-xs ${message.role === "user" ? "text-white/45" : "text-slate-400"}`}>
                    {formatTime(message.createdAt)}
                  </span>
                </div>
                <p className={`whitespace-pre-wrap text-sm leading-6 ${message.role === "user" ? "text-white" : "text-slate-800"}`}>
                  {message.content}
                </p>
                {message.error ? (
                  <p className={`mt-3 flex items-center gap-2 text-xs font-semibold ${message.role === "user" ? "text-amber-100" : "text-amber-700"}`}>
                    <AlertTriangle size={14} />
                    {message.error}
                  </p>
                ) : null}
                {message.grounding?.graphify ? (
                  <button
                    className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
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
                ) : null}
              </div>
              {message.role === "user" ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm">
                  <User size={15} />
                </span>
              ) : null}
            </div>
          ))}
          {isSending ? (
            <div className="flex justify-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
                <Bot size={15} />
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
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                disabled={isSending || !draft.trim()}
                type="button"
                onClick={() => void sendMessage()}
              >
                {isSending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                Send
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="min-h-0 border-l border-slate-900/5 bg-white/25 p-4">
        <div className="flex items-center gap-2">
          <DatabaseZap size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-950">Grounding</h2>
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
    </div>
  );
}

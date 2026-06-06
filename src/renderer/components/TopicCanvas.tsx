import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clipboard,
  Download,
  FileText,
  Pin,
  RefreshCcw,
  Sparkles,
  X,
  XCircle
} from "lucide-react";
import type {
  BoardChildNode,
  OrganizedBoardTopic,
  ProcessDroppedItemsResult,
  UserValidationState
} from "../../shared/ipc";

type TopicCanvasProps = {
  refreshKey: number;
  lastDropResult: ProcessDroppedItemsResult | null;
};

type LoadState = "loading" | "ready" | "error";
type ExportState = "idle" | "copied" | "error";

function formatRelativeTime(value: string): string {
  const ageMs = Date.now() - new Date(value).getTime();
  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));

  if (ageMinutes < 1) {
    return "just now";
  }

  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours}h ago`;
  }

  return `${Math.round(ageHours / 24)}d ago`;
}

function validationLabel(value: UserValidationState): string {
  switch (value) {
    case "approved":
      return "Approved";
    case "pinned":
      return "Pinned";
    case "rejected":
      return "Rejected";
    case "unreviewed":
    default:
      return "Unreviewed";
  }
}

function validationClass(value: UserValidationState): string {
  switch (value) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "pinned":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "unreviewed":
    default:
      return "border-slate-200 bg-white/60 text-slate-600";
  }
}

export function TopicCanvas({ refreshKey, lastDropResult }: TopicCanvasProps): JSX.Element {
  const [topics, setTopics] = useState<OrganizedBoardTopic[]>([]);
  const [activeTopicUuid, setActiveTopicUuid] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<BoardChildNode | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [exportState, setExportState] = useState<ExportState>("idle");

  useEffect(() => {
    let isMounted = true;

    setLoadState("loading");
    void window.api.brain
      .getOrganizedBoard()
      .then((board) => {
        if (!isMounted) {
          return;
        }

        setTopics(board);
        setLoadState("ready");
        setActiveTopicUuid((current) => {
          if (current && board.some((topic) => topic.uuid === current)) {
            return current;
          }

          return board[0]?.uuid ?? null;
        });
      })
      .catch((error) => {
        console.error("Unable to load organized board", error);
        if (isMounted) {
          setLoadState("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.uuid === activeTopicUuid) ?? topics[0] ?? null,
    [activeTopicUuid, topics]
  );

  async function refreshBoard(): Promise<void> {
    setLoadState("loading");
    try {
      const board = await window.api.brain.getOrganizedBoard();
      setTopics(board);
      setLoadState("ready");
    } catch (error) {
      console.error("Unable to refresh organized board", error);
      setLoadState("error");
    }
  }

  async function copyBoardExport(): Promise<void> {
    try {
      const input = activeTopic ? { root_uuid: activeTopic.uuid, include_body: true } : { include_body: true };
      const text = await window.api.brain.exportBoardPlaintext(input);
      await navigator.clipboard.writeText(text);
      setExportState("copied");
      window.setTimeout(() => setExportState("idle"), 2_000);
    } catch (error) {
      console.error("Unable to export board", error);
      setExportState("error");
      window.setTimeout(() => setExportState("idle"), 2_000);
    }
  }

  async function updateValidation(node: BoardChildNode, userValidation: UserValidationState): Promise<void> {
    await window.api.brain.updateNodeSignals({
      uuid: node.uuid,
      user_validation: userValidation
    });
    setSelectedNode((current) => (current?.uuid === node.uuid ? { ...current, user_validation: userValidation } : current));
    await refreshBoard();
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-floral">
      <nav className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="flex min-w-0 items-center gap-6 overflow-x-auto">
          {topics.map((topic) => {
            const isActive = activeTopic?.uuid === topic.uuid;

            return (
              <button
                key={topic.uuid}
                className={`relative max-w-56 truncate py-2 text-sm font-semibold transition-colors duration-200 ${
                  isActive ? "text-slate-900" : "text-slate-400 hover:text-slate-900"
                }`}
                title={topic.title}
                type="button"
                onClick={() => setActiveTopicUuid(topic.uuid)}
              >
                {topic.title}
                {isActive ? (
                  <motion.span
                    className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-slate-900"
                    layoutId="active-topic-underline"
                    transition={{ duration: 0.24, ease: "easeOut" }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh board"
            type="button"
            onClick={() => void refreshBoard()}
          >
            <RefreshCcw size={16} />
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Copy board export"
            type="button"
            onClick={() => void copyBoardExport()}
          >
            {exportState === "copied" ? <Check size={16} /> : <Download size={16} />}
          </button>
        </div>
      </nav>

      {lastDropResult ? (
        <section className="border-b border-emerald-900/10 bg-emerald-50/60 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-emerald-900">
            <Sparkles size={16} />
            <span className="font-semibold">{lastDropResult.createdNode.title}</span>
            <span>routed to {lastDropResult.routing.parent_title}</span>
            <span>{Math.round(lastDropResult.routing.confidence * 100)}% confidence</span>
          </div>
        </section>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto p-6">
        {loadState === "loading" ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading board...</div>
        ) : null}

        {loadState === "error" ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-sm text-center">
              <XCircle className="mx-auto text-rose-500" size={28} />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Board unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">The local board could not be read.</p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && topics.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-md text-center">
              <FileText className="mx-auto text-slate-400" size={32} />
              <h2 className="mt-4 text-xl font-semibold text-slate-950">Start with one drop</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Add a note, class handout, AI response, schema, or snippet. It will land here as a local topic.
              </p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && activeTopic ? (
          <motion.div
            key={activeTopic.uuid}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
            initial={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold leading-8 text-slate-950">{activeTopic.title}</h1>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${validationClass(activeTopic.user_validation)}`}>
                    {validationLabel(activeTopic.user_validation)}
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{activeTopic.summary}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/55 px-4 py-3 text-sm text-slate-600">
                {activeTopic.children.length} item{activeTopic.children.length === 1 ? "" : "s"}
              </div>
            </header>

            {activeTopic.children.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white/35 p-8 text-center">
                <p className="text-sm text-slate-600">Drop related material to build this topic.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {activeTopic.children.map((node) => (
                  <button
                    key={node.uuid}
                    className="min-h-44 rounded-lg border border-slate-200 bg-white/55 p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-white/75 hover:shadow-md"
                    type="button"
                    onClick={() => setSelectedNode(node)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-base font-semibold leading-6 text-slate-900">{node.title}</h2>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${validationClass(node.user_validation)}`}>
                        {validationLabel(node.user_validation)}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-700">{node.summary}</p>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{formatRelativeTime(node.updatedAt)}</span>
                      <span>{Math.round(node.importance * 100)} importance</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        ) : null}
      </section>

      <AnimatePresence>
        {selectedNode ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-6 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => setSelectedNode(null)}
          >
            <motion.article
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="w-full max-w-2xl rounded-lg border border-slate-200 bg-floral p-7 shadow-float"
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              initial={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold leading-7 text-slate-900">{selectedNode.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{formatRelativeTime(selectedNode.updatedAt)}</p>
                </div>
                <button
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-900"
                  type="button"
                  onClick={() => setSelectedNode(null)}
                >
                  <X size={17} />
                </button>
              </div>

              <p className="text-base leading-relaxed text-slate-800">{selectedNode.summary}</p>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  title="Approve routing"
                  type="button"
                  onClick={() => void updateValidation(selectedNode, "approved")}
                >
                  <Check size={15} />
                  Approve
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                  title="Pin item"
                  type="button"
                  onClick={() => void updateValidation(selectedNode, "pinned")}
                >
                  <Pin size={15} />
                  Pin
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100"
                  title="Reject routing"
                  type="button"
                  onClick={() => void updateValidation(selectedNode, "rejected")}
                >
                  <XCircle size={15} />
                  Reject
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white/60 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
                  title="Copy board export"
                  type="button"
                  onClick={() => void copyBoardExport()}
                >
                  <Clipboard size={15} />
                  {exportState === "copied" ? "Copied" : "Copy context"}
                </button>
              </div>
            </motion.article>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

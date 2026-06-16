import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  FileText,
  Folder,
  GitMerge,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  Network,
  Pencil,
  RefreshCcw,
  Search,
  Table2,
  Trash2,
  X
} from "lucide-react";
import type { BoardItem, BoardRule, BoardSearchResult, GraphBoardTopic, GraphHtmlDocument } from "../../shared/ipc";
import { useBoardStore } from "../stores/useBoardStore";

type BoardRendererProps = {
  refreshKey: number;
};
type BoardTab = BoardRule | "graph";

const boardTabs: Array<{ tab: BoardTab; label: string; icon: typeof LayoutGrid }> = [
  { tab: "community", label: "Cards", icon: LayoutGrid },
  { tab: "entity", label: "Entities", icon: Table2 },
  { tab: "source", label: "Sources", icon: List },
  { tab: "graph", label: "Graph", icon: Network }
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function rawString(item: BoardItem, key: string): string {
  const value = item.rawData[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function rawNumber(item: BoardItem, key: string): number | null {
  const value = item.rawData[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function displaySource(sourceFile: string): string {
  return sourceFile.split(/[\\/]/).filter(Boolean).at(-1) ?? sourceFile;
}

function folderName(sourceFile: string): string {
  const parts = sourceFile.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "Raw vault";
}

function sourceComment(topic: GraphBoardTopic): string {
  const value = topic.items[0]?.rawData.sourceComment;
  return typeof value === "string" ? value.trim() : "";
}

function MasonryGrid({ topic }: { topic: GraphBoardTopic }): JSX.Element {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{topic.title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {topic.items.length} item{topic.items.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>
      <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
        {topic.items.map((item) => (
          <article
            key={item.id}
            className="mb-4 flex max-h-[26rem] break-inside-avoid flex-col rounded-lg border border-slate-200 bg-white/60 p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold leading-6 text-slate-950">{item.title}</h3>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-500">
                {item.type}
              </span>
            </div>
            <div className="mt-4 min-h-0 overflow-y-auto pr-1 text-sm leading-6 text-slate-700">{item.summary}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EntityTable({ topic }: { topic: GraphBoardTopic }): JSX.Element {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-slate-950">{topic.title}</h2>
        <p className="mt-1 text-sm text-slate-500">Graphify nodes sorted by source activity and relation count.</p>
      </header>
      <div className="max-h-[calc(100vh-12rem)] overflow-auto rounded-lg border border-slate-200 bg-white/60 shadow-sm">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 text-xs uppercase text-slate-500 backdrop-blur">
            <tr>
              <th className="px-4 py-3 font-semibold">Entity</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Updated</th>
              <th className="px-4 py-3 font-semibold">Links</th>
              <th className="px-4 py-3 font-semibold">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80">
            {topic.items.map((item) => (
              <tr key={item.id} className="align-top transition hover:bg-white/70">
                <td className="min-w-60 px-4 py-4 font-semibold text-slate-950">
                  <div className="max-h-24 overflow-y-auto pr-1">
                    <p>{item.title}</p>
                    {rawString(item, "company") || rawString(item, "role") ? (
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {[rawString(item, "company"), rawString(item, "role")].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="min-w-36 px-4 py-4 text-slate-800">
                  <div className="max-h-24 overflow-y-auto pr-1">{item.type}</div>
                </td>
                <td className="min-w-56 max-w-80 px-4 py-4 text-slate-600">
                  <div className="max-h-24 overflow-y-auto break-words pr-1">{item.sourceFile}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                  {rawString(item, "date") || formatDate(item.modifiedAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-600">{rawNumber(item, "relationCount") ?? 0}</td>
                <td className="min-w-96 max-w-xl px-4 py-4 leading-6 text-slate-700">
                  <div className="max-h-32 overflow-y-auto pr-1">{item.summary}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceExplorer({
  topics,
  sourceOptions,
  onCollapseSource,
  onCommentSource,
  onRemoveSource,
  onRenameSource
}: {
  topics: GraphBoardTopic[];
  sourceOptions: string[];
  onCollapseSource: (sourceFile: string, targetSourceFile: string) => Promise<void>;
  onCommentSource: (sourceFile: string, comment: string) => Promise<void>;
  onRemoveSource: (sourceFile: string) => Promise<void>;
  onRenameSource: (sourceFile: string, newName: string) => Promise<void>;
}): JSX.Element {
  const [renamingSource, setRenamingSource] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [commentingSource, setCommentingSource] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [mergingSource, setMergingSource] = useState("");
  const [targetSourceFile, setTargetSourceFile] = useState("");
  const sources = topics.map((topic) => ({
    topic,
    sourceFile: topic.items[0]?.sourceFile ?? "",
    comment: sourceComment(topic),
    folder: folderName(topic.items[0]?.sourceFile ?? "")
  }));
  const folders = Array.from(new Set(sources.map((source) => source.folder))).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (!mergingSource) {
      setTargetSourceFile("");
      return;
    }

    const options = sourceOptions.filter((option) => option && option !== mergingSource);
    if (targetSourceFile && options.includes(targetSourceFile)) {
      return;
    }

    setTargetSourceFile(options[0] ?? "");
  }, [mergingSource, sourceOptions, targetSourceFile]);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white/55 shadow-sm">
      <header className="flex h-11 items-center justify-between border-b border-slate-200/80 px-4 text-xs font-semibold uppercase text-slate-500">
        <span>Sources</span>
        <span>{sources.length} file{sources.length === 1 ? "" : "s"}</span>
      </header>
      <div className="max-h-[calc(100vh-12rem)] overflow-auto">
        {folders.map((folder) => (
          <section key={folder}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200/70 bg-white/90 px-4 py-2 text-xs font-semibold text-slate-500 backdrop-blur">
              <Folder size={14} />
              <span className="truncate">{folder}</span>
            </div>
            <div className="divide-y divide-slate-200/70">
              {sources
                .filter((source) => source.folder === folder)
                .map(({ topic, sourceFile, comment }) => {
                  const collapseOptions = sourceOptions.filter((option) => option && option !== sourceFile);
                  const isRenaming = renamingSource === sourceFile;
                  const isCommenting = commentingSource === sourceFile;
                  const isMerging = mergingSource === sourceFile;

                  return (
                    <article key={topic.id} className="px-4 py-3 transition hover:bg-white/60">
                      <div className="flex items-center gap-3">
                        <FileText className="shrink-0 text-slate-400" size={17} />
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <input
                              className="h-9 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                            />
                          ) : (
                            <p className="truncate text-sm font-semibold text-slate-950">{displaySource(sourceFile)}</p>
                          )}
                          <p className="truncate text-xs text-slate-500">
                            {sourceFile} · {topic.items.length} item{topic.items.length === 1 ? "" : "s"}
                          </p>
                          {comment && !isCommenting ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{comment}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isRenaming ? (
                            <>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
                                title="Save name"
                                type="button"
                                onClick={() => {
                                  void onRenameSource(sourceFile, renameDraft);
                                  setRenamingSource("");
                                }}
                              >
                                <Check size={15} />
                              </button>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                                title="Cancel rename"
                                type="button"
                                onClick={() => setRenamingSource("")}
                              >
                                <X size={15} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                                title="Rename source"
                                type="button"
                                onClick={() => {
                                  setRenamingSource(sourceFile);
                                  setRenameDraft(displaySource(sourceFile));
                                }}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                                title="Comment on source"
                                type="button"
                                onClick={() => {
                                  setCommentingSource(isCommenting ? "" : sourceFile);
                                  setCommentDraft(comment);
                                }}
                              >
                                <MessageSquare size={15} />
                              </button>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={collapseOptions.length === 0}
                                title="Merge source"
                                type="button"
                                onClick={() => setMergingSource(isMerging ? "" : sourceFile)}
                              >
                                <GitMerge size={15} />
                              </button>
                              <button
                                className="grid h-8 w-8 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
                                title="Delete source"
                                type="button"
                                onClick={() => void onRemoveSource(sourceFile)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {isMerging ? (
                        <div className="mt-3 flex items-center gap-2 pl-8">
                          <select
                            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                            value={targetSourceFile}
                            onChange={(event) => setTargetSourceFile(event.target.value)}
                          >
                            {collapseOptions.map((option) => (
                              <option key={option} value={option}>
                                {displaySource(option)}
                              </option>
                            ))}
                          </select>
                          <button
                            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!targetSourceFile}
                            type="button"
                            onClick={() => {
                              void onCollapseSource(sourceFile, targetSourceFile);
                              setMergingSource("");
                            }}
                          >
                            <ArrowRight size={15} />
                            Merge
                          </button>
                        </div>
                      ) : null}
                      {isCommenting ? (
                        <div className="mt-3 pl-8">
                          <textarea
                            className="h-24 w-full resize-none rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm leading-5 text-slate-800 outline-none transition focus:border-slate-400"
                            placeholder="Add context for Graphify..."
                            value={commentDraft}
                            onChange={(event) => setCommentDraft(event.target.value)}
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button
                              className="h-8 rounded-md px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950"
                              type="button"
                              onClick={() => setCommentingSource("")}
                            >
                              Cancel
                            </button>
                            <button
                              className="h-8 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                              type="button"
                              onClick={() => {
                                void onCommentSource(sourceFile, commentDraft);
                                setCommentingSource("");
                              }}
                            >
                              Save comment
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function SourceList({
  topic,
  sourceOptions,
  onCollapseSource,
  onCommentSource,
  onRemoveSource,
  onRenameSource
}: {
  topic: GraphBoardTopic;
  sourceOptions: string[];
  onCollapseSource: (sourceFile: string, targetSourceFile: string) => Promise<void>;
  onCommentSource: (sourceFile: string, comment: string) => Promise<void>;
  onRemoveSource: (sourceFile: string) => Promise<void>;
  onRenameSource: (sourceFile: string, newName: string) => Promise<void>;
}): JSX.Element {
  return (
    <SourceExplorer
      topics={[topic]}
      sourceOptions={sourceOptions}
      onCollapseSource={onCollapseSource}
      onCommentSource={onCommentSource}
      onRemoveSource={onRemoveSource}
      onRenameSource={onRenameSource}
    />
  );
}

function TopicView({
  topic,
  sourceOptions,
  onCollapseSource,
  onCommentSource,
  onRemoveSource,
  onRenameSource
}: {
  topic: GraphBoardTopic;
  sourceOptions: string[];
  onCollapseSource: (sourceFile: string, targetSourceFile: string) => Promise<void>;
  onCommentSource: (sourceFile: string, comment: string) => Promise<void>;
  onRemoveSource: (sourceFile: string) => Promise<void>;
  onRenameSource: (sourceFile: string, newName: string) => Promise<void>;
}): JSX.Element {
  switch (topic.layoutType) {
    case "table":
      return <EntityTable topic={topic} />;
    case "list":
      return (
        <SourceList
          topic={topic}
          sourceOptions={sourceOptions}
          onCollapseSource={onCollapseSource}
          onCommentSource={onCommentSource}
          onRemoveSource={onRemoveSource}
          onRenameSource={onRenameSource}
        />
      );
    case "masonry":
    default:
      return <MasonryGrid topic={topic} />;
  }
}

function GraphHtmlViewer({
  document,
  loadState,
  error
}: {
  document: GraphHtmlDocument | null;
  loadState: "idle" | "loading" | "ready" | "error";
  error: string | null;
}): JSX.Element {
  if (loadState === "loading" || loadState === "idle") {
    return <div className="grid h-full place-items-center text-sm text-slate-500">Loading Graphify graph...</div>;
  }

  if (loadState === "error") {
    return (
      <div className="grid h-full place-items-center">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto text-rose-500" size={28} />
          <h2 className="mt-3 text-base font-semibold text-slate-950">Graph view unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{error ?? "Graphify has not generated graph.html yet."}</p>
        </div>
      </div>
    );
  }

  if (!document) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">Graphify has not generated graph.html yet.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm">
      <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-3 text-xs text-slate-300">
        <span className="truncate">{document.path}</span>
        <span className="shrink-0">{formatDate(document.updatedAt)}</span>
      </div>
      <iframe
        className="min-h-0 flex-1 border-0 bg-slate-950"
        sandbox="allow-scripts"
        srcDoc={document.html}
        title="Graphify interactive graph"
      />
    </div>
  );
}

function SearchResultsPanel({
  query,
  results,
  isLoading,
  error
}: {
  query: string;
  results: BoardSearchResult[];
  isLoading: boolean;
  error: string | null;
}): JSX.Element | null {
  if (!query.trim()) {
    return null;
  }

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white/60 shadow-sm">
      <header className="flex h-10 items-center justify-between border-b border-slate-200/80 px-4 text-xs font-semibold uppercase text-slate-500">
        <span>Search</span>
        <span>{isLoading ? "Searching" : `${results.length} result${results.length === 1 ? "" : "s"}`}</span>
      </header>
      {error ? <p className="px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {!error && !isLoading && results.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">No matching entities, types, or sources.</p>
      ) : null}
      <div className="max-h-64 divide-y divide-slate-200/70 overflow-y-auto">
        {results.map((result) => (
          <article key={result.id} className="flex items-center gap-3 px-4 py-3">
            <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-xs font-semibold capitalize text-slate-500">
              {result.kind}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{result.title}</p>
              <p className="truncate text-xs text-slate-500">{result.subtitle}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function BoardRenderer({ refreshKey }: BoardRendererProps): JSX.Element {
  const rule = useBoardStore((state) => state.rule);
  const topics = useBoardStore((state) => state.topics);
  const loadState = useBoardStore((state) => state.loadState);
  const error = useBoardStore((state) => state.error);
  const loadBoard = useBoardStore((state) => state.loadBoard);
  const [activeTab, setActiveTab] = useState<BoardTab>(rule);
  const [graphDocument, setGraphDocument] = useState<GraphHtmlDocument | null>(null);
  const [graphLoadState, setGraphLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [graphError, setGraphError] = useState<string | null>(null);
  const [sourceActionError, setSourceActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BoardSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "graph") {
      void loadGraphHtml();
      return;
    }

    void loadBoard(activeTab);
  }, [activeTab, loadBoard, refreshKey]);

  const visibleTopics = useMemo(() => topics.filter((topic) => topic.items.length > 0), [topics]);
  const sourceOptions = useMemo(
    () =>
      visibleTopics
        .map((topic) => topic.items[0]?.sourceFile ?? "")
        .filter((sourceFile, index, all) => sourceFile && all.indexOf(sourceFile) === index),
    [visibleTopics]
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void window.api.board
        .search({ query, limit: 18 })
        .then((results) => setSearchResults(results))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Unable to search the board.";
          setSearchError(message);
          setSearchResults([]);
        })
        .finally(() => setSearchLoading(false));
    }, 120);

    return () => window.clearTimeout(timer);
  }, [searchQuery, refreshKey]);

  async function loadGraphHtml(): Promise<void> {
    setGraphLoadState("loading");
    setGraphError(null);

    try {
      setGraphDocument(await window.api.board.getGraphHtml());
      setGraphLoadState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load Graphify graph.html.";
      console.error("Unable to load Graphify graph.html", error);
      setGraphDocument(null);
      setGraphLoadState("error");
      setGraphError(message);
    }
  }

  function changeTab(nextTab: BoardTab): void {
    setActiveTab(nextTab);
  }

  async function refreshActiveTab(): Promise<void> {
    if (activeTab === "graph") {
      await loadGraphHtml();
      return;
    }

    await loadBoard(activeTab);
  }

  async function removeSource(sourceFile: string): Promise<void> {
    if (!sourceFile) {
      return;
    }

    setSourceActionError(null);

    try {
      await window.api.board.removeSource(sourceFile);
      await loadBoard(activeTab === "graph" ? "source" : activeTab);
      if (activeTab === "graph") {
        await loadGraphHtml();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove source.";
      console.error("Unable to remove source", error);
      setSourceActionError(message);
    }
  }

  async function collapseSource(sourceFile: string, targetSourceFile: string): Promise<void> {
    if (!sourceFile || !targetSourceFile) {
      return;
    }

    setSourceActionError(null);

    try {
      await window.api.board.collapseSource(sourceFile, targetSourceFile);
      await loadBoard(activeTab === "graph" ? "source" : activeTab);
      if (activeTab === "graph") {
        await loadGraphHtml();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to collapse source.";
      console.error("Unable to collapse source", error);
      setSourceActionError(message);
    }
  }

  async function renameSource(sourceFile: string, newName: string): Promise<void> {
    if (!sourceFile || !newName.trim()) {
      return;
    }

    setSourceActionError(null);

    try {
      await window.api.board.renameSource(sourceFile, newName);
      await loadBoard("source");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to rename source.";
      console.error("Unable to rename source", error);
      setSourceActionError(message);
    }
  }

  async function commentSource(sourceFile: string, comment: string): Promise<void> {
    if (!sourceFile) {
      return;
    }

    setSourceActionError(null);

    try {
      await window.api.board.commentSource(sourceFile, comment);
      await loadBoard("source");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save source comment.";
      console.error("Unable to save source comment", error);
      setSourceActionError(message);
    }
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="flex items-center gap-2">
          {boardTabs.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                activeTab === tab ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:bg-white/50 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => changeTab(tab)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label className="relative hidden w-72 min-w-0 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              className="h-9 w-full rounded-md border border-slate-200 bg-white/65 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
              placeholder="Search entities, types, sources"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh Graphify board"
            type="button"
            onClick={() => void refreshActiveTab()}
          >
            {(activeTab === "graph" ? graphLoadState : loadState) === "loading" ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <RefreshCcw size={16} />
            )}
          </button>
        </div>
      </header>

      <section className={`min-h-0 flex-1 overflow-auto ${activeTab === "graph" ? "p-3" : "p-6"}`}>
        <SearchResultsPanel
          error={searchError}
          isLoading={searchLoading}
          query={searchQuery}
          results={searchResults}
        />

        {activeTab === "graph" ? (
          <GraphHtmlViewer document={graphDocument} error={graphError} loadState={graphLoadState} />
        ) : null}

        {activeTab !== "graph" && loadState === "loading" ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading Graphify board...</div>
        ) : null}

        {activeTab !== "graph" && loadState === "error" ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-sm text-center">
              <AlertCircle className="mx-auto text-rose-500" size={28} />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Graphify board unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{error ?? "The local graph could not be read."}</p>
            </div>
          </div>
        ) : null}

        {activeTab === "source" && sourceActionError ? (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {sourceActionError}
          </div>
        ) : null}

        {activeTab !== "graph" && loadState === "ready" && visibleTopics.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-md text-center">
              {activeTab === "entity" ? (
                <Table2 className="mx-auto text-slate-400" size={32} />
              ) : (
                <FileText className="mx-auto text-slate-400" size={32} />
              )}
              <h2 className="mt-4 text-xl font-semibold text-slate-950">No Graphify items yet</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {activeTab === "entity"
                  ? "The entity table shows graph nodes after Graphify writes graph.json."
                  : "Drop supported files to build the local graph."}
              </p>
            </div>
          </div>
        ) : null}

        {activeTab !== "graph" && loadState === "ready" && visibleTopics.length > 0 ? (
          activeTab === "source" ? (
            <SourceExplorer
              topics={visibleTopics}
              sourceOptions={sourceOptions}
              onCollapseSource={collapseSource}
              onCommentSource={commentSource}
              onRemoveSource={removeSource}
              onRenameSource={renameSource}
            />
          ) : (
            <div className="space-y-8">
              {visibleTopics.map((topic) => (
                <TopicView
                  key={topic.id}
                  topic={topic}
                  sourceOptions={sourceOptions}
                  onCollapseSource={collapseSource}
                  onCommentSource={commentSource}
                  onRemoveSource={removeSource}
                  onRenameSource={renameSource}
                />
              ))}
            </div>
          )
        ) : null}
      </section>
    </main>
  );
}

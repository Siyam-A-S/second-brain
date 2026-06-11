import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  FileText,
  GitMerge,
  LayoutGrid,
  List,
  Loader2,
  Network,
  RefreshCcw,
  Table2,
  Trash2
} from "lucide-react";
import type { BoardItem, BoardRule, GraphBoardTopic, GraphHtmlDocument } from "../../shared/ipc";
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

function SourceList({
  topic,
  sourceOptions,
  onCollapseSource,
  onRemoveSource
}: {
  topic: GraphBoardTopic;
  sourceOptions: string[];
  onCollapseSource: (sourceFile: string, targetSourceFile: string) => Promise<void>;
  onRemoveSource: (sourceFile: string) => Promise<void>;
}): JSX.Element {
  const sourceFile = topic.items[0]?.sourceFile ?? "";
  const collapseOptions = sourceOptions.filter((option) => option && option !== sourceFile);
  const [targetSourceFile, setTargetSourceFile] = useState(collapseOptions[0] ?? "");

  useEffect(() => {
    if (targetSourceFile && collapseOptions.includes(targetSourceFile)) {
      return;
    }

    setTargetSourceFile(collapseOptions[0] ?? "");
  }, [collapseOptions, targetSourceFile]);

  return (
    <section className="flex max-h-[30rem] flex-col rounded-lg border border-slate-200 bg-white/55 p-5 shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-950">{topic.title}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{sourceFile || "Unknown source"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-xs text-slate-500">
            {topic.items.length}
          </span>
          <button
            className="grid h-8 w-8 place-items-center rounded-md border border-rose-200 bg-white/70 text-rose-600 transition hover:bg-rose-50"
            disabled={!sourceFile}
            title="Remove source"
            type="button"
            onClick={() => void onRemoveSource(sourceFile)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      <div className="mt-4 flex items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          disabled={!sourceFile || collapseOptions.length === 0}
          title="Collapse this source into another source"
          value={targetSourceFile}
          onChange={(event) => setTargetSourceFile(event.target.value)}
        >
          {collapseOptions.length === 0 ? <option value="">No target source</option> : null}
          {collapseOptions.map((option) => (
            <option key={option} value={option}>
              {displaySource(option)}
            </option>
          ))}
        </select>
        <button
          className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/70 text-slate-600 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!sourceFile || !targetSourceFile}
          title="Collapse source into selected source"
          type="button"
          onClick={() => void onCollapseSource(sourceFile, targetSourceFile)}
        >
          <GitMerge size={15} />
        </button>
      </div>
      <ul className="mt-4 min-h-0 divide-y divide-slate-200/80 overflow-y-auto pr-1">
        {topic.items.map((item) => (
          <li key={item.id} className="py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 max-h-20 overflow-y-auto pr-1 text-sm leading-5 text-slate-600">{item.summary}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{item.type}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopicView({
  topic,
  sourceOptions,
  onCollapseSource,
  onRemoveSource
}: {
  topic: GraphBoardTopic;
  sourceOptions: string[];
  onCollapseSource: (sourceFile: string, targetSourceFile: string) => Promise<void>;
  onRemoveSource: (sourceFile: string) => Promise<void>;
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
          onRemoveSource={onRemoveSource}
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
      </header>

      <section className={`min-h-0 flex-1 overflow-auto ${activeTab === "graph" ? "p-3" : "p-6"}`}>
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
          <div className={activeTab === "source" ? "grid grid-cols-1 gap-4 xl:grid-cols-2" : "space-y-8"}>
            {visibleTopics.map((topic) => (
              <TopicView
                key={topic.id}
                topic={topic}
                sourceOptions={sourceOptions}
                onCollapseSource={collapseSource}
                onRemoveSource={removeSource}
              />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { AlertCircle, BookOpen, FileText, Layers3, Loader2, Network, RefreshCcw, Route, Search, X } from "lucide-react";
import type {
  CallflowHtmlDocument,
  GraphBoardLink,
  GraphBoardNode,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphDefinitionStatus,
  ResearchPaperStatus
} from "../../shared/ipc";

type GraphBoardRendererProps = {
  refreshKey: number;
};

type LoadState = "idle" | "loading" | "ready" | "error";

type ForceNode = GraphBoardNode & {
  x?: number;
  y?: number;
};

type ForceLink = GraphBoardLink & {
  source: string | ForceNode;
  target: string | ForceNode;
};

function useElementSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      setSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(360, Math.round(entry.contentRect.height))
      });
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

function relationEndpoint(value: string | ForceNode): string {
  return typeof value === "string" ? value : value.id;
}

function colorFor(node: GraphBoardNode): string {
  const palette = ["#0f766e", "#7c3aed", "#b45309", "#2563eb", "#be123c", "#475569", "#15803d", "#a21caf"];
  const seed = `${node.type}:${node.community}`;
  const total = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[total % palette.length] ?? "#475569";
}

function displaySource(sourceFile: string): string {
  return sourceFile.split(/[\\/]/).filter(Boolean).at(-1) ?? sourceFile;
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function paperStatusLabel(status: ResearchPaperStatus): string {
  return titleCase(status);
}

export function GraphBoardRenderer({ refreshKey }: GraphBoardRendererProps): JSX.Element {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const lastAppliedDefinitionKey = useRef("");
  const [graph, setGraph] = useState<GraphBoardState | null>(null);
  const [details, setDetails] = useState<GraphBoardNodeDetails | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphBoardNode | null>(null);
  const [callflow, setCallflow] = useState<CallflowHtmlDocument | null>(null);
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [callflowLoading, setCallflowLoading] = useState(false);
  const [definitionStatus, setDefinitionStatus] = useState<GraphDefinitionStatus | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callflowError, setCallflowError] = useState<string | null>(null);

  async function loadGraph(): Promise<void> {
    setLoadState("loading");
    setError(null);

    try {
      const [state, status] = await Promise.all([
        window.api.graphBoard.getState(),
        window.api.graphBoard.getDefinitionStatus()
      ]);
      setGraph(state);
      setDefinitionStatus(status);
      setDetails(null);
      setCallflow(null);
      setLoadState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load graph board.";
      console.error("Unable to load graph board", error);
      setGraph(null);
      setDetails(null);
      setLoadState("error");
      setError(message);
    }
  }

  useEffect(() => {
    void loadGraph();
  }, [refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void window.api.graphBoard
        .getDefinitionStatus()
        .then(setDefinitionStatus)
        .catch(() => undefined);
    }, 3500);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!definitionStatus?.completedAt || definitionStatus.running || definitionStatus.updatedCount <= 0) {
      return;
    }

    const definitionKey = `${definitionStatus.completedAt}:${definitionStatus.updatedCount}`;
    if (lastAppliedDefinitionKey.current === definitionKey) {
      return;
    }

    lastAppliedDefinitionKey.current = definitionKey;
    void window.api.graphBoard
      .getState()
      .then(setGraph)
      .catch(() => undefined);
  }, [definitionStatus?.completedAt, definitionStatus?.running, definitionStatus?.updatedCount]);

  useEffect(() => {
    setNoteDraft(details?.research?.notes[0]?.note ?? "");
  }, [details?.id, details?.research?.notes]);

  const filteredNodes = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return nodes;
    }

    return nodes.filter((node) =>
      [node.label, node.type, node.summary, node.sourceFile, node.community]
        .join(" ")
        .toLowerCase()
        .includes(trimmed)
    );
  }, [graph?.nodes, query]);

  const graphData = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((node) => node.id));
    const links =
      graph?.links.filter((link) => nodeIds.has(relationEndpoint(link.source)) && nodeIds.has(relationEndpoint(link.target))) ?? [];

    return {
      nodes: filteredNodes as ForceNode[],
      links: links as ForceLink[]
    };
  }, [filteredNodes, graph?.links]);

  const selectedNode = details ?? hoveredNode;

  async function selectNode(node: GraphBoardNode | null): Promise<void> {
    setCallflowError(null);
    if (!node) {
      setDetails(null);
      return;
    }

    try {
      setDetails(await window.api.graphBoard.getNodeDetails(node.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load node details.";
      setError(message);
    }
  }

  async function updatePaperStatus(status: ResearchPaperStatus): Promise<void> {
    if (!details?.research) {
      return;
    }

    const updated = await window.api.research.updatePaperStatus({
      nodeId: details.research.paper.nodeId,
      status
    });
    setDetails({
      ...details,
      research: {
        ...details.research,
        paper: updated
      }
    });
  }

  async function saveResearchNote(): Promise<void> {
    if (!details?.research) {
      return;
    }

    setNoteSaving(true);
    try {
      const note = await window.api.research.saveNodeNote({
        nodeId: details.research.paper.nodeId,
        note: noteDraft
      });
      setDetails({
        ...details,
        research: {
          ...details.research,
          notes: note.note ? [note, ...details.research.notes.filter((item) => item.nodeId !== note.nodeId)] : []
        }
      });
    } finally {
      setNoteSaving(false);
    }
  }

  async function generateCallflow(): Promise<void> {
    if (!details) {
      return;
    }

    setCallflowLoading(true);
    setCallflowError(null);

    try {
      setCallflow(await window.api.graphBoard.generateCallflow(details.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate call flow.";
      console.error("Unable to generate call flow", error);
      setCallflowError(message);
    } finally {
      setCallflowLoading(false);
    }
  }

  function drawNode(node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number): void {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = Math.max(4, Math.min(12, 4 + Math.sqrt(node.degree || 1)));
    const isActive = details?.id === node.id || hoveredNode?.id === node.id;

    ctx.beginPath();
    ctx.arc(x, y, isActive ? radius + 2 : radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = colorFor(node);
    ctx.fill();

    if (isActive) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();
    }

    const label = node.label;
    const fontSize = Math.max(9, 12 / globalScale);
    ctx.font = `${fontSize}px Inter, ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(label.slice(0, 34), x, y + radius + 4);
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-6 text-slate-950">Graph Board</h1>
          <p className="mt-1 truncate text-xs text-slate-500">
            {graph ? `${graph.nodes.length} nodes · ${graph.links.length} edges` : "Explore the active project graph"}
          </p>
          {definitionStatus ? (
            <p
              className={`mt-1 max-w-xl truncate text-xs ${
                definitionStatus.failedBatchCount > 0 ? "text-rose-700" : definitionStatus.running ? "text-amber-700" : "text-slate-400"
              }`}
              title={definitionStatus.lastError}
            >
              {definitionStatus.running
                ? `Definitions running on ${definitionStatus.endpointHost || "AI endpoint"} · ${definitionStatus.updatedCount} updated`
                : definitionStatus.failedBatchCount > 0
                  ? `Definition enrichment failed: ${definitionStatus.lastError ?? "check AI endpoint settings"}`
                  : definitionStatus.updatedCount > 0
                    ? `Definitions updated · ${definitionStatus.updatedCount} cards`
                    : "Definitions fall back to Graphify summaries until enrichment runs"}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label className="relative hidden w-72 min-w-0 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              className="h-9 w-full rounded-md border border-slate-200 bg-white/65 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
              placeholder="Search nodes, types, sources"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh graph board"
            type="button"
            onClick={() => void loadGraph()}
          >
            {loadState === "loading" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
          </button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 p-3">
        <div ref={containerRef} className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white/45 shadow-sm">
          {loadState === "loading" || loadState === "idle" ? (
            <div className="grid h-full place-items-center text-sm text-slate-500">Loading graph...</div>
          ) : null}

          {loadState === "error" ? (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <AlertCircle className="mx-auto text-rose-500" size={28} />
                <h2 className="mt-3 text-base font-semibold text-slate-950">Graph Board unavailable</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{error ?? "The active project graph could not be read."}</p>
              </div>
            </div>
          ) : null}

          {loadState === "ready" && graphData.nodes.length === 0 ? (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <Network className="mx-auto text-slate-400" size={32} />
                <h2 className="mt-4 text-xl font-semibold text-slate-950">No graph yet</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">Drop files into this project to build its local graph.</p>
              </div>
            </div>
          ) : null}

          {loadState === "ready" && graphData.nodes.length > 0 ? (
            <ForceGraph2D
              backgroundColor="rgba(255,250,240,0)"
              cooldownTicks={80}
              graphData={graphData}
              height={size.height}
              linkColor={() => "rgba(71,85,105,0.28)"}
              linkDirectionalParticles={1}
              linkDirectionalParticleSpeed={0.002}
              linkWidth={(link) => Math.max(0.8, Math.min(3, (link as ForceLink).weight))}
              nodeCanvasObject={(node, ctx, globalScale) => drawNode(node as ForceNode, ctx, globalScale)}
              nodePointerAreaPaint={(node, color, ctx) => {
                const forceNode = node as ForceNode;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(forceNode.x ?? 0, forceNode.y ?? 0, 16, 0, 2 * Math.PI, false);
                ctx.fill();
              }}
              width={size.width}
              onNodeClick={(node) => void selectNode(node as GraphBoardNode)}
              onNodeHover={(node) => setHoveredNode((node as GraphBoardNode | null) ?? null)}
            />
          ) : null}
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/55 shadow-sm">
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 px-4">
            <span className="text-sm font-semibold text-slate-950">Node</span>
            {details ? (
              <button
                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                title="Clear selection"
                type="button"
                onClick={() => {
                  setDetails(null);
                  setCallflow(null);
                }}
              >
                <X size={15} />
              </button>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!selectedNode ? (
              <div className="grid h-full place-items-center text-center text-sm leading-6 text-slate-500">
                Hover or click a node to see its source and neighbors.
              </div>
            ) : (
              <div className="space-y-5">
                <section>
                  <p className="text-xs font-semibold uppercase text-slate-500">{selectedNode.type}</p>
                  <h2 className="mt-2 text-lg font-semibold leading-6 text-slate-950">{selectedNode.label}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{selectedNode.summary}</p>
                </section>

                {details?.research ? (
                  <section className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-800">
                        <BookOpen size={14} />
                        <span>Research Paper</span>
                      </div>
                      <select
                        className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-900 outline-none"
                        value={details.research.paper.status}
                        onChange={(event) => void updatePaperStatus(event.target.value as ResearchPaperStatus)}
                      >
                        {(["unread", "reading", "summarized", "cited", "discarded"] as ResearchPaperStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {paperStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {details.research.abstract ? (
                      <p className="line-clamp-6 text-sm leading-6 text-emerald-950">{details.research.abstract}</p>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {["paper_section", "paper_figure", "paper_table", "paper_reference", "paper_claim", "paper_method", "paper_dataset", "paper_result"].map(
                        (type) => {
                          const count = details.research?.components.filter((component) => component.type === type).length ?? 0;
                          return count > 0 ? (
                            <div key={type} className="rounded-md bg-white/70 px-2 py-1.5 text-xs text-emerald-900">
                              <span className="font-semibold">{count}</span> {titleCase(type.replace(/^paper_/, ""))}
                            </div>
                          ) : null;
                        }
                      )}
                    </div>
                    <label className="mt-3 block text-xs font-semibold uppercase text-emerald-800">
                      Research note
                      <textarea
                        className="mt-2 min-h-24 w-full resize-y rounded-md border border-emerald-200 bg-white/85 p-2 text-sm normal-case leading-5 text-slate-800 outline-none focus:border-emerald-400"
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                      />
                    </label>
                    <button
                      className="mt-2 h-8 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                      disabled={noteSaving}
                      type="button"
                      onClick={() => void saveResearchNote()}
                    >
                      {noteSaving ? "Saving" : "Save note"}
                    </button>
                  </section>
                ) : null}

                {details?.research?.components.length ? (
                  <section>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                      <Layers3 size={14} />
                      <span>Paper Drilldown</span>
                    </div>
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {details.research.components.slice(0, 32).map((component) => (
                        <button
                          key={component.id}
                          className="w-full rounded-md border border-slate-200 bg-white/55 p-3 text-left transition hover:bg-white"
                          type="button"
                          onClick={() =>
                            void selectNode({
                              id: component.id,
                              label: component.label,
                              type: component.type,
                              summary: component.summary,
                              sourceFile: details.research?.paper.sourceFile ?? "",
                              community: details.community,
                              degree: 0,
                              rawData: {}
                            })
                          }
                        >
                          <p className="truncate text-sm font-semibold text-slate-950">{component.label}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{titleCase(component.type)}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="rounded-md border border-slate-200 bg-white/60 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                    <FileText size={14} />
                    <span>Source</span>
                  </div>
                  <p className="mt-2 break-words text-sm text-slate-800">
                    {selectedNode.sourceFile ? displaySource(selectedNode.sourceFile) : "Unknown source"}
                  </p>
                  {selectedNode.sourceFile ? (
                    <p className="mt-1 break-words text-xs leading-5 text-slate-500">{selectedNode.sourceFile}</p>
                  ) : null}
                </section>

                {details ? (
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase text-slate-500">Neighbors</p>
                      <span className="text-xs text-slate-400">{details.neighbors.length}</span>
                    </div>
                    <div className="space-y-2">
                      {details.neighbors.length === 0 ? (
                        <p className="text-sm text-slate-500">No neighbors in this graph yet.</p>
                      ) : (
                        details.neighbors.slice(0, 24).map((neighbor) => (
                          <button
                            key={`${neighbor.direction}-${neighbor.id}-${neighbor.relation}`}
                            className="w-full rounded-md border border-slate-200 bg-white/55 p-3 text-left transition hover:bg-white"
                            type="button"
                            onClick={() =>
                              void selectNode({
                                id: neighbor.id,
                                label: neighbor.label,
                                type: neighbor.type,
                                summary: "",
                                sourceFile: neighbor.sourceFile,
                                community: "",
                                degree: 0,
                                rawData: {}
                              })
                            }
                          >
                            <p className="truncate text-sm font-semibold text-slate-950">{neighbor.label}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {neighbor.direction} · {neighbor.relation}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                ) : null}

                {details ? (
                  <section>
                    <button
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={callflowLoading}
                      type="button"
                      onClick={() => void generateCallflow()}
                    >
                      {callflowLoading ? <Loader2 className="animate-spin" size={15} /> : <Route size={15} />}
                      Generate Call Flow
                    </button>
                    {callflowError ? (
                      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
                        {callflowError}
                      </pre>
                    ) : null}
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </section>

      {callflow ? (
        <section className="mx-3 mb-3 flex min-h-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-4 text-xs text-slate-500">
            <span className="truncate">{callflow.path}</span>
            <button className="font-semibold text-slate-700" type="button" onClick={() => setCallflow(null)}>
              Close
            </button>
          </header>
          <iframe className="min-h-0 flex-1 border-0" sandbox="allow-scripts" srcDoc={callflow.html} title="Graphify call flow" />
        </section>
      ) : null}
    </main>
  );
}

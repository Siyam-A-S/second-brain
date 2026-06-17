import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  Folder,
  GitMerge,
  Loader2,
  MessageSquare,
  Network,
  Pencil,
  RefreshCcw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { SourceTreeNode, SourceTreeNodeDetails, SourceTreeSearchResult, SourceTreeSourceOption } from "../../shared/ipc";

type FilesystemExplorerProps = {
  refreshKey: number;
};

type LoadState = "idle" | "loading" | "ready" | "error";

function nodeIcon(node: SourceTreeNode): typeof Folder {
  switch (node.kind) {
    case "folder":
      return Folder;
    case "source":
      return FileText;
    case "related-group":
      return Network;
    case "component":
    case "entity":
    default:
      return node.kind === "component" ? ChevronRight : Network;
  }
}

function formatDate(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function displaySource(sourceFile: string): string {
  return sourceFile.split(/[\\/]/).filter(Boolean).at(-1) ?? sourceFile;
}

function kindLabel(node: SourceTreeNode): string {
  if (node.type) {
    return node.type;
  }

  return node.kind.replace(/-/g, " ");
}

function emptyDetailsNode(): SourceTreeNode {
  return {
    id: "empty",
    title: "No source selected",
    kind: "root",
    childrenCount: 0,
    isExpandable: false
  };
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  loadingIds,
  childrenById,
  onToggle,
  onSelect
}: {
  node: SourceTreeNode;
  depth: number;
  selectedId: string;
  expanded: Set<string>;
  loadingIds: Set<string>;
  childrenById: Map<string, SourceTreeNode[]>;
  onToggle: (node: SourceTreeNode) => void;
  onSelect: (node: SourceTreeNode) => void;
}): JSX.Element {
  const Icon = nodeIcon(node);
  const isExpanded = expanded.has(node.id);
  const isLoading = loadingIds.has(node.id);
  const children = childrenById.get(node.id) ?? [];

  return (
    <div>
      <button
        className={`flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm transition ${
          selectedId === node.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/55 hover:text-slate-950"
        }`}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        type="button"
        onClick={() => onSelect(node)}
      >
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          {isLoading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : node.isExpandable ? (
            <ChevronRight className={`transition ${isExpanded ? "rotate-90" : ""}`} size={15} />
          ) : null}
        </span>
        <Icon className="shrink-0 text-slate-400" size={16} />
        <span className="min-w-0 flex-1 truncate font-medium">{node.title}</span>
        {node.childrenCount > 0 ? <span className="text-xs text-slate-400">{node.childrenCount}</span> : null}
      </button>
      {isExpanded && children.length > 0 ? (
        <div className="mt-1">
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              loadingIds={loadingIds}
              childrenById={childrenById}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FilesystemExplorer({ refreshKey }: FilesystemExplorerProps): JSX.Element {
  const [rootNodes, setRootNodes] = useState<SourceTreeNode[]>([]);
  const [childrenById, setChildrenById] = useState<Map<string, SourceTreeNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<SourceTreeNodeDetails | null>(null);
  const [sourceOptions, setSourceOptions] = useState<SourceTreeSourceOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SourceTreeSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [merging, setMerging] = useState(false);
  const [targetSourceFile, setTargetSourceFile] = useState("");

  const selectedNode = details?.node ?? emptyDetailsNode();
  const sourceTargets = useMemo(
    () => sourceOptions.filter((option) => option.sourceFile && option.sourceFile !== selectedNode.sourceFile),
    [selectedNode.sourceFile, sourceOptions]
  );

  useEffect(() => {
    void loadRoot();
  }, [refreshKey]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void window.api.filesystem
        .search({ query, limit: 24 })
        .then(setSearchResults)
        .catch((error) => {
          console.error("Unable to search filesystem", error);
          setSearchResults([]);
        })
        .finally(() => setSearchLoading(false));
    }, 120);

    return () => window.clearTimeout(timer);
  }, [searchQuery, refreshKey]);

  useEffect(() => {
    if (!merging) {
      setTargetSourceFile("");
      return;
    }

    setTargetSourceFile((current) => (current && sourceTargets.some((option) => option.sourceFile === current) ? current : sourceTargets[0]?.sourceFile ?? ""));
  }, [merging, sourceTargets]);

  async function loadRoot(): Promise<void> {
    setLoadState("loading");
    setError(null);
    setActionError(null);

    try {
      const [root, options] = await Promise.all([window.api.filesystem.getRoot(), window.api.filesystem.getSourceOptions()]);
      setRootNodes(root);
      setSourceOptions(options);
      setChildrenById(new Map());
      setExpanded(new Set());
      setLoadState("ready");
      if (root[0]) {
        await selectNode(root[0]);
      } else {
        setSelectedId("");
        setDetails(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load filesystem view.";
      setRootNodes([]);
      setDetails(null);
      setLoadState("error");
      setError(message);
    }
  }

  async function loadChildren(node: SourceTreeNode): Promise<SourceTreeNode[]> {
    const existing = childrenById.get(node.id);
    if (existing) {
      return existing;
    }

    setLoadingIds((current) => new Set(current).add(node.id));
    try {
      const children = await window.api.filesystem.getChildren(node.id);
      setChildrenById((current) => {
        const next = new Map(current);
        next.set(node.id, children);
        return next;
      });
      return children;
    } finally {
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
    }
  }

  async function selectNode(node: SourceTreeNode): Promise<void> {
    setSelectedId(node.id);
    setActionError(null);
    setRenaming(false);
    setCommenting(false);
    setMerging(false);

    try {
      setDetails(await window.api.filesystem.getDetails(node.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read node details.";
      setActionError(message);
    }
  }

  function toggleNode(node: SourceTreeNode): void {
    if (!node.isExpandable) {
      return;
    }

    void (async () => {
      if (!expanded.has(node.id)) {
        await loadChildren(node);
      }

      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
    })();
  }

  async function refreshAfterSourceAction(): Promise<void> {
    await loadRoot();
  }

  async function removeSelectedSource(): Promise<void> {
    if (!selectedNode.sourceFile) {
      return;
    }

    setActionError(null);
    try {
      await window.api.board.removeSource(selectedNode.sourceFile);
      await refreshAfterSourceAction();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to remove source.");
    }
  }

  async function renameSelectedSource(): Promise<void> {
    if (!selectedNode.sourceFile || !renameDraft.trim()) {
      return;
    }

    setActionError(null);
    try {
      await window.api.board.renameSource(selectedNode.sourceFile, renameDraft);
      setRenaming(false);
      await refreshAfterSourceAction();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to rename source.");
    }
  }

  async function commentSelectedSource(): Promise<void> {
    if (!selectedNode.sourceFile) {
      return;
    }

    setActionError(null);
    try {
      await window.api.board.commentSource(selectedNode.sourceFile, commentDraft);
      setCommenting(false);
      await refreshAfterSourceAction();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to save source comment.");
    }
  }

  async function mergeSelectedSource(): Promise<void> {
    if (!selectedNode.sourceFile || !targetSourceFile) {
      return;
    }

    setActionError(null);
    try {
      await window.api.board.collapseSource(selectedNode.sourceFile, targetSourceFile);
      setMerging(false);
      await refreshAfterSourceAction();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to merge source.");
    }
  }

  if (loadState === "loading" && rootNodes.length === 0) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">Loading filesystem...</div>;
  }

  if (loadState === "error") {
    return (
      <div className="grid h-full place-items-center">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto text-rose-500" size={28} />
          <h2 className="mt-3 text-base font-semibold text-slate-950">Filesystem unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div>
          <h1 className="text-base font-semibold text-slate-950">Filesystem</h1>
          <p className="text-xs text-slate-500">Sources expanded through Graphify relationships</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label className="relative hidden w-72 min-w-0 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              className="h-9 w-full rounded-md border border-slate-200 bg-white/65 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
              placeholder="Search sources and graph nodes"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh filesystem"
            type="button"
            onClick={() => void loadRoot()}
          >
            {loadState === "loading" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
          </button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] gap-3 p-3">
        <aside className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white/45 shadow-sm">
          <div className="flex h-10 items-center justify-between border-b border-slate-200/80 px-3 text-xs font-semibold uppercase text-slate-500">
            <span>Raw Vault</span>
            <span>{rootNodes.length}</span>
          </div>
          {searchQuery.trim() ? (
            <div className="max-h-[calc(100vh-10rem)] overflow-auto p-2">
              {searchLoading ? <p className="px-2 py-3 text-sm text-slate-500">Searching...</p> : null}
              {!searchLoading && searchResults.length === 0 ? (
                <p className="px-2 py-3 text-sm text-slate-500">No matching sources or graph nodes.</p>
              ) : null}
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-600 transition hover:bg-white/60 hover:text-slate-950"
                  type="button"
                  onClick={() => void selectNode(result)}
                >
                  <Search size={14} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{result.title}</span>
                  <span className="text-xs text-slate-400">{kindLabel(result)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="max-h-[calc(100vh-10rem)] overflow-auto p-2">
              {rootNodes.length === 0 ? <p className="px-2 py-3 text-sm text-slate-500">Drop files to populate the vault.</p> : null}
              {rootNodes.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  expanded={expanded}
                  loadingIds={loadingIds}
                  childrenById={childrenById}
                  onToggle={toggleNode}
                  onSelect={(node) => void selectNode(node)}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white/55 shadow-sm">
          <div className="border-b border-slate-200/80 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {renaming && selectedNode.sourceFile ? (
                  <input
                    className="h-10 w-full min-w-80 rounded-md border border-slate-200 bg-white/80 px-3 text-base font-semibold text-slate-950 outline-none focus:border-slate-400"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                  />
                ) : (
                  <h2 className="truncate text-xl font-semibold text-slate-950">{selectedNode.title}</h2>
                )}
                <p className="mt-1 text-sm text-slate-500">
                  {kindLabel(selectedNode)}
                  {selectedNode.sourceFile ? ` · ${selectedNode.sourceFile}` : ""}
                  {selectedNode.modifiedAt ? ` · ${formatDate(selectedNode.modifiedAt)}` : ""}
                </p>
              </div>
              {selectedNode.kind === "source" && selectedNode.sourceFile ? (
                <div className="flex shrink-0 items-center gap-1">
                  {renaming ? (
                    <>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
                        title="Save name"
                        type="button"
                        onClick={() => void renameSelectedSource()}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                        title="Cancel rename"
                        type="button"
                        onClick={() => setRenaming(false)}
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                        title="Rename source"
                        type="button"
                        onClick={() => {
                          setRenaming(true);
                          setRenameDraft(displaySource(selectedNode.sourceFile ?? ""));
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
                        title="Comment on source"
                        type="button"
                        onClick={() => {
                          setCommenting((value) => !value);
                          setCommentDraft(selectedNode.summary && selectedNode.summary !== selectedNode.sourceFile ? selectedNode.summary : "");
                        }}
                      >
                        <MessageSquare size={16} />
                      </button>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={sourceTargets.length === 0}
                        title="Merge source"
                        type="button"
                        onClick={() => setMerging((value) => !value)}
                      >
                        <GitMerge size={16} />
                      </button>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
                        title="Delete source"
                        type="button"
                        onClick={() => void removeSelectedSource()}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            {actionError ? <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{actionError}</p> : null}
            {selectedNode.summary ? <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{selectedNode.summary}</p> : null}
            {details?.sourceLocation ? <p className="mt-2 text-xs text-slate-500">Location: {details.sourceLocation}</p> : null}
          </div>

          {commenting && selectedNode.sourceFile ? (
            <div className="border-b border-slate-200/80 px-5 py-4">
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
                  onClick={() => setCommenting(false)}
                >
                  Cancel
                </button>
                <button
                  className="h-8 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                  type="button"
                  onClick={() => void commentSelectedSource()}
                >
                  Save comment
                </button>
              </div>
            </div>
          ) : null}

          {merging && selectedNode.sourceFile ? (
            <div className="flex items-center gap-2 border-b border-slate-200/80 px-5 py-4">
              <select
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                value={targetSourceFile}
                onChange={(event) => setTargetSourceFile(event.target.value)}
              >
                {sourceTargets.map((option) => (
                  <option key={option.sourceFile} value={option.sourceFile}>
                    {option.title}
                  </option>
                ))}
              </select>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!targetSourceFile}
                type="button"
                onClick={() => void mergeSelectedSource()}
              >
                <GitMerge size={15} />
                Merge
              </button>
            </div>
          ) : null}

          <div className="space-y-6 p-5">
            {details?.relationGroups.length ? (
              details.relationGroups.map((group) => (
                <section key={group.relation}>
                  <h3 className="text-xs font-semibold uppercase text-slate-500">{group.title}</h3>
                  <div className="mt-2 divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-white/45">
                    {group.items.map((item) => (
                      <button
                        key={`${group.relation}-${item.nodeId}`}
                        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/70"
                        type="button"
                        onClick={() =>
                          void selectNode({
                            id: `graph:${encodeURIComponent(item.nodeId)}`,
                            title: item.title,
                            kind: "entity",
                            graphNodeId: item.nodeId,
                            sourceFile: item.sourceFile,
                            type: item.type,
                            childrenCount: 0,
                            isExpandable: true
                          })
                        }
                      >
                        <Network className="shrink-0 text-slate-400" size={16} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {item.type} · {item.sourceFile}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-500">
                          {item.relation}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="grid min-h-52 place-items-center text-center">
                <div>
                  <Network className="mx-auto text-slate-300" size={30} />
                  <p className="mt-3 text-sm font-semibold text-slate-700">No related graph edges yet</p>
                  <p className="mt-1 text-sm text-slate-500">Expand the tree to browse structural children.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

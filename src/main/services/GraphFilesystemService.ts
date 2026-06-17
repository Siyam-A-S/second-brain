import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  SourceTreeNode,
  SourceTreeNodeDetails,
  SourceTreeRelationGroup,
  SourceTreeRelationItem,
  SourceTreeSearchInput,
  SourceTreeSearchResult,
  SourceTreeSourceOption
} from "../../shared/types/filesystem";

type GraphNode = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  title?: unknown;
  type?: unknown;
  node_type?: unknown;
  file_type?: unknown;
  summary?: unknown;
  description?: unknown;
  contextual_definition?: unknown;
  flashcard_definition?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  community?: unknown;
};

type GraphLink = Record<string, unknown> & {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
};

type GraphJson = {
  nodes?: unknown;
  links?: unknown;
  edges?: unknown;
};

type GraphIndex = {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeById: Map<string, GraphNode>;
  outgoing: Map<string, GraphLink[]>;
  incoming: Map<string, GraphLink[]>;
  sourceNodeIds: Map<string, Set<string>>;
};

const rootNodeId = "root";
const generatedDirectoryNames = new Set(["graphify-out", ".graphify", "source-comments", "spreadsheet-components"]);
const sourceCommentDirectoryName = "source-comments";
const maxTreeChildren = 80;
const maxRelationItems = 32;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function encodeIdPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeIdPart(value: string): string {
  return decodeURIComponent(value);
}

function folderId(relativePath: string): string {
  return `folder:${encodeIdPart(relativePath)}`;
}

function sourceId(sourceFile: string): string {
  return `source:${encodeIdPart(sourceFile)}`;
}

function graphId(nodeId: string): string {
  return `graph:${encodeIdPart(nodeId)}`;
}

function relatedGroupId(ownerKind: "source" | "graph", ownerId: string, relation: string): string {
  return `related:${ownerKind}:${encodeIdPart(ownerId)}:${encodeIdPart(relation)}`;
}

function parseTreeId(id: string): { kind: "root" } | { kind: "folder" | "source" | "graph"; value: string } | {
  kind: "related";
  ownerKind: "source" | "graph";
  ownerId: string;
  relation: string;
} {
  if (id === rootNodeId) {
    return { kind: "root" };
  }

  const [prefix, first, second, third] = id.split(":");
  if (prefix === "folder" || prefix === "source" || prefix === "graph") {
    return { kind: prefix, value: decodeIdPart(first ?? "") };
  }

  if (prefix === "related" && (first === "source" || first === "graph")) {
    return {
      kind: "related",
      ownerKind: first,
      ownerId: decodeIdPart(second ?? ""),
      relation: decodeIdPart(third ?? "")
    };
  }

  throw new Error(`Unknown source tree node id: ${id}`);
}

function relationLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "related";
}

function titleCase(value: string): string {
  return relationLabel(value).replace(/\b\w/g, (match) => match.toUpperCase());
}

function linkEndpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function nodeTitle(node: GraphNode): string {
  return asString(node.label) || asString(node.title) || asString(node.id) || "Graph node";
}

function nodeType(node: GraphNode): string {
  return asString(node.type) || asString(node.node_type) || asString(node.file_type) || asString(node._origin) || "entity";
}

function nodeSummary(node: GraphNode): string {
  return (
    asString(node.contextual_definition) ||
    asString(node.flashcard_definition) ||
    asString(node.summary) ||
    asString(node.description) ||
    asString(node.source_location)
  );
}

function isStructuralRelation(relation: string): boolean {
  return /(contains|defines|part[_ -]?of|section|sheet|table|column|field|folder|file)/i.test(relation);
}

function compactSearchText(values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function scoreText(text: string, query: string, tokens: string[]): number {
  if (!query) {
    return 1;
  }

  let score = text.includes(query) ? 8 : 0;
  for (const token of tokens) {
    if (token && text.includes(token)) {
      score += token.length > 3 ? 3 : 1;
    }
  }

  return score;
}

function sortNodes(left: SourceTreeNode, right: SourceTreeNode): number {
  const kindOrder = new Map([
    ["folder", 0],
    ["source", 1],
    ["component", 2],
    ["entity", 3],
    ["related-group", 4]
  ]);

  return (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99) || left.title.localeCompare(right.title);
}

function sourceCommentFileName(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile || "source")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "source"}-${hash}.md`;
}

function parseGraphJson(raw: string): GraphJson {
  const parsed = JSON.parse(raw) as unknown;
  const graph = asRecord(parsed);
  if (!graph) {
    throw new Error("Graphify graph.json must contain an object.");
  }

  return graph;
}

export class GraphFilesystemService {
  constructor(
    private readonly rawVaultPath: string,
    private readonly graphPath: string
  ) {}

  async getRoot(): Promise<SourceTreeNode[]> {
    return this.listDirectory("");
  }

  async getChildren(nodeId: string): Promise<SourceTreeNode[]> {
    const parsed = parseTreeId(nodeId);

    if (parsed.kind === "root") {
      return this.getRoot();
    }

    if (parsed.kind === "folder") {
      return this.listDirectory(parsed.value);
    }

    if (parsed.kind === "source") {
      return this.getSourceChildren(parsed.value);
    }

    if (parsed.kind === "graph") {
      return this.getGraphNodeChildren(parsed.value);
    }

    if (parsed.kind === "related") {
      return this.getRelatedGroupChildren(parsed.ownerKind, parsed.ownerId, parsed.relation);
    }

    return [];
  }

  async getDetails(nodeId: string): Promise<SourceTreeNodeDetails> {
    const parsed = parseTreeId(nodeId);
    const index = await this.readGraphIndex();

    if (parsed.kind === "root") {
      return {
        node: {
          id: rootNodeId,
          title: "Raw vault",
          kind: "root",
          childrenCount: (await this.getRoot()).length,
          isExpandable: true
        },
        relationGroups: []
      };
    }

    if (parsed.kind === "folder") {
      const children = await this.listDirectory(parsed.value);
      return {
        node: {
          id: folderId(parsed.value),
          title: path.basename(parsed.value) || "Raw vault",
          kind: "folder",
          childrenCount: children.length,
          isExpandable: children.length > 0
        },
        relationGroups: []
      };
    }

    if (parsed.kind === "source") {
      const node = await this.sourceTreeNode(parsed.value, index);
      return {
        node,
        relationGroups: this.buildSourceRelationGroups(index, parsed.value)
      };
    }

    if (parsed.kind === "related") {
      const children = await this.getRelatedGroupChildren(parsed.ownerKind, parsed.ownerId, parsed.relation);
      return {
        node: {
          id: nodeId,
          title: parsed.relation === "*" ? "Related across brain" : titleCase(parsed.relation),
          kind: "related-group",
          relation: parsed.relation,
          childrenCount: children.length,
          isExpandable: children.length > 0
        },
        relationGroups: []
      };
    }

    const graphNode = index.nodeById.get(parsed.value);
    if (!graphNode) {
      throw new Error(`Graph node not found: ${parsed.value}`);
    }

    return {
      node: this.graphTreeNode(index, parsed.value),
      sourceLocation: asString(graphNode.source_location),
      community: String(graphNode.community ?? ""),
      relationGroups: this.buildNodeRelationGroups(index, parsed.value)
    };
  }

  async search(input: SourceTreeSearchInput): Promise<SourceTreeSearchResult[]> {
    const query = input.query.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const limit = Math.max(1, input.limit ?? 30);
    const [sources, index] = await Promise.all([this.listSourceOptions(), this.readGraphIndex()]);
    const results: SourceTreeSearchResult[] = [];

    for (const source of sources) {
      const score = scoreText(compactSearchText([source.title, source.sourceFile]), query, tokens);
      if (score > 0) {
      const node = await this.sourceTreeNode(source.sourceFile, index);
        results.push({ ...node, score: score + 2 });
      }
    }

    for (const graphNode of index.nodes) {
      const id = asString(graphNode.id);
      if (!id) {
        continue;
      }

      const sourceFile = this.normalizeSourceFile(asString(graphNode.source_file) || asString(graphNode.sourceFile));
      const score = scoreText(compactSearchText([nodeTitle(graphNode), nodeType(graphNode), nodeSummary(graphNode), sourceFile]), query, tokens);
      if (score > 0) {
        results.push({ ...this.graphTreeNode(index, id), score });
      }
    }

    return results
      .sort((left, right) => right.score - left.score || sortNodes(left, right))
      .slice(0, limit);
  }

  async listSourceOptions(): Promise<SourceTreeSourceOption[]> {
    const files = await this.listSourceFiles();
    return files.map((sourceFile) => ({
      sourceFile,
      title: path.basename(sourceFile)
    }));
  }

  private async listDirectory(relativeDirectory: string, index?: GraphIndex): Promise<SourceTreeNode[]> {
    const graphIndex = index ?? (await this.readGraphIndex());
    const absoluteDirectory = this.resolveRawPath(relativeDirectory);
    let entries;

    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: SourceTreeNode[] = [];
    for (const entry of entries) {
      if (generatedDirectoryNames.has(entry.name)) {
        continue;
      }

      const relativePath = this.toRelativeSourcePath(path.join(absoluteDirectory, entry.name));

      if (entry.isDirectory()) {
        const childCount = await this.countVisibleDirectoryEntries(path.join(absoluteDirectory, entry.name));
        nodes.push({
          id: folderId(relativePath),
          title: entry.name,
          kind: "folder",
          childrenCount: childCount,
          isExpandable: childCount > 0
        });
        continue;
      }

      if (entry.isFile()) {
        nodes.push(await this.sourceTreeNode(relativePath, graphIndex));
      }
    }

    return nodes.sort(sortNodes);
  }

  private async getSourceChildren(sourceFile: string): Promise<SourceTreeNode[]> {
    const index = await this.readGraphIndex();
    const sourceNodeIds = index.sourceNodeIds.get(sourceFile) ?? new Set<string>();

    if (sourceNodeIds.size === 0) {
      return [];
    }

    const incomingStructural = new Set<string>();
    for (const link of index.links) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      const relation = asString(link.relation) || "related";
      if (sourceNodeIds.has(source) && sourceNodeIds.has(target) && isStructuralRelation(relation)) {
        incomingStructural.add(target);
      }
    }

    const roots = Array.from(sourceNodeIds)
      .filter((nodeId) => !incomingStructural.has(nodeId))
      .map((nodeId) => this.graphTreeNode(index, nodeId))
      .filter((node) => node.title)
      .sort((left, right) => right.childrenCount - left.childrenCount || sortNodes(left, right))
      .slice(0, maxTreeChildren);

    const relatedCount = this.sourceRelatedItems(index, sourceFile).length;
    if (relatedCount > 0) {
      roots.push({
        id: relatedGroupId("source", sourceFile, "*"),
        title: "Related across brain",
        kind: "related-group",
        sourceFile,
        relation: "*",
        childrenCount: relatedCount,
        isExpandable: true
      });
    }

    return roots;
  }

  private async getGraphNodeChildren(nodeId: string): Promise<SourceTreeNode[]> {
    const index = await this.readGraphIndex();
    const structuralChildren = (index.outgoing.get(nodeId) ?? [])
      .filter((link) => isStructuralRelation(asString(link.relation) || "related"))
      .map((link) => linkEndpointId(link.target))
      .filter((targetId, indexInList, all) => targetId && all.indexOf(targetId) === indexInList)
      .map((targetId) => this.graphTreeNode(index, targetId))
      .sort(sortNodes)
      .slice(0, maxTreeChildren);

    const groups = this.buildNodeRelationGroups(index, nodeId)
      .filter((group) => group.items.length > 0)
      .map<SourceTreeNode>((group) => ({
        id: relatedGroupId("graph", nodeId, group.relation),
        title: group.title,
        kind: "related-group",
        graphNodeId: nodeId,
        relation: group.relation,
        childrenCount: group.items.length,
        isExpandable: true
      }));

    return [...structuralChildren, ...groups].slice(0, maxTreeChildren);
  }

  private async getRelatedGroupChildren(ownerKind: "source" | "graph", ownerId: string, relation: string): Promise<SourceTreeNode[]> {
    const index = await this.readGraphIndex();
    const items =
      ownerKind === "source"
        ? this.sourceRelatedItems(index, ownerId)
        : this.nodeRelatedItems(index, ownerId).filter((item) => relation === "*" || item.relation === relation);

    return items
      .slice(0, maxRelationItems)
      .map((item) => this.graphTreeNode(index, item.nodeId))
      .sort(sortNodes);
  }

  private async sourceTreeNode(sourceFile: string, index?: GraphIndex): Promise<SourceTreeNode> {
    let modifiedAt = "";
    try {
      modifiedAt = (await stat(this.resolveRawPath(sourceFile))).mtime.toISOString();
    } catch {
      modifiedAt = "";
    }

    const graphIndex = index ?? (await this.readGraphIndex());
    const sourceNodeIds = graphIndex.sourceNodeIds.get(sourceFile) ?? new Set<string>();
    const childrenCount = sourceNodeIds.size > 0 ? Math.min(sourceNodeIds.size, maxTreeChildren) : 0;

    const comment = await this.readSourceComment(sourceFile);

    return {
      id: sourceId(sourceFile),
      title: path.basename(sourceFile),
      kind: "source",
      sourceFile,
      type: path.extname(sourceFile).replace(/^\./, "").toUpperCase() || "FILE",
      summary: comment || sourceFile,
      modifiedAt,
      childrenCount,
      isExpandable: childrenCount > 0
    };
  }

  private graphTreeNode(index: GraphIndex, nodeId: string): SourceTreeNode {
    const node = index.nodeById.get(nodeId);
    if (!node) {
      return {
        id: graphId(nodeId),
        title: nodeId,
        kind: "entity",
        graphNodeId: nodeId,
        childrenCount: 0,
        isExpandable: false
      };
    }

    const type = nodeType(node);
    const sourceFile = this.normalizeSourceFile(asString(node.source_file) || asString(node.sourceFile));
    const structuralCount = (index.outgoing.get(nodeId) ?? []).filter((link) => isStructuralRelation(asString(link.relation) || "related")).length;
    const relationCount = this.buildNodeRelationGroups(index, nodeId).length;
    const childrenCount = structuralCount + relationCount;

    return {
      id: graphId(nodeId),
      title: nodeTitle(node),
      kind: /sheet|table|column|section|file|class|function|method/i.test(type) ? "component" : "entity",
      sourceFile,
      graphNodeId: nodeId,
      type,
      summary: nodeSummary(node),
      childrenCount,
      isExpandable: childrenCount > 0
    };
  }

  private buildSourceRelationGroups(index: GraphIndex, sourceFile: string): SourceTreeRelationGroup[] {
    const items = this.sourceRelatedItems(index, sourceFile);
    return items.length > 0
      ? [
          {
            relation: "*",
            title: "Related Across Brain",
            items: items.slice(0, maxRelationItems)
          }
        ]
      : [];
  }

  private buildNodeRelationGroups(index: GraphIndex, nodeId: string): SourceTreeRelationGroup[] {
    const groups = new Map<string, SourceTreeRelationItem[]>();

    for (const item of this.nodeRelatedItems(index, nodeId)) {
      const list = groups.get(item.relation) ?? [];
      list.push(item);
      groups.set(item.relation, list);
    }

    return Array.from(groups.entries())
      .map(([relation, items]) => ({
        relation,
        title: titleCase(relation),
        items: items.slice(0, maxRelationItems)
      }))
      .sort((left, right) => right.items.length - left.items.length || left.title.localeCompare(right.title));
  }

  private sourceRelatedItems(index: GraphIndex, sourceFile: string): SourceTreeRelationItem[] {
    const sourceNodeIds = index.sourceNodeIds.get(sourceFile) ?? new Set<string>();
    const seen = new Set<string>();
    const items: SourceTreeRelationItem[] = [];

    for (const nodeId of sourceNodeIds) {
      for (const item of this.nodeRelatedItems(index, nodeId)) {
        if (item.sourceFile && item.sourceFile !== sourceFile && !seen.has(item.nodeId)) {
          seen.add(item.nodeId);
          items.push(item);
        }
      }
    }

    return items.sort((left, right) => left.title.localeCompare(right.title));
  }

  private nodeRelatedItems(index: GraphIndex, nodeId: string): SourceTreeRelationItem[] {
    const links = [...(index.outgoing.get(nodeId) ?? []), ...(index.incoming.get(nodeId) ?? [])];
    const seen = new Set<string>();
    const items: SourceTreeRelationItem[] = [];

    for (const link of links) {
      const relation = asString(link.relation) || "related";
      if (isStructuralRelation(relation)) {
        continue;
      }

      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      const neighborId = source === nodeId ? target : source;
      if (!neighborId || neighborId === nodeId || seen.has(`${relation}:${neighborId}`)) {
        continue;
      }

      const neighbor = index.nodeById.get(neighborId);
      if (!neighbor) {
        continue;
      }

      seen.add(`${relation}:${neighborId}`);
      items.push({
        nodeId: neighborId,
        title: nodeTitle(neighbor),
        type: nodeType(neighbor),
        sourceFile: this.normalizeSourceFile(asString(neighbor.source_file) || asString(neighbor.sourceFile)),
        relation
      });
    }

    return items.sort((left, right) => left.relation.localeCompare(right.relation) || left.title.localeCompare(right.title));
  }

  private async listSourceFiles(directory = this.rawVaultPath): Promise<string[]> {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (generatedDirectoryNames.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listSourceFiles(entryPath)));
      } else if (entry.isFile()) {
        files.push(this.toRelativeSourcePath(entryPath));
      }
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  private async countVisibleDirectoryEntries(directory: string): Promise<number> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => !generatedDirectoryNames.has(entry.name)).length;
    } catch {
      return 0;
    }
  }

  private async readGraphIndex(): Promise<GraphIndex> {
    try {
      const graph = parseGraphJson(await readFile(this.graphPath, "utf8"));
      const nodes = Array.isArray(graph.nodes)
        ? graph.nodes.map(asRecord).filter((node): node is GraphNode => Boolean(node))
        : [];
      const rawLinks = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
      const links = rawLinks.map(asRecord).filter((link): link is GraphLink => Boolean(link));
      const nodeById = new Map<string, GraphNode>();
      const outgoing = new Map<string, GraphLink[]>();
      const incoming = new Map<string, GraphLink[]>();
      const sourceNodeIds = new Map<string, Set<string>>();

      for (const node of nodes) {
        const id = asString(node.id);
        if (!id) {
          continue;
        }

        nodeById.set(id, node);
        const sourceFile = this.normalizeSourceFile(asString(node.source_file) || asString(node.sourceFile));
        if (sourceFile && !this.isGeneratedSourceFile(sourceFile)) {
          const ids = sourceNodeIds.get(sourceFile) ?? new Set<string>();
          ids.add(id);
          sourceNodeIds.set(sourceFile, ids);
        }
      }

      for (const link of links) {
        const source = linkEndpointId(link.source);
        const target = linkEndpointId(link.target);
        if (!source || !target) {
          continue;
        }

        outgoing.set(source, [...(outgoing.get(source) ?? []), link]);
        incoming.set(target, [...(incoming.get(target) ?? []), link]);
      }

      return { nodes, links, nodeById, outgoing, incoming, sourceNodeIds };
    } catch {
      return {
        nodes: [],
        links: [],
        nodeById: new Map(),
        outgoing: new Map(),
        incoming: new Map(),
        sourceNodeIds: new Map()
      };
    }
  }

  private async readSourceComment(sourceFile: string): Promise<string> {
    try {
      return await readFile(path.join(this.rawVaultPath, sourceCommentDirectoryName, sourceCommentFileName(sourceFile)), "utf8");
    } catch {
      return "";
    }
  }

  private normalizeSourceFile(sourceFile: string): string {
    if (!sourceFile) {
      return "";
    }

    const normalized = sourceFile.split(/[\\/]/).join(path.sep);
    if (path.isAbsolute(normalized)) {
      return this.toRelativeSourcePath(normalized);
    }

    return normalized.split(path.sep).join(path.posix.sep);
  }

  private isGeneratedSourceFile(sourceFile: string): boolean {
    return sourceFile.split(/[\\/]/).some((part) => generatedDirectoryNames.has(part));
  }

  private resolveRawPath(relativePath: string): string {
    const resolved = path.resolve(this.rawVaultPath, relativePath);
    const relative = path.relative(this.rawVaultPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to read outside the raw vault: ${relativePath}`);
    }

    return resolved;
  }

  private toRelativeSourcePath(filePath: string): string {
    return path.relative(this.rawVaultPath, filePath).split(path.sep).join(path.posix.sep);
  }
}

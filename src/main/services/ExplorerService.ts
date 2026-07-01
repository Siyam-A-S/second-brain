import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type {
  ExplorerArtifactContent,
  ExplorerArtifactFormat,
  ExplorerArtifactKind,
  ExplorerNode,
  ExplorerNodeDetails,
  ExplorerRelationGroup,
  ExplorerRelationItem,
  ExplorerSearchInput,
  ExplorerSearchResult,
  ExplorerSourceOption
} from "../../shared/types/explorer";

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

type PaperArtifactRecord = {
  artifactId: string;
  artifactKind: ExplorerArtifactKind;
  title: string;
  sourceFile: string;
  artifactPath: string;
  graphNodeId?: string | undefined;
  page?: number | undefined;
  preview?: string | undefined;
  llmFormat: ExplorerArtifactFormat;
};

const rootNodeId = "root";
const generatedDirectoryNames = new Set([
  "graphify-out",
  ".graphify",
  "source-comments",
  "spreadsheet-components",
  "paper-components"
]);
const sourceCommentDirectoryName = "source-comments";
const inlineCommentEnd = "<!-- /second-brain:comment -->";
const maxTreeChildren = 80;
const maxRelationItems = 32;
const inlineCommentExtensions = new Set([".css", ".html", ".log", ".md", ".markdown", ".mdx", ".txt", ".xml", ".yaml", ".yml"]);

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

function artifactId(value: string): string {
  return `artifact:${encodeIdPart(value)}`;
}

function relatedGroupId(ownerKind: "source" | "graph", ownerId: string, relation: string): string {
  return `related:${ownerKind}:${encodeIdPart(ownerId)}:${encodeIdPart(relation)}`;
}

function parseTreeId(id: string): { kind: "root" } | { kind: "folder" | "source" | "graph" | "artifact"; value: string } | {
  kind: "related";
  ownerKind: "source" | "graph";
  ownerId: string;
  relation: string;
} {
  if (id === rootNodeId) {
    return { kind: "root" };
  }

  const [prefix, first, second, third] = id.split(":");
  if (prefix === "folder" || prefix === "source" || prefix === "graph" || prefix === "artifact") {
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

  throw new Error(`Unknown Explorer node id: ${id}`);
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
    return /(contains|defines|part[_ -]?of|section|sheet|table|column|field|folder|file|reference|figure|abstract)/i.test(relation);
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

function sortNodes(left: ExplorerNode, right: ExplorerNode): number {
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

function canInlineSourceComment(filePath: string): boolean {
  return inlineCommentExtensions.has(path.extname(filePath).toLowerCase());
}

function readInlineSourceComment(content: string): string {
  const pattern = /<!-- second-brain:comment[\s\S]*?-->\s*([\s\S]*?)\s*<!-- \/second-brain:comment -->/;
  const match = content.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function displaySourceName(sourceFile: string): string {
  const base = path.basename(sourceFile);
  return base.replace(/-\d{12,}-[a-f0-9]{8}(?=\.[^.]+$|$)/i, "");
}

function compactPreview(content: string): string {
  return content
    .replace(new RegExp(`<!-- second-brain:comment[\\s\\S]*?${inlineCommentEnd}`, "g"), "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`|[\]()~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export class ExplorerService {
  private readonly fileIconCache = new Map<string, string | undefined>();

  constructor(
    private readonly rawVaultPath: string,
    private readonly graphPath: string
  ) {}

  async getRoot(): Promise<ExplorerNode[]> {
    return this.listDirectory("");
  }

  async getChildren(nodeId: string): Promise<ExplorerNode[]> {
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

    if (parsed.kind === "artifact") {
      return [];
    }

    if (parsed.kind === "graph") {
      return this.getGraphNodeChildren(parsed.value);
    }

    if (parsed.kind === "related") {
      return this.getRelatedGroupChildren(parsed.ownerKind, parsed.ownerId, parsed.relation);
    }

    return [];
  }

  async getDetails(nodeId: string): Promise<ExplorerNodeDetails> {
    const parsed = parseTreeId(nodeId);
    const index = await this.readGraphIndex();

    if (parsed.kind === "root") {
      return {
        node: {
          id: rootNodeId,
          title: "Project Sources",
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
          title: path.basename(parsed.value) || "Project Sources",
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

    if (parsed.kind === "artifact") {
      const artifact = await this.getArtifactRecord(parsed.value);
      if (!artifact) {
        throw new Error(`Paper artifact not found: ${parsed.value}`);
      }

      return {
        node: this.artifactTreeNode(artifact),
        sourceLocation: artifact.artifactPath,
        relationGroups: []
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

  async search(input: ExplorerSearchInput): Promise<ExplorerSearchResult[]> {
    const query = input.query.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const limit = Math.max(1, input.limit ?? 30);
    const [sources, index] = await Promise.all([this.listSourceOptions(), this.readGraphIndex()]);
    const results: ExplorerSearchResult[] = [];

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

    for (const artifact of await this.readArtifactIndex()) {
      const score = scoreText(
        compactSearchText([
          artifact.title,
          artifact.artifactKind,
          artifact.sourceFile,
          artifact.preview,
          artifact.llmFormat
        ]),
        query,
        tokens
      );
      if (score > 0) {
        results.push({ ...this.artifactTreeNode(artifact), score: score + 1 });
      }
    }

    return results
      .sort((left, right) => right.score - left.score || sortNodes(left, right))
      .slice(0, limit);
  }

  async listSourceOptions(): Promise<ExplorerSourceOption[]> {
    const files = await this.listSourceFiles();
    return files.map((sourceFile) => ({
      sourceFile,
      title: displaySourceName(sourceFile)
    }));
  }

  async getArtifactContent(inputArtifactId: string): Promise<ExplorerArtifactContent> {
    const artifact = await this.getArtifactRecord(inputArtifactId);
    if (!artifact) {
      throw new Error(`Paper artifact not found: ${inputArtifactId}`);
    }

    const absolutePath = this.resolveRawPath(artifact.artifactPath);
    const [content, fileStat] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);

    return {
      artifactId: artifact.artifactId,
      title: artifact.title,
      artifactKind: artifact.artifactKind,
      sourceFile: artifact.sourceFile,
      artifactPath: artifact.artifactPath,
      page: artifact.page,
      preview: artifact.preview,
      llmFormat: artifact.llmFormat,
      content,
      updatedAt: fileStat.mtime.toISOString()
    };
  }

  async getOpenPath(nodeId: string): Promise<string> {
    const parsed = parseTreeId(nodeId);

    if (parsed.kind === "root") {
      return this.rawVaultPath;
    }

    if (parsed.kind === "folder" || parsed.kind === "source") {
      return this.resolveRawPath(parsed.value);
    }

    if (parsed.kind === "artifact") {
      const artifact = await this.getArtifactRecord(parsed.value);
      if (!artifact) {
        throw new Error(`Paper artifact not found: ${parsed.value}`);
      }

      return this.resolveRawPath(artifact.artifactPath);
    }

    if (parsed.kind === "graph") {
      const index = await this.readGraphIndex();
      const node = index.nodeById.get(parsed.value);
      if (!node) {
        throw new Error(`Graph node not found: ${parsed.value}`);
      }

      const artifactPath = this.normalizeSourceFile(asString(node.artifact_path) || asString(node.artifactPath));
      if (artifactPath) {
        return this.resolveRawPath(artifactPath);
      }

      const sourceFile = this.normalizeSourceFile(asString(node.source_file) || asString(node.sourceFile));
      if (sourceFile) {
        return this.resolveRawPath(sourceFile);
      }
    }

    throw new Error("This Explorer item does not map to a local file.");
  }

  private async listDirectory(relativeDirectory: string, index?: GraphIndex): Promise<ExplorerNode[]> {
    const graphIndex = index ?? (await this.readGraphIndex());
    const absoluteDirectory = this.resolveRawPath(relativeDirectory);
    let entries;

    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: ExplorerNode[] = [];
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

  private async getSourceChildren(sourceFile: string): Promise<ExplorerNode[]> {
    const index = await this.readGraphIndex();
    const sourceNodeIds = index.sourceNodeIds.get(sourceFile) ?? new Set<string>();
    const artifactNodes = (await this.readArtifactIndex())
      .filter((artifact) => artifact.sourceFile === sourceFile)
      .map((artifact) => this.artifactTreeNode(artifact));

    if (sourceNodeIds.size === 0) {
      return artifactNodes.slice(0, maxTreeChildren).sort(sortNodes);
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

    roots.push(...artifactNodes);

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

    return roots.sort(sortNodes).slice(0, maxTreeChildren);
  }

  private async getGraphNodeChildren(nodeId: string): Promise<ExplorerNode[]> {
    const index = await this.readGraphIndex();
    const artifacts = (await this.readArtifactIndex())
      .filter((artifact) => artifact.graphNodeId === nodeId)
      .map((artifact) => this.artifactTreeNode(artifact));
    const structuralChildren = (index.outgoing.get(nodeId) ?? [])
      .filter((link) => isStructuralRelation(asString(link.relation) || "related"))
      .map((link) => linkEndpointId(link.target))
      .filter((targetId, indexInList, all) => targetId && all.indexOf(targetId) === indexInList)
      .map((targetId) => this.graphTreeNode(index, targetId))
      .sort(sortNodes)
      .slice(0, maxTreeChildren);

    const groups = this.buildNodeRelationGroups(index, nodeId)
      .filter((group) => group.items.length > 0)
      .map<ExplorerNode>((group) => ({
        id: relatedGroupId("graph", nodeId, group.relation),
        title: group.title,
        kind: "related-group",
        graphNodeId: nodeId,
        relation: group.relation,
        childrenCount: group.items.length,
        isExpandable: true
      }));

    return [...artifacts, ...structuralChildren, ...groups].slice(0, maxTreeChildren);
  }

  private async getRelatedGroupChildren(ownerKind: "source" | "graph", ownerId: string, relation: string): Promise<ExplorerNode[]> {
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

  private async sourceTreeNode(sourceFile: string, index?: GraphIndex): Promise<ExplorerNode> {
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
      title: displaySourceName(sourceFile),
      kind: "source",
      sourceFile,
      type: path.extname(sourceFile).replace(/^\./, "").toUpperCase() || "FILE",
      summary: comment || sourceFile,
      modifiedAt,
      systemIconDataUrl: await this.fileIconDataUrl(sourceFile),
      childrenCount,
      isExpandable: childrenCount > 0
    };
  }

  private graphTreeNode(index: GraphIndex, nodeId: string): ExplorerNode {
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
    const artifactKind = this.normalizeArtifactKind(asString(node.artifact_kind) || asString(node.artifactKind) || type);
    const artifactPath = this.normalizeSourceFile(asString(node.artifact_path) || asString(node.artifactPath));
    const artifactRecordId = asString(node.artifact_id) || asString(node.artifactId);
    const childrenCount = structuralCount + relationCount + (artifactPath ? 1 : 0);

    return {
      id: graphId(nodeId),
      title: nodeTitle(node),
      kind: /sheet|table|column|section|file|class|function|method|paper_|reference|figure|abstract|dataset|result|claim/i.test(type)
        ? "component"
        : "entity",
      sourceFile,
      graphNodeId: nodeId,
      type,
      summary: nodeSummary(node),
      artifactId: artifactRecordId || undefined,
      artifactKind,
      artifactPath: artifactPath || undefined,
      page: this.normalizePage(node.page),
      preview: asString(node.preview) || undefined,
      llmFormat: this.normalizeArtifactFormat(asString(node.llm_format) || asString(node.llmFormat)),
      childrenCount,
      isExpandable: childrenCount > 0
    };
  }

  private artifactTreeNode(artifact: PaperArtifactRecord): ExplorerNode {
    return {
      id: artifactId(artifact.artifactId),
      title: artifact.title,
      kind: "artifact",
      sourceFile: artifact.sourceFile,
      graphNodeId: artifact.graphNodeId,
      type: artifact.artifactKind,
      summary: artifact.preview,
      artifactId: artifact.artifactId,
      artifactKind: artifact.artifactKind,
      artifactPath: artifact.artifactPath,
      page: artifact.page,
      preview: artifact.preview,
      llmFormat: artifact.llmFormat,
      childrenCount: 0,
      isExpandable: false
    };
  }

  private buildSourceRelationGroups(index: GraphIndex, sourceFile: string): ExplorerRelationGroup[] {
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

  private buildNodeRelationGroups(index: GraphIndex, nodeId: string): ExplorerRelationGroup[] {
    const groups = new Map<string, ExplorerRelationItem[]>();

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

  private sourceRelatedItems(index: GraphIndex, sourceFile: string): ExplorerRelationItem[] {
    const sourceNodeIds = index.sourceNodeIds.get(sourceFile) ?? new Set<string>();
    const seen = new Set<string>();
    const items: ExplorerRelationItem[] = [];

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

  private nodeRelatedItems(index: GraphIndex, nodeId: string): ExplorerRelationItem[] {
    const links = [...(index.outgoing.get(nodeId) ?? []), ...(index.incoming.get(nodeId) ?? [])];
    const seen = new Set<string>();
    const items: ExplorerRelationItem[] = [];

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

  private async readArtifactIndex(): Promise<PaperArtifactRecord[]> {
    const [paper, converted, wiki] = await Promise.all([
      this.readPaperArtifactIndex(),
      this.readConvertedArtifactIndex(),
      this.readWikiArtifactIndex()
    ]);
    return [...paper, ...converted, ...wiki].sort(
      (left, right) => left.sourceFile.localeCompare(right.sourceFile) || left.title.localeCompare(right.title)
    );
  }

  private async readPaperArtifactIndex(): Promise<PaperArtifactRecord[]> {
    const root = path.join(this.rawVaultPath, "paper-components");
    const records: PaperArtifactRecord[] = [];

    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (!entry.isFile() || entry.name !== "artifact-index.json") {
          continue;
        }

        try {
          const parsed = JSON.parse(await readFile(entryPath, "utf8")) as unknown;
          const items = Array.isArray(parsed)
            ? parsed
            : Array.isArray(asRecord(parsed)?.artifacts)
              ? (asRecord(parsed)?.artifacts as unknown[])
              : [];

          for (const item of items) {
            const record = asRecord(item);
            if (!record) {
              continue;
            }

            const artifactIdValue = asString(record.artifactId) || asString(record.id);
            const artifactPathValue = this.normalizeSourceFile(asString(record.artifactPath) || asString(record.path));
            const sourceFile = this.normalizeSourceFile(asString(record.sourceFile) || asString(record.source_file));
            if (!artifactIdValue || !artifactPathValue || !sourceFile) {
              continue;
            }

            records.push({
              artifactId: artifactIdValue,
              artifactKind: this.normalizeArtifactKind(asString(record.artifactKind) || asString(record.kind) || asString(record.type)),
              title: asString(record.title) || artifactIdValue,
              sourceFile,
              artifactPath: artifactPathValue,
              graphNodeId: asString(record.graphNodeId) || asString(record.graph_node_id) || undefined,
              page: this.normalizePage(record.page),
              preview: asString(record.preview) || undefined,
              llmFormat: this.normalizeArtifactFormat(asString(record.llmFormat) || asString(record.format))
            });
          }
        } catch {
          // Rebuildable cache only; skip malformed artifact indexes without blocking Explorer.
        }
      }
    };

    await visit(root);
    return records.sort((left, right) => left.sourceFile.localeCompare(right.sourceFile) || left.title.localeCompare(right.title));
  }

  private async readConvertedArtifactIndex(): Promise<PaperArtifactRecord[]> {
    const root = path.join(this.rawVaultPath, "graphify-out", "converted");
    const records: PaperArtifactRecord[] = [];
    const sourceFiles = await this.listSourceFiles();
    const sourceByBase = new Map(
      sourceFiles.map((sourceFile) => [path.basename(sourceFile, path.extname(sourceFile)).toLowerCase(), sourceFile] as const)
    );

    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
          continue;
        }

        try {
          const relativePath = this.toRelativeSourcePath(entryPath);
          const content = await readFile(entryPath, "utf8");
          const base = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
          const sourceFile = sourceByBase.get(base) ?? relativePath;
          records.push({
            artifactId: `converted:${relativePath}`,
            artifactKind: "artifact",
            title: titleFromMarkdown(content, path.basename(entry.name)),
            sourceFile,
            artifactPath: relativePath,
            preview: compactPreview(content),
            llmFormat: "markdown"
          });
        } catch {
          // Converted sidecars are rebuildable.
        }
      }
    };

    await visit(root);
    return records;
  }

  private async readWikiArtifactIndex(): Promise<PaperArtifactRecord[]> {
    const root = path.join(this.rawVaultPath, "graphify-out", "wiki");
    const records: PaperArtifactRecord[] = [];

    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
          continue;
        }

        try {
          const relativePath = this.toRelativeSourcePath(entryPath);
          const content = await readFile(entryPath, "utf8");
          records.push({
            artifactId: `wiki:${relativePath}`,
            artifactKind: entry.name.toLowerCase() === "index.md" ? "graph" : "artifact",
            title: titleFromMarkdown(content, path.basename(entry.name, ".md")),
            sourceFile: relativePath,
            artifactPath: relativePath,
            preview: compactPreview(content),
            llmFormat: "markdown"
          });
        } catch {
          // Wiki exports are rebuildable.
        }
      }
    };

    await visit(root);
    return records;
  }

  private async getArtifactRecord(inputArtifactId: string): Promise<PaperArtifactRecord | null> {
    const artifacts = await this.readArtifactIndex();
    return artifacts.find((artifact) => artifact.artifactId === inputArtifactId) ?? null;
  }

  private normalizeArtifactKind(value: string): ExplorerArtifactKind {
    const normalized = value.replace(/^paper_/, "").toLowerCase();
    if (
      normalized === "section" ||
      normalized === "abstract" ||
      normalized === "figure" ||
      normalized === "diagram" ||
      normalized === "graph" ||
      normalized === "table" ||
      normalized === "experiment" ||
      normalized === "reference" ||
      normalized === "claim" ||
      normalized === "method" ||
      normalized === "dataset" ||
      normalized === "result"
    ) {
      return normalized;
    }

    return "artifact";
  }

  private normalizeArtifactFormat(value: string): ExplorerArtifactFormat {
    const normalized = value.toLowerCase();
    if (normalized === "markdown" || normalized === "csv" || normalized === "json" || normalized === "text") {
      return normalized;
    }

    return "markdown";
  }

  private normalizePage(value: unknown): number | undefined {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
  }

  private async readSourceComment(sourceFile: string): Promise<string> {
    try {
      const sourcePath = this.resolveRawPath(sourceFile);
      if (canInlineSourceComment(sourcePath)) {
        const inlineComment = readInlineSourceComment(await readFile(sourcePath, "utf8"));
        if (inlineComment) {
          return inlineComment;
        }
      }
    } catch {
      // Fall back to sidecar comments below.
    }

    try {
      return await readFile(path.join(this.rawVaultPath, sourceCommentDirectoryName, sourceCommentFileName(sourceFile)), "utf8");
    } catch {
      return "";
    }
  }

  private async fileIconDataUrl(sourceFile: string): Promise<string | undefined> {
    const absolutePath = this.resolveRawPath(sourceFile);
    if (this.fileIconCache.has(absolutePath)) {
      return this.fileIconCache.get(absolutePath);
    }

    try {
      const icon = await app.getFileIcon(absolutePath, { size: "small" });
      const dataUrl = icon.isEmpty() ? undefined : icon.toDataURL();
      this.fileIconCache.set(absolutePath, dataUrl);
      return dataUrl;
    } catch {
      this.fileIconCache.set(absolutePath, undefined);
      return undefined;
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

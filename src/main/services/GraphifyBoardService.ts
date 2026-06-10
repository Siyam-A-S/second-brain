import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BoardItem, BoardRule, OrganizedBoardTopic } from "../../shared/types/board";

type GraphifyNode = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  node_type?: unknown;
  file_type?: unknown;
  summary?: unknown;
  description?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  community?: unknown;
  tags?: unknown;
  company?: unknown;
  role?: unknown;
  date?: unknown;
  created_at?: unknown;
  modified_at?: unknown;
  updated_at?: unknown;
};

type GraphifyLink = {
  source?: unknown;
  target?: unknown;
  weight?: unknown;
};

type GraphifyGraph = {
  nodes?: unknown;
  links?: unknown;
  edges?: unknown;
};

type NodeWithDegree = {
  node: GraphifyNode;
  item: BoardItem;
  degree: number;
};

const unknownSource = "Unknown source";
const fallbackDate = new Date(0).toISOString();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown, fallback: string): string {
  const id = asString(value);
  return id || fallback;
}

function normalizeCommunity(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return asString(value) || "unclustered";
}

function normalizeType(node: GraphifyNode): string {
  return (
    asString(node.type) ||
    asString(node.node_type) ||
    asString(node.file_type) ||
    asString(node._origin) ||
    "entity"
  );
}

function summarizeNode(node: GraphifyNode): string {
  return (
    asString(node.summary) ||
    asString(node.description) ||
    asString(node.source_location) ||
    asString(node.label) ||
    "Graphify node"
  );
}

function timestampFromNode(node: GraphifyNode): string {
  return asString(node.modified_at) || asString(node.updated_at) || asString(node.created_at) || fallbackDate;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function topEntries(counts: Map<string, number>, limit: number): string[] {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function parseGraphJson(raw: string): GraphifyGraph {
  const parsed = JSON.parse(raw) as unknown;
  const graph = asRecord(parsed);

  if (!graph) {
    throw new Error("Graphify graph.json must contain an object.");
  }

  return graph;
}

function extractNodes(graph: GraphifyGraph): GraphifyNode[] {
  return Array.isArray(graph.nodes)
    ? graph.nodes.map(asRecord).filter((node): node is GraphifyNode => Boolean(node))
    : [];
}

function extractLinks(graph: GraphifyGraph): GraphifyLink[] {
  const links = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  return links.map(asRecord).filter((link): link is GraphifyLink => Boolean(link));
}

function linkEndpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function buildDegreeMap(links: GraphifyLink[]): Map<string, number> {
  const degree = new Map<string, number>();

  for (const link of links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    const weight = typeof link.weight === "number" && Number.isFinite(link.weight) ? Math.max(1, link.weight) : 1;

    if (source) {
      degree.set(source, (degree.get(source) ?? 0) + weight);
    }

    if (target) {
      degree.set(target, (degree.get(target) ?? 0) + weight);
    }
  }

  return degree;
}

export class GraphifyBoardService {
  constructor(
    private readonly graphPath: string,
    private readonly sourceRoot: string
  ) {}

  async buildBoardState(rule: BoardRule): Promise<OrganizedBoardTopic[]> {
    const graph = await this.readGraph();
    if (!graph) {
      return [];
    }

    const nodes = extractNodes(graph);
    const links = extractLinks(graph);
    const degree = buildDegreeMap(links);
    const items = await Promise.all(nodes.map((node, index) => this.toNodeWithDegree(node, degree, index)));

    switch (rule) {
      case "entity":
        return this.buildEntityBoard(items);
      case "source":
        return this.buildSourceBoard(items);
      case "community":
      default:
        return this.buildCommunityBoard(items);
    }
  }

  private async readGraph(): Promise<GraphifyGraph | null> {
    try {
      return parseGraphJson(await readFile(this.graphPath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private buildCommunityBoard(nodes: NodeWithDegree[]): OrganizedBoardTopic[] {
    const grouped = new Map<string, NodeWithDegree[]>();

    for (const node of nodes) {
      const community = normalizeCommunity(node.node.community);
      grouped.set(community, [...(grouped.get(community) ?? []), node]);
    }

    return Array.from(grouped.entries())
      .map(([community, communityNodes]) => ({
        id: `community-${community}`,
        title: this.titleCommunity(community, communityNodes),
        layoutType: "masonry" as const,
        items: communityNodes
          .map((node) => node.item)
          .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.title.localeCompare(right.title))
      }))
      .sort((left, right) => right.items.length - left.items.length || left.title.localeCompare(right.title));
  }

  private buildEntityBoard(nodes: NodeWithDegree[]): OrganizedBoardTopic[] {
    const rows = nodes
      .map(({ node, item, degree }) => ({
        item: {
          ...item,
          rawData: {
            ...item.rawData,
            relationCount: degree
          }
        },
        degree
      }))
      .sort(
        (left, right) =>
          right.item.modifiedAt.localeCompare(left.item.modifiedAt) ||
          right.degree - left.degree ||
          left.item.title.localeCompare(right.item.title)
      );

    return [
      {
        id: "entities-table",
        title: "Graph Entities",
        layoutType: "table",
        items: rows.map((row) => row.item)
      }
    ];
  }

  private buildSourceBoard(nodes: NodeWithDegree[]): OrganizedBoardTopic[] {
    const grouped = new Map<string, BoardItem[]>();

    for (const { item } of nodes) {
      const sourceFile = item.sourceFile || unknownSource;
      grouped.set(sourceFile, [...(grouped.get(sourceFile) ?? []), item]);
    }

    return Array.from(grouped.entries())
      .map(([sourceFile, items]) => ({
        id: `source-${sourceFile}`,
        title: sourceFile === unknownSource ? unknownSource : path.basename(sourceFile),
        layoutType: "list" as const,
        items: items.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.title.localeCompare(right.title))
      }))
      .sort((left, right) => right.items.length - left.items.length || left.title.localeCompare(right.title));
  }

  private titleCommunity(community: string, nodes: NodeWithDegree[]): string {
    const types = topEntries(countBy(nodes.map(({ item }) => item.type).filter(Boolean)), 2);
    const highestDegree = [...nodes].sort((left, right) => right.degree - left.degree || left.item.title.localeCompare(right.item.title))[0];
    const lead = highestDegree?.item.title;

    if (lead && highestDegree.degree > 1) {
      return `${lead} Cluster`;
    }

    if (types.length > 0) {
      return `${types.map(titleCase).join(" / ")} Cluster`;
    }

    return `Community ${community}`;
  }

  private async toNodeWithDegree(node: GraphifyNode, degree: Map<string, number>, index: number): Promise<NodeWithDegree> {
    const id = normalizeId(node.id, `graph-node-${index}`);
    const sourceFile = asString(node.source_file) || asString(node.sourceFile) || unknownSource;
    const modifiedAt = await this.modifiedAtForNode(node, sourceFile);
    const item: BoardItem = {
      id,
      title: asString(node.label) || id,
      summary: summarizeNode(node),
      type: normalizeType(node),
      sourceFile,
      modifiedAt,
      rawData: { ...node }
    };

    return {
      node,
      item,
      degree: degree.get(id) ?? 0
    };
  }

  private async modifiedAtForNode(node: GraphifyNode, sourceFile: string): Promise<string> {
    const nodeTimestamp = timestampFromNode(node);
    if (nodeTimestamp !== fallbackDate) {
      return nodeTimestamp;
    }

    if (!sourceFile || sourceFile === unknownSource) {
      return fallbackDate;
    }

    const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.join(this.sourceRoot, sourceFile);

    try {
      return (await stat(sourcePath)).mtime.toISOString();
    } catch {
      return fallbackDate;
    }
  }
}

import { readFile, stat } from "node:fs/promises";
import type {
  GraphBoardLink,
  GraphBoardNeighbor,
  GraphBoardNode,
  GraphBoardNodeDetails,
  GraphBoardState
} from "../../shared/brain";
import type { ResearchService } from "./ResearchService";

type GraphNodeRecord = Record<string, unknown> & {
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

type GraphLinkRecord = Record<string, unknown> & {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
  label?: unknown;
  type?: unknown;
  weight?: unknown;
};

type GraphJson = {
  nodes?: unknown;
  links?: unknown;
  edges?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function endpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function nodeLabel(node: GraphNodeRecord, fallback: string): string {
  return asString(node.label) || asString(node.title) || asString(node.id) || fallback;
}

function nodeType(node: GraphNodeRecord): string {
  return asString(node.type) || asString(node.node_type) || asString(node.file_type) || asString(node._origin) || "entity";
}

function nodeSummary(node: GraphNodeRecord): string {
  return (
    asString(node.contextual_definition) ||
    asString(node.flashcard_definition) ||
    asString(node.summary) ||
    asString(node.description) ||
    asString(node.source_location) ||
    "No definition yet."
  );
}

function nodeSource(node: GraphNodeRecord): string {
  return asString(node.source_file) || asString(node.sourceFile);
}

function nodeCommunity(node: GraphNodeRecord): string {
  const value = node.community;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return asString(value) || "unclustered";
}

function linkLabel(link: GraphLinkRecord): string {
  return asString(link.relation) || asString(link.label) || asString(link.type) || "related";
}

function linkWeight(link: GraphLinkRecord): number {
  return typeof link.weight === "number" && Number.isFinite(link.weight) ? Math.max(1, link.weight) : 1;
}

function parseGraph(raw: string): GraphJson {
  const parsed = JSON.parse(raw) as unknown;
  const graph = asRecord(parsed);
  if (!graph) {
    throw new Error("Graphify graph.json must contain an object.");
  }

  return graph;
}

function graphNodes(graph: GraphJson): GraphNodeRecord[] {
  return Array.isArray(graph.nodes)
    ? graph.nodes.map(asRecord).filter((node): node is GraphNodeRecord => Boolean(node))
    : [];
}

function graphLinks(graph: GraphJson): GraphLinkRecord[] {
  const links = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  return links.map(asRecord).filter((link): link is GraphLinkRecord => Boolean(link));
}

export class GraphBoardService {
  constructor(
    private readonly graphPath: string,
    private readonly research?: ResearchService
  ) {}

  async getState(): Promise<GraphBoardState> {
    const graph = await this.readGraph();
    const nodes = graphNodes(graph);
    const links = graphLinks(graph);
    const degrees = this.buildDegreeMap(links);
    const updatedAt = await this.graphUpdatedAt();

    return {
      nodes: nodes.map((node, index) => this.toBoardNode(node, degrees, index)),
      links: links.map((link) => this.toBoardLink(link)).filter((link): link is GraphBoardLink => Boolean(link.source && link.target)),
      graphPath: this.graphPath,
      updatedAt
    };
  }

  async getNodeDetails(nodeId: string): Promise<GraphBoardNodeDetails> {
    const graph = await this.readGraph();
    const nodes = graphNodes(graph);
    const links = graphLinks(graph);
    const nodeById = new Map(nodes.map((node, index) => [asString(node.id) || `graph-node-${index}`, node]));
    const degrees = this.buildDegreeMap(links);
    const node = nodeById.get(nodeId);

    if (!node) {
      throw new Error(`Graph node "${nodeId}" was not found.`);
    }

    const neighbors: GraphBoardNeighbor[] = [];
    for (const link of links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      const relation = linkLabel(link);

      if (source === nodeId && target) {
        const targetNode = nodeById.get(target);
        neighbors.push({
          id: target,
          label: targetNode ? nodeLabel(targetNode, target) : target,
          type: targetNode ? nodeType(targetNode) : "entity",
          relation,
          direction: "outgoing",
          sourceFile: targetNode ? nodeSource(targetNode) : ""
        });
      } else if (target === nodeId && source) {
        const sourceNode = nodeById.get(source);
        neighbors.push({
          id: source,
          label: sourceNode ? nodeLabel(sourceNode, source) : source,
          type: sourceNode ? nodeType(sourceNode) : "entity",
          relation,
          direction: "incoming",
          sourceFile: sourceNode ? nodeSource(sourceNode) : ""
        });
      }
    }

    const boardNode = this.toBoardNode(node, degrees, nodes.indexOf(node));
    const details: GraphBoardNodeDetails = {
      ...boardNode,
      research: await this.tryPaperDetails(boardNode.id, boardNode.type),
      neighbors: neighbors
        .sort((left, right) => left.label.localeCompare(right.label))
        .slice(0, 80)
    };

    return details;
  }

  private async readGraph(): Promise<GraphJson> {
    try {
      return parseGraph(await readFile(this.graphPath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { nodes: [], links: [] };
      }

      throw error;
    }
  }

  private async graphUpdatedAt(): Promise<string> {
    try {
      return (await stat(this.graphPath)).mtime.toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  }

  private buildDegreeMap(links: GraphLinkRecord[]): Map<string, number> {
    const degrees = new Map<string, number>();

    for (const link of links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      const weight = linkWeight(link);

      if (source) {
        degrees.set(source, (degrees.get(source) ?? 0) + weight);
      }

      if (target) {
        degrees.set(target, (degrees.get(target) ?? 0) + weight);
      }
    }

    return degrees;
  }

  private toBoardNode(node: GraphNodeRecord, degrees: Map<string, number>, index: number): GraphBoardNode {
    const id = asString(node.id) || `graph-node-${index}`;

    return {
      id,
      label: nodeLabel(node, id),
      type: nodeType(node),
      summary: nodeSummary(node),
      sourceFile: nodeSource(node),
      community: nodeCommunity(node),
      degree: degrees.get(id) ?? 0,
      rawData: node
    };
  }

  private toBoardLink(link: GraphLinkRecord): GraphBoardLink {
    return {
      source: endpointId(link.source),
      target: endpointId(link.target),
      label: linkLabel(link),
      weight: linkWeight(link),
      rawData: link
    };
  }

  private async tryPaperDetails(nodeId: string, type: string): Promise<GraphBoardNodeDetails["research"]> {
    if (!this.research || !/^(paper|paper_file)$/i.test(type)) {
      return undefined;
    }

    try {
      return await this.research.getPaperDetails(nodeId);
    } catch {
      return undefined;
    }
  }
}

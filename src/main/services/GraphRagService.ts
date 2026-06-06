import type {
  BoardTopologyNode,
  BoardChildNode,
  BrainNode,
  ExportBoardPlaintextInput,
  FetchFileSegmentsInput,
  IngestAndRouteFragmentInput,
  IngestAndRouteFragmentResult,
  OrganizedBoardTopic,
  RoutingDecision,
  SearchBoardTopologyInput
} from "../../shared/brain";
import { EmbeddingService } from "./EmbeddingService";
import { StorageService } from "./StorageService";

function dotProduct(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return score;
}

function keywordScore(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();

  return keywords.reduce((score, keyword) => {
    const needle = keyword.trim().toLowerCase();
    return needle && normalized.includes(needle) ? score + 1 : score;
  }, 0);
}

function validationBoost(node: BrainNode): number {
  switch (node.user_validation) {
    case "pinned":
      return 0.14;
    case "approved":
      return 0.08;
    case "rejected":
      return -0.45;
    case "unreviewed":
    default:
      return 0;
  }
}

function recencyScore(updatedAt: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(updatedAt).getTime());
  const ageDays = ageMs / 86_400_000;

  if (ageDays <= 1) {
    return 1;
  }

  if (ageDays <= 7) {
    return 0.8;
  }

  if (ageDays <= 30) {
    return 0.5;
  }

  return 0.2;
}

function candidateText(node: BrainNode): string {
  return [node.title, node.summary, node.tags.join(" "), node.context_hints.join(" ")].join("\n");
}

function deriveTopicTitle(input: IngestAndRouteFragmentInput): string {
  const explicitHint = input.context_hints?.find((hint) => hint.trim().length > 4);

  if (explicitHint) {
    return explicitHint.trim().slice(0, 80);
  }

  return input.inferred_title.trim().slice(0, 80) || "Untitled Topic";
}

type CandidateScore = {
  node: BrainNode;
  score: number;
  reasons: string[];
};

export class GraphRagService {
  private readonly existingContextThreshold = 0.58;

  constructor(
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingService
  ) {}

  async searchBoardTopology(input: SearchBoardTopologyInput): Promise<BoardTopologyNode[]> {
    const keywords = input.keywords.map((keyword) => keyword.trim()).filter(Boolean);
    const nodes = await this.storage.listNodes();

    if (keywords.length === 0) {
      return nodes.slice(0, 5).map(this.toTopologyNode);
    }

    const query = keywords.join(" ");

    try {
      const queryEmbedding = await this.embeddings.generateEmbedding(query);
      const scored = await Promise.all(
        nodes.map(async (node) => {
          const text = [node.title, node.summary, node.tags.join(" ")].join("\n");
          const embedding = await this.embeddings.generateEmbedding(text);
          return {
            node,
            score: dotProduct(queryEmbedding, embedding)
          };
        })
      );

      return scored
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ node }) => this.toTopologyNode(node));
    } catch (error) {
      console.warn("Embedding topology search failed; falling back to keyword matching.", error);

      return nodes
        .map((node) => ({
          node,
          score: keywordScore([node.title, node.summary, node.tags.join(" ")].join("\n"), keywords)
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ node }) => this.toTopologyNode(node));
    }
  }

  async fetchFileSegments(input: FetchFileSegmentsInput): Promise<string> {
    return this.storage.fetchFileSegments(input.uuid, input.sections);
  }

  async ingestAndRouteFragment(input: IngestAndRouteFragmentInput): Promise<IngestAndRouteFragmentResult> {
    if (input.target_parent_uuid) {
      const parent = await this.storage.readNode(input.target_parent_uuid);
      const node = await this.storage.ingestFragment(input);

      return {
        node,
        routing: {
          strategy: "explicit-parent",
          parent_uuid: parent.uuid,
          parent_title: parent.title,
          confidence: 1,
          reasons: ["The caller supplied target_parent_uuid."]
        }
      };
    }

    const bestCandidate = await this.findBestRoutingCandidate(input);
    const routingParent =
      bestCandidate && bestCandidate.score >= this.existingContextThreshold
        ? bestCandidate.node
        : await this.createTopicForFragment(input);

    const node = await this.storage.ingestFragment({
      ...input,
      target_parent_uuid: routingParent.uuid,
      importance: input.importance ?? routingParent.importance,
      context_hints: input.context_hints ?? routingParent.context_hints
    });

    return {
      node,
      routing: {
        strategy: bestCandidate && bestCandidate.score >= this.existingContextThreshold ? "existing-context" : "new-topic",
        parent_uuid: routingParent.uuid,
        parent_title: routingParent.title,
        confidence: bestCandidate?.score ?? 0,
        reasons:
          bestCandidate && bestCandidate.score >= this.existingContextThreshold
            ? bestCandidate.reasons
            : ["No existing topic or subtopic cleared the routing confidence threshold."]
      }
    };
  }

  async getOrganizedBoard(): Promise<OrganizedBoardTopic[]> {
    const nodes = await this.storage.listNodes();
    const topics = nodes.filter((node) => node.type === "topic" || !node.parent_uuid);

    return topics.map((topic) => {
      const children = nodes
        .filter((node) => node.uuid !== topic.uuid)
        .filter((node) => node.parent_uuid === topic.uuid || topic.connections.includes(node.uuid))
        .sort(this.sortBoardChildren)
        .map(this.toBoardChildNode);

      return {
        ...this.toBoardChildNode(topic),
        children
      };
    });
  }

  async exportBoardPlaintext(input: ExportBoardPlaintextInput = {}): Promise<string> {
    const nodes = await this.storage.listNodes();
    const topics = await this.getOrganizedBoard();
    const selectedTopics = input.root_uuid ? topics.filter((topic) => topic.uuid === input.root_uuid) : topics;
    const nodeByUuid = new Map(nodes.map((node) => [node.uuid, node]));
    const lines: string[] = ["# Second Brain Board Export", ""];

    for (const topic of selectedTopics) {
      lines.push(`## ${topic.title}`, `UUID: ${topic.uuid}`, `Summary: ${topic.summary}`, "");

      for (const child of topic.children) {
        lines.push(`### ${child.title}`, `UUID: ${child.uuid}`, `Type: ${child.type}`, `Summary: ${child.summary}`);

        if (child.tags.length) {
          lines.push(`Tags: ${child.tags.join(", ")}`);
        }

        if (input.include_body) {
          const fullNode = nodeByUuid.get(child.uuid);
          if (fullNode?.content) {
            lines.push("", fullNode.content);
          }
        }

        lines.push("");
      }
    }

    return lines.join("\n").trim();
  }

  private toTopologyNode(node: BoardTopologyNode): BoardTopologyNode {
    return {
      uuid: node.uuid,
      title: node.title,
      summary: node.summary,
      connections: node.connections
    };
  }

  private async findBestRoutingCandidate(input: IngestAndRouteFragmentInput): Promise<CandidateScore | null> {
    const candidates = (await this.storage.listNodes()).filter((node) => node.type === "topic" || node.type === "subtopic");

    if (candidates.length === 0) {
      return null;
    }

    const queryText = [
      input.inferred_title,
      input.generated_summary,
      input.context_hints?.join(" ") ?? "",
      input.raw_content.slice(0, 2_000)
    ].join("\n");
    const keywords = [input.inferred_title, input.generated_summary, ...(input.context_hints ?? [])]
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
      .filter((value) => value.length > 3);

    try {
      const queryEmbedding = await this.embeddings.generateEmbedding(queryText);
      const scored = await Promise.all(
        candidates.map(async (node) => {
          const semanticScore = dotProduct(queryEmbedding, await this.embeddings.generateEmbedding(candidateText(node)));
          const lexicalScore = keywords.length ? keywordScore(candidateText(node), keywords) / keywords.length : 0;
          const score =
            semanticScore * 0.58 +
            lexicalScore * 0.18 +
            recencyScore(node.updatedAt) * 0.12 +
            node.importance * 0.08 +
            validationBoost(node);

          return {
            node,
            score,
            reasons: [
              `semantic=${semanticScore.toFixed(2)}`,
              `keyword=${lexicalScore.toFixed(2)}`,
              `recency=${recencyScore(node.updatedAt).toFixed(2)}`,
              `importance=${node.importance.toFixed(2)}`,
              `validation=${node.user_validation}`
            ]
          };
        })
      );

      return scored.sort((left, right) => right.score - left.score)[0] ?? null;
    } catch (error) {
      console.warn("Embedding route selection failed; falling back to keyword routing.", error);

      return candidates
        .map((node) => ({
          node,
          score:
            (keywords.length ? keywordScore(candidateText(node), keywords) / keywords.length : 0) +
            recencyScore(node.updatedAt) * 0.12 +
            node.importance * 0.08 +
            validationBoost(node),
          reasons: ["Used keyword routing because embedding route selection failed."]
        }))
        .sort((left, right) => right.score - left.score)[0] ?? null;
    }
  }

  private async createTopicForFragment(input: IngestAndRouteFragmentInput): Promise<BrainNode> {
    const title = deriveTopicTitle(input);

    return this.storage.writeNode({
      title,
      type: "topic",
      summary: input.generated_summary,
      parent_uuid: null,
      connections: [],
      tags: [],
      importance: input.importance ?? 0.5,
      user_validation: "unreviewed",
      context_hints: input.context_hints ?? [title],
      content: `# ${title}\n\n${input.generated_summary}`
    });
  }

  private sortBoardChildren(left: BrainNode, right: BrainNode): number {
    const recencyDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();

    if (Math.abs(recencyDelta) > 60_000) {
      return recencyDelta;
    }

    const signalDelta = right.importance + validationBoost(right) - (left.importance + validationBoost(left));
    return signalDelta;
  }

  private toBoardChildNode(node: BrainNode): BoardChildNode {
    return {
      uuid: node.uuid,
      title: node.title,
      type: node.type,
      summary: node.summary,
      connections: node.connections,
      tags: node.tags,
      updatedAt: node.updatedAt,
      importance: node.importance,
      user_validation: node.user_validation
    };
  }
}

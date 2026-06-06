import path from "node:path";
import type {
  BrainNode,
  BrainSearchResult,
  SearchBrainNodesInput
} from "../../shared/brain";
import type { FeatureExtractionPipeline } from "@xenova/transformers";

type TransformersModule = typeof import("@xenova/transformers");

type CachedEmbedding = {
  fingerprint: string;
  embedding: number[];
};

function dynamicImport<TModule>(specifier: string): Promise<TModule> {
  return new Function("specifier", "return import(specifier)")(specifier) as Promise<TModule>;
}

function dotProduct(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return score;
}

function searchableText(node: BrainNode): string {
  return [node.title, node.summary, node.tags.join(" "), node.content].filter(Boolean).join("\n\n");
}

function fingerprintNode(node: BrainNode): string {
  return `${node.updatedAt}:${node.title}:${node.summary}:${node.content.length}`;
}

export class EmbeddingService {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
  private readonly cache = new Map<string, CachedEmbedding>();

  constructor(private readonly cachePath: string) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, {
      pooling: "mean",
      normalize: true
    });

    return Array.from(output.data as Iterable<number>);
  }

  async embed(text: string): Promise<number[]> {
    return this.generateEmbedding(text);
  }

  async search(input: SearchBrainNodesInput, nodes: BrainNode[]): Promise<BrainSearchResult[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const queryEmbedding = await this.generateEmbedding(input.query);
    const scored = await Promise.all(
      nodes.map(async (node) => ({
        node,
        score: dotProduct(queryEmbedding, await this.embeddingForNode(node))
      }))
    );

    return scored.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  private async embeddingForNode(node: BrainNode): Promise<number[]> {
    const fingerprint = fingerprintNode(node);
    const cached = this.cache.get(node.uuid);

    if (cached?.fingerprint === fingerprint) {
      return cached.embedding;
    }

    const embedding = await this.generateEmbedding(searchableText(node));
    this.cache.set(node.uuid, { fingerprint, embedding });
    return embedding;
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    this.extractorPromise ??= this.loadExtractor();
    return this.extractorPromise;
  }

  private async loadExtractor(): Promise<FeatureExtractionPipeline> {
    const transformers = await dynamicImport<TransformersModule>("@xenova/transformers");

    transformers.env.cacheDir = path.join(this.cachePath, "transformers");
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;

    return transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
}

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ResearchLiteratureMatrix,
  ResearchPaperDetails,
  ResearchPaperNote,
  ResearchPaperStatus,
  ResearchPaperSummary,
  ResearchThesisLink,
  SaveResearchNodeNoteInput,
  UpdateResearchPaperStatusInput
} from "../../shared/brain";

type GraphNode = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  title?: unknown;
  type?: unknown;
  node_type?: unknown;
  file_type?: unknown;
  summary?: unknown;
  contextual_definition?: unknown;
  flashcard_definition?: unknown;
  description?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  authors?: unknown;
  year?: unknown;
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

type ResearchStore = {
  papers: Record<
    string,
    {
      status?: ResearchPaperStatus;
      literature?: Partial<ResearchLiteratureMatrix>;
      thesisLinks?: ResearchThesisLink[];
    }
  >;
  notes: Record<string, ResearchPaperNote>;
};

const emptyLiterature: ResearchLiteratureMatrix = {
  problem: "",
  method: "",
  dataset: "",
  keyResult: "",
  limitations: "",
  relevanceToThesis: ""
};

const paperTypes = new Set(["paper_file", "paper"]);
const paperComponentTypes = new Set([
  "paper_file",
  "paper_abstract",
  "paper_section",
  "paper_figure",
  "paper_table",
  "paper_reference",
  "paper_claim",
  "paper_method",
  "paper_dataset",
  "paper_result"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function nodeId(node: GraphNode, fallback: string): string {
  return asString(node.id) || fallback;
}

function nodeTitle(node: GraphNode, fallback: string): string {
  return asString(node.label) || asString(node.title) || asString(node.id) || fallback;
}

function nodeType(node: GraphNode): string {
  return asString(node.type) || asString(node.node_type) || asString(node.file_type) || "entity";
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

function sourceFile(node: GraphNode): string {
  return asString(node.source_file) || asString(node.sourceFile);
}

function endpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function parseGraph(raw: string): GraphJson {
  const parsed = JSON.parse(raw) as unknown;
  const graph = asRecord(parsed);
  if (!graph) {
    throw new Error("Graphify graph.json must contain an object.");
  }

  return graph;
}

function graphNodes(graph: GraphJson): GraphNode[] {
  return Array.isArray(graph.nodes)
    ? graph.nodes.map(asRecord).filter((node): node is GraphNode => Boolean(node))
    : [];
}

function graphLinks(graph: GraphJson): GraphLink[] {
  const links = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  return links.map(asRecord).filter((link): link is GraphLink => Boolean(link));
}

function normalizeStatus(value: unknown): ResearchPaperStatus {
  return value === "reading" || value === "summarized" || value === "cited" || value === "discarded" ? value : "unread";
}

function normalizeAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter(Boolean).slice(0, 12);
  }

  const text = asString(value);
  return text ? text.split(/,\s+|;\s+/).map(compact).filter(Boolean).slice(0, 12) : [];
}

export class ResearchService {
  private readonly researchDirectory: string;
  private readonly storePath: string;

  constructor(
    private readonly projectRootPath: string,
    private readonly graphPath: string
  ) {
    this.researchDirectory = path.join(projectRootPath, "research");
    this.storePath = path.join(this.researchDirectory, "papers.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.researchDirectory, { recursive: true });
    try {
      await readFile(this.storePath, "utf8");
    } catch {
      await this.writeStore({ papers: {}, notes: {} });
    }
  }

  async listPapers(): Promise<ResearchPaperSummary[]> {
    const [store, graph] = await Promise.all([this.readStore(), this.readGraph()]);
    const nodes = graphNodes(graph);
    const summaries = await Promise.all(
      nodes.map((node, index) => this.toPaperSummary(node, store, `paper-${index}`))
    );

    return summaries
      .filter((paper): paper is ResearchPaperSummary => Boolean(paper))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
  }

  async getPaperDetails(nodeId: string): Promise<ResearchPaperDetails> {
    const [store, graph] = await Promise.all([this.readStore(), this.readGraph()]);
    const nodes = graphNodes(graph);
    const links = graphLinks(graph);
    const nodeById = new Map(nodes.map((node, index) => [this.stableNodeId(node, index), node]));
    const paper = nodeById.get(nodeId);

    if (!paper) {
      throw new Error(`Research paper node "${nodeId}" was not found.`);
    }

    const summary = await this.toPaperSummary(paper, store, nodeId);
    if (!summary) {
      throw new Error(`Graph node "${nodeId}" is not a research paper.`);
    }

    const paperSource = sourceFile(paper);
    const relatedIds = new Set<string>([nodeId]);
    for (const link of links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === nodeId) {
        relatedIds.add(target);
      }
      if (target === nodeId) {
        relatedIds.add(source);
      }
    }

    const components = nodes
      .map((node, index) => ({ id: this.stableNodeId(node, index), node }))
      .filter(({ id, node }) => id !== nodeId && (sourceFile(node) === paperSource || relatedIds.has(id)))
      .filter(({ node }) => paperComponentTypes.has(nodeType(node)))
      .map(({ id, node }) => ({
        id,
        label: nodeTitle(node, id),
        type: nodeType(node),
        summary: nodeSummary(node),
        sourceLocation: asString(node.source_location)
      }))
      .sort((left, right) => left.type.localeCompare(right.type) || left.label.localeCompare(right.label));

    const abstract = components.find((component) => component.type === "paper_abstract")?.summary;
    const paperStore = store.papers[nodeId] ?? {};

    return {
      paper: summary,
      abstract,
      components,
      notes: Object.values(store.notes)
        .filter((note) => note.nodeId === nodeId || components.some((component) => component.id === note.nodeId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      literature: {
        ...emptyLiterature,
        ...paperStore.literature
      },
      thesisLinks: paperStore.thesisLinks ?? []
    };
  }

  async saveNodeNote(input: SaveResearchNodeNoteInput): Promise<ResearchPaperNote> {
    const store = await this.readStore();
    const note: ResearchPaperNote = {
      nodeId: input.nodeId,
      note: input.note.trim(),
      updatedAt: new Date().toISOString()
    };

    if (note.note) {
      store.notes[input.nodeId] = note;
    } else {
      delete store.notes[input.nodeId];
    }

    await this.writeStore(store);
    return note;
  }

  async updatePaperStatus(input: UpdateResearchPaperStatusInput): Promise<ResearchPaperSummary> {
    const store = await this.readStore();
    store.papers[input.nodeId] = {
      ...store.papers[input.nodeId],
      status: input.status
    };
    await this.writeStore(store);

    const paper = (await this.listPapers()).find((candidate) => candidate.nodeId === input.nodeId);
    if (!paper) {
      throw new Error(`Research paper node "${input.nodeId}" was not found.`);
    }

    return paper;
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

  private async readStore(): Promise<ResearchStore> {
    try {
      const parsed = asRecord(JSON.parse(await readFile(this.storePath, "utf8"))) ?? {};
      const papers = asRecord(parsed.papers);
      const notes = asRecord(parsed.notes);
      return {
        papers: papers ? (papers as ResearchStore["papers"]) : {},
        notes: notes ? (notes as ResearchStore["notes"]) : {}
      };
    } catch {
      return { papers: {}, notes: {} };
    }
  }

  private async writeStore(store: ResearchStore): Promise<void> {
    await mkdir(this.researchDirectory, { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  private stableNodeId(node: GraphNode, index: number): string {
    return nodeId(node, `graph-node-${index}`);
  }

  private async toPaperSummary(
    node: GraphNode,
    store: ResearchStore,
    fallbackId: string
  ): Promise<ResearchPaperSummary | null> {
    const type = nodeType(node);
    if (!paperTypes.has(type)) {
      return null;
    }

    const id = nodeId(node, fallbackId);
    const paperStore = store.papers[id] ?? {};

    return {
      nodeId: id,
      title: nodeTitle(node, id),
      sourceFile: sourceFile(node),
      year: asString(node.year) || undefined,
      authors: normalizeAuthors(node.authors),
      status: normalizeStatus(paperStore.status),
      updatedAt: await this.modifiedAt(sourceFile(node))
    };
  }

  private async modifiedAt(filePath: string): Promise<string> {
    if (!filePath) {
      return new Date(0).toISOString();
    }

    try {
      return (await stat(path.join(this.projectRootPath, "vault", "raw", filePath))).mtime.toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  }
}

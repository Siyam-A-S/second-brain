import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  GraphifyContextCitation,
  GraphifyContextNodeHit,
  GraphifyContextResult,
  GraphifyContextSourceExcerpt
} from "../../shared/brain";
import { SourceContentService } from "./SourceContentService";
import {
  isCmdShim,
  runtimeGraphifyCommands,
  runtimePythonCommands,
  runtimeUvCommands,
  uniqueRuntimeCandidates,
  withRuntimePath,
  withRuntimePathRecord
} from "./RuntimeCommandPaths";

type GraphifyInvocation = {
  label: string;
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

type GraphifyGraphNode = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  sourceLocation?: unknown;
  community?: unknown;
  confidence?: unknown;
  confidence_score?: unknown;
};

type GraphifyGraphLink = Record<string, unknown> & {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
  confidence?: unknown;
  source_file?: unknown;
  source_location?: unknown;
};

type GraphifyGraphData = {
  nodes: GraphifyGraphNode[];
  links: GraphifyGraphLink[];
};

const graphifyToolPackage = "graphifyy[all]";
const maxExecBuffer = 4 * 1024 * 1024;
const defaultTimeoutMs = 90_000;
const defaultMcpTimeoutMs = 45_000;
const defaultBudget = 1800;
const maxHydratedContextFiles = 8;
const maxHydratedContextChars = 2800;
const maxNodeHits = 24;
const maxExpandedTokens = 12;
const maxCardDefinitionCount = 10;
const maxWikiArticleCount = 3;
const maxWikiArticleChars = 2200;
const maxReadableContextBytes = 2 * 1024 * 1024;
const readableContextExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".py",
  ".rs",
  ".sql",
  ".svelte",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
const graphVocabularyStopTokens = new Set([
  "src",
  "dist",
  "main",
  "renderer",
  "preload",
  "services",
  "components",
  "lib",
  "tests",
  "test",
  "dev",
  "build",
  "node",
  "json",
  "cjs",
  "mjs",
  "js",
  "jsx",
  "ts",
  "tsx",
  "md",
  "txt"
]);

function quoteCommandPart(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function formatInvocation(invocation: GraphifyInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteCommandPart).join(" ");
}

function formatMcpTool(name: string, args: Record<string, unknown>): string {
  return `mcp:graphify.serve/${name} ${JSON.stringify(args)}`;
}

function parseArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function normalizeBudget(value: number | undefined): number {
  return Math.max(250, Math.min(4000, Math.trunc(Number.isFinite(value) ? value ?? defaultBudget : defaultBudget)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractCitations(stdout: string): GraphifyContextCitation[] {
  const citations = new Map<string, GraphifyContextCitation>();
  const pattern = /(?:src|source)=([^\]\s]+)(?:\s+loc=([^\]\s]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    const sourceFile = match[1]?.trim();
    if (!sourceFile) {
      continue;
    }

    const sourceLocation = match[2]?.trim();
    const key = `${sourceFile}:${sourceLocation ?? ""}`;
    citations.set(key, {
      sourceFile,
      sourceLocation,
      label: sourceLocation ? `${sourceFile} ${sourceLocation}` : sourceFile
    });
  }

  return Array.from(citations.values()).slice(0, 24);
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .flatMap((token) => token.split(/[./-]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 48 && !graphVocabularyStopTokens.has(token));
}

function lineNumberFromLocation(sourceLocation: string | undefined): number | null {
  const lineMatch = sourceLocation?.match(/(?:^|[^A-Za-z])L(?:ine)?[:=]?(\d+)/i) ?? sourceLocation?.match(/(?:line|loc)[:=]?(\d+)/i);
  if (!lineMatch) {
    return null;
  }

  const line = Number(lineMatch[1]);
  return Number.isFinite(line) && line > 0 ? Math.trunc(line) : null;
}

function parseAttributeBlock(block: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!block) {
    return attrs;
  }

  const pattern = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const key = match[1];
    if (key) {
      attrs[key.toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    }
  }

  return attrs;
}

function sourceFileFromNode(node: GraphifyGraphNode): string {
  return asString(node.source_file) || asString(node.sourceFile);
}

function sourceLocationFromNode(node: GraphifyGraphNode): string {
  return asString(node.source_location) || asString(node.sourceLocation);
}

function nodeLabel(node: GraphifyGraphNode): string {
  const id = asString(node.id);
  return asString(node.label) || asString(node.title) || id;
}

function linkEndpointId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  return record ? asString(record.id) || asString(record.label) : "";
}

function parseTraversalNodeHits(stdout: string): GraphifyContextNodeHit[] {
  const hits = new Map<string, GraphifyContextNodeHit>();
  const pattern = /^\s*NODE\s+(.+?)(?:\s+\[([^\]]*)\])?\s*$/gim;
  let match: RegExpExecArray | null;
  let rank = 0;

  while ((match = pattern.exec(stdout)) !== null) {
    const label = compact(match[1] ?? "");
    if (!label) {
      continue;
    }

    const attrs = parseAttributeBlock(match[2]);
    const sourceFile = attrs.src || attrs.source || attrs.source_file || attrs.sourcefile;
    const sourceLocation = attrs.loc || attrs.location || attrs.source_location || attrs.sourcelocation;
    const id = attrs.id || "";
    const key = `${id}:${label}:${sourceFile ?? ""}:${sourceLocation ?? ""}`.toLowerCase();
    if (hits.has(key)) {
      continue;
    }

    rank += 1;
    hits.set(key, {
      id,
      label,
      sourceFile,
      sourceLocation,
      community: attrs.community,
      confidence: attrs.confidence || attrs.conf || attrs.confidence_score,
      rank
    });
  }

  return Array.from(hits.values()).slice(0, maxNodeHits);
}

function resolveTraversalNodeHits(parsedHits: GraphifyContextNodeHit[], graph: GraphifyGraphData): GraphifyContextNodeHit[] {
  const nodesById = new Map<string, GraphifyGraphNode>(
    graph.nodes.flatMap((node): Array<[string, GraphifyGraphNode]> => {
      const id = asString(node.id).toLowerCase();
      return id ? [[id, node]] : [];
    })
  );
  const resolved: GraphifyContextNodeHit[] = [];
  const seen = new Set<string>();

  const pushNode = (node: GraphifyGraphNode, rank: number, fallback: GraphifyContextNodeHit) => {
    const id = asString(node.id);
    const label = nodeLabel(node) || fallback.label || id;
    if (!id || !label || seen.has(id)) {
      return;
    }

    seen.add(id);
    resolved.push({
      id,
      label,
      sourceFile: sourceFileFromNode(node) || fallback.sourceFile,
      sourceLocation: sourceLocationFromNode(node) || fallback.sourceLocation,
      community: asString(node.community) || fallback.community,
      confidence: asString(node.confidence) || asString(node.confidence_score) || fallback.confidence,
      rank
    });
  };

  const exactLabelMatches = (hit: GraphifyContextNodeHit): GraphifyGraphNode[] =>
    graph.nodes.filter((node) => nodeLabel(node).toLowerCase() === hit.label.toLowerCase());

  const exactSourceMatches = (nodes: GraphifyGraphNode[], hit: GraphifyContextNodeHit): GraphifyGraphNode[] =>
    hit.sourceFile
      ? nodes.filter((node) => sourceFileFromNode(node).toLowerCase() === hit.sourceFile?.toLowerCase())
      : [];

  const exactLocationMatches = (nodes: GraphifyGraphNode[], hit: GraphifyContextNodeHit): GraphifyGraphNode[] =>
    hit.sourceLocation
      ? nodes.filter((node) => sourceLocationFromNode(node).toLowerCase() === hit.sourceLocation?.toLowerCase())
      : [];

  for (const hit of parsedHits) {
    const byId = hit.id ? nodesById.get(hit.id.toLowerCase()) : undefined;
    if (byId) {
      pushNode(byId, hit.rank, hit);
      continue;
    }

    const labelMatches = exactLabelMatches(hit);
    const sourceMatches = exactSourceMatches(labelMatches, hit);
    const locationMatches = exactLocationMatches(sourceMatches, hit);
    const matched =
      (locationMatches.length === 1 ? locationMatches[0] : undefined) ??
      (sourceMatches.length === 1 ? sourceMatches[0] : undefined) ??
      (labelMatches.length === 1 ? labelMatches[0] : undefined);

    if (matched) {
      pushNode(matched, hit.rank, hit);
    }
  }

  return resolved
    .sort((left, right) => left.rank - right.rank)
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
    .slice(0, maxNodeHits);
}

function citationFromNodeHit(hit: GraphifyContextNodeHit): GraphifyContextCitation | null {
  if (!hit.sourceFile) {
    return null;
  }

  const line = lineNumberFromLocation(hit.sourceLocation);
  return {
    sourceFile: hit.sourceFile,
    sourceLocation: hit.sourceLocation,
    label: hit.sourceLocation ? `${hit.sourceFile} ${hit.sourceLocation}` : hit.sourceFile,
    nodeId: hit.id,
    nodeLabel: hit.label,
    startLine: line ?? undefined,
    endLine: line ?? undefined
  };
}

function dedupeCitations(citations: GraphifyContextCitation[]): GraphifyContextCitation[] {
  const seen = new Map<string, GraphifyContextCitation>();
  for (const citation of citations) {
    const key = `${citation.sourceFile}:${citation.sourceLocation ?? ""}:${citation.nodeId ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, citation);
    }
  }

  return Array.from(seen.values()).slice(0, 24);
}

export function buildInlineGraphTraversalStdout(graph: GraphifyGraphData, traversalQuery: string, budget: number): string {
  const queryTokens = new Set(tokenize(traversalQuery));
  const scoredStarts = graph.nodes
    .map((node) => {
      const haystack = [...tokenize(asString(node.id)), ...tokenize(nodeLabel(node)), ...tokenize(sourceFileFromNode(node))];
      const score = haystack.reduce((sum, token) => sum + (queryTokens.has(token) ? 10 : 0), 0);
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  if (scoredStarts.length === 0) {
    throw new Error("No graph nodes matched the expanded query tokens.");
  }

  const nodeById = new Map<string, GraphifyGraphNode>(
    graph.nodes.flatMap((node): Array<[string, GraphifyGraphNode]> => {
      const id = asString(node.id);
      return id ? [[id, node]] : [];
    })
  );
  const startIds = scoredStarts.map((item) => asString(item.node.id)).filter(Boolean);
  const visited = new Set<string>(startIds);
  const queue = startIds.map((id) => ({ id, depth: 0 }));
  const selectedLinks: GraphifyGraphLink[] = [];

  while (queue.length > 0 && visited.size < maxNodeHits) {
    const current = queue.shift();
    if (!current || current.depth >= 2) {
      continue;
    }

    for (const link of graph.links) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      if (source !== current.id && target !== current.id) {
        continue;
      }

      selectedLinks.push(link);
      const next = source === current.id ? target : source;
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, depth: current.depth + 1 });
      }
    }
  }

  const selectedNodes = Array.from(visited)
    .map((id) => nodeById.get(id))
    .filter((node): node is GraphifyGraphNode => Boolean(node));
  const startLabels = scoredStarts.map((item) => nodeLabel(item.node)).filter(Boolean);
  const lines = [`Traversal: BFS depth=2 | Start: [${startLabels.map((label) => `'${label}'`).join(", ")}] | ${selectedNodes.length} nodes found`];

  for (const node of selectedNodes) {
    const label = nodeLabel(node);
    const attrs = [
      sourceFileFromNode(node) ? `src=${sourceFileFromNode(node)}` : "",
      sourceLocationFromNode(node) ? `loc=${sourceLocationFromNode(node)}` : "",
      asString(node.community) ? `community=${asString(node.community)}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`NODE ${label}${attrs ? ` [${attrs}]` : ""}`);
  }

  for (const link of selectedLinks.slice(0, maxNodeHits * 3)) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    const sourceLabel = nodeById.get(source) ? nodeLabel(nodeById.get(source) as GraphifyGraphNode) : source;
    const targetLabel = nodeById.get(target) ? nodeLabel(nodeById.get(target) as GraphifyGraphNode) : target;
    const relation = asString(link.relation) || "related_to";
    const confidence = asString(link.confidence) || "AMBIGUOUS";
    lines.push(`EDGE ${sourceLabel} --${relation} [${confidence}]--> ${targetLabel}`);
  }

  const approxCharBudget = Math.max(1000, budget * 4);
  return lines.join("\n").slice(0, approxCharBudget);
}

export const graphifyContextTestUtils = {
  buildInlineGraphTraversalStdout,
  lineNumberFromLocation,
  parseTraversalNodeHits,
  resolveTraversalNodeHits,
  tokenize
};

function normalizeCandidatePath(value: string): string {
  return value.trim().replace(/^["'`]+|["'`,.;:)]+$/g, "");
}

function extractContextPathCandidates(stdout: string, citations: GraphifyContextCitation[]): string[] {
  const candidates = new Set<string>();

  for (const citation of citations) {
    candidates.add(citation.sourceFile);
  }

  const patterns = [
    /(?:src|source|source_file|sourceFile|artifact_path|artifactPath)=["']?([^"'\]\s,}]+)/gi,
    /(?:source file|artifact path):\s*([^\n\r]+)/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stdout)) !== null) {
      const candidate = normalizeCandidatePath(match[1] ?? "");
      if (candidate) {
        candidates.add(candidate);
      }
    }
  }

  return Array.from(candidates).slice(0, maxHydratedContextFiles * 2);
}

function sliceByLocation(content: string, sourceLocation: string | undefined): string {
  const lineMatch = sourceLocation?.match(/L(\d+)/i);
  if (!lineMatch) {
    return content.slice(0, maxHydratedContextChars);
  }

  const targetLine = Math.max(1, Number(lineMatch[1]));
  if (!Number.isFinite(targetLine)) {
    return content.slice(0, maxHydratedContextChars);
  }

  const lines = content.split(/\r?\n/);
  const start = Math.max(0, targetLine - 8);
  const end = Math.min(lines.length, targetLine + 18);
  return lines.slice(start, end).join("\n").slice(0, maxHydratedContextChars);
}

function excerptTitle(relativePath: string, sourceLocation: string | undefined): string {
  return sourceLocation ? `${relativePath} ${sourceLocation}` : relativePath;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringifyMcpToolResult(result: unknown): string {
  const record = asRecord(result);
  if (!record) {
    return String(result ?? "");
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content
    .map((item) => {
      const itemRecord = asRecord(item);
      if (!itemRecord) {
        return "";
      }

      if (typeof itemRecord.text === "string") {
        return itemRecord.text;
      }

      return JSON.stringify(itemRecord);
    })
    .filter(Boolean);

  if (record.structuredContent) {
    parts.push(JSON.stringify(record.structuredContent, null, 2));
  }

  return parts.length > 0 ? parts.join("\n\n").trim() : JSON.stringify(record, null, 2);
}

export class GraphifyContextService {
  private readonly graphPath: string;
  private mcpClient: Client | null = null;
  private mcpTransport: StdioClientTransport | null = null;
  private mcpGraphMtimeMs = 0;

  constructor(
    private readonly rawVaultPath: string,
    private readonly sourceContent = new SourceContentService(rawVaultPath)
  ) {
    this.graphPath = path.join(rawVaultPath, "graphify-out", "graph.json");
  }

  async query(question: string, budget?: number): Promise<GraphifyContextResult> {
    const normalizedQuestion = question.trim();
    const normalizedBudget = normalizeBudget(budget);

    if (!normalizedQuestion) {
      throw new Error("A question is required for Graphify context retrieval.");
    }

    const expandedTokens = await this.expandQueryTokens(normalizedQuestion);
    const traversalQuery = expandedTokens.length > 0 ? expandedTokens.join(" ") : normalizedQuestion;
    return this.runGraphifyMcpTool(
      normalizedQuestion,
      traversalQuery,
      "query_graph",
      [{ question: traversalQuery, mode: "bfs", token_budget: normalizedBudget }],
      normalizedBudget,
      ["query", traversalQuery, "--budget", String(normalizedBudget)],
      expandedTokens
    );
  }

  async explain(nodeIdOrLabel: string): Promise<GraphifyContextResult> {
    const normalized = nodeIdOrLabel.trim();
    if (!normalized) {
      throw new Error("A node label is required for Graphify explain.");
    }

    return this.runGraphifyMcpTool(
      normalized,
      normalized,
      "get_node",
      [{ node_id_or_label: normalized }, { id: normalized }, { label: normalized }, { node: normalized }],
      defaultBudget,
      ["explain", normalized],
      []
    );
  }

  async tracePath(from: string, to: string): Promise<GraphifyContextResult> {
    const source = from.trim();
    const target = to.trim();
    if (!source || !target) {
      throw new Error("Both source and target node labels are required for Graphify path tracing.");
    }

    return this.runGraphifyMcpTool(
      `${source} -> ${target}`,
      `${source} -> ${target}`,
      "shortest_path",
      [
        { source, target },
        { from: source, to: target },
        { start: source, end: target },
        { source_label: source, target_label: target }
      ],
      defaultBudget,
      ["path", source, target],
      []
    );
  }

  async saveResult(input: { question: string; answer: string; type?: string | undefined; nodes?: string[] | undefined }): Promise<string> {
    const question = input.question.trim();
    const answer = input.answer.trim();
    if (!question || !answer) {
      throw new Error("Both question and answer are required to save a Graphify result.");
    }

    const type = input.type?.trim() || "query";
    const nodes = [...new Set((input.nodes ?? []).map((node) => node.trim()).filter(Boolean))].slice(0, maxNodeHits);
    const args = ["save-result", "--question", question, "--answer", answer, "--type", type];
    if (nodes.length > 0) {
      args.push("--nodes", ...nodes);
    }

    const invocations = await this.getGraphifyInvocations(args);
    const failures: string[] = [];
    for (const invocation of invocations) {
      try {
        return await this.runInvocation(invocation);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    throw new Error(["Graphify result save failed.", "Tried:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  }

  private async runGraphifyMcpTool(
    query: string,
    traversalQuery: string,
    toolName: string,
    argumentAttempts: Array<Record<string, unknown>>,
    budget: number,
    fallbackGraphifyArgs: string[],
    expandedTokens: string[]
  ): Promise<GraphifyContextResult> {
    const failures: string[] = [];

    for (const toolArgs of argumentAttempts) {
      try {
        const client = await this.ensureMcpClient();
        const result = await client.callTool(
          {
            name: toolName,
            arguments: toolArgs
          },
          undefined,
          {
            timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_MCP_TIMEOUT_MS ?? defaultMcpTimeoutMs)
          }
        );
        const stdout = stringifyMcpToolResult(result);
        return this.buildContextResult(query, stdout, budget, formatMcpTool(toolName, toolArgs), expandedTokens);
      } catch (error) {
        failures.push(`${toolName}: ${errorMessage(error)}`);
        await this.stopMcp();
      }
    }

    const fallback = await this.runGraphifyCliContextCommand(query, fallbackGraphifyArgs, budget, expandedTokens);
    if (fallback.error) {
      const inline = await this.runInlineGraphTraversal(query, traversalQuery, budget, expandedTokens).catch((error) => ({
        query,
        stdout: "",
        budget,
        command: "inline graph traversal",
        graphPath: this.graphPath,
        citations: [],
        expandedTokens,
        nodeHits: [],
        sourceChunks: [],
        sourceExcerpts: [],
        error: errorMessage(error)
      }));
      if (!inline.error) {
        return {
          ...inline,
          stdout: [
            inline.stdout,
            "",
            "Note: Graphify MCP and CLI context retrieval were unavailable, so Second Brain used the local graph.json traversal fallback.",
            ...failures.slice(0, 3).map((failure) => `- ${failure}`)
          ]
            .filter(Boolean)
            .join("\n")
        };
      }

      return {
        ...fallback,
        error: [
          "Graphify MCP context retrieval failed, and CLI fallback failed.",
          "MCP attempts:",
          ...failures.map((failure) => `- ${failure}`),
          "",
          fallback.error,
          "",
          "Inline traversal failure:",
          inline.error
        ].join("\n")
      };
    }

    return {
      ...fallback,
      stdout: [
        fallback.stdout,
        "",
        "Note: Graphify MCP context retrieval was unavailable, so Second Brain used the CLI compatibility fallback.",
        ...failures.slice(0, 3).map((failure) => `- ${failure}`)
      ]
        .filter(Boolean)
        .join("\n")
    };
  }

  private async buildContextResult(
    query: string,
    stdout: string,
    budget: number,
    command: string,
    expandedTokens: string[] = []
  ): Promise<GraphifyContextResult> {
    const graph = await this.readGraphData().catch(() => ({ nodes: [], links: [] }));
    const parsedHits = parseTraversalNodeHits(stdout);
    const nodeHits = this.resolveNodeHits(stdout, parsedHits, graph);
    const citations = dedupeCitations([
      ...nodeHits.map(citationFromNodeHit).filter((citation): citation is GraphifyContextCitation => Boolean(citation)),
      ...extractCitations(stdout)
    ]);
    const sourceChunks = await this.sourceContent.hydrate({
      nodeHits,
      expandedTokens,
      query
    });
    const sourceExcerpts = this.sourceContent.toSourceExcerpts(sourceChunks);
    const graphCards = await this.hydrateGraphCardDefinitions(stdout, citations, nodeHits, graph);
    const wikiContext = await this.hydrateWikiContext(stdout, graphCards.communityIds);
    const sourceChunkText = this.sourceContent.formatSourceChunks(sourceChunks);
    return {
      query,
      stdout: [
        expandedTokens.length > 0 ? `Query expanded to (from graph vocab, ${expandedTokens.length} tokens): [${expandedTokens.join(", ")}]` : "",
        stdout,
        graphCards.text ? `Relevant card definitions:\n${graphCards.text}` : "",
        wikiContext ? `Relevant community wiki:\n${wikiContext}` : "",
        sourceChunkText ? `Relevant source chunks:\n${sourceChunkText}` : ""
      ]
        .filter(Boolean)
        .join("\n\n"),
      budget,
      command,
      graphPath: this.graphPath,
      citations,
      expandedTokens,
      nodeHits,
      sourceChunks,
      sourceExcerpts
    };
  }

  private async runGraphifyCliContextCommand(
    query: string,
    args: string[],
    budget: number,
    expandedTokens: string[] = []
  ): Promise<GraphifyContextResult> {
    const invocations = await this.getGraphifyInvocations(args);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        const stdout = await this.runInvocation(invocation);
        return this.buildContextResult(query, stdout, budget, formatInvocation(invocation), expandedTokens);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    const error = ["Graphify context retrieval failed.", "Tried:", ...failures.map((failure) => `- ${failure}`)].join("\n");
    return {
      query,
      stdout: "",
      budget,
      command: invocations.map(formatInvocation).join("\n"),
      graphPath: this.graphPath,
      citations: [],
      expandedTokens,
      nodeHits: [],
      sourceChunks: [],
      sourceExcerpts: [],
      error
    };
  }

  private async readGraphData(): Promise<GraphifyGraphData> {
    const graph = asRecord(JSON.parse(await readFile(this.graphPath, "utf8")));
    return {
      nodes: Array.isArray(graph?.nodes) ? graph.nodes.map(asRecord).filter((node): node is GraphifyGraphNode => Boolean(node)) : [],
      links: Array.isArray(graph?.links) ? graph.links.map(asRecord).filter((link): link is GraphifyGraphLink => Boolean(link)) : []
    };
  }

  private async expandQueryTokens(query: string): Promise<string[]> {
    const graph = await this.readGraphData().catch(() => ({ nodes: [], links: [] }));
    const questionTokens = new Set(tokenize(query));
    if (questionTokens.size === 0) {
      return [];
    }

    const scored = new Map<string, number>();
    const tokenFrequency = new Map<string, number>();

    for (const node of graph.nodes) {
      const nodeTokens = new Set([
        ...tokenize(asString(node.id)),
        ...tokenize(nodeLabel(node)),
        ...tokenize(sourceFileFromNode(node))
      ]);
      let nodeScore = 0;

      for (const token of nodeTokens) {
        tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
        for (const questionToken of questionTokens) {
          if (token === questionToken) {
            nodeScore += 12;
            scored.set(token, (scored.get(token) ?? 0) + 50);
          } else if (token.length > 2 && questionToken.length > 2 && (token.includes(questionToken) || questionToken.includes(token))) {
            nodeScore += 4;
            scored.set(token, (scored.get(token) ?? 0) + 20);
          }
        }
      }

      if (nodeScore > 0) {
        for (const token of nodeTokens) {
          scored.set(token, (scored.get(token) ?? 0) + Math.min(nodeScore, 12));
        }
      }
    }

    const ranked = Array.from(scored.entries())
      .filter(([, score]) => score > 0)
      .sort((left, right) => right[1] - left[1] || (tokenFrequency.get(right[0]) ?? 0) - (tokenFrequency.get(left[0]) ?? 0))
      .map(([token]) => token);

    return ranked.slice(0, maxExpandedTokens);
  }

  private resolveNodeHits(_stdout: string, parsedHits: GraphifyContextNodeHit[], graph: GraphifyGraphData): GraphifyContextNodeHit[] {
    return resolveTraversalNodeHits(parsedHits, graph);
  }

  private async hydrateNodeSourceExcerpts(nodeHits: GraphifyContextNodeHit[]): Promise<GraphifyContextSourceExcerpt[]> {
    const bySource = new Map<string, Array<{ hit: GraphifyContextNodeHit; line: number }>>();
    for (const hit of nodeHits) {
      if (!hit.sourceFile) {
        continue;
      }

      const line = lineNumberFromLocation(hit.sourceLocation);
      if (!line) {
        continue;
      }

      const entries = bySource.get(hit.sourceFile) ?? [];
      entries.push({ hit, line });
      bySource.set(hit.sourceFile, entries);
    }

    const excerpts: GraphifyContextSourceExcerpt[] = [];
    for (const [sourceFile, entries] of bySource) {
      if (excerpts.length >= maxHydratedContextFiles) {
        break;
      }

      try {
        const resolved = this.resolveContextPath(sourceFile);
        const relativePath = path.relative(this.rawVaultPath, resolved).split(path.sep).join(path.posix.sep);
        if (!this.isReadableContextFile(resolved)) {
          continue;
        }

        const fileStat = await stat(resolved);
        if (!fileStat.isFile() || fileStat.size > maxReadableContextBytes) {
          continue;
        }

        const lines = (await readFile(resolved, "utf8")).split(/\r?\n/);
        const windows = entries
          .map(({ hit, line }) => ({
            startLine: Math.max(1, line - 10),
            endLine: Math.min(lines.length, line + 30),
            nodeIds: [hit.id],
            sourceLocation: hit.sourceLocation
          }))
          .sort((left, right) => left.startLine - right.startLine);

        const merged: Array<{ startLine: number; endLine: number; nodeIds: string[]; sourceLocation?: string | undefined }> = [];
        for (const item of windows) {
          const last = merged[merged.length - 1];
          if (last && item.startLine <= last.endLine + 5) {
            last.endLine = Math.max(last.endLine, item.endLine);
            last.nodeIds = [...new Set([...last.nodeIds, ...item.nodeIds])];
            continue;
          }
          merged.push({ ...item });
        }

        for (const item of merged) {
          if (excerpts.length >= maxHydratedContextFiles) {
            break;
          }

          const text = lines
            .slice(item.startLine - 1, item.endLine)
            .join("\n")
            .slice(0, maxHydratedContextChars)
            .trim();
          if (text) {
            excerpts.push({
              sourceFile: relativePath,
              sourceLocation: item.sourceLocation,
              startLine: item.startLine,
              endLine: item.endLine,
              nodeIds: item.nodeIds,
              text
            });
          }
        }
      } catch {
        // Keep node metadata for citations, but skip unreadable or unsafe source excerpts.
      }
    }

    return excerpts;
  }

  private formatSourceExcerpts(excerpts: GraphifyContextSourceExcerpt[]): string {
    return excerpts
      .map((excerpt) =>
        [
          `--- ${excerpt.sourceFile}${excerpt.startLine ? ` L${excerpt.startLine}-L${excerpt.endLine ?? excerpt.startLine}` : ""} ---`,
          excerpt.text
        ].join("\n")
      )
      .join("\n\n");
  }

  private async runInlineGraphTraversal(
    query: string,
    traversalQuery: string,
    budget: number,
    expandedTokens: string[]
  ): Promise<GraphifyContextResult> {
    const graph = await this.readGraphData();
    const stdout = buildInlineGraphTraversalStdout(graph, traversalQuery, budget);
    return this.buildContextResult(query, stdout, budget, "inline graph.json BFS traversal", expandedTokens);
  }

  private async ensureMcpClient(): Promise<Client> {
    const graphStat = await stat(this.graphPath).catch(() => null);
    if (!graphStat?.isFile()) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    if (this.mcpClient && this.mcpGraphMtimeMs === graphStat.mtimeMs) {
      return this.mcpClient;
    }

    await this.stopMcp();

    const invocations = await this.getGraphifyMcpInvocations();
    const failures: string[] = [];
    for (const invocation of invocations) {
      const client = new Client({
        name: "second-brain-graphify-context",
        version: "0.1.0"
      });
      const transport = new StdioClientTransport({
        command: invocation.command,
        args: invocation.args,
        cwd: this.rawVaultPath,
        env: withRuntimePathRecord(process.env),
        stderr: "pipe"
      });

      transport.stderr?.on("data", (chunk) => {
        console.warn("Graphify context MCP stderr", chunk.toString());
      });

      try {
        await client.connect(transport);
        this.mcpClient = client;
        this.mcpTransport = transport;
        this.mcpGraphMtimeMs = graphStat.mtimeMs;
        return client;
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
        await transport.close().catch(() => undefined);
      }
    }

    throw new Error(["Could not start Graphify MCP context server.", "Tried:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  }

  private async stopMcp(): Promise<void> {
    const client = this.mcpClient;
    const transport = this.mcpTransport;
    this.mcpClient = null;
    this.mcpTransport = null;
    this.mcpGraphMtimeMs = 0;

    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
  }

  private async getGraphifyMcpInvocations(): Promise<GraphifyInvocation[]> {
    const baseArgs =
      process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS !== undefined
        ? parseArgs(process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS).map((arg) => arg.replace("{graphPath}", this.graphPath))
        : ["-m", "graphify.serve", this.graphPath];
    const invocations: GraphifyInvocation[] = [];
    const configured = process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND?.trim();

    if (configured) {
      invocations.push({
        label: "SECOND_BRAIN_GRAPHIFY_MCP_COMMAND",
        command: configured,
        args: baseArgs,
        shell: isCmdShim(configured)
      });
    }

    const bundledPython = await this.findBundledGraphifyPythonCommand();
    if (bundledPython) {
      invocations.push({
        label: "bundled Graphify Python runtime",
        command: bundledPython,
        args: baseArgs,
        shell: isCmdShim(bundledPython)
      });
    }

    for (const uvCommand of runtimeUvCommands()) {
      invocations.push({
        label: `uv tool graphifyy[all] Python (${path.basename(uvCommand)})`,
        command: uvCommand,
        args: ["tool", "run", "--from", graphifyToolPackage, "python", ...baseArgs],
        shell: isCmdShim(uvCommand)
      });
    }

    const uvPython = await this.findUvToolGraphifyPythonCommand();
    if (uvPython) {
      invocations.push({
        label: "uv installed graphifyy Python",
        command: uvPython,
        args: baseArgs,
        shell: isCmdShim(uvPython)
      });
    }

    for (const pythonCommand of runtimePythonCommands()) {
      invocations.push({
        label: `${path.basename(pythonCommand)} Graphify MCP`,
        command: pythonCommand,
        args: baseArgs,
        shell: isCmdShim(pythonCommand)
      });
    }

    return uniqueRuntimeCandidates(invocations);
  }

  private async getGraphifyInvocations(graphifyArgs: string[]): Promise<GraphifyInvocation[]> {
    const invocations: GraphifyInvocation[] = [];
    const configured = process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim();

    if (configured) {
      invocations.push({
        label: "SECOND_BRAIN_GRAPHIFY_BIN",
        command: configured,
        args: graphifyArgs,
        shell: isCmdShim(configured)
      });
    }

    const bundled = await this.findBundledGraphifyCommand();
    if (bundled) {
      invocations.push({
        label: "bundled Graphify runtime",
        command: bundled,
        args: graphifyArgs,
        shell: isCmdShim(bundled)
      });
    }

    const uvInstalled = await this.findUvToolGraphifyCommand();
    if (uvInstalled) {
      invocations.push({
        label: "uv installed graphifyy",
        command: uvInstalled,
        args: graphifyArgs,
        shell: isCmdShim(uvInstalled)
      });
    }

    for (const uvCommand of runtimeUvCommands()) {
      invocations.push({
        label: `uv tool graphifyy[all] (${path.basename(uvCommand)})`,
        command: uvCommand,
        args: ["tool", "run", "--from", graphifyToolPackage, "graphify", ...graphifyArgs],
        shell: isCmdShim(uvCommand)
      });
    }

    for (const pythonCommand of runtimePythonCommands()) {
      invocations.push({
        label: `${path.basename(pythonCommand)} module`,
        command: pythonCommand,
        args: ["-m", "graphify", ...graphifyArgs],
        shell: isCmdShim(pythonCommand)
      });
    }

    for (const graphifyCommand of runtimeGraphifyCommands()) {
      invocations.push({
        label: `graphify executable (${path.basename(graphifyCommand)})`,
        command: graphifyCommand,
        args: graphifyArgs,
        shell: isCmdShim(graphifyCommand)
      });
    }

    return uniqueRuntimeCandidates(invocations);
  }

  private async findBundledGraphifyCommand(): Promise<string | null> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify.cmd") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify.exe") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify") : "",
      path.join(process.cwd(), "resources", "graphify-runtime", "bin", process.platform === "win32" ? "graphify.cmd" : "graphify")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findBundledGraphifyPythonCommand(): Promise<string | null> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "python", "python.exe") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "python", "python") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "python", "bin", "python") : "",
      path.join(process.cwd(), "resources", "graphify-runtime", "python", process.platform === "win32" ? "python.exe" : "python"),
      path.join(process.cwd(), "resources", "graphify-runtime", "python", "bin", "python")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    let uvToolDir = "";

    for (const uvCommand of runtimeUvCommands()) {
      try {
        uvToolDir = await this.execCapture(uvCommand, ["tool", "dir"], {
          cwd: this.rawVaultPath,
          shell: isCmdShim(uvCommand)
        });
        break;
      } catch {
        // Try the next uv candidate.
      }
    }

    if (!uvToolDir) {
      return null;
    }

    const candidates = [
      path.join(uvToolDir.trim().split(/\r?\n/)[0] ?? "", "graphifyy", "Scripts", "graphify.exe"),
      path.join(uvToolDir.trim().split(/\r?\n/)[0] ?? "", "graphifyy", "Scripts", "graphify.cmd"),
      path.join(uvToolDir.trim().split(/\r?\n/)[0] ?? "", "graphifyy", "bin", "graphify")
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findUvToolGraphifyPythonCommand(): Promise<string | null> {
    let uvToolDir = "";

    for (const uvCommand of runtimeUvCommands()) {
      try {
        uvToolDir = await this.execCapture(uvCommand, ["tool", "dir"], {
          cwd: this.rawVaultPath,
          shell: isCmdShim(uvCommand)
        });
        break;
      } catch {
        // Try the next uv candidate.
      }
    }

    if (!uvToolDir) {
      return null;
    }

    const root = uvToolDir.trim().split(/\r?\n/)[0] ?? "";
    const candidates = [
      path.join(root, "graphifyy", "Scripts", "python.exe"),
      path.join(root, "graphifyy", "bin", "python")
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async runInvocation(invocation: GraphifyInvocation): Promise<string> {
    return this.execCapture(invocation.command, invocation.args, {
      cwd: this.rawVaultPath,
      shell: invocation.shell,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_CONTEXT_TIMEOUT_MS ?? defaultTimeoutMs)
    });
  }

  private async hydrateContext(stdout: string, citations: GraphifyContextCitation[]): Promise<string> {
    const candidates = extractContextPathCandidates(stdout, citations);
    const hydrated: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (hydrated.length >= maxHydratedContextFiles) {
        break;
      }

      try {
        const resolved = this.resolveContextPath(candidate);
        const relativePath = path.relative(this.rawVaultPath, resolved).split(path.sep).join(path.posix.sep);
        if (seen.has(relativePath) || !this.isReadableContextFile(resolved)) {
          continue;
        }

        const fileStat = await stat(resolved);
        if (!fileStat.isFile() || fileStat.size > maxReadableContextBytes) {
          continue;
        }

        const citation = citations.find((item) => item.sourceFile === candidate || item.sourceFile === relativePath);
        const content = await readFile(resolved, "utf8");
        const excerpt = sliceByLocation(content, citation?.sourceLocation).trim();
        if (!excerpt) {
          continue;
        }

        seen.add(relativePath);
        hydrated.push([`--- ${excerptTitle(relativePath, citation?.sourceLocation)} ---`, excerpt].join("\n"));
      } catch {
        // Graphify can return labels, URLs, or binary files. Ignore anything that cannot be safely read as local text.
      }
    }

    return hydrated.join("\n\n").slice(0, maxHydratedContextFiles * (maxHydratedContextChars + 120));
  }

  private async hydrateGraphCardDefinitions(
    stdout: string,
    citations: GraphifyContextCitation[],
    nodeHits: GraphifyContextNodeHit[],
    graphData?: GraphifyGraphData | undefined
  ): Promise<{ text: string; communityIds: string[] }> {
    try {
      const graph = graphData ?? (await this.readGraphData());
      const nodes = graph.nodes;
      const haystack = stdout.toLowerCase();
      const citationSources = new Set(citations.map((citation) => citation.sourceFile));
      const hitIds = new Set(nodeHits.map((hit) => hit.id));
      const selected: string[] = [];
      const communityIds = new Set<string>();

      for (const node of nodes) {
        const id = asString(node.id);
        const label = nodeLabel(node);
        const sourceFile = sourceFileFromNode(node);
        const definition = asString(node.contextual_definition) || asString(node.flashcard_definition);
        const summary = definition || asString(node.summary) || asString(node.description);
        const community = asString(node.community);
        const matches =
          Boolean(id && hitIds.has(id)) ||
          Boolean(id && haystack.includes(id.toLowerCase())) ||
          Boolean(label && haystack.includes(label.toLowerCase())) ||
          Boolean(sourceFile && citationSources.has(sourceFile));

        if (!matches) {
          continue;
        }

        if (community) {
          communityIds.add(community);
        }

        if (summary) {
          selected.push(`- ${label}: ${compact(summary).slice(0, 520)}`);
        }

        if (selected.length >= maxCardDefinitionCount) {
          break;
        }
      }

      return {
        text: selected.join("\n"),
        communityIds: Array.from(communityIds).slice(0, maxWikiArticleCount)
      };
    } catch {
      return { text: "", communityIds: [] };
    }
  }

  private async hydrateWikiContext(stdout: string, communityIds: string[]): Promise<string> {
    const wikiRoot = path.join(this.rawVaultPath, "graphify-out", "wiki");
    let entries;

    try {
      entries = await readdir(wikiRoot, { withFileTypes: true });
    } catch {
      return "";
    }

    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => path.join(wikiRoot, entry.name));
    const scored: Array<{ score: number; filePath: string }> = [];
    const tokens = compact(stdout)
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 4)
      .slice(0, 80);

    for (const filePath of files) {
      const fileName = path.basename(filePath).toLowerCase();
      let score = fileName === "index.md" ? 1 : 0;
      for (const communityId of communityIds) {
        if (fileName.includes(communityId.toLowerCase())) {
          score += 12;
        }
      }

      try {
        const content = (await readFile(filePath, "utf8")).slice(0, maxWikiArticleChars * 2).toLowerCase();
        for (const token of tokens) {
          if (content.includes(token)) {
            score += 1;
          }
        }
      } catch {
        continue;
      }

      if (score > 0) {
        scored.push({ score, filePath });
      }
    }

    const excerpts: string[] = [];
    for (const item of scored.sort((left, right) => right.score - left.score).slice(0, maxWikiArticleCount)) {
      try {
        const relativePath = path.relative(this.rawVaultPath, item.filePath).split(path.sep).join(path.posix.sep);
        const content = (await readFile(item.filePath, "utf8")).trim();
        if (content) {
          excerpts.push([`--- ${relativePath} ---`, content.slice(0, maxWikiArticleChars)].join("\n"));
        }
      } catch {
        // Wiki exports are rebuildable, so skip unreadable files.
      }
    }

    return excerpts.join("\n\n");
  }

  private resolveContextPath(candidate: string): string {
    const normalized = candidate.split(/[\\/]/).filter(Boolean).join(path.sep);
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(this.rawVaultPath, normalized);
    const relative = path.relative(this.rawVaultPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to hydrate context outside the raw vault: ${candidate}`);
    }

    return resolved;
  }

  private isReadableContextFile(filePath: string): boolean {
    return readableContextExtensions.has(path.extname(filePath).toLowerCase());
  }

  private execCapture(command: string, args: string[], options: Pick<ExecFileOptions, "cwd" | "shell" | "timeout">): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          ...options,
          maxBuffer: maxExecBuffer,
          windowsHide: true,
          env: withRuntimePath(process.env)
        },
        (error, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

          if (error) {
            reject(
              new Error(
                [`Command: ${[command, ...args].map(quoteCommandPart).join(" ")}`, error.message, combined].filter(Boolean).join("\n\n")
              )
            );
            return;
          }

          resolve(combined);
        }
      );
    });
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

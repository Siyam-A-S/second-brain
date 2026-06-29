import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { GraphifyContextCitation, GraphifyContextResult } from "../../shared/brain";

type GraphifyInvocation = {
  label: string;
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

const graphifyToolPackage = "graphifyy[all]";
const maxExecBuffer = 4 * 1024 * 1024;
const defaultTimeoutMs = 90_000;
const defaultMcpTimeoutMs = 45_000;
const defaultBudget = 1800;
const maxHydratedContextFiles = 8;
const maxHydratedContextChars = 2800;
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

function isCmdShim(filePath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(filePath);
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

  constructor(private readonly rawVaultPath: string) {
    this.graphPath = path.join(rawVaultPath, "graphify-out", "graph.json");
  }

  async query(question: string, budget?: number): Promise<GraphifyContextResult> {
    const normalizedQuestion = question.trim();
    const normalizedBudget = normalizeBudget(budget);

    if (!normalizedQuestion) {
      throw new Error("A question is required for Graphify context retrieval.");
    }

    return this.runGraphifyMcpTool(
      normalizedQuestion,
      "query_graph",
      [{ question: normalizedQuestion, mode: "bfs", token_budget: normalizedBudget }],
      normalizedBudget,
      ["query", normalizedQuestion, "--budget", String(normalizedBudget)]
    );
  }

  async explain(nodeIdOrLabel: string): Promise<GraphifyContextResult> {
    const normalized = nodeIdOrLabel.trim();
    if (!normalized) {
      throw new Error("A node label is required for Graphify explain.");
    }

    return this.runGraphifyMcpTool(
      normalized,
      "get_node",
      [{ node_id_or_label: normalized }, { id: normalized }, { label: normalized }, { node: normalized }],
      defaultBudget,
      ["explain", normalized]
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
      "shortest_path",
      [
        { source, target },
        { from: source, to: target },
        { start: source, end: target },
        { source_label: source, target_label: target }
      ],
      defaultBudget,
      ["path", source, target]
    );
  }

  private async runGraphifyMcpTool(
    query: string,
    toolName: string,
    argumentAttempts: Array<Record<string, unknown>>,
    budget: number,
    fallbackGraphifyArgs: string[]
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
        return this.buildContextResult(query, stdout, budget, formatMcpTool(toolName, toolArgs));
      } catch (error) {
        failures.push(`${toolName}: ${errorMessage(error)}`);
        await this.stopMcp();
      }
    }

    const fallback = await this.runGraphifyCliContextCommand(query, fallbackGraphifyArgs, budget);
    if (fallback.error) {
      return {
        ...fallback,
        error: [
          "Graphify MCP context retrieval failed, and CLI fallback failed.",
          "MCP attempts:",
          ...failures.map((failure) => `- ${failure}`),
          "",
          fallback.error
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
    command: string
  ): Promise<GraphifyContextResult> {
    const citations = extractCitations(stdout);
    const hydratedContext = await this.hydrateContext(stdout, citations);
    const graphCards = await this.hydrateGraphCardDefinitions(stdout, citations);
    const wikiContext = await this.hydrateWikiContext(stdout, graphCards.communityIds);
    return {
      query,
      stdout: [
        stdout,
        graphCards.text ? `Relevant card definitions:\n${graphCards.text}` : "",
        wikiContext ? `Relevant community wiki:\n${wikiContext}` : "",
        hydratedContext ? `Relevant local excerpts:\n${hydratedContext}` : ""
      ]
        .filter(Boolean)
        .join("\n\n"),
      budget,
      command,
      graphPath: this.graphPath,
      citations
    };
  }

  private async runGraphifyCliContextCommand(query: string, args: string[], budget: number): Promise<GraphifyContextResult> {
    const invocations = await this.getGraphifyInvocations(args);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        const stdout = await this.runInvocation(invocation);
        return this.buildContextResult(query, stdout, budget, formatInvocation(invocation));
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
      error
    };
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

    invocations.push(
      {
        label: "uv tool graphifyy[all] Python",
        command: "uv",
        args: ["tool", "run", "--from", graphifyToolPackage, "python", ...baseArgs]
      }
    );

    const uvPython = await this.findUvToolGraphifyPythonCommand();
    if (uvPython) {
      invocations.push({
        label: "uv installed graphifyy Python",
        command: uvPython,
        args: baseArgs,
        shell: isCmdShim(uvPython)
      });
    }

    invocations.push(
      {
        label: "Windows py Graphify MCP",
        command: "py",
        args: baseArgs
      },
      {
        label: "python Graphify MCP",
        command: process.platform === "win32" ? "python" : "python3",
        args: baseArgs
      }
    );

    return invocations;
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

    invocations.push(
      {
        label: "uv tool graphifyy[all]",
        command: "uv",
        args: ["tool", "run", "--from", graphifyToolPackage, "graphify", ...graphifyArgs]
      },
      {
        label: "Windows py module",
        command: "py",
        args: ["-m", "graphify", ...graphifyArgs]
      },
      {
        label: "python module",
        command: process.platform === "win32" ? "python" : "python3",
        args: ["-m", "graphify", ...graphifyArgs]
      },
      {
        label: "PATH graphify",
        command: "graphify",
        args: graphifyArgs
      }
    );

    return invocations;
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

    try {
      uvToolDir = await this.execCapture("uv", ["tool", "dir"], { cwd: this.rawVaultPath });
    } catch {
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

    try {
      uvToolDir = await this.execCapture("uv", ["tool", "dir"], { cwd: this.rawVaultPath });
    } catch {
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
    citations: GraphifyContextCitation[]
  ): Promise<{ text: string; communityIds: string[] }> {
    try {
      const graph = asRecord(JSON.parse(await readFile(this.graphPath, "utf8")));
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(asRecord).filter((node): node is Record<string, unknown> => Boolean(node)) : [];
      const haystack = stdout.toLowerCase();
      const citationSources = new Set(citations.map((citation) => citation.sourceFile));
      const selected: string[] = [];
      const communityIds = new Set<string>();

      for (const node of nodes) {
        const id = asString(node.id);
        const label = asString(node.label) || asString(node.title) || id;
        const sourceFile = asString(node.source_file) || asString(node.sourceFile);
        const definition = asString(node.contextual_definition) || asString(node.flashcard_definition);
        const summary = definition || asString(node.summary) || asString(node.description);
        const community = asString(node.community);
        const matches =
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
          env: process.env
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

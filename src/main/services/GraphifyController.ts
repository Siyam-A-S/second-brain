import { createHash, randomUUID } from "node:crypto";
import { exec, execFile } from "node:child_process";
import type { ExecFileOptions, ExecOptions } from "node:child_process";
import { createReadStream } from "node:fs";
import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  AiSettings,
  CallflowHtmlDocument,
  FilesDroppedPayload,
  GraphDefinitionStatus,
  GraphHtmlDocument,
  GraphifyIngestionResult,
  GroupGraphNodesInput,
  ProcessDroppedItem,
  ResearchDependencyReport
} from "../../shared/ipc";
import { LlmService } from "./LlmService";
import type { GraphCardDefinitionInput, GraphifyMcpToolSpec } from "./LlmService";
import {
  isCmdShim,
  runtimeGraphifyCommands,
  runtimePythonCommands,
  runtimeUvCommands,
  uniqueRuntimeCandidates,
  withRuntimePath,
  withRuntimePathRecord
} from "./RuntimeCommandPaths";

type GraphifyGraph = {
  nodes?: unknown[];
  links?: unknown[];
  edges?: unknown[];
  graph?: Record<string, unknown>;
  hyperedges?: unknown[];
};
type GraphifyNodeRecord = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  title?: unknown;
  type?: unknown;
  node_type?: unknown;
  file_type?: unknown;
  summary?: unknown;
  description?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  community?: unknown;
  contextual_definition?: unknown;
};
type GraphifyLinkRecord = {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
  hyperedge_id?: unknown;
};
type GraphifyProviderConfig = {
  base_url: string;
  default_model: string;
  model_env_key: string;
  env_key: string;
  pricing: {
    input: number;
    output: number;
  };
  temperature: number;
  max_completion_tokens?: number;
};
type GraphifyLocalModelSettings = {
  temperature: number;
  maxTokens: number;
};
type AiSettingsProvider = () => Promise<AiSettings>;
type GraphifyInvocation = {
  label: string;
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

const graphifyToolPackage = "graphifyy[all]";
const updateTimeoutMs = 10 * 60 * 1_000;
const maxExecBuffer = 10 * 1024 * 1024;
const graphifyProviderName = "second-brain-local";
const defaultLocalModelEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultLocalModelName = "local-model";
const productionProxyOrigin = "https://graphify-proxy-724616525781.us-central1.run.app";
const productionProxyOpenAiBaseUrl = `${productionProxyOrigin}/v1`;
const productionProxyChatEndpoint = `${productionProxyOrigin}/chat`;
const productionProxyChatCompletionsEndpoint = `${productionProxyOrigin}/v1/chat/completions`;
const defaultGraphifyTemperature = 0.6;
const defaultGraphifyMaxTokens = 8192;
const defaultGraphifyRetryTemperature = 0;
const defaultGraphifyRetryMaxTokens = 4096;
const defaultHtmlCommand = "graphify export html --graph graphify-out/graph.json";
const defaultCallflowCommand = "graphify export callflow-html";
const sourceCommentDirectoryName = "source-comments";
const spreadsheetComponentDirectoryName = "spreadsheet-components";
const paperComponentDirectoryName = "paper-components";
const collapsibleTextExtensions = new Set([
  ".c",
  ".cjs",
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
  ".log",
  ".md",
  ".markdown",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".txt",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);
const inlineCommentExtensions = new Set([
  ".css",
  ".html",
  ".log",
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
const inlineCommentStartPattern = "<!-- second-brain:comment";
const inlineCommentEnd = "<!-- /second-brain:comment -->";

function safeFilePart(value: string): string {
  const parsed = path.parse(value);
  const base = (parsed.name || "dropped-file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16);

  return `${base || "dropped-file"}${ext}`;
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

function spreadsheetComponentFileName(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile, path.extname(sourceFile))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "spreadsheet"}-${hash}.components.md`;
}

function paperComponentDirectoryNameForSource(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile, path.extname(sourceFile))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "paper"}-${hash}`;
}

function bufferFromDroppedValue(value: unknown): Buffer | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return null;
}

function sha256Buffer(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function looksComplete(stdout: string): boolean {
  return /graph complete|graph:\s+\d+\s+nodes|report updated|outputs in|generation complete|wrote graph/i.test(stdout);
}

function parseArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function openAiBaseUrlFromChatCompletionsEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/chat\/completions$/i, "") || trimmed;
}

function numberFromEnv(value: string | undefined, fallback: number, minimum = 0): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpointHostLabel(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.trim() || "AI endpoint";
  }
}

function isProxyAiSettings(aiSettings: AiSettings): boolean {
  return aiSettings.mode === "proxy";
}

function defaultUpdateCommand(
  settings: GraphifyLocalModelSettings,
  aiSettings: AiSettings,
  writtenFileCount: number
): string {
  if (writtenFileCount > 0) {
    if (isProxyAiSettings(aiSettings)) {
      return `graphify extract . --out . --mode deep --backend ${graphifyProviderName} --max-concurrency 10`;
    }

    const concurrency = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_MAX_CONCURRENCY, 1, 1);
    const tokenBudget = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET, settings.maxTokens, 256);

    return `graphify extract . --out . --mode deep --backend ${graphifyProviderName} --max-concurrency ${concurrency} --token-budget ${tokenBudget}`;
  }

  if (isProxyAiSettings(aiSettings)) {
    return "graphify . --update --max-concurrency 10";
  }

  const concurrency = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_MAX_CONCURRENCY, 1, 1);
  const tokenBudget = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET, settings.maxTokens, 256);

  return `graphify . --update --max-concurrency ${concurrency} --token-budget ${tokenBudget}`;
}

function quoteCommandPart(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function formatInvocation(invocation: GraphifyInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteCommandPart).join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCollapsibleTextSource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return collapsibleTextExtensions.has(extension);
}

function canInlineSourceComment(filePath: string): boolean {
  return inlineCommentExtensions.has(path.extname(filePath).toLowerCase());
}

function sanitizeInlineCommentBody(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/-->/g, "- ->")
    .trim();
}

function stripInlineSourceComment(content: string): string {
  const pattern = /(?:\n{0,2})<!-- second-brain:comment[\s\S]*?<!-- \/second-brain:comment -->\n*/g;
  return content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimStart();
}

function writeInlineSourceComment(content: string, comment: string): string {
  const withoutExisting = stripInlineSourceComment(content);
  const block = [
    `${inlineCommentStartPattern} id="${randomUUID()}" updated="${new Date().toISOString()}" -->`,
    sanitizeInlineCommentBody(comment),
    inlineCommentEnd,
    ""
  ].join("\n");

  return `${block}\n${withoutExisting.trimStart()}`;
}

function readInlineSourceComment(content: string): string {
  const pattern = /<!-- second-brain:comment[\s\S]*?-->\s*([\s\S]*?)\s*<!-- \/second-brain:comment -->/;
  const match = content.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function researchDependencyStatusScript(): string {
  return [
    "import importlib, json, sys",
    "deps = [",
    "  ('Graphify', 'graphify', True, 'Graph generation and MCP server'),",
    "  ('pypdf', 'pypdf', True, 'Plain PDF text fallback'),",
    "  ('fpdf2', 'fpdf', True, 'Formatted PDF and presentation artifact rendering'),",
    "  ('PyMuPDF', 'fitz', False, 'PDF pages, images, layout blocks, and source locations'),",
    "  ('pymupdf4llm', 'pymupdf4llm', False, 'Rich PDF-to-Markdown extraction for research papers'),",
    "  ('numpy', 'numpy', False, 'Layout scoring and future research analytics'),",
    "  ('matplotlib', 'matplotlib', False, 'Future figure previews and visual summaries'),",
    "]",
    "items = []",
    "for name, import_name, required, purpose in deps:",
    "    try:",
    "        module = importlib.import_module(import_name)",
    "        version = str(getattr(module, '__version__', 'installed'))",
    "        installed = True",
    "    except Exception:",
    "        version = ''",
    "        installed = False",
    "    items.append({",
    "        'name': name,",
    "        'importName': import_name,",
    "        'installed': installed,",
    "        'version': version,",
    "        'required': required,",
    "        'purpose': purpose,",
    "        'guidance': 'Install into the Graphify tool environment with uv --with.' if not installed else '',",
    "    })",
    "print(json.dumps({'runtime': sys.executable, 'dependencies': items}, ensure_ascii=False))",
  ].join("\n");
}

function linkEndpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function normalizeGraphNodes(value: unknown): GraphifyNodeRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((node): node is GraphifyNodeRecord => Boolean(node))
    : [];
}

function normalizeGraphLinks(value: unknown): GraphifyLinkRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((link): link is GraphifyLinkRecord => Boolean(link))
    : [];
}

function normalizeSourceReference(value: string): string {
  return value.split(/[\\/]/).join(path.posix.sep).replace(/^\.?\//, "");
}

export class GraphifyController {
  private readonly graphOutPath: string;
  private readonly graphPath: string;
  private readonly graphHtmlPath: string;
  private readonly reportPath: string;
  private lastUpdate: Promise<GraphifyIngestionResult> = Promise.resolve({
    completed: true,
    writtenFileCount: 0,
    graphPath: "",
    reportPath: "",
    stdout: "",
    updatedAt: new Date(0).toISOString()
  });
  private mcpClient: Client | null = null;
  private mcpTransport: StdioClientTransport | null = null;
  private readonly llm: LlmService;
  private cardDefinitionUpdate: Promise<void> | null = null;
  private cardDefinitionQueued = false;
  private activeGraphifyProxyBaseUrl: string | null = null;
  private definitionStatus: GraphDefinitionStatus = {
    running: false,
    pendingCount: 0,
    updatedCount: 0,
    failedBatchCount: 0,
    updatedAt: new Date(0).toISOString(),
    endpointHost: ""
  };

  constructor(
    private readonly rawVaultPath: string,
    private readonly settingsProvider: AiSettingsProvider = async () => ({
      mode: "local",
      endpoint: process.env.SECOND_BRAIN_LLM_ENDPOINT ?? defaultLocalModelEndpoint,
      apiKey:
        process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
        process.env.SECOND_BRAIN_LLM_API_KEY ??
        process.env.OPENAI_API_KEY ??
        "second-brain-local",
      model: process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? defaultLocalModelName,
      updatedAt: new Date().toISOString()
    })
  ) {
    this.graphOutPath = path.join(rawVaultPath, "graphify-out");
    this.graphPath = path.join(this.graphOutPath, "graph.json");
    this.graphHtmlPath = path.join(this.graphOutPath, "graph.html");
    this.reportPath = path.join(this.graphOutPath, "GRAPH_REPORT.md");
    this.llm = new LlmService(settingsProvider);
  }

  getRawVaultPath(): string {
    return this.rawVaultPath;
  }

  getGraphPath(): string {
    return this.graphPath;
  }

  getGraphHtmlPath(): string {
    return this.graphHtmlPath;
  }

  getDefinitionStatus(): GraphDefinitionStatus {
    return { ...this.definitionStatus };
  }

  getMcpServerCommand(): string {
    return `${process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND ?? "python"} -m graphify.serve ${this.graphPath}`;
  }

  async readGraphHtml(): Promise<GraphHtmlDocument> {
    await this.ensureGraphHtml();

    const [html, htmlStat] = await Promise.all([readFile(this.graphHtmlPath, "utf8"), stat(this.graphHtmlPath)]);

    return {
      html,
      path: this.graphHtmlPath,
      updatedAt: htmlStat.mtime.toISOString()
    };
  }

  async generateCallflowHtml(nodeId: string): Promise<CallflowHtmlDocument> {
    await this.initialize();
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const settings = this.getGraphifyLocalModelSettings();
    const aiSettings = await this.getAiSettings();
    const command = (
      process.env.SECOND_BRAIN_GRAPHIFY_CALLFLOW_COMMAND ?? defaultCallflowCommand
    ).replace(/\{nodeId\}/g, nodeId);
    const before = await this.listCallflowHtmlCandidates();
    const stdout =
      command === defaultCallflowCommand
        ? await this.runGraphifyCli(["export", "callflow-html"], settings, "Graphify call flow export failed", aiSettings)
        : await this.runGraphifyCommand(command, settings, "Graphify call flow export failed", aiSettings);
    const after = await this.listCallflowHtmlCandidates();
    const beforePaths = new Set(before.map((candidate) => candidate.path));
    const created = after.find((candidate) => !beforePaths.has(candidate.path)) ?? after[0];

    if (!created) {
      throw new Error(
        [
          "Graphify call flow export finished but did not create an HTML artifact.",
          `Command: ${command}`,
          stdout ? `Graphify output:\n${stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return {
      html: await readFile(created.path, "utf8"),
      path: created.path,
      updatedAt: created.updatedAt,
      stdout
    };
  }

  async initialize(): Promise<void> {
    await mkdir(this.rawVaultPath, { recursive: true });
    await this.ensureGraphifyProviderConfig();
  }

  async getResearchDependencyStatus(): Promise<ResearchDependencyReport> {
    const checkedAt = new Date().toISOString();
    const invocations = await this.getGraphifyPythonInvocations(["-c", researchDependencyStatusScript()]);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        const stdout = await this.runGraphifyUtilityInvocation(invocation);
        const parsed = JSON.parse(stdout) as Pick<ResearchDependencyReport, "runtime" | "dependencies">;
        const missingRequired = parsed.dependencies.filter((dependency) => dependency.required && !dependency.installed);
        const missingRich = parsed.dependencies.filter((dependency) => !dependency.required && !dependency.installed);

        return {
          available: missingRequired.length === 0,
          checkedAt,
          runtime: parsed.runtime,
          dependencies: parsed.dependencies,
          guidance: [
            missingRequired.length > 0
              ? "Install the base Graphify PDF runtime and artifact renderer: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\" && python3 -m pip install --user --upgrade fpdf2 --break-system-packages"
              : "",
            missingRich.length > 0
              ? "For rich research-paper extraction, install the full Graphify tool environment: uv tool install --upgrade \"graphifyy[all]\""
              : "",
            process.env.SECOND_BRAIN_PAPER_COMPONENTS === "0"
              ? "Paper component extraction is disabled by SECOND_BRAIN_PAPER_COMPONENTS=0."
              : ""
          ].filter(Boolean)
        };
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    return {
      available: false,
      checkedAt,
      runtime: "",
      dependencies: [],
      guidance: [
        "Second Brain could not inspect the Graphify Python runtime.",
        "Install Graphify with: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\"",
        ...failures.map((failure) => `- ${failure}`)
      ]
    };
  }

  async ingestFilesDrop(payload: FilesDroppedPayload): Promise<GraphifyIngestionResult> {
    const fileItems = payload.files.map((file) => ({
      name: file.name,
      path: file.path,
      type: file.type,
      buffer: file.buffer
    }));
    const textItems = payload.files.length === 0 && payload.text
      ? [
          {
            name: "dropped-text.txt",
            type: "text/plain",
            text: payload.text
          }
        ]
      : [];

    return this.ingestDroppedItems([...fileItems, ...textItems]);
  }

  async removeSource(sourceFile: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    await rm(sourcePath, { force: true });
    await this.removeSourceComment(sourceFile);

    if (!(await this.hasRawSourceFiles())) {
      return this.writeEmptyGraphResult();
    }

    return this.queueUpdate(0);
  }

  async collapseSourceInto(sourceFile: string, targetSourceFile: string): Promise<GraphifyIngestionResult> {
    await this.initialize();

    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const targetPath = this.resolveRemovableSourcePath(targetSourceFile);

    if (sourcePath === targetPath) {
      throw new Error("Choose a different source to collapse into.");
    }

    if (!isCollapsibleTextSource(sourcePath) || !isCollapsibleTextSource(targetPath)) {
      throw new Error("Source collapse currently supports text-like files only.");
    }

    const [sourceContent, targetContent] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(targetPath, "utf8")
    ]);
    const collapsedBlock = [
      "",
      "",
      "---",
      `Collapsed source: ${path.basename(sourcePath)}`,
      `Collapsed at: ${new Date().toISOString()}`,
      "---",
      "",
      sourceContent.trim(),
      ""
    ].join("\n");

    await writeFile(targetPath, `${targetContent.trimEnd()}${collapsedBlock}`, "utf8");
    await this.mergeSourceComment(sourceFile, targetSourceFile);
    await rm(sourcePath, { force: true });

    return this.queueUpdate(0);
  }

  async groupGraphNodes(input: GroupGraphNodesInput): Promise<GraphifyIngestionResult> {
    await this.initialize();

    const nodeIds = Array.from(new Set(input.nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean)));
    if (nodeIds.length < 3) {
      throw new Error("Choose at least three graph nodes for a group relationship.");
    }

    const label = input.label.trim() || "Group Relationship";
    const relation =
      input.relation
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "grouped_with";
    const graph = JSON.parse(await readFile(this.graphPath, "utf8")) as GraphifyGraph;
    const knownNodeIds = new Set(normalizeGraphNodes(graph.nodes).map((node) => asString(node.id)).filter(Boolean));
    const missing = nodeIds.filter((nodeId) => !knownNodeIds.has(nodeId));
    if (missing.length > 0) {
      throw new Error(`Graph nodes were not found: ${missing.slice(0, 6).join(", ")}`);
    }

    const backupPath = path.join(this.graphOutPath, `graph.backup-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await copyFile(this.graphPath, backupPath);

    const hyperedgeId = `manual_group_${createHash("sha1")
      .update(`${label}:${relation}:${nodeIds.join("|")}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12)}`;
    const now = new Date().toISOString();
    const hyperedge = {
      id: hyperedgeId,
      label,
      nodes: nodeIds,
      relation,
      confidence: "EXTRACTED",
      confidence_score: 1,
      source_file: `manual-hyperedge:${hyperedgeId}`,
      captured_at: now
    };

    const existingHyperedges = this.mergeHyperedges(graph, hyperedge);
    graph.hyperedges = existingHyperedges;
    graph.graph = {
      ...(asRecord(graph.graph) ?? {}),
      hyperedges: existingHyperedges
    };

    const linkKey = graph.links ? "links" : "edges";
    const links = normalizeGraphLinks(graph[linkKey]);
    for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
        const source = nodeIds[leftIndex];
        const target = nodeIds[rightIndex];
        const exists = links.some(
          (link) =>
            linkEndpointId(link.source) === source &&
            linkEndpointId(link.target) === target &&
            asString(link.hyperedge_id) === hyperedgeId
        );

        if (!exists) {
          links.push({
            source,
            target,
            relation: "grouped_with",
            hyperedge_id: hyperedgeId,
            label,
            weight: 0.35,
            confidence: "EXTRACTED",
            confidence_score: 1,
            source_file: `manual-hyperedge:${hyperedgeId}`,
            captured_at: now
          } as GraphifyLinkRecord);
        }
      }
    }
    graph[linkKey] = links;

    try {
      await writeFile(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
      const settings = this.getGraphifyLocalModelSettings();
      const aiSettings = await this.getAiSettings();
      const clusterStdout = await this.runGraphifyCli(["cluster-only", "."], settings, "Graphify cluster-only failed", aiSettings);
      const htmlStdout = await this.ensureGraphHtml(settings, aiSettings);
      const wikiStdout = await this.refreshWikiExport(settings, aiSettings);
      await this.stopMcp();

      const counts = await this.readGraphCounts();
      return {
        completed: true,
        writtenFileCount: 0,
        graphPath: this.graphPath,
        reportPath: this.reportPath,
        ...counts,
        stdout: [
          `Added group relationship "${label}" over ${nodeIds.length} graph nodes.`,
          `Graph backup: ${backupPath}`,
          clusterStdout ? `Graphify cluster-only:\n${clusterStdout}` : "",
          htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : "",
          wikiStdout ? `Graphify wiki export:\n${wikiStdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n"),
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      await copyFile(backupPath, this.graphPath);
      throw error;
    }
  }

  async renameSource(sourceFile: string, newName: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const trimmedName = newName.trim();

    if (!trimmedName) {
      throw new Error("Enter a source name.");
    }

    const parsedCurrent = path.parse(sourcePath);
    const parsedNext = path.parse(trimmedName);
    const nextFileName = safeFilePart(parsedNext.ext ? parsedNext.base : `${parsedNext.name || trimmedName}${parsedCurrent.ext}`);
    const nextPath = path.join(parsedCurrent.dir, nextFileName);

    if (sourcePath === nextPath) {
      throw new Error("Enter a different source name.");
    }

    try {
      await stat(nextPath);
      throw new Error(`A source named ${nextFileName} already exists.`);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    const nextSourceFile = path.relative(this.rawVaultPath, nextPath).split(path.sep).join(path.posix.sep);
    const graph = JSON.parse(await readFile(this.graphPath, "utf8")) as GraphifyGraph;
    const patchedGraph = this.patchGraphSourceReferences(graph, sourceFile, nextSourceFile) as GraphifyGraph;

    await rename(sourcePath, nextPath);
    try {
      await this.renameSourceComment(sourceFile, nextSourceFile);
      return await this.writeGraphWithOrganizationRefresh(patchedGraph, [
        `Renamed source "${sourceFile}" to "${nextSourceFile}" without re-extracting the vault.`
      ]);
    } catch (error) {
      try {
        await rename(nextPath, sourcePath);
      } catch {
        // Leave the original error visible; the graph backup was restored by the refresh helper.
      }
      throw error;
    }
  }

  async commentSource(sourceFile: string, comment: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const trimmed = comment.trim();

    if (canInlineSourceComment(sourcePath)) {
      const current = await readFile(sourcePath, "utf8");
      await writeFile(sourcePath, trimmed ? writeInlineSourceComment(current, trimmed) : stripInlineSourceComment(current), "utf8");
      await this.removeSourceComment(sourceFile);
    } else if (!trimmed) {
      await this.removeSourceComment(sourceFile);
    } else {
      const commentPath = this.resolveSourceCommentPath(sourceFile);
      await mkdir(path.dirname(commentPath), { recursive: true });
      await writeFile(
        commentPath,
        [
          `# Source context: ${path.basename(sourcePath)}`,
          "",
          `Source file: ${path.relative(this.rawVaultPath, sourcePath)}`,
          `Updated: ${new Date().toISOString()}`,
          "",
          trimmed,
          ""
        ].join("\n"),
        "utf8"
      );
    }

    const graph = JSON.parse(await readFile(this.graphPath, "utf8")) as GraphifyGraph;
    this.addGraphSourceComment(graph, sourceFile, trimmed);
    return this.writeGraphWithOrganizationRefresh(graph, [
      trimmed
        ? `Saved source comment for "${sourceFile}" and attached it to matching graph nodes without re-extracting the vault.`
        : `Removed source comment for "${sourceFile}" without re-extracting the vault.`
    ]);
  }

  async ingestDroppedItems(items: ProcessDroppedItem[]): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const writtenFiles = await this.writeRawItems(items);

    if (writtenFiles.length === 0) {
      if (await this.fileExists(this.graphPath)) {
        return this.currentGraphResult(0, "Dropped content is already present in the raw vault; Graphify update was skipped.");
      }

      return this.queueUpdate(0);
    }

    return this.queueUpdate(writtenFiles.length);
  }

  async listMcpTools(): Promise<GraphifyMcpToolSpec[]> {
    const client = await this.ensureMcpClient();
    const result = await client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  async stopMcp(): Promise<void> {
    const client = this.mcpClient;
    this.mcpClient = null;

    if (client) {
      await client.close();
    }

    if (this.mcpTransport) {
      await this.mcpTransport.close();
      this.mcpTransport = null;
    }
  }

  private async writeRawItems(items: ProcessDroppedItem[]): Promise<string[]> {
    const written: string[] = [];

    for (const [index, item] of items.entries()) {
      const buffer = bufferFromDroppedValue(item.buffer);

      if (buffer) {
        const outputPath = this.createRawDestination(item, index, sha256Buffer(buffer));
        if (await this.fileExists(outputPath)) {
          continue;
        }

        await writeFile(outputPath, buffer);
        written.push(outputPath);
        continue;
      }

      if (item.path) {
        try {
          const sourcePath = path.resolve(item.path);
          const relativeToRaw = path.relative(this.rawVaultPath, sourcePath);
          if (relativeToRaw && !relativeToRaw.startsWith("..") && !path.isAbsolute(relativeToRaw)) {
            continue;
          }

          const fileStat = await stat(item.path);
          if (fileStat.isFile()) {
            const outputPath = this.createRawDestination(item, index, await sha256File(item.path));
            if (await this.fileExists(outputPath)) {
              continue;
            }

            await copyFile(item.path, outputPath);
            written.push(outputPath);
            continue;
          }
        } catch {
          // Fall through to text/content handling below.
        }
      }

      const text = item.text ?? item.content;
      if (text?.trim()) {
        const outputPath = this.createRawDestination(item, index, sha256Buffer(text));
        if (await this.fileExists(outputPath)) {
          continue;
        }

        await writeFile(outputPath, text, "utf8");
        written.push(outputPath);
      }
    }

    return written;
  }

  private async isGeneratedOutputFresh(sourcePath: string, outputPath: string): Promise<boolean> {
    try {
      const [sourceStat, outputStat] = await Promise.all([stat(sourcePath), stat(outputPath)]);
      return outputStat.mtimeMs >= sourceStat.mtimeMs;
    } catch {
      return false;
    }
  }

  private createRawDestination(item: ProcessDroppedItem, index: number, contentHash: string): string {
    const fallbackName = item.text || item.content ? "dropped-text.txt" : `dropped-file-${index + 1}`;
    const safeName = safeFilePart(item.name ?? (item.path ? path.basename(item.path) : fallbackName));
    const parsed = path.parse(safeName);
    const unique = `${parsed.name}-${contentHash.slice(0, 16)}${parsed.ext || ".txt"}`;

    return path.join(this.rawVaultPath, unique);
  }

  private queueUpdate(writtenFileCount: number): Promise<GraphifyIngestionResult> {
    this.lastUpdate = this.lastUpdate
      .catch(() => ({
        completed: true,
        writtenFileCount: 0,
        graphPath: this.graphPath,
        reportPath: this.reportPath,
        stdout: "",
        updatedAt: new Date().toISOString()
      }))
      .then(() => this.runGraphifyUpdate(writtenFileCount));

    return this.lastUpdate;
  }

  private async currentGraphResult(writtenFileCount: number, stdout: string): Promise<GraphifyIngestionResult> {
    const counts = await this.readGraphCounts();

    return {
      completed: true,
      writtenFileCount,
      graphPath: this.graphPath,
      reportPath: this.reportPath,
      ...counts,
      stdout,
      updatedAt: new Date().toISOString()
    };
  }

  private async runGraphifyUpdate(writtenFileCount: number): Promise<GraphifyIngestionResult> {
    const primarySettings = this.getGraphifyLocalModelSettings();
    const aiSettings = await this.getAiSettings();
    return this.withGraphifyProxyAdapter(aiSettings, async () => {
      await this.ensureGraphifyProviderConfig(primarySettings, aiSettings);

      const command =
        (writtenFileCount > 0 ? process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND : undefined) ??
        process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND ??
        defaultUpdateCommand(primarySettings, aiSettings, writtenFileCount);
      const graphMtimeBefore = await this.fileMtimeMs(this.graphPath);
      let stdout: string;

      try {
        stdout = await this.runGraphifyCommandWithRetry(command, primarySettings, aiSettings);
      } catch (error) {
        const detail = errorMessage(error);
        if (await this.canUsePartialGraphifyResult(detail, graphMtimeBefore)) {
          stdout = [
            "Graphify reported partial semantic extraction failures, but graph.json was updated.",
            "Second Brain accepted the partial graph so later drops can continue.",
            detail
          ].join("\n\n");
        } else {
          throw error;
        }
      }
      const graphExists = await this.fileExists(this.graphPath);

      if (!graphExists) {
        throw new Error(`Graphify finished but did not create ${this.graphPath}.`);
      }

      const htmlStdout = await this.ensureGraphHtml(primarySettings, aiSettings);
      const wikiStdout = await this.refreshWikiExport(primarySettings, aiSettings);
      const combinedStdout = [
        stdout,
        process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0" ? "" : "Graphify card definitions scheduled in background.",
        htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : "",
        wikiStdout ? `Graphify wiki export:\n${wikiStdout}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");

      await this.stopMcp();

      const counts = await this.readGraphCounts();
      this.scheduleGraphCardDefinitions();

      return {
        completed: looksComplete(combinedStdout) || graphExists,
        writtenFileCount,
        graphPath: this.graphPath,
        reportPath: this.reportPath,
        ...counts,
        stdout: combinedStdout,
        updatedAt: new Date().toISOString()
      };
    });
  }

  private async ensureGraphHtml(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<string> {
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const shouldExport = await this.shouldExportGraphHtml();
    if (!shouldExport) {
      return "";
    }

    const command = process.env.SECOND_BRAIN_GRAPHIFY_HTML_COMMAND ?? defaultHtmlCommand;
    const stdout = await this.runGraphifyCommand(
      command,
      settings,
      "Graphify HTML export failed",
      aiSettings ?? (await this.getAiSettings())
    );

    if (!(await this.fileExists(this.graphHtmlPath))) {
      throw new Error(
        [
          `Graphify HTML export finished but did not create ${this.graphHtmlPath}.`,
          stdout ? `Graphify output:\n${stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return stdout;
  }

  private async refreshWikiExport(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<string> {
    if (process.env.SECOND_BRAIN_GRAPHIFY_WIKI === "0") {
      return "";
    }

    const effectiveAiSettings = aiSettings ?? (await this.getAiSettings());
    try {
      return await this.runGraphifyCli(["export", "wiki", "--graph", "graphify-out/graph.json"], settings, "Graphify wiki export failed", effectiveAiSettings);
    } catch (firstError) {
      try {
        const clusterStdout = await this.runGraphifyCli(["cluster-only", "."], settings, "Graphify cluster-only failed before wiki export", effectiveAiSettings);
        const wikiStdout = await this.runGraphifyCli(["export", "wiki", "--graph", "graphify-out/graph.json"], settings, "Graphify wiki export failed", effectiveAiSettings);
        return [clusterStdout ? `Graphify cluster-only before wiki export:\n${clusterStdout}` : "", wikiStdout]
          .filter(Boolean)
          .join("\n\n");
      } catch (secondError) {
        return [
          "Graphify wiki export skipped.",
          `Initial failure: ${errorMessage(firstError)}`,
          `Retry failure: ${errorMessage(secondError)}`
        ].join("\n");
      }
    }
  }

  private mergeHyperedges(graph: GraphifyGraph, nextHyperedge: Record<string, unknown>): Array<Record<string, unknown>> {
    const existing = [
      ...(Array.isArray(graph.hyperedges) ? graph.hyperedges : []),
      ...(Array.isArray(asRecord(graph.graph)?.hyperedges) ? (asRecord(graph.graph)?.hyperedges as unknown[]) : [])
    ];
    const byId = new Map<string, Record<string, unknown>>();

    for (const item of existing) {
      const record = asRecord(item);
      const id = asString(record?.id);
      if (record && id) {
        byId.set(id, record);
      }
    }

    byId.set(asString(nextHyperedge.id), nextHyperedge);
    return Array.from(byId.values());
  }

  private patchGraphSourceReferences(value: unknown, previousSourceFile: string, nextSourceFile: string): unknown {
    const previous = normalizeSourceReference(previousSourceFile);
    const next = normalizeSourceReference(nextSourceFile);

    if (Array.isArray(value)) {
      return value.map((item) => this.patchGraphSourceReferences(item, previous, next));
    }

    const record = asRecord(value);
    if (!record) {
      return value;
    }

    const patched: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(record)) {
      if (typeof raw === "string") {
        const normalized = normalizeSourceReference(raw);
        if ((key === "source_file" || key === "sourceFile") && normalized === previous) {
          patched[key] = next;
          continue;
        }

        if ((key === "artifact_path" || key === "artifactPath") && normalized === previous) {
          patched[key] = next;
          continue;
        }

        if ((key === "source_location" || key === "sourceLocation") && normalized.startsWith(previous)) {
          patched[key] = `${next}${raw.slice(previousSourceFile.length)}`;
          continue;
        }
      }

      patched[key] = this.patchGraphSourceReferences(raw, previous, next);
    }

    return patched;
  }

  private addGraphSourceComment(graph: GraphifyGraph, sourceFile: string, comment: string): void {
    const normalizedSource = normalizeSourceReference(sourceFile);
    const nodes = normalizeGraphNodes(graph.nodes);
    const links = normalizeGraphLinks(graph.links ?? graph.edges);
    const now = new Date().toISOString();
    const matchingNodes = nodes.filter((node) => {
      const nodeSource = normalizeSourceReference(asString(node.source_file) || asString(node.sourceFile));
      return nodeSource === normalizedSource;
    });

    for (const node of matchingNodes) {
      node.user_comment = comment || undefined;
      node.user_comment_updated_at = comment ? now : undefined;
    }

    const sourceComments = asRecord(graph.graph)?.source_comments;
    graph.graph = {
      ...(asRecord(graph.graph) ?? {}),
      source_comments: {
        ...(asRecord(sourceComments) ?? {}),
        [normalizedSource]: comment
          ? {
              comment,
              updated_at: now
            }
          : undefined
      }
    };

    const commentNodeId = `source_comment:${createHash("sha1").update(normalizedSource).digest("hex").slice(0, 12)}`;
    const remainingNodes = nodes.filter((node) => asString(node.id) !== commentNodeId);
    const remainingLinks = links.filter((link) => {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      return source !== commentNodeId && target !== commentNodeId;
    });

    if (comment) {
      remainingNodes.push({
        id: commentNodeId,
        label: `Comment: ${path.basename(normalizedSource)}`,
        type: "source_comment",
        summary: comment,
        source_file: normalizedSource,
        source_location: normalizedSource,
        confidence: "EXTRACTED",
        confidence_score: 1,
        updated_at: now
      });

      for (const node of matchingNodes.slice(0, 24)) {
        remainingLinks.push({
          source: commentNodeId,
          target: asString(node.id),
          relation: "comments_on",
          confidence: "EXTRACTED",
          confidence_score: 1,
          source_file: normalizedSource,
          updated_at: now
        } as GraphifyLinkRecord);
      }
    }

    graph.nodes = remainingNodes;
    if (graph.links) {
      graph.links = remainingLinks;
    } else {
      graph.edges = remainingLinks;
    }
  }

  private async writeGraphWithOrganizationRefresh(
    graph: GraphifyGraph,
    successLines: string[]
  ): Promise<GraphifyIngestionResult> {
    const backupPath = path.join(this.graphOutPath, `graph.backup-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await copyFile(this.graphPath, backupPath);

    try {
      await writeFile(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
      const settings = this.getGraphifyLocalModelSettings();
      const aiSettings = await this.getAiSettings();
      const clusterStdout = await this.runGraphifyCli(["cluster-only", "."], settings, "Graphify cluster-only failed", aiSettings);
      const htmlStdout = await this.ensureGraphHtml(settings, aiSettings);
      const wikiStdout = await this.refreshWikiExport(settings, aiSettings);
      await this.stopMcp();
      const counts = await this.readGraphCounts();

      return {
        completed: true,
        writtenFileCount: 0,
        graphPath: this.graphPath,
        reportPath: this.reportPath,
        ...counts,
        stdout: [
          ...successLines,
          `Graph backup: ${backupPath}`,
          clusterStdout ? `Graphify cluster-only:\n${clusterStdout}` : "",
          htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : "",
          wikiStdout ? `Graphify wiki export:\n${wikiStdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n"),
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      await copyFile(backupPath, this.graphPath);
      throw error;
    }
  }

  private async enrichGraphCardDefinitions(): Promise<string> {
    if (process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0") {
      this.updateDefinitionStatus({
        running: false,
        pendingCount: 0,
        updatedCount: 0,
        failedBatchCount: 0,
        lastError: "Card definitions are disabled by SECOND_BRAIN_CARD_DEFINITIONS=0.",
        completedAt: new Date().toISOString()
      });
      return "";
    }

    const aiSettings = await this.getAiSettings();
    const endpointHost = endpointHostLabel(aiSettings.endpoint);
    this.updateDefinitionStatus({
      running: true,
      pendingCount: 0,
      updatedCount: 0,
      failedBatchCount: 0,
      lastError: undefined,
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      endpointHost
    });

    const graphVersion = (await stat(this.graphPath)).mtimeMs;
    const graph = asRecord(JSON.parse(await readFile(this.graphPath, "utf8")));
    if (!graph) {
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        lastError: "Graphify graph.json did not contain an object."
      });
      return "";
    }

    const nodes = normalizeGraphNodes(graph.nodes);
    if (nodes.length === 0) {
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        pendingCount: 0
      });
      return "";
    }

    const nodeLabels = new Map(
      nodes.map((node, index) => {
        const id = asString(node.id) || `graph-node-${index}`;
        return [id, asString(node.label) || asString(node.title) || id] as const;
      })
    );
    const related = this.buildRelatedNodeMap(normalizeGraphLinks(graph.links ?? graph.edges), nodeLabels);
    const cards = nodes
      .filter((node) => !asString(node.contextual_definition))
      .map((node, index) => this.toDefinitionInput(node, index, related))
      .filter((card): card is GraphCardDefinitionInput => Boolean(card));
    const maxCardsPerPass = Math.max(1, numberFromEnv(process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS, 24, 1));
    const cardsForThisPass = cards.slice(0, maxCardsPerPass);
    const batchSize = Math.max(1, numberFromEnv(process.env.SECOND_BRAIN_CARD_DEFINITION_BATCH_SIZE, 8, 1));
    let updatedCount = 0;
    let failedBatchCount = 0;
    let lastError = "";

    if (cards.length === 0) {
      this.updateDefinitionStatus({
        running: false,
        pendingCount: 0,
        updatedCount: 0,
        failedBatchCount: 0,
        completedAt: new Date().toISOString()
      });
      return "Graphify card definitions are already current.";
    }

    this.updateDefinitionStatus({
      pendingCount: cards.length,
      updatedCount,
      failedBatchCount
    });

    for (const batch of chunkArray(cardsForThisPass, batchSize)) {
      try {
        const definitions = await this.llm.defineGraphCards(batch);
        const definitionById = new Map(definitions.map((definition) => [definition.id, definition.definition]));

        for (const node of nodes) {
          const id = asString(node.id);
          const definition = id ? definitionById.get(id) : undefined;

          if (definition) {
            node.contextual_definition = definition;
            updatedCount += 1;
          }
        }
      } catch (error) {
        failedBatchCount += 1;
        lastError = errorMessage(error);
        console.warn("Graph card definition batch failed; leaving Graphify summaries in place.", error);
      }

      this.updateDefinitionStatus({
        pendingCount: Math.max(0, cards.length - updatedCount),
        updatedCount,
        failedBatchCount,
        lastError: lastError || undefined
      });
    }

    graph.nodes = nodes;

    if ((await stat(this.graphPath)).mtimeMs !== graphVersion) {
      this.cardDefinitionQueued = true;
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        lastError: "Graph changed while definitions were running; a fresh definition pass was queued."
      });
      return "Graphify card definitions skipped because a newer graph was written.";
    }

    await writeFile(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    void this.refreshWikiExport(this.getGraphifyLocalModelSettings(), aiSettings).catch((error) => {
      console.warn("Graphify wiki export after card definitions failed.", error);
    });
    this.updateDefinitionStatus({
      running: false,
      pendingCount: Math.max(0, cards.length - updatedCount),
      updatedCount,
      failedBatchCount,
      lastError: lastError || undefined,
      completedAt: new Date().toISOString()
    });

    return [
      `Graphify card definitions: ${updatedCount}/${cardsForThisPass.length} cards enriched this pass.`,
      cards.length > cardsForThisPass.length ? `${cards.length - cardsForThisPass.length} cards remain for later passes.` : "",
      failedBatchCount > 0 ? `${failedBatchCount} definition batch${failedBatchCount === 1 ? "" : "es"} failed.` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  private scheduleGraphCardDefinitions(): void {
    if (process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0") {
      return;
    }

    if (this.cardDefinitionUpdate) {
      this.cardDefinitionQueued = true;
      return;
    }

    this.cardDefinitionUpdate = this.enrichGraphCardDefinitions()
      .then((message) => {
        if (message) {
          console.info(message);
        }
      })
      .catch((error) => {
        this.updateDefinitionStatus({
          running: false,
          failedBatchCount: this.definitionStatus.failedBatchCount + 1,
          lastError: errorMessage(error),
          completedAt: new Date().toISOString()
        });
        console.warn("Graphify card definition background pass failed; Board will use Graphify summaries.", error);
      })
      .finally(() => {
        this.cardDefinitionUpdate = null;

        if (this.cardDefinitionQueued) {
          this.cardDefinitionQueued = false;
          this.scheduleGraphCardDefinitions();
        }
      });
  }

  private updateDefinitionStatus(patch: Partial<GraphDefinitionStatus>): void {
    this.definitionStatus = {
      ...this.definitionStatus,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  private buildRelatedNodeMap(
    links: GraphifyLinkRecord[],
    labels: Map<string, string>
  ): Map<string, string[]> {
    const related = new Map<string, string[]>();

    for (const link of links) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);

      if (!source || !target) {
        continue;
      }

      related.set(source, [...(related.get(source) ?? []), labels.get(target) ?? target]);
      related.set(target, [...(related.get(target) ?? []), labels.get(source) ?? source]);
    }

    return related;
  }

  private toDefinitionInput(
    node: GraphifyNodeRecord,
    index: number,
    related: Map<string, string[]>
  ): GraphCardDefinitionInput | null {
    const id = asString(node.id) || `graph-node-${index}`;
    const title = asString(node.label) || asString(node.title) || id;

    if (!title) {
      return null;
    }

    return {
      id,
      title,
      type: asString(node.type) || asString(node.node_type) || asString(node.file_type) || "entity",
      summary: asString(node.summary) || asString(node.description) || asString(node.source_location) || title,
      sourceFile: asString(node.source_file) || asString(node.sourceFile),
      sourceContext: asString(node.source_location) || asString(node.description) || asString(node.summary),
      community: asString(node.community) || "unclustered",
      related: Array.from(new Set(related.get(id) ?? [])).slice(0, 6)
    };
  }

  private async shouldExportGraphHtml(): Promise<boolean> {
    try {
      const [graphStat, htmlStat] = await Promise.all([stat(this.graphPath), stat(this.graphHtmlPath)]);
      return htmlStat.mtimeMs + 1000 < graphStat.mtimeMs;
    } catch {
      return true;
    }
  }

  private async runGraphifyCommandWithRetry(
    command: string,
    primarySettings: GraphifyLocalModelSettings,
    aiSettings: AiSettings
  ): Promise<string> {
    try {
      return await this.runGraphifyCommand(command, primarySettings, "Graphify ingestion failed", aiSettings);
    } catch (error) {
      const primaryError = errorMessage(error);

      if (isProxyAiSettings(aiSettings) || !this.canRetryGraphifyCommand() || !this.shouldRetryWithStrictJson(primaryError)) {
        throw this.enrichGraphifyError(primaryError);
      }

      const retrySettings = this.getStrictRetrySettings(primarySettings);
      await this.ensureGraphifyProviderConfig(retrySettings, aiSettings);

      try {
        const retryStdout = await this.runGraphifyCommand(
          command,
          retrySettings,
          "Graphify ingestion retry failed",
          aiSettings
        );

        return [
          "Primary Graphify attempt failed; retried with strict local JSON settings.",
          `Strict retry settings: temperature=${retrySettings.temperature}, max_completion_tokens=${retrySettings.maxTokens}.`,
          `Primary failure:\n${primaryError}`,
          retryStdout ? `Retry output:\n${retryStdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n");
      } catch (retryError) {
        throw this.enrichGraphifyError(
          [
            "Graphify strict retry also failed.",
            `Primary failure:\n${primaryError}`,
            `Strict retry failure:\n${errorMessage(retryError)}`
          ].join("\n\n")
        );
      }
    }
  }

  private runGraphifyCommand(
    command: string,
    settings: GraphifyLocalModelSettings,
    failureLabel: string,
    aiSettings: AiSettings
  ): Promise<string> {
    if (command.trim().startsWith("graphify ")) {
      const graphifyArgs = parseArgs(command).slice(1);
      return this.runGraphifyCli(graphifyArgs, settings, failureLabel, aiSettings);
    }

    const options: ExecOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS ?? updateTimeoutMs),
      maxBuffer: maxExecBuffer,
      env: this.buildGraphifyEnvironment(settings, aiSettings),
      windowsHide: true
    };

    return new Promise<string>((resolve, reject) => {
      exec(command, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `${failureLabel} while running: ${command}`,
                error.message,
                combined ? `Graphify output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private async withGraphifyProxyAdapter<T>(aiSettings: AiSettings, task: () => Promise<T>): Promise<T> {
    if (!isProxyAiSettings(aiSettings)) {
      return task();
    }

    const adapter = await this.startGraphifyProxyAdapter(aiSettings);
    const previousBaseUrl = this.activeGraphifyProxyBaseUrl;
    this.activeGraphifyProxyBaseUrl = adapter.baseUrl;

    try {
      return await task();
    } finally {
      this.activeGraphifyProxyBaseUrl = previousBaseUrl;
      await adapter.close();
    }
  }

  private async startGraphifyProxyAdapter(aiSettings: AiSettings): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
      void this.handleGraphifyProxyAdapterRequest(request, response, aiSettings);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      await this.closeServer(server);
      throw new Error("Could not start local Graphify proxy adapter.");
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      close: () => this.closeServer(server)
    };
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleGraphifyProxyAdapterRequest(
    request: IncomingMessage,
    response: ServerResponse,
    aiSettings: AiSettings
  ): Promise<void> {
    try {
      if (request.method !== "POST" || !request.url?.replace(/\/+$/, "").endsWith("/chat/completions")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Not Found" } }));
        return;
      }

      const rawBody = await this.readHttpRequestBody(request);
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      const requestId = randomUUID();
      const proxyResponse = await fetch(productionProxyChatEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${aiSettings.apiKey}`,
          "Content-Type": "application/json",
          "X-Second-Brain-Request-Id": requestId
        },
        body: JSON.stringify({
          userIdOrKey: aiSettings.apiKey,
          model: typeof payload.model === "string" ? payload.model : aiSettings.model,
          groundingEnabled: false,
          requestId,
          messages: Array.isArray(payload.messages) ? payload.messages : []
        })
      });
      const proxyText = await proxyResponse.text();

      if (!proxyResponse.ok) {
        response.writeHead(proxyResponse.status, { "Content-Type": "application/json" });
        response.end(proxyText);
        return;
      }

      const parsed = JSON.parse(proxyText) as Record<string, unknown>;
      const text = typeof parsed.text === "string" ? parsed.text : typeof parsed.output_text === "string" ? parsed.output_text : "";
      const model = typeof parsed.model === "string" ? parsed.model : aiSettings.model;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: requestId,
          object: "chat.completion",
          model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: text
              }
            }
          ],
          usage: parsed.usage ?? null
        })
      );
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: errorMessage(error) } }));
    }
  }

  private readHttpRequestBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on("error", reject);
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  private async runGraphifyCli(
    graphifyArgs: string[],
    settings: GraphifyLocalModelSettings,
    failureLabel: string,
    aiSettings: AiSettings
  ): Promise<string> {
    const invocations = await this.getGraphifyInvocations(graphifyArgs);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        return await this.runGraphifyInvocation(invocation, settings, aiSettings);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      [
        `${failureLabel} while running Graphify.`,
        "Tried:",
        ...failures.map((failure) => `- ${failure}`)
      ].join("\n")
    );
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
        label: `uv tool graphifyy (${path.basename(uvCommand)})`,
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

  private async getGraphifyPythonInvocations(pythonArgs: string[]): Promise<GraphifyInvocation[]> {
    const invocations: GraphifyInvocation[] = [];
    const configured = process.env.SECOND_BRAIN_GRAPHIFY_PYTHON?.trim();

    if (configured) {
      invocations.push({
        label: "SECOND_BRAIN_GRAPHIFY_PYTHON",
        command: configured,
        args: pythonArgs,
        shell: isCmdShim(configured)
      });
    }

    const bundledPython = await this.findBundledGraphifyPythonCommand();
    if (bundledPython) {
      invocations.push({
        label: "bundled Graphify Python runtime",
        command: bundledPython,
        args: pythonArgs,
        shell: isCmdShim(bundledPython)
      });
    }

    const uvInstalledPython = await this.findUvToolGraphifyPythonCommand();
    if (uvInstalledPython) {
      invocations.push({
        label: "uv installed graphifyy Python",
        command: uvInstalledPython,
        args: pythonArgs,
        shell: isCmdShim(uvInstalledPython)
      });
    }

    for (const uvCommand of runtimeUvCommands()) {
      invocations.push({
        label: `uv tool graphifyy python (${path.basename(uvCommand)})`,
        command: uvCommand,
        args: ["tool", "run", "--from", graphifyToolPackage, "python", ...pythonArgs],
        shell: isCmdShim(uvCommand)
      });
    }

    for (const pythonCommand of runtimePythonCommands()) {
      invocations.push({
        label: `${path.basename(pythonCommand)} runtime`,
        command: pythonCommand,
        args: pythonArgs,
        shell: isCmdShim(pythonCommand)
      });
    }

    return uniqueRuntimeCandidates(invocations);
  }

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    let uvToolDir = "";

    for (const uvCommand of runtimeUvCommands()) {
      try {
        uvToolDir = await new Promise<string>((resolve, reject) => {
          execFile(
            uvCommand,
            ["tool", "dir"],
            { windowsHide: true, shell: isCmdShim(uvCommand), env: withRuntimePath(process.env) },
            (error, stdout) => {
              if (error) {
                reject(error);
                return;
              }

              resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
            }
          );
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
      path.join(uvToolDir, "graphifyy", "Scripts", "graphify.exe"),
      path.join(uvToolDir, "graphifyy", "Scripts", "graphify.cmd"),
      path.join(uvToolDir, "graphifyy", "bin", "graphify")
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
        uvToolDir = await new Promise<string>((resolve, reject) => {
          execFile(
            uvCommand,
            ["tool", "dir"],
            { windowsHide: true, shell: isCmdShim(uvCommand), env: withRuntimePath(process.env) },
            (error, stdout) => {
              if (error) {
                reject(error);
                return;
              }

              resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
            }
          );
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
      path.join(uvToolDir, "graphifyy", "Scripts", "python.exe"),
      path.join(uvToolDir, "graphifyy", "bin", "python")
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
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

  private runGraphifyInvocation(
    invocation: GraphifyInvocation,
    settings: GraphifyLocalModelSettings,
    aiSettings: AiSettings
  ): Promise<string> {
    const options: ExecFileOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS ?? updateTimeoutMs),
      maxBuffer: maxExecBuffer,
      env: this.buildGraphifyEnvironment(settings, aiSettings),
      windowsHide: true,
      shell: invocation.shell
    };

    return new Promise<string>((resolve, reject) => {
      execFile(invocation.command, invocation.args, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `Command: ${formatInvocation(invocation)}`,
                error.message,
                combined ? `Graphify output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private runGraphifyUtilityInvocation(invocation: GraphifyInvocation): Promise<string> {
    const options: ExecFileOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_XLSX_COMPONENT_TIMEOUT_MS ?? 120_000),
      maxBuffer: maxExecBuffer,
      env: withRuntimePath(process.env),
      windowsHide: true,
      shell: invocation.shell
    };

    return new Promise<string>((resolve, reject) => {
      execFile(invocation.command, invocation.args, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `Command: ${formatInvocation(invocation)}`,
                error.message,
                combined ? `Output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private async ensureGraphifyProviderConfig(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<void> {
    const resolvedAiSettings = aiSettings ?? (await this.getAiSettings());
    const endpoint = this.getGraphifyLlmEndpoint(resolvedAiSettings);
    const graphifyConfigPath = path.join(this.rawVaultPath, ".graphify");
    const providerPath = path.join(graphifyConfigPath, "providers.json");
    const provider: GraphifyProviderConfig = {
      base_url: this.getGraphifyOpenAiBaseUrl(resolvedAiSettings, endpoint),
      default_model: this.getGraphifyLlmModel(resolvedAiSettings),
      model_env_key: "SECOND_BRAIN_GRAPHIFY_LLM_MODEL",
      env_key: "SECOND_BRAIN_GRAPHIFY_LLM_API_KEY",
      pricing: {
        input: 0,
        output: 0
      },
      temperature: settings.temperature
    };
    if (!isProxyAiSettings(resolvedAiSettings)) {
      provider.max_completion_tokens = settings.maxTokens;
    }
    const providerConfig: Record<string, GraphifyProviderConfig> = {
      [graphifyProviderName]: provider
    };

    await mkdir(graphifyConfigPath, { recursive: true });
    await writeFile(providerPath, `${JSON.stringify(providerConfig, null, 2)}\n`, "utf8");
  }

  private buildGraphifyEnvironment(settings: GraphifyLocalModelSettings, aiSettings: AiSettings): NodeJS.ProcessEnv {
    const endpoint = this.getGraphifyLlmEndpoint(aiSettings);
    const baseUrl = this.getGraphifyOpenAiBaseUrl(aiSettings, endpoint);
    const model = this.getGraphifyLlmModel(aiSettings);
    const apiKey =
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
      process.env.OPENAI_API_KEY ??
      aiSettings.apiKey ??
      "second-brain-local";
    const graphifyModel = process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ?? process.env.OPENAI_MODEL ?? model;
    const env: NodeJS.ProcessEnv = {
      ...withRuntimePath(process.env),
      GRAPHIFY_ALLOW_LOCAL_PROVIDERS: process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS ?? "1",
      SECOND_BRAIN_GRAPHIFY_LLM_API_KEY: apiKey,
      SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT: endpoint,
      SECOND_BRAIN_GRAPHIFY_LLM_MODEL: graphifyModel,
      SECOND_BRAIN_GRAPHIFY_TEMPERATURE: String(settings.temperature),
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: baseUrl,
      OPENAI_MODEL: graphifyModel
    };

    if (!isProxyAiSettings(aiSettings)) {
      env.GRAPHIFY_MAX_OUTPUT_TOKENS = String(settings.maxTokens);
    } else {
      delete env.GRAPHIFY_MAX_OUTPUT_TOKENS;
      delete env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS;
      delete env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS;
      delete env.SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET;
      delete env.SECOND_BRAIN_GRAPHIFY_MAX_CONCURRENCY;
    }

    return env;
  }

  private getGraphifyLlmEndpoint(aiSettings: AiSettings): string {
    if (isProxyAiSettings(aiSettings)) {
      return productionProxyChatCompletionsEndpoint;
    }

    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT ??
      aiSettings.endpoint ??
      defaultLocalModelEndpoint
    );
  }

  private getGraphifyOpenAiBaseUrl(aiSettings: AiSettings, endpoint = this.getGraphifyLlmEndpoint(aiSettings)): string {
    if (this.activeGraphifyProxyBaseUrl) {
      return this.activeGraphifyProxyBaseUrl;
    }

    if (isProxyAiSettings(aiSettings)) {
      return productionProxyOpenAiBaseUrl;
    }

    return openAiBaseUrlFromChatCompletionsEndpoint(endpoint);
  }

  private getGraphifyLlmModel(aiSettings: AiSettings): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ??
      process.env.OPENAI_MODEL ??
      aiSettings.model ??
      defaultLocalModelName
    );
  }

  private async getAiSettings(): Promise<AiSettings> {
    return this.settingsProvider();
  }

  private getGraphifyTemperature(): number {
    return numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_TEMPERATURE, defaultGraphifyTemperature);
  }

  private getGraphifyMaxTokens(): number {
    return numberFromEnv(
      process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS ?? process.env.GRAPHIFY_MAX_OUTPUT_TOKENS,
      defaultGraphifyMaxTokens,
      1
    );
  }

  private getGraphifyRetryMaxTokens(): number {
    return numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS, defaultGraphifyRetryMaxTokens, 1);
  }

  private getGraphifyLocalModelSettings(): GraphifyLocalModelSettings {
    return {
      temperature: this.getGraphifyTemperature(),
      maxTokens: this.getGraphifyMaxTokens()
    };
  }

  private getStrictRetrySettings(primarySettings: GraphifyLocalModelSettings): GraphifyLocalModelSettings {
    return {
      temperature: defaultGraphifyRetryTemperature,
      maxTokens: Math.min(primarySettings.maxTokens, this.getGraphifyRetryMaxTokens())
    };
  }

  private canRetryGraphifyCommand(): boolean {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND === undefined &&
      process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND === undefined
    );
  }

  private shouldRetryWithStrictJson(message: string): boolean {
    return /invalid JSON|hollow response|empty or filtered response|chunk\s+\d+\/\d+\s+failed|truncated at max_completion_tokens|graph is empty|extraction produced no nodes/i.test(
      message
    );
  }

  private enrichGraphifyError(message: string): Error {
    const runtimeHint = /access is denied|eacces|permission denied|spawn .* denied/i.test(message)
      ? [
          "Graphify runtime guidance:",
          "- The app now tries a bundled runtime, the direct uv tool executable, `uv tool run --from graphifyy[pdf,office,openai,mcp] graphify`, Python module fallbacks, then PATH.",
          "- For beta machines, install the document-capable tool with `uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\"`.",
          "- If Graphify is installed somewhere custom, set `SECOND_BRAIN_GRAPHIFY_BIN` to the full graphify executable path."
        ].join("\n")
      : "";
    const localModelHint = [
      "Local model guidance:",
      "- The app first tries 8192 completion tokens and retries once with strict JSON settings capped at 4096.",
      "- If this still fails, restart llama-server with a larger context, for example `-c 8192` or `-c 12288`.",
      "- For Gemma/Gemma-style thinking templates, disable thinking in the server/template if available; hidden thinking can consume completion budget before the JSON closes.",
      "- You can lower the retry cap with `SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS=2048`."
    ].join("\n");

    return new Error([message, runtimeHint, localModelHint].filter(Boolean).join("\n\n"));
  }

  private async ensureMcpClient(): Promise<Client> {
    if (this.mcpClient) {
      return this.mcpClient;
    }

    const graphExists = await this.fileExists(this.graphPath);
    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const invocations = await this.getGraphifyMcpInvocations();
    const failures: string[] = [];
    for (const invocation of invocations) {
      const client = new Client({
        name: "second-brain-graphify",
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
        console.warn("Graphify MCP stderr", chunk.toString());
      });

      try {
        await client.connect(transport);
        this.mcpClient = client;
        this.mcpTransport = transport;
        return client;
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
        await transport.close().catch(() => undefined);
      }
    }

    throw new Error(["Could not start Graphify MCP server.", "Tried:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
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
        label: `uv tool graphifyy python (${path.basename(uvCommand)})`,
        command: uvCommand,
        args: ["tool", "run", "--from", graphifyToolPackage, "python", ...baseArgs],
        shell: isCmdShim(uvCommand)
      });
    }

    const uvInstalledPython = await this.findUvToolGraphifyPythonCommand();
    if (uvInstalledPython) {
      invocations.push({
        label: "uv installed graphifyy Python",
        command: uvInstalledPython,
        args: baseArgs,
        shell: isCmdShim(uvInstalledPython)
      });
    }

    for (const pythonCommand of runtimePythonCommands()) {
      invocations.push({
        label: `${path.basename(pythonCommand)} runtime`,
        command: pythonCommand,
        args: baseArgs,
        shell: isCmdShim(pythonCommand)
      });
    }
    return uniqueRuntimeCandidates(invocations);
  }

  private resolveSourcePath(sourceFile: string): string {
    return path.isAbsolute(sourceFile) ? sourceFile : path.join(this.rawVaultPath, sourceFile);
  }

  private resolveRemovableSourcePath(sourceFile: string): string {
    const candidate = this.resolveSourcePath(sourceFile);
    const resolvedRaw = path.resolve(this.rawVaultPath);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRaw, resolvedCandidate);

    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
      throw new Error(`Refusing to remove source outside the raw vault: ${sourceFile}`);
    }

    if (
      relative
        .split(path.sep)
        .some((part) => part === "graphify-out" || part === spreadsheetComponentDirectoryName || part === paperComponentDirectoryName)
    ) {
      throw new Error(`Refusing to remove generated Graphify artifact: ${sourceFile}`);
    }

    return resolvedCandidate;
  }

  private resolveSourceCommentPath(sourceFile: string): string {
    return path.join(this.rawVaultPath, sourceCommentDirectoryName, sourceCommentFileName(sourceFile));
  }

  private async readSourceComment(sourceFile: string): Promise<string> {
    try {
      const sourcePath = this.resolveSourcePath(sourceFile);
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
      return await readFile(this.resolveSourceCommentPath(sourceFile), "utf8");
    } catch {
      return "";
    }
  }

  private async listCallflowHtmlCandidates(
    directory = this.graphOutPath
  ): Promise<Array<{ path: string; updatedAt: string; mtimeMs: number }>> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const candidates: Array<{ path: string; updatedAt: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        candidates.push(...(await this.listCallflowHtmlCandidates(entryPath)));
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html") || entryPath === this.graphHtmlPath) {
        continue;
      }

      const entryStat = await stat(entryPath);
      candidates.push({
        path: entryPath,
        updatedAt: entryStat.mtime.toISOString(),
        mtimeMs: entryStat.mtimeMs
      });
    }

    return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  }

  private async removeSourceComment(sourceFile: string): Promise<void> {
    await rm(this.resolveSourceCommentPath(sourceFile), { force: true });
  }

  private async renameSourceComment(sourceFile: string, nextSourceFile: string): Promise<void> {
    const currentCommentPath = this.resolveSourceCommentPath(sourceFile);
    const nextCommentPath = this.resolveSourceCommentPath(nextSourceFile);

    try {
      await mkdir(path.dirname(nextCommentPath), { recursive: true });
      await rename(currentCommentPath, nextCommentPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  private async mergeSourceComment(sourceFile: string, targetSourceFile: string): Promise<void> {
    const sourceComment = (await this.readSourceComment(sourceFile)).trim();
    if (!sourceComment) {
      return;
    }

    const targetComment = (await this.readSourceComment(targetSourceFile)).trim();
    const nextComment = [
      targetComment,
      targetComment ? "\n---\n" : "",
      sourceComment,
      "",
      `Merged from: ${sourceFile}`,
      `Merged at: ${new Date().toISOString()}`
    ]
      .filter(Boolean)
      .join("\n");
    const targetCommentPath = this.resolveSourceCommentPath(targetSourceFile);
    await mkdir(path.dirname(targetCommentPath), { recursive: true });
    await writeFile(targetCommentPath, `${nextComment.trim()}\n`, "utf8");
    await this.removeSourceComment(sourceFile);
  }

  private async hasRawSourceFiles(directory = this.rawVaultPath): Promise<boolean> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (
        entry.name === "graphify-out" ||
        entry.name === ".graphify" ||
        entry.name === sourceCommentDirectoryName ||
        entry.name === spreadsheetComponentDirectoryName ||
        entry.name === paperComponentDirectoryName
      ) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && (await this.hasRawSourceFiles(entryPath))) {
        return true;
      }
    }

    return false;
  }

  private async writeEmptyGraphResult(): Promise<GraphifyIngestionResult> {
    const updatedAt = new Date().toISOString();
    await mkdir(this.graphOutPath, { recursive: true });
    await Promise.all([
      writeFile(this.graphPath, `${JSON.stringify({ nodes: [], links: [] }, null, 2)}\n`, "utf8"),
      writeFile(this.reportPath, "# Graphify Report\n\nNo raw sources are currently stored.\n", "utf8"),
      writeFile(
        this.graphHtmlPath,
        [
          "<!doctype html>",
          "<html><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:sans-serif;\">",
          "<p>No raw sources are currently stored.</p>",
          "</body></html>"
        ].join(""),
        "utf8"
      )
    ]);

    return {
      completed: true,
      writtenFileCount: 0,
      graphPath: this.graphPath,
      reportPath: this.reportPath,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      stdout: "Removed final source and wrote an empty Graphify graph.",
      updatedAt
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async fileMtimeMs(filePath: string): Promise<number | null> {
    try {
      return (await stat(filePath)).mtimeMs;
    } catch {
      return null;
    }
  }

  private async canUsePartialGraphifyResult(errorDetail: string, graphMtimeBefore: number | null): Promise<boolean> {
    if (!/chunk\s+\d+\/\d+\s+failed|LLM returned empty or filtered response|semantic extraction/i.test(errorDetail)) {
      return false;
    }

    const graphMtimeAfter = await this.fileMtimeMs(this.graphPath);
    if (graphMtimeAfter === null) {
      return false;
    }

    return graphMtimeBefore === null ? graphMtimeAfter > 0 : graphMtimeAfter > graphMtimeBefore;
  }

  private async readGraphCounts(): Promise<Pick<GraphifyIngestionResult, "graphNodeCount" | "graphEdgeCount">> {
    try {
      const graph = JSON.parse(await readFile(this.graphPath, "utf8")) as GraphifyGraph;
      return {
        graphNodeCount: graph.nodes?.length,
        graphEdgeCount: graph.links?.length ?? graph.edges?.length
      };
    } catch {
      return {};
    }
  }
}

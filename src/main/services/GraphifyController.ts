import { randomUUID } from "node:crypto";
import { exec, execFile } from "node:child_process";
import type { ExecFileOptions, ExecOptions } from "node:child_process";
import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  AiSettings,
  FilesDroppedPayload,
  GraphHtmlDocument,
  GraphifyIngestionResult,
  ProcessDroppedItem
} from "../../shared/ipc";
import { LlmService } from "./LlmService";
import type { GraphCardDefinitionInput, GraphifyMcpToolSpec } from "./LlmService";

type GraphifyGraph = {
  nodes?: unknown[];
  links?: unknown[];
  edges?: unknown[];
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
  max_completion_tokens: number;
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

const updateTimeoutMs = 10 * 60 * 1_000;
const maxExecBuffer = 10 * 1024 * 1024;
const graphifyProviderName = "second-brain-local";
const defaultLocalModelEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultLocalModelName = "local-model";
const defaultGraphifyTemperature = 0.6;
const defaultGraphifyMaxTokens = 8192;
const defaultGraphifyRetryTemperature = 0;
const defaultGraphifyRetryMaxTokens = 4096;
const defaultIngestCommand = `graphify extract . --out . --backend ${graphifyProviderName} --max-concurrency 1 --token-budget 2048`;
const defaultHtmlCommand = "graphify export html --graph graphify-out/graph.json";
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

function safeFilePart(value: string): string {
  const parsed = path.parse(value);
  const base = (parsed.name || "dropped-file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16);

  return `${base || "dropped-file"}${ext}`;
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

function normalizeOpenAiBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");

  return trimmed.replace(/\/chat\/completions$/i, "");
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

function quoteCommandPart(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function formatInvocation(invocation: GraphifyInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteCommandPart).join(" ");
}

function isCmdShim(filePath: string): boolean {
  return /\.cmd$/i.test(filePath) || /\.bat$/i.test(filePath);
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

  constructor(
    private readonly rawVaultPath: string,
    private readonly settingsProvider: AiSettingsProvider = async () => ({
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

  async initialize(): Promise<void> {
    await mkdir(this.rawVaultPath, { recursive: true });
    await this.ensureGraphifyProviderConfig();
  }

  async ingestFilesDrop(payload: FilesDroppedPayload): Promise<GraphifyIngestionResult> {
    const fileItems = payload.files.map((file) => ({
      name: file.name,
      path: file.path,
      type: file.type,
      buffer: file.buffer
    }));
    const textItems = payload.text
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
    await this.resetGraphifyOutputs();

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
    await rm(sourcePath, { force: true });
    await this.resetGraphifyOutputs();

    return this.queueUpdate(0);
  }

  async ingestDroppedItems(items: ProcessDroppedItem[]): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const writtenFiles = await this.writeRawItems(items);

    if (writtenFiles.length === 0) {
      throw new Error("No dropped files or text were available for Graphify ingestion.");
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
      const outputPath = this.createRawDestination(item, index);
      const buffer = bufferFromDroppedValue(item.buffer);

      if (buffer) {
        await writeFile(outputPath, buffer);
        written.push(outputPath);
        continue;
      }

      if (item.path) {
        try {
          const fileStat = await stat(item.path);
          if (fileStat.isFile()) {
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
        await writeFile(outputPath, text, "utf8");
        written.push(outputPath);
      }
    }

    return written;
  }

  private createRawDestination(item: ProcessDroppedItem, index: number): string {
    const fallbackName = item.text || item.content ? "dropped-text.txt" : `dropped-file-${index + 1}`;
    const safeName = safeFilePart(item.name ?? (item.path ? path.basename(item.path) : fallbackName));
    const parsed = path.parse(safeName);
    const unique = `${parsed.name}-${Date.now()}-${randomUUID().slice(0, 8)}${parsed.ext || ".txt"}`;

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

  private async runGraphifyUpdate(writtenFileCount: number): Promise<GraphifyIngestionResult> {
    const primarySettings = this.getGraphifyLocalModelSettings();
    const aiSettings = await this.getAiSettings();
    await this.ensureGraphifyProviderConfig(primarySettings, aiSettings);

    const command =
      process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND ??
      process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND ??
      defaultIngestCommand;
    const stdout = await this.runGraphifyCommandWithRetry(command, primarySettings, aiSettings);
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify finished but did not create ${this.graphPath}.`);
    }

    const htmlStdout = await this.ensureGraphHtml(primarySettings, aiSettings);
    const combinedStdout = [
      stdout,
      process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0" ? "" : "Graphify card definitions scheduled in background.",
      htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : ""
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

  private async enrichGraphCardDefinitions(): Promise<string> {
    if (process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0") {
      return "";
    }

    const graphVersion = (await stat(this.graphPath)).mtimeMs;
    const graph = asRecord(JSON.parse(await readFile(this.graphPath, "utf8")));
    if (!graph) {
      return "";
    }

    const nodes = normalizeGraphNodes(graph.nodes);
    if (nodes.length === 0) {
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

    if (cards.length === 0) {
      return "Graphify card definitions are already current.";
    }

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
        console.warn("Graph card definition batch failed; leaving Graphify summaries in place.", error);
      }
    }

    graph.nodes = nodes;

    if ((await stat(this.graphPath)).mtimeMs !== graphVersion) {
      this.cardDefinitionQueued = true;
      return "Graphify card definitions skipped because a newer graph was written.";
    }

    await writeFile(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");

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

      if (!this.canRetryGraphifyCommand() || !this.shouldRetryWithStrictJson(primaryError)) {
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
    if (command === defaultIngestCommand || command === defaultHtmlCommand) {
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

    invocations.push(
      {
        label: "uv tool graphifyy",
        command: "uv",
        args: ["tool", "run", "--from", "graphifyy[pdf,office,openai,mcp]", "graphify", ...graphifyArgs]
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

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    let uvToolDir = "";

    try {
      uvToolDir = await new Promise<string>((resolve, reject) => {
        execFile("uv", ["tool", "dir"], { windowsHide: true }, (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
        });
      });
    } catch {
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

  private async ensureGraphifyProviderConfig(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<void> {
    const resolvedAiSettings = aiSettings ?? (await this.getAiSettings());
    const graphifyConfigPath = path.join(this.rawVaultPath, ".graphify");
    const providerPath = path.join(graphifyConfigPath, "providers.json");
    const providerConfig: Record<string, GraphifyProviderConfig> = {
      [graphifyProviderName]: {
        base_url: normalizeOpenAiBaseUrl(this.getGraphifyLlmEndpoint(resolvedAiSettings)),
        default_model: this.getGraphifyLlmModel(resolvedAiSettings),
        model_env_key: "SECOND_BRAIN_GRAPHIFY_LLM_MODEL",
        env_key: "SECOND_BRAIN_GRAPHIFY_LLM_API_KEY",
        pricing: {
          input: 0,
          output: 0
        },
        temperature: settings.temperature,
        max_completion_tokens: settings.maxTokens
      }
    };

    await mkdir(graphifyConfigPath, { recursive: true });
    await writeFile(providerPath, `${JSON.stringify(providerConfig, null, 2)}\n`, "utf8");
  }

  private buildGraphifyEnvironment(settings: GraphifyLocalModelSettings, aiSettings: AiSettings): NodeJS.ProcessEnv {
    const endpoint = this.getGraphifyLlmEndpoint(aiSettings);
    const model = this.getGraphifyLlmModel(aiSettings);
    const maxTokens = String(settings.maxTokens);

    return {
      ...process.env,
      GRAPHIFY_ALLOW_LOCAL_PROVIDERS: process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS ?? "1",
      GRAPHIFY_MAX_OUTPUT_TOKENS: maxTokens,
      SECOND_BRAIN_GRAPHIFY_LLM_API_KEY:
        process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
        aiSettings.apiKey ??
        "second-brain-local",
      SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT: endpoint,
      SECOND_BRAIN_GRAPHIFY_LLM_MODEL: process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ?? model,
      SECOND_BRAIN_GRAPHIFY_TEMPERATURE: String(settings.temperature)
    };
  }

  private getGraphifyLlmEndpoint(aiSettings: AiSettings): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT ??
      aiSettings.endpoint ??
      defaultLocalModelEndpoint
    );
  }

  private getGraphifyLlmModel(aiSettings: AiSettings): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ??
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
    return /invalid JSON|hollow response|truncated at max_completion_tokens|graph is empty|extraction produced no nodes/i.test(
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

    const command = await this.resolveMcpCommand();
    const args =
      process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS !== undefined
        ? parseArgs(process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS).map((arg) => arg.replace("{graphPath}", this.graphPath))
        : ["-m", "graphify.serve", this.graphPath];
    const client = new Client({
      name: "second-brain-graphify",
      version: "0.1.0"
    });
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: this.rawVaultPath,
      stderr: "pipe"
    });

    transport.stderr?.on("data", (chunk) => {
      console.warn("Graphify MCP stderr", chunk.toString());
    });

    await client.connect(transport);
    this.mcpClient = client;
    this.mcpTransport = transport;
    return client;
  }

  private async resolveMcpCommand(): Promise<string> {
    if (process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND) {
      return process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND;
    }

    if (process.platform === "win32") {
      return "python";
    }

    try {
      const graphifyBin = await new Promise<string>((resolve, reject) => {
        exec("command -v graphify", { windowsHide: true }, (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
        });
      });

      if (graphifyBin) {
        const firstLine = (await readFile(graphifyBin, "utf8")).split(/\r?\n/)[0] ?? "";
        const shebang = firstLine.startsWith("#!") ? firstLine.slice(2).trim() : "";

        if (shebang) {
          return shebang;
        }
      }
    } catch {
      // Fall back below.
    }

    return "python3";
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

    if (relative.split(path.sep).includes("graphify-out")) {
      throw new Error(`Refusing to remove generated Graphify artifact: ${sourceFile}`);
    }

    return resolvedCandidate;
  }

  private async resetGraphifyOutputs(): Promise<void> {
    await this.stopMcp();
    await rm(this.graphOutPath, { recursive: true, force: true });
  }

  private async hasRawSourceFiles(directory = this.rawVaultPath): Promise<boolean> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.name === "graphify-out" || entry.name === ".graphify") {
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

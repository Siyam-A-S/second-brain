import { createHash, randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import type { ExecOptions } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  FilesDroppedPayload,
  GraphHtmlDocument,
  GraphifyIngestionResult,
  JobTrackerRecord,
  ProcessDroppedItem
} from "../../shared/ipc";
import type { GraphifyJobDraft, GraphifyMcpToolSpec, LlmService, PlannedLocalToolCall } from "./LlmService";

type GraphifyGraph = {
  nodes?: unknown[];
  links?: unknown[];
  edges?: unknown[];
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

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;
type ToolContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "resource";
      resource: {
        text?: string | undefined;
      };
    };

const updateTimeoutMs = 10 * 60 * 1_000;
const maxExecBuffer = 10 * 1024 * 1024;
const graphifyProviderName = "second-brain-local";
const defaultLocalModelEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultLocalModelName = "local-model";
const defaultGraphifyTemperature = 0.6;
const defaultGraphifyMaxTokens = 4096;
const defaultGraphifyRetryTemperature = 0;
const defaultGraphifyRetryMaxTokens = 3072;
const defaultIngestCommand = `graphify extract . --out . --backend ${graphifyProviderName} --max-concurrency 1 --token-budget 2048`;
const defaultHtmlCommand = "graphify export html --graph graphify-out/graph.json";
const graphifyQuestion = [
  "Extract job tracker rows from this local Graphify graph.",
  "Find Job Descriptions, Companies, Roles, posting dates, source files, and source modified timestamps.",
  "Prefer evidence from graph topology and source metadata over raw file search."
].join(" ");

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

function readToolText(result: ToolCallResult): string {
  const content = Array.isArray(result.content) ? (result.content as ToolContentPart[]) : [];

  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      if (part.type === "resource" && "text" in part.resource) {
        return part.resource.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function stableJobUuid(job: GraphifyJobDraft): string {
  const hash = createHash("sha1")
    .update([job.company, job.role, job.source_file, job.description_summary].filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);

  return `graphify-${hash}`;
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

  constructor(private readonly rawVaultPath: string) {
    this.graphOutPath = path.join(rawVaultPath, "graphify-out");
    this.graphPath = path.join(this.graphOutPath, "graph.json");
    this.graphHtmlPath = path.join(this.graphOutPath, "graph.html");
    this.reportPath = path.join(this.graphOutPath, "GRAPH_REPORT.md");
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

  async extractJobRecords(llm: LlmService): Promise<JobTrackerRecord[]> {
    const graphExists = await this.fileExists(this.graphPath);
    if (!graphExists) {
      return [];
    }

    const tools = await this.listMcpTools();
    if (tools.length === 0) {
      return [];
    }

    const planned = await this.planGraphifyJobQuery(llm, tools);
    const toolResult = await (await this.ensureMcpClient()).callTool({
      name: planned.tool,
      arguments: planned.input as Record<string, unknown>
    });
    const context = readToolText(toolResult);

    if (!context) {
      return [];
    }

    const drafts = await llm.extractJobsFromGraphifyContext(context);
    return Promise.all(drafts.map((draft) => this.toJobRecord(draft)));
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
    await this.ensureGraphifyProviderConfig(primarySettings);

    const command =
      process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND ??
      process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND ??
      defaultIngestCommand;
    const stdout = await this.runGraphifyCommandWithRetry(command, primarySettings);
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify finished but did not create ${this.graphPath}.`);
    }

    const htmlStdout = await this.ensureGraphHtml(primarySettings);
    const combinedStdout = [stdout, htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : ""].filter(Boolean).join("\n\n");

    await this.stopMcp();

    const counts = await this.readGraphCounts();

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

  private async ensureGraphHtml(settings = this.getGraphifyLocalModelSettings()): Promise<string> {
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const shouldExport = await this.shouldExportGraphHtml();
    if (!shouldExport) {
      return "";
    }

    const command = process.env.SECOND_BRAIN_GRAPHIFY_HTML_COMMAND ?? defaultHtmlCommand;
    const stdout = await this.runGraphifyCommand(command, settings, "Graphify HTML export failed");

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

  private async shouldExportGraphHtml(): Promise<boolean> {
    try {
      const [graphStat, htmlStat] = await Promise.all([stat(this.graphPath), stat(this.graphHtmlPath)]);
      return htmlStat.mtimeMs + 1000 < graphStat.mtimeMs;
    } catch {
      return true;
    }
  }

  private async runGraphifyCommandWithRetry(command: string, primarySettings: GraphifyLocalModelSettings): Promise<string> {
    try {
      return await this.runGraphifyCommand(command, primarySettings, "Graphify ingestion failed");
    } catch (error) {
      const primaryError = errorMessage(error);

      if (!this.canRetryGraphifyCommand() || !this.shouldRetryWithStrictJson(primaryError)) {
        throw this.enrichGraphifyError(primaryError);
      }

      const retrySettings = this.getStrictRetrySettings(primarySettings);
      await this.ensureGraphifyProviderConfig(retrySettings);

      try {
        const retryStdout = await this.runGraphifyCommand(command, retrySettings, "Graphify ingestion retry failed");

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

  private runGraphifyCommand(command: string, settings: GraphifyLocalModelSettings, failureLabel: string): Promise<string> {
    const options: ExecOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS ?? updateTimeoutMs),
      maxBuffer: maxExecBuffer,
      env: this.buildGraphifyEnvironment(settings),
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

  private ensureGraphifyProviderConfig(settings = this.getGraphifyLocalModelSettings()): Promise<void> {
    const graphifyConfigPath = path.join(this.rawVaultPath, ".graphify");
    const providerPath = path.join(graphifyConfigPath, "providers.json");
    const providerConfig: Record<string, GraphifyProviderConfig> = {
      [graphifyProviderName]: {
        base_url: normalizeOpenAiBaseUrl(this.getGraphifyLlmEndpoint()),
        default_model: this.getGraphifyLlmModel(),
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

    return mkdir(graphifyConfigPath, { recursive: true }).then(() =>
      writeFile(providerPath, `${JSON.stringify(providerConfig, null, 2)}\n`, "utf8")
    );
  }

  private buildGraphifyEnvironment(settings = this.getGraphifyLocalModelSettings()): NodeJS.ProcessEnv {
    const endpoint = this.getGraphifyLlmEndpoint();
    const model = this.getGraphifyLlmModel();
    const maxTokens = String(settings.maxTokens);

    return {
      ...process.env,
      GRAPHIFY_ALLOW_LOCAL_PROVIDERS: process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS ?? "1",
      GRAPHIFY_MAX_OUTPUT_TOKENS: maxTokens,
      SECOND_BRAIN_GRAPHIFY_LLM_API_KEY:
        process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
        process.env.SECOND_BRAIN_LLM_API_KEY ??
        process.env.OPENAI_API_KEY ??
        "second-brain-local",
      SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT: endpoint,
      SECOND_BRAIN_GRAPHIFY_LLM_MODEL: process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ?? model,
      SECOND_BRAIN_GRAPHIFY_TEMPERATURE: String(settings.temperature)
    };
  }

  private getGraphifyLlmEndpoint(): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT ??
      process.env.SECOND_BRAIN_LLM_ENDPOINT ??
      defaultLocalModelEndpoint
    );
  }

  private getGraphifyLlmModel(): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ??
      process.env.SECOND_BRAIN_LLM_MODEL ??
      process.env.OPENAI_MODEL ??
      defaultLocalModelName
    );
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
    const localModelHint = [
      "Local model guidance:",
      "- Your llama.cpp server is running with a 4096-token context. A request with max_completion_tokens=4096 cannot also fit Graphify's prompt and source text.",
      "- The app now retries once with strict JSON settings. If this still fails, restart llama-server with a larger context, for example `-c 8192` or `-c 12288`.",
      "- For Gemma/Gemma-style thinking templates, disable thinking in the server/template if available; hidden thinking can consume completion budget before the JSON closes.",
      "- You can lower the retry cap with `SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS=2048`."
    ].join("\n");

    return new Error([message, localModelHint].filter(Boolean).join("\n\n"));
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

  private async planGraphifyJobQuery(llm: LlmService, tools: GraphifyMcpToolSpec[]): Promise<PlannedLocalToolCall> {
    try {
      return await llm.planGraphifyJobQuery(tools);
    } catch (error) {
      console.warn("Local AI could not plan a Graphify MCP tool call; using deterministic query fallback.", error);
      const queryTool =
        tools.find((tool) => /query|search|ask/i.test(tool.name)) ??
        tools.find((tool) => /query|search|ask/i.test(tool.description ?? "")) ??
        tools[0];

      if (!queryTool) {
        throw new Error("Graphify MCP did not expose any tools.");
      }

      return {
        tool: queryTool.name,
        input: this.buildFallbackToolInput(queryTool),
        reason: "Fallback Graphify job query."
      };
    }
  }

  private buildFallbackToolInput(tool: GraphifyMcpToolSpec): Record<string, unknown> {
    const properties = tool.inputSchema?.properties;
    const keys = properties && typeof properties === "object" ? Object.keys(properties) : [];
    const preferredKey = keys.find((key) => /query|question|prompt|text|input/i.test(key)) ?? keys[0] ?? "query";

    return {
      [preferredKey]: graphifyQuestion
    };
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

  private async toJobRecord(job: GraphifyJobDraft): Promise<JobTrackerRecord> {
    const now = new Date().toISOString();
    const sourcePath = job.source_file ? this.resolveSourcePath(job.source_file) : null;
    const sourceStat = sourcePath ? await this.safeStat(sourcePath) : null;
    const updatedAt = job.updated_at ?? sourceStat?.mtime.toISOString() ?? now;
    const applicationDate = normalizeDate(job.application_date, now.slice(0, 10));

    return {
      uuid: stableJobUuid(job),
      company: job.company,
      role: job.role,
      job_posted: normalizeDate(job.job_posted, ""),
      application_date: applicationDate,
      status: job.status ?? "Applied",
      resume: job.resume ?? "",
      description_summary: job.description_summary,
      raw_content: job.raw_content ?? "",
      createdAt: sourceStat?.birthtime.toISOString() ?? updatedAt,
      updatedAt
    };
  }

  private resolveSourcePath(sourceFile: string): string {
    return path.isAbsolute(sourceFile) ? sourceFile : path.join(this.rawVaultPath, sourceFile);
  }

  private async safeStat(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
    try {
      return await stat(filePath);
    } catch {
      return null;
    }
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

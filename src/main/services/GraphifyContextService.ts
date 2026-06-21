import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
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
const defaultBudget = 1800;
const maxHydratedContextFiles = 8;
const maxHydratedContextChars = 2800;
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

export class GraphifyContextService {
  private readonly graphPath: string;

  constructor(private readonly rawVaultPath: string) {
    this.graphPath = path.join(rawVaultPath, "graphify-out", "graph.json");
  }

  async query(question: string, budget?: number): Promise<GraphifyContextResult> {
    const normalizedQuestion = question.trim();
    const normalizedBudget = normalizeBudget(budget);

    if (!normalizedQuestion) {
      throw new Error("A question is required for Graphify context retrieval.");
    }

    return this.runGraphifyContextCommand(normalizedQuestion, ["query", normalizedQuestion, "--budget", String(normalizedBudget)], normalizedBudget);
  }

  async explain(nodeIdOrLabel: string): Promise<GraphifyContextResult> {
    const normalized = nodeIdOrLabel.trim();
    if (!normalized) {
      throw new Error("A node label is required for Graphify explain.");
    }

    return this.runGraphifyContextCommand(normalized, ["explain", normalized], defaultBudget);
  }

  async tracePath(from: string, to: string): Promise<GraphifyContextResult> {
    const source = from.trim();
    const target = to.trim();
    if (!source || !target) {
      throw new Error("Both source and target node labels are required for Graphify path tracing.");
    }

    return this.runGraphifyContextCommand(`${source} -> ${target}`, ["path", source, target], defaultBudget);
  }

  private async runGraphifyContextCommand(query: string, args: string[], budget: number): Promise<GraphifyContextResult> {
    const invocations = await this.getGraphifyInvocations(args);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        const stdout = await this.runInvocation(invocation);
        const citations = extractCitations(stdout);
        const hydratedContext = await this.hydrateContext(stdout, citations);
        return {
          query,
          stdout: hydratedContext ? `${stdout}\n\nRelevant local excerpts:\n${hydratedContext}` : stdout,
          budget,
          command: formatInvocation(invocation),
          graphPath: this.graphPath,
          citations
        };
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

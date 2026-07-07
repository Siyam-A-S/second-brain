import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { GraphifyContextNodeHit, GraphifyContextSourceExcerpt, GraphifySourceChunk, GraphifySourceChunkReason } from "../../shared/brain";

const maxSourceChunks = 8;
const maxChunkChars = 2800;
const maxTotalChunkChars = 12_000;
const maxReadableSourceBytes = 2 * 1024 * 1024;
const nodeWindowBeforeLines = 10;
const nodeWindowAfterLines = 30;
const keywordChunkLines = 34;
const keywordChunkOverlapLines = 6;
const mergeDistanceLines = 5;

const readableSourceExtensions = new Set([
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

type SourceCandidate = {
  filePath: string | null;
  sourceFile: string;
  displayName: string;
  sourceKind: "raw" | "converted" | "paper" | "metadata";
};

type PendingWindow = {
  source: SourceCandidate;
  hit: GraphifyContextNodeHit;
  startLine?: number | undefined;
  endLine?: number | undefined;
  reason: GraphifySourceChunkReason;
  score: number;
};

type PaperArtifactCandidate = {
  sourceFile: string;
  artifactPath: string;
};

export type SourceContentHydrationInput = {
  nodeHits: GraphifyContextNodeHit[];
  expandedTokens?: string[] | undefined;
  query?: string | undefined;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lineNumberFromLocation(sourceLocation: string | undefined): number | null {
  const lineMatch = sourceLocation?.match(/(?:^|[^A-Za-z])L(?:ine)?[:=]?(\d+)/i) ?? sourceLocation?.match(/(?:line|loc)[:=]?(\d+)/i);
  if (!lineMatch) {
    return null;
  }

  const line = Number(lineMatch[1]);
  return Number.isFinite(line) && line > 0 ? Math.trunc(line) : null;
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .flatMap((token) => token.split(/[./-]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 48);
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).join(path.sep);
}

function basenameWithoutExtension(value: string): string {
  return path.basename(value, path.extname(value)).toLowerCase();
}

function scoreKeywordChunk(text: string, tokens: Set<string>): number {
  if (tokens.size === 0) {
    return 0;
  }

  const chunkTokens = new Set(tokenize(text));
  let score = 0;
  for (const token of tokens) {
    if (chunkTokens.has(token)) {
      score += 10;
      continue;
    }

    for (const chunkToken of chunkTokens) {
      if (token.length > 2 && chunkToken.length > 2 && (token.includes(chunkToken) || chunkToken.includes(token))) {
        score += 3;
        break;
      }
    }
  }

  return score;
}

export class SourceContentService {
  private convertedMarkdownFiles: string[] | null = null;
  private paperArtifacts: PaperArtifactCandidate[] | null = null;

  constructor(private readonly rawVaultPath: string) {}

  async hydrate(input: SourceContentHydrationInput): Promise<GraphifySourceChunk[]> {
    const hits = input.nodeHits.filter((hit) => hit.sourceFile).slice(0, 24);
    if (hits.length === 0) {
      return [];
    }

    const tokens = new Set([...tokenize(input.query ?? ""), ...(input.expandedTokens ?? []).flatMap(tokenize)]);
    const pending: PendingWindow[] = [];

    for (const hit of hits) {
      const source = await this.resolveSourceCandidate(hit);
      const line = lineNumberFromLocation(hit.sourceLocation);

      if (!source.filePath) {
        pending.push({
          source,
          hit,
          reason: "metadata-only",
          score: Math.max(1, 100 - hit.rank)
        });
        continue;
      }

      if (line) {
        pending.push({
          source,
          hit,
          startLine: Math.max(1, line - nodeWindowBeforeLines),
          endLine: line + nodeWindowAfterLines,
          reason: source.sourceKind === "raw" ? "node-location" : source.sourceKind === "converted" ? "converted-sidecar" : "paper-component",
          score: 1000 - hit.rank * 10
        });
        continue;
      }

      const keywordWindow = await this.findKeywordWindow(source, hit, tokens);
      pending.push(keywordWindow);
    }

    const chunks = await this.materializeWindows(pending, tokens);
    return this.applyBudget(chunks);
  }

  toSourceExcerpts(chunks: GraphifySourceChunk[]): GraphifyContextSourceExcerpt[] {
    return chunks
      .filter((chunk) => chunk.text.trim())
      .map((chunk) => ({
        sourceFile: chunk.sourceFile,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        nodeIds: chunk.nodeIds,
        text: chunk.text
      }));
  }

  formatSourceChunks(chunks: GraphifySourceChunk[]): string {
    return chunks
      .map((chunk, index) => {
        const location = chunk.startLine ? ` L${chunk.startLine}-L${chunk.endLine ?? chunk.startLine}` : "";
        const nodes = chunk.nodeLabels.length > 0 ? ` nodes=${chunk.nodeLabels.map(compact).join(", ")}` : "";
        const header = `--- [${index + 1}] ${chunk.displayName || chunk.sourceFile}${location} reason=${chunk.reason}${nodes} ---`;
        const body = chunk.text.trim() || "(metadata only; no readable text sidecar was available for this source)";
        return [header, body].join("\n");
      })
      .join("\n\n");
  }

  private async resolveSourceCandidate(hit: GraphifyContextNodeHit): Promise<SourceCandidate> {
    const sourceFile = hit.sourceFile?.trim() ?? "";
    const displayName = sourceFile ? path.basename(sourceFile) : hit.label;
    if (!sourceFile) {
      return {
        filePath: null,
        sourceFile,
        displayName,
        sourceKind: "metadata"
      };
    }

    const rawPath = this.resolveVaultPath(sourceFile);
    if (rawPath && (await this.canReadTextFile(rawPath))) {
      return {
        filePath: rawPath,
        sourceFile: this.toRelativeVaultPath(rawPath),
        displayName,
        sourceKind: "raw"
      };
    }

    const convertedPath = await this.findConvertedSidecar(sourceFile);
    if (convertedPath && (await this.canReadTextFile(convertedPath))) {
      return {
        filePath: convertedPath,
        sourceFile: this.toRelativeVaultPath(convertedPath),
        displayName,
        sourceKind: "converted"
      };
    }

    const paperPath = await this.findPaperComponent(sourceFile);
    if (paperPath && (await this.canReadTextFile(paperPath))) {
      return {
        filePath: paperPath,
        sourceFile: this.toRelativeVaultPath(paperPath),
        displayName,
        sourceKind: "paper"
      };
    }

    return {
      filePath: null,
      sourceFile,
      displayName,
      sourceKind: "metadata"
    };
  }

  private async findKeywordWindow(source: SourceCandidate, hit: GraphifyContextNodeHit, tokens: Set<string>): Promise<PendingWindow> {
    if (!source.filePath) {
      return {
        source,
        hit,
        reason: "metadata-only",
        score: Math.max(1, 100 - hit.rank)
      };
    }

    const lines = (await readFile(source.filePath, "utf8")).split(/\r?\n/);
    let best: { startLine: number; endLine: number; score: number } | null = null;
    const step = Math.max(1, keywordChunkLines - keywordChunkOverlapLines);

    for (let startIndex = 0; startIndex < lines.length; startIndex += step) {
      const endIndex = Math.min(lines.length, startIndex + keywordChunkLines);
      const text = lines.slice(startIndex, endIndex).join("\n");
      const score = scoreKeywordChunk([hit.label, text].join("\n"), tokens);
      if (!best || score > best.score) {
        best = {
          startLine: startIndex + 1,
          endLine: endIndex,
          score
        };
      }
    }

    const fallback = best ?? { startLine: 1, endLine: Math.min(lines.length, keywordChunkLines), score: 0 };
    return {
      source,
      hit,
      startLine: fallback.startLine,
      endLine: fallback.endLine,
      reason: source.sourceKind === "raw" ? "keyword-overlap" : source.sourceKind === "converted" ? "converted-sidecar" : "paper-component",
      score: 500 + fallback.score - hit.rank * 10
    };
  }

  private async materializeWindows(pending: PendingWindow[], tokens: Set<string>): Promise<GraphifySourceChunk[]> {
    const metadataChunks = pending
      .filter((window) => !window.source.filePath)
      .map((window): GraphifySourceChunk => ({
        id: this.chunkId(window.source.sourceFile || window.hit.id, undefined, undefined, [window.hit.id]),
        sourceFile: window.source.sourceFile,
        displayName: window.source.displayName,
        nodeIds: [window.hit.id],
        nodeLabels: [window.hit.label],
        text: "",
        score: window.score,
        reason: "metadata-only"
      }));

    const byFile = new Map<string, PendingWindow[]>();
    for (const item of pending.filter((window) => window.source.filePath)) {
      const key = item.source.filePath as string;
      byFile.set(key, [...(byFile.get(key) ?? []), item]);
    }

    const chunks: GraphifySourceChunk[] = [];
    for (const [filePath, windows] of byFile) {
      const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
      const merged = this.mergeWindows(
        windows
          .filter((window) => window.startLine && window.endLine)
          .map((window) => ({
            ...window,
            startLine: Math.max(1, window.startLine as number),
            endLine: Math.min(lines.length, window.endLine as number)
          }))
      );

      for (const window of merged) {
        const text = lines
          .slice((window.startLine ?? 1) - 1, window.endLine)
          .join("\n")
          .slice(0, maxChunkChars)
          .trim();
        if (!text) {
          continue;
        }

        chunks.push({
          id: this.chunkId(window.source.sourceFile, window.startLine, window.endLine, window.nodeIds),
          sourceFile: window.source.sourceFile,
          displayName: window.source.displayName,
          startLine: window.startLine,
          endLine: window.endLine,
          nodeIds: window.nodeIds,
          nodeLabels: window.nodeLabels,
          text,
          score: window.score + scoreKeywordChunk(text, tokens),
          reason: window.reason
        });
      }
    }

    return [...chunks, ...metadataChunks].sort((left, right) => right.score - left.score);
  }

  private mergeWindows(windows: Array<PendingWindow & { startLine: number; endLine: number }>): Array<{
    source: SourceCandidate;
    startLine: number;
    endLine: number;
    nodeIds: string[];
    nodeLabels: string[];
    reason: GraphifySourceChunkReason;
    score: number;
  }> {
    const sorted = windows.sort(
      (left, right) =>
        left.source.sourceFile.localeCompare(right.source.sourceFile) || left.startLine - right.startLine || right.score - left.score
    );
    const merged: Array<{
      source: SourceCandidate;
      startLine: number;
      endLine: number;
      nodeIds: string[];
      nodeLabels: string[];
      reason: GraphifySourceChunkReason;
      score: number;
    }> = [];

    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (last && last.source.sourceFile === item.source.sourceFile && item.startLine <= last.endLine + mergeDistanceLines) {
        last.endLine = Math.max(last.endLine, item.endLine);
        last.nodeIds = [...new Set([...last.nodeIds, item.hit.id])];
        last.nodeLabels = [...new Set([...last.nodeLabels, item.hit.label])];
        last.score = Math.max(last.score, item.score);
        if (last.reason !== "node-location") {
          last.reason = item.reason;
        }
        continue;
      }

      merged.push({
        source: item.source,
        startLine: item.startLine,
        endLine: item.endLine,
        nodeIds: [item.hit.id],
        nodeLabels: [item.hit.label],
        reason: item.reason,
        score: item.score
      });
    }

    return merged;
  }

  private applyBudget(chunks: GraphifySourceChunk[]): GraphifySourceChunk[] {
    const selected: GraphifySourceChunk[] = [];
    const seen = new Set<string>();
    let totalChars = 0;

    for (const chunk of chunks) {
      if (selected.length >= maxSourceChunks) {
        break;
      }

      const key = `${chunk.sourceFile}:${chunk.startLine ?? ""}:${chunk.endLine ?? ""}:${chunk.nodeIds.join(",")}`;
      if (seen.has(key)) {
        continue;
      }

      const remaining = maxTotalChunkChars - totalChars;
      if (remaining <= 0) {
        break;
      }

      const text = chunk.text.length > remaining ? chunk.text.slice(0, remaining).trim() : chunk.text;
      selected.push({ ...chunk, text });
      totalChars += text.length;
      seen.add(key);
    }

    return selected;
  }

  private async findConvertedSidecar(sourceFile: string): Promise<string | null> {
    const files = await this.getConvertedMarkdownFiles();
    const sourceBase = basenameWithoutExtension(sourceFile);
    const exactRelative = normalizeRelativePath(sourceFile).toLowerCase();
    const direct = files.find((filePath) => this.toRelativeVaultPath(filePath).toLowerCase() === exactRelative);
    if (direct) {
      return direct;
    }

    return files.find((filePath) => basenameWithoutExtension(filePath) === sourceBase) ?? null;
  }

  private async findPaperComponent(sourceFile: string): Promise<string | null> {
    const artifacts = await this.getPaperArtifacts();
    const normalizedSource = normalizeRelativePath(sourceFile).toLowerCase();
    const sourceBase = path.basename(sourceFile).toLowerCase();
    const match = artifacts.find((artifact) => {
      const artifactSource = normalizeRelativePath(artifact.sourceFile).toLowerCase();
      return artifactSource === normalizedSource || path.basename(artifactSource).toLowerCase() === sourceBase;
    });
    if (!match) {
      return null;
    }

    return this.resolveVaultPath(match.artifactPath);
  }

  private async getConvertedMarkdownFiles(): Promise<string[]> {
    if (this.convertedMarkdownFiles) {
      return this.convertedMarkdownFiles;
    }

    const root = path.join(this.rawVaultPath, "graphify-out", "converted");
    this.convertedMarkdownFiles = await this.walkFiles(root, (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
    return this.convertedMarkdownFiles;
  }

  private async getPaperArtifacts(): Promise<PaperArtifactCandidate[]> {
    if (this.paperArtifacts) {
      return this.paperArtifacts;
    }

    const root = path.join(this.rawVaultPath, "paper-components");
    const indexFiles = await this.walkFiles(root, (entry) => entry.isFile() && entry.name === "artifact-index.json");
    const artifacts: PaperArtifactCandidate[] = [];

    for (const filePath of indexFiles) {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        const records = Array.isArray(parsed) ? parsed : Array.isArray(asRecord(parsed)?.artifacts) ? (asRecord(parsed)?.artifacts as unknown[]) : [];
        for (const item of records) {
          const record = asRecord(item);
          const sourceFile = asString(record?.sourceFile) || asString(record?.source_file);
          const artifactPath = asString(record?.artifactPath) || asString(record?.artifact_path) || asString(record?.path);
          if (sourceFile && artifactPath) {
            artifacts.push({ sourceFile, artifactPath });
          }
        }
      } catch {
        // Paper component indexes are rebuildable; ignore malformed files.
      }
    }

    this.paperArtifacts = artifacts;
    return artifacts;
  }

  private async walkFiles(root: string, include: (entry: Dirent) => boolean): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (include(entry)) {
          files.push(entryPath);
        }
      }
    };

    await visit(root);
    return files;
  }

  private resolveVaultPath(candidate: string): string | null {
    const normalized = normalizeRelativePath(candidate);
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(this.rawVaultPath, normalized);
    const relative = path.relative(this.rawVaultPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }

    return resolved;
  }

  private toRelativeVaultPath(filePath: string): string {
    return path.relative(this.rawVaultPath, filePath).split(path.sep).join(path.posix.sep);
  }

  private async canReadTextFile(filePath: string): Promise<boolean> {
    if (!readableSourceExtensions.has(path.extname(filePath).toLowerCase())) {
      return false;
    }

    const fileStat = await stat(filePath).catch(() => null);
    return Boolean(fileStat?.isFile() && fileStat.size <= maxReadableSourceBytes);
  }

  private chunkId(sourceFile: string, startLine: number | undefined, endLine: number | undefined, nodeIds: string[]): string {
    return [sourceFile || "metadata", startLine ?? "", endLine ?? "", ...nodeIds].join(":");
  }
}

export const sourceContentServiceTestUtils = {
  lineNumberFromLocation,
  scoreKeywordChunk,
  tokenize
};

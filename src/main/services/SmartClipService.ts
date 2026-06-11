import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProcessDroppedItem, SmartClip, SmartClipKind } from "../../shared/brain";

type SmartClipCandidate = {
  title: string;
  value: string;
  kind: SmartClipKind;
};

const maxSmartClips = 48;
const maxCandidatesPerDrop = 16;
const bashCommandPattern =
  /^(?:\$ |(?:npm|pnpm|yarn|bun|node|python3?|pipx?|uv|git|gh|docker|kubectl|ssh|scp|rsync|curl|wget|cd|ls|cat|rg|grep|find|mkdir|rm|cp|mv|chmod|chown|tar|zip|unzip|make|cmake|cargo|go|pytest|tsx|tsc|vite|electron)\b).+/i;
const windowsPathPattern = /\b[A-Za-z]:\\(?:[^<>"|?*\r\n\t ]+\\?)+/g;
const unixPathPattern = /(?:^|[\s"'(])((?:~|\.{1,2}|\/)[A-Za-z0-9._~+@%/-]+(?:\.[A-Za-z0-9]{1,12})?)/g;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function smartClipId(kind: SmartClipKind, value: string): string {
  const hash = createHash("sha1").update(`${kind}:${value}`).digest("hex").slice(0, 18);
  return `smart-clip-${hash}`;
}

function titleFor(kind: SmartClipKind, value: string): string {
  if (kind === "bash") {
    return compact(value.replace(/^\$\s*/, "")).slice(0, 80) || "Bash command";
  }

  if (kind === "path") {
    return value.replace(/[/\\]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || value.slice(0, 80) || "Path";
  }

  return compact(value).slice(0, 80) || "Clip";
}

function normalizeCandidate(kind: SmartClipKind, value: string): SmartClipCandidate | null {
  const normalized = kind === "bash" ? value.trim().replace(/^\$\s*/, "") : value.trim();

  if (normalized.length < 2 || normalized.length > 2_000) {
    return null;
  }

  return {
    kind,
    value: normalized,
    title: titleFor(kind, normalized)
  };
}

function extractPaths(text: string): SmartClipCandidate[] {
  const candidates: SmartClipCandidate[] = [];

  for (const match of text.matchAll(windowsPathPattern)) {
    const candidate = normalizeCandidate("path", match[0]);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const match of text.matchAll(unixPathPattern)) {
    const value = match[1] ?? match[0];
    if (/^https?:\/\//i.test(value)) {
      continue;
    }

    const candidate = normalizeCandidate("path", value);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function extractBashCommands(text: string): SmartClipCandidate[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => bashCommandPattern.test(line))
    .map((line) => normalizeCandidate("bash", line))
    .filter((candidate): candidate is SmartClipCandidate => Boolean(candidate));
}

function extractTextClip(text: string): SmartClipCandidate[] {
  const normalized = compact(text);
  if (!normalized || normalized.length > 1_000) {
    return [];
  }

  const candidate = normalizeCandidate("text", normalized);
  return candidate ? [candidate] : [];
}

function sortForDisplay(items: SmartClip[]): SmartClip[] {
  return [...items].sort(
    (left, right) =>
      right.frequency - left.frequency ||
      Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) ||
      left.title.localeCompare(right.title)
  );
}

function pruneLfu(items: SmartClip[]): SmartClip[] {
  if (items.length <= maxSmartClips) {
    return items;
  }

  const removeIds = new Set(
    [...items]
      .sort(
        (left, right) =>
          left.frequency - right.frequency ||
          Date.parse(left.lastUsedAt) - Date.parse(right.lastUsedAt) ||
          left.title.localeCompare(right.title)
      )
      .slice(0, items.length - maxSmartClips)
      .map((item) => item.id)
  );

  return items.filter((item) => !removeIds.has(item.id));
}

export class SmartClipService {
  private readonly storePath: string;
  private items: SmartClip[] = [];

  constructor(private readonly userDataPath: string) {
    this.storePath = path.join(userDataPath, "smart-clips.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });

    try {
      const parsed = JSON.parse(await readFile(this.storePath, "utf8")) as unknown;
      this.items = Array.isArray(parsed) ? parsed.filter(this.isSmartClip) : [];
    } catch {
      this.items = [];
    }
  }

  async listClips(): Promise<SmartClip[]> {
    return sortForDisplay(this.items);
  }

  async recordUse(id: string): Promise<SmartClip> {
    const now = new Date().toISOString();
    const index = this.items.findIndex((item) => item.id === id);

    if (index < 0) {
      throw new Error(`Smart Clip not found: ${id}`);
    }

    const current = this.items[index] as SmartClip;
    const updated = {
      ...current,
      frequency: current.frequency + 1,
      lastUsedAt: now
    };

    this.items.splice(index, 1, updated);
    await this.save();
    return updated;
  }

  async ingestDroppedItems(items: ProcessDroppedItem[], rawContent = ""): Promise<SmartClip[]> {
    const candidates = this.extractCandidates(items, rawContent).slice(0, maxCandidatesPerDrop);
    if (candidates.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const changed: SmartClip[] = [];

    for (const candidate of candidates) {
      const id = smartClipId(candidate.kind, candidate.value);
      const existingIndex = this.items.findIndex((item) => item.id === id);

      if (existingIndex >= 0) {
        const existing = this.items[existingIndex] as SmartClip;
        const updated = {
          ...existing,
          title: candidate.title,
          frequency: existing.frequency + 1,
          lastUsedAt: now
        };

        this.items.splice(existingIndex, 1, updated);
        changed.push(updated);
        continue;
      }

      const clip: SmartClip = {
        id,
        title: candidate.title,
        value: candidate.value,
        kind: candidate.kind,
        frequency: 1,
        createdAt: now,
        lastUsedAt: now
      };

      this.items.push(clip);
      changed.push(clip);
    }

    this.items = pruneLfu(this.items);
    await this.save();
    return sortForDisplay(changed);
  }

  private extractCandidates(items: ProcessDroppedItem[], rawContent: string): SmartClipCandidate[] {
    const candidates: SmartClipCandidate[] = [];

    for (const item of items) {
      if (item.path) {
        const candidate = normalizeCandidate("path", item.path);
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    const text = [
      rawContent,
      ...items.map((item) => item.text ?? item.content ?? item.name ?? item.path ?? "")
    ]
      .filter(Boolean)
      .join("\n");

    candidates.push(...extractBashCommands(text), ...extractPaths(text));

    if (candidates.length === 0) {
      candidates.push(...extractTextClip(text));
    }

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.kind}:${candidate.value}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private isSmartClip(value: unknown): value is SmartClip {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.value === "string" &&
      (candidate.kind === "bash" || candidate.kind === "path" || candidate.kind === "text") &&
      typeof candidate.frequency === "number" &&
      typeof candidate.createdAt === "string" &&
      typeof candidate.lastUsedAt === "string"
    );
  }

  private async save(): Promise<void> {
    await writeFile(this.storePath, `${JSON.stringify(sortForDisplay(this.items), null, 2)}\n`, "utf8");
  }
}

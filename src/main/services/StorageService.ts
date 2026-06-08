import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  BrainNode,
  BrainNodeFrontmatter,
  IngestAndRouteFragmentInput,
  ListBrainNodesInput,
  UpdateNodeSignalsInput,
  UserValidationState,
  WriteBrainNodeInput
} from "../../shared/brain";

type UuidModule = {
  v4: () => string;
};

let uuidModulePromise: Promise<UuidModule> | null = null;

async function createUuid(): Promise<string> {
  try {
    uuidModulePromise ??= new Function("specifier", "return import(specifier)")("uuid") as Promise<UuidModule>;
    const uuidModule = await uuidModulePromise;
    return uuidModule.v4();
  } catch {
    return randomUUID();
  }
}

function wordsIn(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Frontmatter field "${field}" must be a string array.`);
  }

  return value;
}

function optionalStringArray(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function clampImportance(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function isUserValidationState(value: unknown): value is UserValidationState {
  return value === "unreviewed" || value === "approved" || value === "rejected" || value === "pinned";
}

function slugifyFilePart(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "untitled";
}

export class StorageService {
  constructor(private readonly vaultPath: string) {}

  getVaultPath(): string {
    return this.vaultPath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.vaultPath, { recursive: true });
  }

  async writeNode(input: WriteBrainNodeInput): Promise<BrainNode> {
    await this.initialize();

    const existingPath = input.uuid ? await this.findNodePath(input.uuid) : null;
    const existingNode = existingPath ? await this.readNodeFile(existingPath) : null;
    const frontmatter = await this.normalizeInput(input, existingNode);
    const filePath = existingPath ?? path.join(this.vaultPath, `${slugifyFilePart(frontmatter.title)}-${frontmatter.uuid}.md`);
    const serialized = matter.stringify(`${input.content.trim()}\n`, frontmatter);

    await writeFile(filePath, serialized, "utf8");
    return this.readNode(frontmatter.uuid);
  }

  async readNode(uuid: string): Promise<BrainNode> {
    await this.initialize();

    const filePath = await this.findNodePath(uuid);
    if (!filePath) {
      throw new Error(`No markdown node found for uuid "${uuid}".`);
    }

    return this.readNodeFile(filePath);
  }

  async ingestFragment(input: IngestAndRouteFragmentInput): Promise<BrainNode> {
    const node = await this.writeNode({
      title: input.inferred_title,
      type: "fragment",
      summary: input.generated_summary,
      parent_uuid: input.target_parent_uuid ?? null,
      connections: [],
      tags: [],
      importance: input.importance,
      context_hints: input.context_hints,
      content: input.raw_content
    });

    if (input.target_parent_uuid) {
      await this.addConnection(input.target_parent_uuid, node.uuid);
    }

    return node;
  }

  async addConnection(parentUuid: string, childUuid: string): Promise<BrainNode> {
    const parent = await this.readNode(parentUuid);
    const connections = Array.from(new Set([...parent.connections, childUuid]));

    return this.writeNode({
      uuid: parent.uuid,
      title: parent.title,
      type: parent.type,
      summary: parent.summary,
      parent_uuid: parent.parent_uuid,
      connections,
      tags: parent.tags,
      created_at: parent.created_at,
      importance: parent.importance,
      user_validation: parent.user_validation,
      context_hints: parent.context_hints,
      content: parent.content
    });
  }

  async updateNodeSignals(input: UpdateNodeSignalsInput): Promise<BrainNode> {
    const node = await this.readNode(input.uuid);

    return this.writeNode({
      uuid: node.uuid,
      title: node.title,
      type: node.type,
      summary: node.summary,
      parent_uuid: node.parent_uuid,
      connections: node.connections,
      tags: node.tags,
      created_at: node.created_at,
      importance: input.importance ?? node.importance,
      user_validation: input.user_validation ?? node.user_validation,
      context_hints: input.context_hints ?? node.context_hints,
      content: node.content
    });
  }

  async fetchFileSegments(uuid: string, sections?: string[]): Promise<string> {
    const node = await this.readNode(uuid);

    if (!sections?.length) {
      return node.content;
    }

    const segmentMap = this.parseMarkdownSections(node.content);
    const requested = sections
      .map((section) => segmentMap.get(section.trim().toLowerCase()))
      .filter((section): section is string => Boolean(section));

    return requested.join("\n\n").trim();
  }

  async listNodes(input: ListBrainNodesInput = {}): Promise<BrainNode[]> {
    await this.initialize();

    const files = await this.listMarkdownFiles(this.vaultPath);
    const nodes = (
      await Promise.all(
        files.map(async (filePath) => {
          try {
            return await this.readNodeFile(filePath);
          } catch (error) {
            console.warn(`Skipping non-vault markdown file at ${filePath}`, error);
            return null;
          }
        })
      )
    ).filter((node): node is BrainNode => Boolean(node));

    return nodes
      .filter((node) => !input.type || node.type === input.type)
      .filter((node) => !input.tag || node.tags.includes(input.tag))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async normalizeInput(input: WriteBrainNodeInput, existingNode: BrainNode | null): Promise<BrainNodeFrontmatter> {
    if (!input.title.trim()) {
      throw new Error("Node title is required.");
    }

    if (!input.type.trim()) {
      throw new Error("Node type is required.");
    }

    if (wordsIn(input.summary) > 150) {
      throw new Error("Node summary must be 150 words or fewer.");
    }

    return {
      uuid: input.uuid?.trim() || existingNode?.uuid || (await createUuid()),
      title: input.title.trim(),
      type: input.type.trim(),
      summary: input.summary.trim(),
      parent_uuid: input.parent_uuid !== undefined ? input.parent_uuid?.trim() || null : existingNode?.parent_uuid ?? null,
      connections: input.connections ?? existingNode?.connections ?? [],
      tags: input.tags ?? existingNode?.tags ?? [],
      created_at: input.created_at ?? existingNode?.created_at ?? new Date().toISOString(),
      importance: clampImportance(input.importance ?? existingNode?.importance),
      user_validation: input.user_validation ?? existingNode?.user_validation ?? "unreviewed",
      context_hints: input.context_hints ?? existingNode?.context_hints ?? []
    };
  }

  private validateFrontmatter(data: Record<string, unknown>, filePath: string): BrainNodeFrontmatter {
    const uuid = data.uuid;
    const title = data.title;
    const type = data.type;
    const summary = data.summary;
    const parentUuid = data.parent_uuid;
    const createdAt = data.created_at;
    const importance = data.importance;
    const userValidation = data.user_validation;
    const contextHints = data.context_hints;

    if (typeof uuid !== "string" || !uuid.trim()) {
      throw new Error(`${filePath} is missing required frontmatter field "uuid".`);
    }

    if (typeof title !== "string" || !title.trim()) {
      throw new Error(`${filePath} is missing required frontmatter field "title".`);
    }

    if (typeof type !== "string" || !type.trim()) {
      throw new Error(`${filePath} is missing required frontmatter field "type".`);
    }

    if (typeof summary !== "string") {
      throw new Error(`${filePath} is missing required frontmatter field "summary".`);
    }

    if (wordsIn(summary) > 150) {
      throw new Error(`${filePath} has a summary longer than 150 words.`);
    }

    if (parentUuid !== null && typeof parentUuid !== "string") {
      throw new Error(`${filePath} frontmatter field "parent_uuid" must be a string or null.`);
    }

    return {
      uuid,
      title,
      type,
      summary,
      parent_uuid: parentUuid || null,
      connections: stringArray(data.connections, "connections"),
      tags: stringArray(data.tags, "tags"),
      created_at: typeof createdAt === "string" && createdAt.trim() ? createdAt : new Date(0).toISOString(),
      importance: clampImportance(typeof importance === "number" ? importance : undefined),
      user_validation: isUserValidationState(userValidation) ? userValidation : "unreviewed",
      context_hints: Array.isArray(contextHints) ? stringArray(contextHints, "context_hints") : []
    };
  }

  private async readNodeFile(filePath: string): Promise<BrainNode> {
    const raw = await readFile(filePath, "utf8");
    const parsed = matter(raw);
    const fileStat = await stat(filePath);
    const frontmatter = this.validateFrontmatter(parsed.data, filePath);

    return {
      ...frontmatter,
      content: parsed.content.trim(),
      path: filePath,
      updatedAt: fileStat.mtime.toISOString()
    };
  }

  private async findNodePath(uuid: string): Promise<string | null> {
    const files = await this.listMarkdownFiles(this.vaultPath);

    for (const filePath of files) {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = matter(raw);
        if (parsed.data.uuid === uuid) {
          return filePath;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private parseMarkdownSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split(/\r?\n/);
    let currentHeading: string | null = null;
    let currentLines: string[] = [];

    const flush = (): void => {
      if (!currentHeading) {
        return;
      }

      sections.set(currentHeading, currentLines.join("\n").trim());
    };

    for (const line of lines) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);

      if (heading) {
        flush();
        currentHeading = heading[1]?.trim().toLowerCase() ?? null;
        currentLines = [];
        continue;
      }

      if (currentHeading) {
        currentLines.push(line);
      }
    }

    flush();
    return sections;
  }

  private async listMarkdownFiles(directory: string): Promise<string[]> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === "raw" || entry.name === "graphify-out") {
            return [];
          }

          return this.listMarkdownFiles(entryPath);
        }

        return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
      })
    );

    return files.flat();
  }
}

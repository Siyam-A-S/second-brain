import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BrainNode,
  CreateTrackerInput,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateTrackerInput
} from "../../shared/brain";
import type { StorageService } from "./StorageService";

const trackerStatuses: TrackerStatus[] = ["backlog", "todo", "in_progress", "blocked", "done"];
const trackerPriorities: TrackerPriority[] = ["low", "medium", "high", "urgent"];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStatus(value: unknown): TrackerStatus {
  return trackerStatuses.includes(value as TrackerStatus) ? (value as TrackerStatus) : "todo";
}

function normalizePriority(value: unknown): TrackerPriority {
  return trackerPriorities.includes(value as TrackerPriority) ? (value as TrackerPriority) : "medium";
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : fallback;
}

function normalizeOptionalDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
            .map((item) => item.trim())
        )
      )
    : [];
}

function compareTickets(left: TrackerRecord, right: TrackerRecord): number {
  const statusOrder = new Map<TrackerStatus, number>([
    ["blocked", 0],
    ["in_progress", 1],
    ["todo", 2],
    ["backlog", 3],
    ["done", 4]
  ]);
  return (
    (statusOrder.get(left.status) ?? 99) - (statusOrder.get(right.status) ?? 99) ||
    (left.dueDate ?? "9999-99-99").localeCompare(right.dueDate ?? "9999-99-99") ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function legacyTrackerToTicket(node: BrainNode): TrackerRecord | null {
  try {
    const parsed = JSON.parse(node.content) as Record<string, unknown>;
    const timestamp = node.updatedAt || nowIso();
    const status = normalizeText(parsed.status) === "Done" ? "done" : "todo";
    const labels = ["imported-tracker"];

    if (normalizeText(parsed.status) === "Dismissed") {
      labels.push("dismissed");
    }

    return {
      uuid: node.uuid,
      title: normalizeText(parsed.title, node.title).slice(0, 120),
      description: normalizeText(parsed.context, node.summary),
      status,
      priority: "medium",
      labels,
      dueDate: normalizeOptionalDate(parsed.date),
      sourceNodeIds: normalizeStringArray(parsed.source_node_uuid ? [parsed.source_node_uuid] : []),
      sourceFiles: normalizeStringArray(parsed.source ? [parsed.source] : []),
      createdAt: node.created_at,
      updatedAt: timestamp
    };
  } catch {
    return null;
  }
}

export class TrackerService {
  private tickets: TrackerRecord[] = [];

  constructor(private readonly trackerPath: string) {}

  async initialize(legacyStorage?: StorageService): Promise<void> {
    await mkdir(path.dirname(this.trackerPath), { recursive: true });

    try {
      const parsed = JSON.parse(await readFile(this.trackerPath, "utf8")) as unknown;
      this.tickets = Array.isArray(parsed)
        ? parsed.map((item) => this.normalizeTicket(item)).filter((ticket): ticket is TrackerRecord => Boolean(ticket))
        : [];
    } catch {
      this.tickets = [];
    }

    if (this.tickets.length === 0 && legacyStorage) {
      await this.importLegacyTrackers(legacyStorage);
    }

    await this.persist();
  }

  async listTrackers(): Promise<TrackerRecord[]> {
    await this.initialize();
    return [...this.tickets].sort(compareTickets);
  }

  async createTracker(input: CreateTrackerInput): Promise<TrackerRecord> {
    await this.initialize();
    const timestamp = nowIso();
    const ticket: TrackerRecord = {
      uuid: randomUUID(),
      title: normalizeText(input.title, "Untitled ticket").slice(0, 120),
      description: normalizeText(input.description),
      status: normalizeStatus(input.status),
      priority: normalizePriority(input.priority),
      labels: normalizeStringArray(input.labels),
      dueDate: normalizeOptionalDate(input.dueDate),
      sourceNodeIds: normalizeStringArray(input.sourceNodeIds),
      sourceFiles: normalizeStringArray(input.sourceFiles),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.tickets.unshift(ticket);
    await this.persist();
    return ticket;
  }

  async updateTracker(input: UpdateTrackerInput): Promise<TrackerRecord> {
    await this.initialize();
    const index = this.tickets.findIndex((ticket) => ticket.uuid === input.uuid);
    if (index < 0) {
      throw new Error(`Tracker ticket "${input.uuid}" was not found.`);
    }

    const current = this.tickets[index] as TrackerRecord;
    const next: TrackerRecord = {
      ...current,
      title: input.title !== undefined ? normalizeText(input.title, current.title).slice(0, 120) : current.title,
      description:
        input.description !== undefined ? normalizeText(input.description, current.description) : current.description,
      status: input.status !== undefined ? normalizeStatus(input.status) : current.status,
      priority: input.priority !== undefined ? normalizePriority(input.priority) : current.priority,
      labels: input.labels !== undefined ? normalizeStringArray(input.labels) : current.labels,
      dueDate: input.dueDate === null ? undefined : input.dueDate !== undefined ? normalizeOptionalDate(input.dueDate) : current.dueDate,
      sourceNodeIds: input.sourceNodeIds !== undefined ? normalizeStringArray(input.sourceNodeIds) : current.sourceNodeIds,
      sourceFiles: input.sourceFiles !== undefined ? normalizeStringArray(input.sourceFiles) : current.sourceFiles,
      updatedAt: nowIso()
    };

    this.tickets.splice(index, 1, next);
    await this.persist();
    return next;
  }

  async removeTracker(uuid: string): Promise<void> {
    await this.initialize();
    this.tickets = this.tickets.filter((ticket) => ticket.uuid !== uuid);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.tickets = [];
    await rm(this.trackerPath, { force: true });
  }

  private async importLegacyTrackers(storage: StorageService): Promise<void> {
    try {
      const nodes = await storage.listNodes({ type: "tracker" });
      this.tickets = nodes.map(legacyTrackerToTicket).filter((ticket): ticket is TrackerRecord => Boolean(ticket));
    } catch (error) {
      console.warn("Unable to import legacy tracker records.", error);
    }
  }

  private normalizeTicket(value: unknown): TrackerRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const uuid = normalizeText(record.uuid);
    const title = normalizeText(record.title);
    const createdAt = normalizeText(record.createdAt, nowIso());
    const updatedAt = normalizeText(record.updatedAt, createdAt);

    if (!uuid || !title) {
      return null;
    }

    return {
      uuid,
      title,
      description: normalizeText(record.description),
      status: normalizeStatus(record.status),
      priority: normalizePriority(record.priority),
      labels: normalizeStringArray(record.labels),
      dueDate: normalizeOptionalDate(record.dueDate),
      sourceNodeIds: normalizeStringArray(record.sourceNodeIds),
      sourceFiles: normalizeStringArray(record.sourceFiles),
      createdAt,
      updatedAt
    };
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.trackerPath), { recursive: true });
    await writeFile(this.trackerPath, `${JSON.stringify(this.tickets, null, 2)}\n`, "utf8");
  }
}

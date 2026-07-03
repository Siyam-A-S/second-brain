import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  BrainNode,
  CreateTrackerInput,
  TrackerPriority,
  TrackerListInput,
  TrackerRecord,
  TrackerStatus,
  UpdateTrackerInput
} from "../../shared/brain";
import { runtimePythonCommands, withRuntimePath } from "./RuntimeCommandPaths";
import type { StorageService } from "./StorageService";

const trackerStatuses: TrackerStatus[] = ["backlog", "todo", "in_progress", "blocked", "done"];
const trackerPriorities: TrackerPriority[] = ["low", "medium", "high", "urgent"];
const sqliteHelperScript = String.raw`
import json
import sqlite3
import sys

request = json.load(sys.stdin)
db_path = request["dbPath"]
op = request["op"]
payload = request.get("payload") or {}

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
conn.execute("""
CREATE TABLE IF NOT EXISTS tracker_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'TODO',
  priority TEXT DEFAULT 'NORMAL',
  due_date DATETIME,
  linked_node_ids TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")
existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(tracker_events)").fetchall()}
for column_name, column_sql in {
    "project_id": "TEXT",
    "project_name": "TEXT",
    "labels": "TEXT",
    "source_files": "TEXT",
    "updated_at": "DATETIME",
}.items():
    if column_name not in existing_columns:
        conn.execute(f"ALTER TABLE tracker_events ADD COLUMN {column_name} {column_sql}")
conn.commit()

def row_to_dict(row):
    return {
        "id": row["id"],
        "project_id": row["project_id"] or "",
        "project_name": row["project_name"] or "",
        "title": row["title"],
        "description": row["description"] or "",
        "status": row["status"] or "TODO",
        "priority": row["priority"] or "NORMAL",
        "due_date": row["due_date"],
        "linked_node_ids": row["linked_node_ids"] or "[]",
        "labels": row["labels"] or "[]",
        "source_files": row["source_files"] or "[]",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"] or row["created_at"],
    }

def list_rows():
    rows = conn.execute(
        """
        SELECT id, project_id, project_name, title, description, status, priority, due_date,
          linked_node_ids, labels, source_files, created_at, updated_at
        FROM tracker_events
        WHERE (? != 'project' OR project_id = ?)
        """,
        (payload.get("scope") or "project", payload.get("project_id") or ""),
    ).fetchall()
    return [row_to_dict(row) for row in rows]

if op == "list":
    result = list_rows()
elif op == "create":
    conn.execute(
        """
        INSERT INTO tracker_events (
          id, project_id, project_name, title, description, status, priority, due_date,
          linked_node_ids, labels, source_files, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("project_id") or "",
            payload.get("project_name") or "",
            payload["title"],
            payload.get("description") or "",
            payload.get("status") or "TODO",
            payload.get("priority") or "NORMAL",
            payload.get("due_date"),
            json.dumps(payload.get("linked_node_ids") or []),
            json.dumps(payload.get("labels") or []),
            json.dumps(payload.get("source_files") or []),
            payload.get("created_at"),
            payload.get("updated_at") or payload.get("created_at"),
        ),
    )
    conn.commit()
    result = row_to_dict(conn.execute(
        """
        SELECT id, project_id, project_name, title, description, status, priority, due_date,
          linked_node_ids, labels, source_files, created_at, updated_at
        FROM tracker_events WHERE id = ?
        """,
        (payload["id"],),
    ).fetchone())
elif op == "update":
    fields = []
    values = []
    for column in ["title", "description", "status", "priority", "due_date", "linked_node_ids", "labels", "source_files"]:
        if column in payload:
            fields.append(f"{column} = ?")
            if column in {"linked_node_ids", "labels", "source_files"}:
                values.append(json.dumps(payload.get(column) or []))
            else:
                values.append(payload.get(column))
    fields.append("updated_at = ?")
    values.append(payload.get("updated_at"))
    if fields:
        values.append(payload["id"])
        conn.execute(f"UPDATE tracker_events SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    row = conn.execute(
        """
        SELECT id, project_id, project_name, title, description, status, priority, due_date,
          linked_node_ids, labels, source_files, created_at, updated_at
        FROM tracker_events WHERE id = ?
        """,
        (payload["id"],),
    ).fetchone()
    if row is None:
        raise SystemExit(f"Tracker event not found: {payload['id']}")
    result = row_to_dict(row)
elif op == "remove":
    conn.execute("DELETE FROM tracker_events WHERE id = ?", (payload["id"],))
    conn.commit()
    result = {"ok": True}
elif op == "clear":
    conn.execute("DELETE FROM tracker_events")
    conn.commit()
    result = {"ok": True}
else:
    raise SystemExit(f"Unsupported tracker sqlite op: {op}")

print(json.dumps(result))
`;

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
  const parsed = new Date(trimmed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return undefined;
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

function dbStatus(status: TrackerStatus | undefined): string {
  switch (status) {
    case "backlog":
      return "BACKLOG";
    case "in_progress":
      return "IN_PROGRESS";
    case "blocked":
      return "BLOCKED";
    case "done":
      return "COMPLETED";
    default:
      return "TODO";
  }
}

function appStatus(status: unknown): TrackerStatus {
  switch (normalizeText(status).toUpperCase()) {
    case "BACKLOG":
      return "backlog";
    case "IN_PROGRESS":
      return "in_progress";
    case "BLOCKED":
      return "blocked";
    case "COMPLETED":
    case "DONE":
      return "done";
    default:
      return "todo";
  }
}

function dbPriority(priority: TrackerPriority | undefined): string {
  switch (priority) {
    case "low":
      return "LOW";
    case "high":
      return "HIGH";
    case "urgent":
      return "URGENT";
    default:
      return "NORMAL";
  }
}

function appPriority(priority: unknown): TrackerPriority {
  switch (normalizeText(priority).toUpperCase()) {
    case "LOW":
      return "low";
    case "HIGH":
      return "high";
    case "URGENT":
      return "urgent";
    default:
      return "medium";
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function legacyTrackerToTicket(node: BrainNode): CreateTrackerInput | null {
  try {
    const parsed = JSON.parse(node.content) as Record<string, unknown>;
    const status = normalizeText(parsed.status) === "Done" ? "done" : "todo";
    const labels = ["imported-tracker"];

    if (normalizeText(parsed.status) === "Dismissed") {
      labels.push("dismissed");
    }

    return {
      title: normalizeText(parsed.title, node.title).slice(0, 120),
      description: normalizeText(parsed.context, node.summary),
      status,
      priority: "medium",
      labels,
      dueDate: normalizeOptionalDate(parsed.date),
      sourceNodeIds: normalizeStringArray(parsed.source_node_uuid ? [parsed.source_node_uuid] : []),
      sourceFiles: normalizeStringArray(parsed.source ? [parsed.source] : [])
    };
  } catch {
    return null;
  }
}

type DbTrackerRow = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date?: string | null | undefined;
  linked_node_ids: string;
  labels: string;
  source_files: string;
  created_at: string;
  updated_at: string;
};

export class TrackerService {
  private initialized = false;

  constructor(
    private readonly dbPath: string,
    private readonly project: { id: string; name: string }
  ) {}

  async initialize(legacyStorage?: StorageService): Promise<void> {
    if (this.initialized) {
      return;
    }

    await mkdir(path.dirname(this.dbPath), { recursive: true });
    const existing = await this.runSqlite<DbTrackerRow[]>("list", { scope: "all" });
    this.initialized = true;
    if (existing.length === 0 && legacyStorage) {
      await this.importLegacyTrackers(legacyStorage);
    }
  }

  async listTrackers(input?: TrackerListInput): Promise<TrackerRecord[]> {
    await this.initialize();
    const rows = await this.runSqlite<DbTrackerRow[]>("list", {
      scope: input?.scope === "all" ? "all" : "project",
      project_id: this.project.id
    });
    return rows.map((row) => this.rowToTracker(row)).sort(compareTickets);
  }

  async createTracker(input: CreateTrackerInput): Promise<TrackerRecord> {
    await this.initialize();
    const timestamp = nowIso();
    const row = await this.runSqlite<DbTrackerRow>("create", {
      id: randomUUID(),
      project_id: this.project.id,
      project_name: this.project.name,
      title: normalizeText(input.title, "Untitled ticket").slice(0, 120),
      description: normalizeText(input.description),
      status: dbStatus(normalizeStatus(input.status)),
      priority: dbPriority(normalizePriority(input.priority)),
      due_date: normalizeOptionalDate(input.dueDate),
      linked_node_ids: normalizeStringArray(input.sourceNodeIds),
      labels: normalizeStringArray(input.labels),
      source_files: normalizeStringArray(input.sourceFiles),
      created_at: timestamp,
      updated_at: timestamp
    });

    return this.rowToTracker(row, input);
  }

  async updateTracker(input: UpdateTrackerInput): Promise<TrackerRecord> {
    await this.initialize();
    const payload: Record<string, unknown> = { id: input.uuid };
    if (input.title !== undefined) {
      payload.title = normalizeText(input.title, "Untitled ticket").slice(0, 120);
    }
    if (input.description !== undefined) {
      payload.description = normalizeText(input.description);
    }
    if (input.status !== undefined) {
      payload.status = dbStatus(normalizeStatus(input.status));
    }
    if (input.priority !== undefined) {
      payload.priority = dbPriority(normalizePriority(input.priority));
    }
    if (input.dueDate !== undefined) {
      payload.due_date = input.dueDate === null ? null : normalizeOptionalDate(input.dueDate);
    }
    if (input.sourceNodeIds !== undefined) {
      payload.linked_node_ids = normalizeStringArray(input.sourceNodeIds);
    }
    if (input.labels !== undefined) {
      payload.labels = normalizeStringArray(input.labels);
    }
    if (input.sourceFiles !== undefined) {
      payload.source_files = normalizeStringArray(input.sourceFiles);
    }
    payload.updated_at = nowIso();

    return this.rowToTracker(await this.runSqlite<DbTrackerRow>("update", payload), input);
  }

  async removeTracker(uuid: string): Promise<void> {
    await this.initialize();
    await this.runSqlite("remove", { id: uuid });
  }

  async clear(): Promise<void> {
    await this.runSqlite("clear", {});
  }

  async dueSoon(referenceDate = new Date()): Promise<TrackerRecord[]> {
    const tickets = await this.listTrackers({ scope: "all" });
    const now = referenceDate.getTime();
    const windowsMs = [15 * 60_000, 60 * 60_000];
    return tickets.filter((ticket) => {
      if (!ticket.dueDate || ticket.status === "done") {
        return false;
      }

      const due = new Date(ticket.dueDate).getTime();
      if (Number.isNaN(due)) {
        return false;
      }

      return windowsMs.some((windowMs) => Math.abs(due - now - windowMs) <= 2.5 * 60_000);
    });
  }

  async undatedOpenCount(): Promise<number> {
    return (await this.listTrackers({ scope: "all" })).filter((ticket) => ticket.status !== "done" && !ticket.dueDate).length;
  }

  private async importLegacyTrackers(storage: StorageService): Promise<void> {
    try {
      const nodes = await storage.listNodes({ type: "tracker" });
      const tickets = nodes.map(legacyTrackerToTicket).filter((ticket): ticket is CreateTrackerInput => Boolean(ticket));
      for (const ticket of tickets) {
        await this.createTracker(ticket);
      }
    } catch (error) {
      console.warn("Unable to import legacy tracker records.", error);
    }
  }

  private rowToTracker(row: DbTrackerRow, fallback?: Partial<CreateTrackerInput | UpdateTrackerInput>): TrackerRecord {
    const linkedNodeIds = parseJsonArray(row.linked_node_ids);
    const createdAt = normalizeText(row.created_at, nowIso());
    return {
      uuid: row.id,
      projectId: normalizeText(row.project_id, this.project.id),
      projectName: normalizeText(row.project_name, this.project.name),
      title: normalizeText(row.title, "Untitled ticket").slice(0, 120),
      description: normalizeText(row.description),
      status: appStatus(row.status),
      priority: appPriority(row.priority),
      labels: normalizeStringArray(fallback && "labels" in fallback ? fallback.labels : parseJsonArray(row.labels)),
      dueDate: normalizeOptionalDate(row.due_date),
      sourceNodeIds: linkedNodeIds,
      sourceFiles: normalizeStringArray(fallback && "sourceFiles" in fallback ? fallback.sourceFiles : parseJsonArray(row.source_files)),
      createdAt,
      updatedAt: normalizeText(row.updated_at, createdAt)
    };
  }

  private async runSqlite<T = unknown>(op: string, payload: Record<string, unknown>): Promise<T> {
    const request = JSON.stringify({ dbPath: this.dbPath, op, payload });
    const errors: string[] = [];

    for (const command of runtimePythonCommands()) {
      try {
        return await new Promise<T>((resolve, reject) => {
          const child = spawn(command, ["-c", sqliteHelperScript], {
            env: withRuntimePath(),
            windowsHide: true
          });
          let stdout = "";
          let stderr = "";

          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            if (code !== 0) {
              reject(new Error(stderr.trim() || `SQLite helper exited with code ${code ?? "unknown"}.`));
              return;
            }

            try {
              resolve(JSON.parse(stdout) as T);
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(request);
        });
      } catch (error) {
        errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`Unable to run tracker SQLite helper. Tried ${errors.join("; ")}`);
  }
}

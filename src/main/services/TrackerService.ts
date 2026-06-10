import type { BrainNode, TrackerRecord, TrackerStatus, UpdateTrackerInput } from "../../shared/brain";
import { LlmService } from "./LlmService";
import type { StorageService } from "./StorageService";

type StoredTrackerContent = {
  title: string;
  date?: string | undefined;
  time?: string | undefined;
  endTime?: string | undefined;
  timezone?: string | undefined;
  location?: string | undefined;
  link?: string | undefined;
  context: string;
  source_node_uuid?: string | undefined;
  source?: string | undefined;
  status?: TrackerStatus | undefined;
  raw_content: string;
};

const defaultStatus: TrackerStatus = "Tracking";
const statusOptions: TrackerStatus[] = ["Tracking", "Done", "Dismissed"];

function normalizeStatus(value: unknown): TrackerStatus {
  return statusOptions.includes(value as TrackerStatus) ? (value as TrackerStatus) : defaultStatus;
}

function normalizeDate(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "";
}

function normalizeLine(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : fallback;
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function safeTitle(value: string): string {
  return normalizeLine(value, "Track item").slice(0, 90);
}

function summarizeRawContent(rawContent: string): string {
  return normalizeLine(rawContent).slice(0, 420);
}

export class TrackerService {
  constructor(
    private readonly storage: StorageService,
    private readonly llm: LlmService
  ) {}

  async listTrackers(): Promise<TrackerRecord[]> {
    const nodes = await this.storage.listNodes({ type: "tracker" });

    return nodes
      .map((node) => this.nodeToTrackerRecord(node))
      .filter((tracker): tracker is TrackerRecord => Boolean(tracker))
      .sort(this.sortTrackers);
  }

  async ingestTrackableContent(rawContent: string, source = "", sourceNodeUuid?: string): Promise<TrackerRecord[]> {
    const metadata = await this.llm.extractTrackerMetadata(rawContent, source);
    const trackableItems = metadata.filter((item) => item.trackable);

    if (trackableItems.length === 0) {
      return [];
    }

    const records: TrackerRecord[] = [];

    for (const item of trackableItems) {
      const content: StoredTrackerContent = {
        title: safeTitle(item.title),
        date: item.date,
        time: item.time,
        ...(item.endTime ? { endTime: item.endTime } : {}),
        ...(item.timezone ? { timezone: item.timezone } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(item.link ? { link: item.link } : {}),
        context: item.context || summarizeRawContent(rawContent),
        ...(sourceNodeUuid ? { source_node_uuid: sourceNodeUuid } : {}),
        ...(source ? { source } : {}),
        status: defaultStatus,
        raw_content: rawContent
      };

      const node = await this.storage.writeNode({
        title: content.title,
        type: "tracker",
        summary: content.context,
        parent_uuid: null,
        connections: sourceNodeUuid ? [sourceNodeUuid] : [],
        tags: ["tracker"],
        importance: 0.75,
        context_hints: [
          content.date ?? "",
          content.time ?? "",
          content.location ?? "",
          content.link ?? "",
          source,
          "tracker"
        ].filter(Boolean),
        content: JSON.stringify(content, null, 2)
      });

      records.push(
        this.nodeToTrackerRecord(node) ?? {
          uuid: node.uuid,
          ...content,
          date: content.date ?? "",
          time: content.time ?? "",
          status: defaultStatus,
          createdAt: node.created_at,
          updatedAt: node.updatedAt
        }
      );
    }

    return records;
  }

  async updateTracker(input: UpdateTrackerInput): Promise<TrackerRecord> {
    const node = await this.storage.readNode(input.uuid);
    const current = this.nodeToStoredTrackerContent(node);
    const next: StoredTrackerContent = {
      ...current,
      status: input.status ?? normalizeStatus(current.status),
      context: input.context ?? current.context
    };

    const updated = await this.storage.writeNode({
      uuid: node.uuid,
      title: node.title,
      type: node.type,
      summary: next.context || node.summary,
      parent_uuid: node.parent_uuid,
      connections: node.connections,
      tags: node.tags,
      created_at: node.created_at,
      importance: node.importance,
      user_validation: node.user_validation,
      context_hints: node.context_hints,
      content: JSON.stringify(next, null, 2)
    });
    const record = this.nodeToTrackerRecord(updated);

    if (!record) {
      throw new Error(`Unable to read updated tracker "${input.uuid}".`);
    }

    return record;
  }

  private sortTrackers(left: TrackerRecord, right: TrackerRecord): number {
    const leftWhen = `${left.date || "9999-99-99"} ${left.time || "99:99"}`;
    const rightWhen = `${right.date || "9999-99-99"} ${right.time || "99:99"}`;
    const byWhen = leftWhen.localeCompare(rightWhen);

    if (byWhen !== 0) {
      return byWhen;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  }

  private nodeToStoredTrackerContent(node: BrainNode): StoredTrackerContent {
    const parsed = JSON.parse(node.content) as StoredTrackerContent;

    return {
      ...parsed,
      title: safeTitle(parsed.title || node.title),
      date: normalizeDate(parsed.date),
      time: normalizeLine(parsed.time),
      endTime: normalizeLine(parsed.endTime),
      timezone: normalizeLine(parsed.timezone),
      location: normalizeLine(parsed.location),
      link: normalizeUrl(parsed.link),
      context: normalizeLine(parsed.context, node.summary),
      status: normalizeStatus(parsed.status),
      raw_content: parsed.raw_content ?? ""
    };
  }

  private nodeToTrackerRecord(node: BrainNode): TrackerRecord | null {
    try {
      const parsed = this.nodeToStoredTrackerContent(node);

      return {
        uuid: node.uuid,
        title: parsed.title,
        date: parsed.date ?? "",
        time: parsed.time ?? "",
        ...(parsed.endTime ? { endTime: parsed.endTime } : {}),
        ...(parsed.timezone ? { timezone: parsed.timezone } : {}),
        ...(parsed.location ? { location: parsed.location } : {}),
        ...(parsed.link ? { link: parsed.link } : {}),
        context: parsed.context,
        source_node_uuid: parsed.source_node_uuid,
        source: parsed.source,
        status: normalizeStatus(parsed.status),
        raw_content: parsed.raw_content,
        createdAt: node.created_at,
        updatedAt: node.updatedAt
      };
    } catch {
      return null;
    }
  }
}

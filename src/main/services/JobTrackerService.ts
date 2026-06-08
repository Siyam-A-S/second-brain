import type { BrainNode, JobApplicationStatus, JobTrackerRecord, UpdateJobTrackerInput } from "../../shared/brain";
import type { GraphifyController } from "./GraphifyController";
import { LlmService } from "./LlmService";
import type { StorageService } from "./StorageService";

type StoredJobContent = {
  company: string;
  role: string;
  job_posted?: string | undefined;
  application_date?: string | undefined;
  /**
   * Legacy alias for application_date. Keep it in persisted job JSON so older
   * vault entries and browser-preview expectations stay compatible.
   */
  date?: string | undefined;
  status?: JobApplicationStatus | undefined;
  resume?: string | undefined;
  description_summary: string;
  source_node_uuid?: string | undefined;
  raw_content: string;
};

const defaultStatus: JobApplicationStatus = "Applied";
const statusOptions: JobApplicationStatus[] = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];

function todayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function summarizeRawContent(rawContent: string): string {
  return rawContent.replace(/\s+/g, " ").trim().slice(0, 420);
}

function safeFileTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 90) || "Job";
}

function normalizeDate(value: string | undefined, fallback = ""): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function normalizeStatus(value: unknown): JobApplicationStatus {
  return statusOptions.includes(value as JobApplicationStatus) ? (value as JobApplicationStatus) : defaultStatus;
}

export class JobTrackerService {
  constructor(
    private readonly storage: StorageService,
    private readonly llm: LlmService,
    private readonly graphify?: GraphifyController | undefined
  ) {}

  async listJobs(): Promise<JobTrackerRecord[]> {
    const nodes = await this.storage.listNodes({ type: "job" });
    const storedJobs = nodes
      .map((node) => this.nodeToJobRecord(node))
      .filter((job): job is JobTrackerRecord => Boolean(job));
    const graphifyJobs = await this.listGraphifyJobs();
    const byUuid = new Map<string, JobTrackerRecord>();

    for (const job of [...storedJobs, ...graphifyJobs]) {
      byUuid.set(job.uuid, job);
    }

    return Array.from(byUuid.values()).sort(this.sortJobs);
  }

  async ingestJobDescription(rawContent: string, sourceNodeUuid?: string): Promise<JobTrackerRecord> {
    const metadata = await this.llm.extractJobMetadata(rawContent);
    const applicationDate = todayString();
    const title = safeFileTitle(`${metadata.company} ${metadata.role}`);
    const content: StoredJobContent = {
      company: metadata.company,
      role: metadata.role,
      job_posted: metadata.job_posted,
      application_date: applicationDate,
      date: applicationDate,
      status: defaultStatus,
      resume: "",
      description_summary: metadata.description_summary,
      ...(sourceNodeUuid ? { source_node_uuid: sourceNodeUuid } : {}),
      raw_content: rawContent
    };

    const node = await this.storage.writeNode({
      title,
      type: "job",
      summary: metadata.description_summary || summarizeRawContent(rawContent),
      parent_uuid: null,
      connections: sourceNodeUuid ? [sourceNodeUuid] : [],
      tags: ["job-tracker"],
      importance: 0.7,
      context_hints: [metadata.company, metadata.role, "job tracker"],
      content: JSON.stringify(content, null, 2)
    });

    return this.nodeToJobRecord(node) ?? {
      uuid: node.uuid,
      ...content,
      job_posted: content.job_posted ?? "",
      application_date: content.application_date ?? todayString(),
      status: normalizeStatus(content.status),
      resume: content.resume ?? "",
      createdAt: node.created_at,
      updatedAt: node.updatedAt
    };
  }

  async updateJob(input: UpdateJobTrackerInput): Promise<JobTrackerRecord> {
    const node = await this.storage.readNode(input.uuid);
    const current = this.nodeToStoredJobContent(node);
    const next: StoredJobContent = {
      ...current,
      date: current.application_date,
      status: input.status ?? normalizeStatus(current.status),
      resume: input.resume ?? current.resume ?? ""
    };

    const updated = await this.storage.writeNode({
      uuid: node.uuid,
      title: node.title,
      type: node.type,
      summary: next.description_summary || node.summary,
      parent_uuid: node.parent_uuid,
      connections: node.connections,
      tags: node.tags,
      created_at: node.created_at,
      importance: node.importance,
      user_validation: node.user_validation,
      context_hints: node.context_hints,
      content: JSON.stringify(next, null, 2)
    });
    const record = this.nodeToJobRecord(updated);

    if (!record) {
      throw new Error(`Unable to read updated job "${input.uuid}".`);
    }

    return record;
  }

  private sortJobs(left: JobTrackerRecord, right: JobTrackerRecord): number {
    const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdated !== 0) {
      return byUpdated;
    }

    return right.application_date.localeCompare(left.application_date);
  }

  private async listGraphifyJobs(): Promise<JobTrackerRecord[]> {
    if (!this.graphify) {
      return [];
    }

    try {
      return await this.graphify.extractJobRecords(this.llm);
    } catch (error) {
      console.warn("Unable to list jobs from Graphify MCP; falling back to stored job nodes.", error);
      return [];
    }
  }

  private nodeToStoredJobContent(node: BrainNode): StoredJobContent {
    const parsed = JSON.parse(node.content) as StoredJobContent;
    return {
      ...parsed,
      application_date: normalizeDate(parsed.application_date ?? parsed.date, node.created_at.slice(0, 10)),
      date: normalizeDate(parsed.date ?? parsed.application_date, node.created_at.slice(0, 10)),
      job_posted: normalizeDate(parsed.job_posted),
      status: normalizeStatus(parsed.status),
      resume: parsed.resume ?? ""
    };
  }

  private nodeToJobRecord(node: BrainNode): JobTrackerRecord | null {
    try {
      const parsed = this.nodeToStoredJobContent(node);

      return {
        uuid: node.uuid,
        company: parsed.company,
        role: parsed.role,
        job_posted: parsed.job_posted ?? "",
        application_date: parsed.application_date ?? node.created_at.slice(0, 10),
        status: normalizeStatus(parsed.status),
        resume: parsed.resume ?? "",
        description_summary: parsed.description_summary,
        source_node_uuid: parsed.source_node_uuid,
        raw_content: parsed.raw_content,
        createdAt: node.created_at,
        updatedAt: node.updatedAt
      };
    } catch {
      return null;
    }
  }
}

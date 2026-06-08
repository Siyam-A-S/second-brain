import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type {
  IngestAndRouteFragmentResult,
  JobIngestionStatus,
  ProcessDroppedItem,
  ProcessDroppedItemsResult
} from "../../shared/brain";
import { brainChannels, jobChannels } from "../../shared/ipc";
import type { JobTrackerService } from "./JobTrackerService";
import { LocalMcpServer } from "./LocalMcpServer";
import type { LlmService } from "./LlmService";
import { agentMethods, agentPrompts } from "./AgentRuntimeConfig";
import type { GraphifyController } from "./GraphifyController";

type DraftFragment = {
  raw_content: string;
  inferred_title: string;
  generated_summary: string;
  target_parent_uuid?: string | undefined;
  importance?: number | undefined;
  context_hints?: string[] | undefined;
};

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const words = compact.split(" ").filter(Boolean).slice(0, 40);
  return words.join(" ") || "Dropped fragment awaiting review.";
}

function inferTitle(items: ProcessDroppedItem[], content: string): string {
  const namedItem = items.find((item) => item.name || item.path);
  const fileName = namedItem?.name ?? (namedItem?.path ? path.basename(namedItem.path) : undefined);

  if (fileName) {
    return fileName.replace(/\.[^.]+$/, "");
  }

  return content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || "Untitled Fragment";
}

function inferContextHints(items: ProcessDroppedItem[]): string[] {
  return Array.from(
    new Set(
      items
        .flatMap((item) => [item.name, item.path, item.type])
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.replace(/[_/\\.-]+/g, " ").trim())
        .filter((value) => value.length > 3)
    )
  ).slice(0, 8);
}

function looksLikeJobDescription(content: string): boolean {
  const lower = content.toLowerCase();
  const signals = [
    "job description",
    "responsibilities",
    "requirements",
    "qualifications",
    "apply",
    "salary",
    "benefits",
    "full-time",
    "internship",
    "about the role",
    "we are hiring"
  ];

  return signals.filter((signal) => lower.includes(signal)).length >= 2;
}

export class AgentController {
  constructor(
    private readonly localMcpServer: LocalMcpServer,
    private readonly jobTracker: JobTrackerService,
    private readonly llm: LlmService,
    private readonly graphify?: GraphifyController | undefined
  ) {}

  registerIpc(): void {
    ipcMain.handle(brainChannels.processDroppedItems, async (event, items: ProcessDroppedItem[]) => {
      return this.processDroppedItems(event, items);
    });
  }

  async processDroppedItems(event: IpcMainInvokeEvent, items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
    if (this.graphify) {
      this.sendJobStatus(event, {
        stage: "extracting",
        message: "Saving raw files and updating Graphify..."
      });

      try {
        const graphify = await this.graphify.ingestDroppedItems(items);

        this.sendJobStatus(event, {
          stage: "saved",
          message: `Graphify updated ${graphify.graphNodeCount ?? 0} nodes.`
        });

        return {
          prompt: [
            "Dropped content was saved raw into the local vault and ingested by Graphify.",
            `Graphify MCP command: ${this.graphify.getMcpServerCommand()}`
          ].join("\n"),
          graphify
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Graphify ingestion failed.";
        this.sendJobStatus(event, {
          stage: "error",
          message,
          error: message
        });
        throw error;
      }
    }

    const rawContent = await this.readDroppedContent(items);
    if (looksLikeJobDescription(rawContent)) {
      return {
        prompt: this.buildJobDescriptionPrompt(rawContent),
        ...(await this.tryIngestJobDescription(event, rawContent))
      };
    }

    const draft = {
      raw_content: rawContent,
      inferred_title: inferTitle(items, rawContent),
      generated_summary: summarize(rawContent),
      importance: 0.65,
      context_hints: inferContextHints(items)
    };
    const prompt = this.buildDroppedItemsPrompt(rawContent, draft);
    const ingestResult = await this.callDroppedContentTool(prompt, draft);

    return {
      prompt,
      createdNode: ingestResult.node,
      routing: ingestResult.routing
    };
  }

  private async readDroppedContent(items: ProcessDroppedItem[]): Promise<string> {
    const parts = await Promise.all(
      items.map(async (item) => {
        if (item.text?.trim()) {
          return item.text.trim();
        }

        if (item.content?.trim()) {
          return item.content.trim();
        }

        if (item.path) {
          try {
            return await readFile(item.path, "utf8");
          } catch (error) {
            console.warn(`Unable to read dropped file at ${item.path}`, error);
            return item.name ?? item.path;
          }
        }

        return item.name ?? "";
      })
    );

    return parts.filter(Boolean).join("\n\n---\n\n").trim();
  }

  private buildDroppedItemsPrompt(rawContent: string, draft: DraftFragment): string {
    return [
      "Route this dropped content using the enabled local tools.",
      "Suggested fallback input:",
      JSON.stringify(draft),
      "Dropped content:",
      rawContent
    ].join("\n");
  }

  private buildJobDescriptionPrompt(rawContent: string): string {
    return [
      "You are the Second Brain job ingestion agent.",
      "Extract the dropped job description into the local Jobs table only.",
      "Do not create a graph topic, subtopic, or fragment for this job application.",
      "",
      "Dropped content:",
      rawContent
    ].join("\n");
  }

  private async callDroppedContentTool(prompt: string, draft: DraftFragment): Promise<IngestAndRouteFragmentResult> {
    const method = agentMethods.droppedContentToolRouting;
    const tools = this.localMcpServer.listToolSpecs(method.enabledTools);

    try {
      const toolCall = await this.llm.planLocalToolCall({
        systemPrompt: agentPrompts.droppedContentToolRouter,
        userPrompt: prompt,
        tools,
        method
      });
      const allowedToolNames = new Set(tools.map((tool) => tool.name as string));

      if (!allowedToolNames.has(toolCall.tool)) {
        throw new Error(`Local AI selected disabled tool "${toolCall.tool}".`);
      }

      console.info("Local tool call planned", {
        tool: toolCall.tool,
        reason: toolCall.reason
      });

      return this.localMcpServer.callLocalTool(toolCall.tool, toolCall.input) as Promise<IngestAndRouteFragmentResult>;
    } catch (error) {
      console.warn("Local tool routing failed; using fallback ingest tool.", error);
      return this.localMcpServer.callLocalTool("ingest_and_route_fragment", draft) as Promise<IngestAndRouteFragmentResult>;
    }
  }

  private sendJobStatus(event: IpcMainInvokeEvent, status: JobIngestionStatus): void {
    event.sender.send(jobChannels.ingestionStatus, status);
    for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
      if (!window.isDestroyed() && window.webContents !== event.sender) {
        window.webContents.send(jobChannels.ingestionStatus, status);
      }
    }
  }

  private async tryIngestJobDescription(
    event: IpcMainInvokeEvent,
    rawContent: string,
    sourceNodeUuid?: string
  ): Promise<Pick<ProcessDroppedItemsResult, "job" | "jobError">> {
    this.sendJobStatus(event, {
      stage: "extracting",
      message: "Extracting job details locally..."
    });

    try {
      const job = await this.jobTracker.ingestJobDescription(rawContent, sourceNodeUuid);
      this.sendJobStatus(event, {
        stage: "saved",
        message: `Saved ${job.role} at ${job.company}`,
        job
      });
      return { job };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local job extraction failed.";
      this.sendJobStatus(event, {
        stage: "error",
        message,
        error: message
      });
      return { jobError: message };
    }
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type {
  IngestAndRouteFragmentResult,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  TrackerIngestionStatus
} from "../../shared/brain";
import { brainChannels, trackerChannels } from "../../shared/ipc";
import { LocalMcpServer } from "./LocalMcpServer";
import type { LlmService } from "./LlmService";
import { agentMethods, agentPrompts } from "./AgentRuntimeConfig";
import type { GraphifyController } from "./GraphifyController";
import type { TrackerService } from "./TrackerService";

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

function looksTrackable(content: string): boolean {
  const lower = content.toLowerCase();
  const dateSignals = [
    /\b(?:today|tomorrow|tonight|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i
  ];
  const timeSignals = [/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i, /\b\d{1,2}\s*(?:am|pm)\b/i];
  const intentSignals = [
    "event name",
    "event date",
    "event date and time",
    "link to join",
    "join event",
    "hackathon",
    "webinar",
    "conference",
    "workshop",
    "deadline",
    "due",
    "meeting",
    "appointment",
    "schedule",
    "scheduled",
    "call",
    "follow up",
    "follow-up",
    "remind",
    "renew",
    "expires",
    "interview",
    "event",
    "submit",
    "review by"
  ];
  const temporalSignalCount =
    dateSignals.reduce((count, signal) => count + (signal.test(content) ? 1 : 0), 0) +
    timeSignals.reduce((count, signal) => count + (signal.test(content) ? 1 : 0), 0);
  const hasTemporalSignal = temporalSignalCount > 0;
  const hasIntentSignal = intentSignals.some((signal) => lower.includes(signal));
  const hasEventFields = /event\s+(?:name|date|time)|link\s+to\s+join|more\s+about\s+the\s+event/i.test(content);
  const looksLikeDatedList = temporalSignalCount >= 2 && /[\n;]/.test(content);

  return hasTemporalSignal && (hasIntentSignal || hasEventFields || looksLikeDatedList);
}

export class AgentController {
  constructor(
    private readonly localMcpServer: LocalMcpServer,
    private readonly tracker: TrackerService,
    private readonly llm: LlmService,
    private readonly graphify?: GraphifyController | undefined
  ) {}

  registerIpc(): void {
    ipcMain.handle(brainChannels.processDroppedItems, async (event, items: ProcessDroppedItem[]) => {
      return this.processDroppedItems(event, items);
    });
  }

  async processDroppedItems(event: IpcMainInvokeEvent, items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
    const rawContent = await this.readDroppedContent(items);
    const sourceName = inferTitle(items, rawContent);

    if (this.graphify) {
      this.sendTrackerStatus(event, {
        stage: "extracting",
        message: "Saving raw files and updating Graphify..."
      });

      try {
        const [graphify, trackerResult] = await Promise.all([
          this.graphify.ingestDroppedItems(items),
          this.tryIngestTracker(event, rawContent, sourceName)
        ]);

        this.sendTrackerStatus(event, {
          stage: "saved",
          message: trackerResult.trackers?.length
            ? `Graphify updated ${graphify.graphNodeCount ?? 0} nodes and added ${trackerResult.trackers.length} tracker item${trackerResult.trackers.length === 1 ? "" : "s"}.`
            : `Graphify updated ${graphify.graphNodeCount ?? 0} nodes.`
        });

        return {
          prompt: [
            "Dropped content was saved raw into the local vault and ingested by Graphify.",
            `Graphify MCP command: ${this.graphify.getMcpServerCommand()}`
          ].join("\n"),
          graphify,
          ...trackerResult
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Graphify ingestion failed.";
        this.sendTrackerStatus(event, {
          stage: "error",
          message,
          error: message
        });
        throw error;
      }
    }

    const draft = {
      raw_content: rawContent,
      inferred_title: sourceName,
      generated_summary: summarize(rawContent),
      importance: 0.65,
      context_hints: inferContextHints(items)
    };
    const prompt = this.buildDroppedItemsPrompt(rawContent, draft);
    const [ingestResult, trackerResult] = await Promise.all([
      this.callDroppedContentTool(prompt, draft),
      this.tryIngestTracker(event, rawContent, sourceName)
    ]);

    return {
      prompt,
      createdNode: ingestResult.node,
      routing: ingestResult.routing,
      ...trackerResult
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

  private sendTrackerStatus(event: IpcMainInvokeEvent, status: TrackerIngestionStatus): void {
    event.sender.send(trackerChannels.ingestionStatus, status);
    for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
      if (!window.isDestroyed() && window.webContents !== event.sender) {
        window.webContents.send(trackerChannels.ingestionStatus, status);
      }
    }
  }

  private async tryIngestTracker(
    event: IpcMainInvokeEvent,
    rawContent: string,
    source: string,
    sourceNodeUuid?: string
  ): Promise<Pick<ProcessDroppedItemsResult, "tracker" | "trackers" | "trackerError" | "trackerSkipped">> {
    if (!rawContent.trim() || !looksTrackable(rawContent)) {
      return { trackerSkipped: true };
    }

    this.sendTrackerStatus(event, {
      stage: "extracting",
      message: "Checking dropped content for trackable dates..."
    });

    try {
      const trackers = await this.tracker.ingestTrackableContent(rawContent, source, sourceNodeUuid);

      if (trackers.length === 0) {
        this.sendTrackerStatus(event, {
          stage: "skipped",
          message: "No explicit date or time to track."
        });
        return { trackerSkipped: true };
      }

      this.sendTrackerStatus(event, {
        stage: "saved",
        message: `Tracking ${trackers.length} item${trackers.length === 1 ? "" : "s"}`,
        tracker: trackers[0],
        trackers
      });
      return { tracker: trackers[0], trackers };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tracker extraction failed.";
      this.sendTrackerStatus(event, {
        stage: "error",
        message,
        error: message
      });
      return { trackerError: message };
    }
  }
}

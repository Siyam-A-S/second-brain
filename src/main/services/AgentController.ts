import { readFile } from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import type { IngestAndRouteFragmentResult, ProcessDroppedItem, ProcessDroppedItemsResult } from "../../shared/brain";
import { brainChannels } from "../../shared/ipc";
import { LocalMcpServer } from "./LocalMcpServer";

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

export class AgentController {
  constructor(private readonly localMcpServer: LocalMcpServer) {}

  registerIpc(): void {
    ipcMain.handle(brainChannels.processDroppedItems, async (_event, items: ProcessDroppedItem[]) => {
      return this.processDroppedItems(items);
    });
  }

  async processDroppedItems(items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
    const rawContent = await this.readDroppedContent(items);
    const prompt = this.buildDroppedItemsPrompt(rawContent);
    const ingestResult = await this.placeholderLlmCall(prompt, {
      raw_content: rawContent,
      inferred_title: inferTitle(items, rawContent),
      generated_summary: summarize(rawContent),
      importance: 0.65,
      context_hints: inferContextHints(items)
    });

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

  private buildDroppedItemsPrompt(rawContent: string): string {
    return [
      "You are the Second Brain ingestion agent.",
      "Turn the dropped item into a concise local graph fragment.",
      "Use the local MCP tool ingest_and_route_fragment to persist the result.",
      "",
      "Dropped content:",
      rawContent
    ].join("\n");
  }

  private async placeholderLlmCall(prompt: string, draft: DraftFragment): Promise<IngestAndRouteFragmentResult> {
    console.info("Placeholder LLM prompt prepared", prompt);

    return this.localMcpServer.callLocalTool("ingest_and_route_fragment", draft) as Promise<IngestAndRouteFragmentResult>;
  }
}

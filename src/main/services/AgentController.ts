import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ProcessDroppedItem, ProcessDroppedItemsResult, TrackerIngestionStatus } from "../../shared/brain";
import { brainChannels, trackerChannels } from "../../shared/ipc";
import type { GraphifyController } from "./GraphifyController";

type GraphifyProvider = () => GraphifyController;

export class AgentController {
  constructor(private readonly getGraphify: GraphifyProvider) {}

  registerIpc(): void {
    ipcMain.handle(brainChannels.processDroppedItems, async (event, items: ProcessDroppedItem[]) => {
      return this.processDroppedItems(event, items);
    });
  }

  async processDroppedItems(event: IpcMainInvokeEvent, items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
    const graphify = this.getGraphify();

    this.sendStatus(event, {
      stage: "extracting",
      message: "Saving raw files and updating Graphify..."
    });

    try {
      const result = await graphify.ingestDroppedItems(items);
      this.sendStatus(event, {
        stage: "saved",
        message: `Graphify updated ${result.graphNodeCount ?? 0} node${result.graphNodeCount === 1 ? "" : "s"}.`
      });

      return {
        prompt: [
          "Dropped content was saved raw into the active project and ingested by Graphify.",
          `Graphify MCP command: ${graphify.getMcpServerCommand()}`
        ].join("\n"),
        graphify: result
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Graphify ingestion failed.";
      this.sendStatus(event, {
        stage: "error",
        message,
        error: message
      });
      throw error;
    }
  }

  private sendStatus(event: IpcMainInvokeEvent, status: TrackerIngestionStatus): void {
    event.sender.send(trackerChannels.ingestionStatus, status);
    for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
      if (!window.isDestroyed() && window.webContents !== event.sender) {
        window.webContents.send(trackerChannels.ingestionStatus, status);
      }
    }
  }
}

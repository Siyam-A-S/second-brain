import { contextBridge, ipcRenderer } from "electron";
import type {
  BoardRule,
  FilesDroppedPayload,
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  ProcessDroppedItem,
  SearchBrainNodesInput,
  SecondBrainApi,
  TrackerIngestionStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
  WidgetMovePayload,
  WriteBrainNodeInput
} from "../shared/ipc";

const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore",
  getWidgetBounds: "widget-get-bounds",
  moveWidget: "widget-move"
} as const;

const fileChannels = {
  dropped: "files-dropped"
} as const;

const brainChannels = {
  writeNode: "brain-write-node",
  readNode: "brain-read-node",
  listNodes: "brain-list-nodes",
  searchNodes: "brain-search-nodes",
  mcpStatus: "brain-mcp-status",
  processDroppedItems: "process-dropped-items",
  organizedBoard: "brain-organized-board",
  exportBoardPlaintext: "brain-export-board-plaintext",
  updateNodeSignals: "brain-update-node-signals"
} as const;

const trackerChannels = {
  list: "tracker-list",
  update: "tracker-update",
  ingestionStatus: "tracker-ingestion-status"
} as const;

const boardChannels = {
  getState: "get-board-state",
  getGraphHtml: "get-graph-html",
  removeSource: "remove-board-source",
  collapseSource: "collapse-board-source",
  renameSource: "rename-board-source",
  commentSource: "comment-board-source",
  search: "search-board"
} as const;

const clipboardChannels = {
  readText: "clipboard-read-text",
  writeText: "clipboard-write-text",
  listSmartClips: "smart-clips-list",
  useSmartClip: "smart-clips-use"
} as const;

const settingsChannels = {
  getAi: "settings-get-ai",
  updateAi: "settings-update-ai",
  getApp: "settings-get-app",
  updateApp: "settings-update-app"
} as const;

const api: SecondBrainApi = {
  window: {
    minimize: () => ipcRenderer.invoke(windowChannels.minimize),
    maximize: () => ipcRenderer.invoke(windowChannels.maximize),
    close: () => ipcRenderer.invoke(windowChannels.close),
    restore: () => ipcRenderer.invoke(windowChannels.restore),
    getWidgetBounds: () => ipcRenderer.invoke(windowChannels.getWidgetBounds),
    moveWidget: (payload: WidgetMovePayload) => ipcRenderer.invoke(windowChannels.moveWidget, payload)
  },
  files: {
    dropped: (payload: FilesDroppedPayload) => ipcRenderer.invoke(fileChannels.dropped, payload)
  },
  brain: {
    writeNode: (input: WriteBrainNodeInput) => ipcRenderer.invoke(brainChannels.writeNode, input),
    readNode: (uuid: string) => ipcRenderer.invoke(brainChannels.readNode, uuid),
    listNodes: (input?: ListBrainNodesInput) => ipcRenderer.invoke(brainChannels.listNodes, input),
    searchNodes: (input: SearchBrainNodesInput) => ipcRenderer.invoke(brainChannels.searchNodes, input),
    getMcpStatus: () => ipcRenderer.invoke(brainChannels.mcpStatus),
    processDroppedItems: (items: ProcessDroppedItem[]) => ipcRenderer.invoke(brainChannels.processDroppedItems, items),
    getOrganizedBoard: () => ipcRenderer.invoke(brainChannels.organizedBoard),
    exportBoardPlaintext: (input?: ExportBoardPlaintextInput) => ipcRenderer.invoke(brainChannels.exportBoardPlaintext, input),
    updateNodeSignals: (input: UpdateNodeSignalsInput) => ipcRenderer.invoke(brainChannels.updateNodeSignals, input)
  },
  tracker: {
    list: () => ipcRenderer.invoke(trackerChannels.list),
    update: (input: UpdateTrackerInput) => ipcRenderer.invoke(trackerChannels.update, input),
    onIngestionStatus: (handler: (status: TrackerIngestionStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: TrackerIngestionStatus): void => {
        handler(status);
      };

      ipcRenderer.on(trackerChannels.ingestionStatus, listener);
      return () => {
        ipcRenderer.removeListener(trackerChannels.ingestionStatus, listener);
      };
    }
  },
  board: {
    getState: (rule: BoardRule) => ipcRenderer.invoke(boardChannels.getState, rule),
    getGraphHtml: () => ipcRenderer.invoke(boardChannels.getGraphHtml),
    removeSource: (sourceFile: string) => ipcRenderer.invoke(boardChannels.removeSource, sourceFile),
    collapseSource: (sourceFile: string, targetSourceFile: string) =>
      ipcRenderer.invoke(boardChannels.collapseSource, sourceFile, targetSourceFile),
    renameSource: (sourceFile: string, newName: string) =>
      ipcRenderer.invoke(boardChannels.renameSource, sourceFile, newName),
    commentSource: (sourceFile: string, comment: string) =>
      ipcRenderer.invoke(boardChannels.commentSource, sourceFile, comment),
    search: (input) => ipcRenderer.invoke(boardChannels.search, input)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(clipboardChannels.readText),
    writeText: (text: string) => ipcRenderer.invoke(clipboardChannels.writeText, text),
    listSmartClips: () => ipcRenderer.invoke(clipboardChannels.listSmartClips),
    useSmartClip: (id: string) => ipcRenderer.invoke(clipboardChannels.useSmartClip, id)
  },
  settings: {
    getAi: () => ipcRenderer.invoke(settingsChannels.getAi),
    updateAi: (input: UpdateAiSettingsInput) => ipcRenderer.invoke(settingsChannels.updateAi, input),
    getApp: () => ipcRenderer.invoke(settingsChannels.getApp),
    updateApp: (input: UpdateAppSettingsInput) => ipcRenderer.invoke(settingsChannels.updateApp, input)
  }
};

contextBridge.exposeInMainWorld("api", api);

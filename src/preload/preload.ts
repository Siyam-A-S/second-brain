import { contextBridge, ipcRenderer } from "electron";
import type {
  BoardRule,
  ChatSendInput,
  CreateProjectInput,
  CreateTrackerInput,
  FilesDroppedPayload,
  ExportBoardPlaintextInput,
  ExplorerSearchInput,
  ListBrainNodesInput,
  ProcessDroppedItem,
  ProjectSelectionInput,
  RenameProjectInput,
  SaveResearchNodeNoteInput,
  SearchBrainNodesInput,
  SecondBrainApi,
  TrackerIngestionStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput,
  UpdateNodeSignalsInput,
  UpdateResearchPaperStatusInput,
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
  create: "tracker-create",
  update: "tracker-update",
  remove: "tracker-remove",
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

const explorerChannels = {
  getRoot: "explorer-get-root",
  getChildren: "explorer-get-children",
  getDetails: "explorer-get-details",
  search: "explorer-search",
  getSourceOptions: "explorer-get-source-options",
  getArtifactContent: "explorer-get-artifact-content"
} as const;

const projectChannels = {
  list: "projects-list",
  create: "projects-create",
  select: "projects-select",
  rename: "projects-rename",
  archive: "projects-archive",
  getActive: "projects-get-active"
} as const;

const graphBoardChannels = {
  getState: "graph-board-get-state",
  getNodeDetails: "graph-board-get-node-details",
  generateCallflow: "graph-board-generate-callflow",
  getDefinitionStatus: "graph-board-get-definition-status"
} as const;

const researchChannels = {
  getDependencyStatus: "research-get-dependency-status",
  listPapers: "research-list-papers",
  getPaperDetails: "research-get-paper-details",
  saveNodeNote: "research-save-node-note",
  updatePaperStatus: "research-update-paper-status"
} as const;

const clipboardChannels = {
  readText: "clipboard-read-text",
  writeText: "clipboard-write-text"
} as const;

const settingsChannels = {
  getAi: "settings-get-ai",
  updateAi: "settings-update-ai",
  getApp: "settings-get-app",
  updateApp: "settings-update-app",
  updateManagedProxy: "settings-update-managed-proxy"
} as const;

const chatChannels = {
  listThreads: "chat-list-threads",
  createThread: "chat-create-thread",
  sendMessage: "chat-send-message",
  deleteThread: "chat-delete-thread",
  getGrounding: "chat-get-grounding"
} as const;

const runtimeChannels = {
  getDependencyStatus: "runtime-get-dependency-status",
  installOrRepairDependencies: "runtime-install-or-repair-dependencies"
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
    create: (input: CreateTrackerInput) => ipcRenderer.invoke(trackerChannels.create, input),
    update: (input: UpdateTrackerInput) => ipcRenderer.invoke(trackerChannels.update, input),
    remove: (uuid: string) => ipcRenderer.invoke(trackerChannels.remove, uuid),
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
  projects: {
    list: () => ipcRenderer.invoke(projectChannels.list),
    create: (input: CreateProjectInput) => ipcRenderer.invoke(projectChannels.create, input),
    select: (input: ProjectSelectionInput) => ipcRenderer.invoke(projectChannels.select, input),
    rename: (input: RenameProjectInput) => ipcRenderer.invoke(projectChannels.rename, input),
    archive: (input: ProjectSelectionInput) => ipcRenderer.invoke(projectChannels.archive, input),
    getActive: () => ipcRenderer.invoke(projectChannels.getActive)
  },
  graphBoard: {
    getState: () => ipcRenderer.invoke(graphBoardChannels.getState),
    getNodeDetails: (nodeId: string) => ipcRenderer.invoke(graphBoardChannels.getNodeDetails, nodeId),
    generateCallflow: (nodeId: string) => ipcRenderer.invoke(graphBoardChannels.generateCallflow, nodeId),
    getDefinitionStatus: () => ipcRenderer.invoke(graphBoardChannels.getDefinitionStatus)
  },
  research: {
    getDependencyStatus: () => ipcRenderer.invoke(researchChannels.getDependencyStatus),
    listPapers: () => ipcRenderer.invoke(researchChannels.listPapers),
    getPaperDetails: (nodeId: string) => ipcRenderer.invoke(researchChannels.getPaperDetails, nodeId),
    saveNodeNote: (input: SaveResearchNodeNoteInput) => ipcRenderer.invoke(researchChannels.saveNodeNote, input),
    updatePaperStatus: (input: UpdateResearchPaperStatusInput) =>
      ipcRenderer.invoke(researchChannels.updatePaperStatus, input)
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
  explorer: {
    getRoot: () => ipcRenderer.invoke(explorerChannels.getRoot),
    getChildren: (nodeId: string) => ipcRenderer.invoke(explorerChannels.getChildren, nodeId),
    getDetails: (nodeId: string) => ipcRenderer.invoke(explorerChannels.getDetails, nodeId),
    search: (input: ExplorerSearchInput) => ipcRenderer.invoke(explorerChannels.search, input),
    getSourceOptions: () => ipcRenderer.invoke(explorerChannels.getSourceOptions),
    getArtifactContent: (artifactId: string) => ipcRenderer.invoke(explorerChannels.getArtifactContent, artifactId)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(clipboardChannels.readText),
    writeText: (text: string) => ipcRenderer.invoke(clipboardChannels.writeText, text)
  },
  settings: {
    getAi: () => ipcRenderer.invoke(settingsChannels.getAi),
    updateAi: (input: UpdateAiSettingsInput) => ipcRenderer.invoke(settingsChannels.updateAi, input),
    getApp: () => ipcRenderer.invoke(settingsChannels.getApp),
    updateApp: (input: UpdateAppSettingsInput) => ipcRenderer.invoke(settingsChannels.updateApp, input),
    updateManagedProxy: (input: UpdateManagedProxySettingsInput) =>
      ipcRenderer.invoke(settingsChannels.updateManagedProxy, input)
  },
  chat: {
    listThreads: () => ipcRenderer.invoke(chatChannels.listThreads),
    createThread: (input?: { title?: string | undefined }) => ipcRenderer.invoke(chatChannels.createThread, input),
    sendMessage: (input: ChatSendInput) => ipcRenderer.invoke(chatChannels.sendMessage, input),
    deleteThread: (threadId: string) => ipcRenderer.invoke(chatChannels.deleteThread, threadId),
    getGrounding: (messageId: string) => ipcRenderer.invoke(chatChannels.getGrounding, messageId)
  },
  runtime: {
    getDependencyStatus: () => ipcRenderer.invoke(runtimeChannels.getDependencyStatus),
    installOrRepairDependencies: () => ipcRenderer.invoke(runtimeChannels.installOrRepairDependencies)
  }
};

contextBridge.exposeInMainWorld("api", api);

import { contextBridge, ipcRenderer } from "electron";
import type {
  FilesDroppedPayload,
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  ProcessDroppedItem,
  SearchBrainNodesInput,
  SecondBrainApi,
  UpdateNodeSignalsInput,
  WriteBrainNodeInput
} from "../shared/ipc";

const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore"
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

const api: SecondBrainApi = {
  window: {
    minimize: () => ipcRenderer.invoke(windowChannels.minimize),
    maximize: () => ipcRenderer.invoke(windowChannels.maximize),
    close: () => ipcRenderer.invoke(windowChannels.close),
    restore: () => ipcRenderer.invoke(windowChannels.restore)
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
  }
};

contextBridge.exposeInMainWorld("api", api);

import type {
  BrainNode,
  BrainSearchResult,
  ExportBoardPlaintextInput,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  UpdateNodeSignalsInput,
  WriteBrainNodeInput
} from "./brain";

export type {
  BrainNode,
  BrainSearchResult,
  ExportBoardPlaintextInput,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  UpdateNodeSignalsInput,
  WriteBrainNodeInput
} from "./brain";

export const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore"
} as const;

export const fileChannels = {
  dropped: "files-dropped"
} as const;

export const brainChannels = {
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

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];
export type BrainChannel = (typeof brainChannels)[keyof typeof brainChannels];

export type DroppedFile = {
  name: string;
  path: string;
  type: string;
  size: number;
};

export type FilesDroppedPayload = {
  source: "main-drop-zone" | "floating-widget";
  files: DroppedFile[];
  text?: string;
};

export type SecondBrainApi = {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<boolean>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
  };
  files: {
    dropped: (payload: FilesDroppedPayload) => Promise<void>;
  };
  brain: {
    writeNode: (input: WriteBrainNodeInput) => Promise<BrainNode>;
    readNode: (uuid: string) => Promise<BrainNode>;
    listNodes: (input?: ListBrainNodesInput) => Promise<BrainNode[]>;
    searchNodes: (input: SearchBrainNodesInput) => Promise<BrainSearchResult[]>;
    getMcpStatus: () => Promise<McpServerStatus>;
    processDroppedItems: (items: ProcessDroppedItem[]) => Promise<ProcessDroppedItemsResult>;
    getOrganizedBoard: () => Promise<OrganizedBoardTopic[]>;
    exportBoardPlaintext: (input?: ExportBoardPlaintextInput) => Promise<string>;
    updateNodeSignals: (input: UpdateNodeSignalsInput) => Promise<BrainNode>;
  };
};

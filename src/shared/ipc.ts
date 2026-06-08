import type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  ExportBoardPlaintextInput,
  GraphifyIngestionResult,
  JobApplicationStatus,
  JobIngestionStatus,
  JobTrackerRecord,
  UpdateJobTrackerInput,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  UpdateNodeSignalsInput,
  UserValidationState,
  WriteBrainNodeInput
} from "./brain";
import type { BoardRule, OrganizedBoardTopic as GraphBoardTopic } from "./types/board";

export type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  ExportBoardPlaintextInput,
  GraphifyIngestionResult,
  JobApplicationStatus,
  JobIngestionStatus,
  JobTrackerRecord,
  UpdateJobTrackerInput,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  UpdateNodeSignalsInput,
  UserValidationState,
  WriteBrainNodeInput
} from "./brain";
export type {
  BoardItem,
  BoardLayoutType,
  BoardRule,
  OrganizedBoardTopic as GraphBoardTopic
} from "./types/board";

export const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore",
  getWidgetBounds: "widget-get-bounds",
  moveWidget: "widget-move"
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

export const jobChannels = {
  list: "jobs-list",
  update: "jobs-update",
  ingestionStatus: "job-ingestion-status"
} as const;

export const boardChannels = {
  getState: "get-board-state",
  getGraphHtml: "get-graph-html"
} as const;

export const clipboardChannels = {
  readText: "clipboard-read-text"
} as const;

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];
export type BrainChannel = (typeof brainChannels)[keyof typeof brainChannels];
export type JobChannel = (typeof jobChannels)[keyof typeof jobChannels];
export type BoardChannel = (typeof boardChannels)[keyof typeof boardChannels];
export type ClipboardChannel = (typeof clipboardChannels)[keyof typeof clipboardChannels];

export type DroppedFile = {
  name: string;
  path: string;
  type: string;
  size: number;
  buffer?: ArrayBuffer | number[] | undefined;
};

export type FilesDroppedPayload = {
  source: "main-drop-zone" | "floating-widget";
  files: DroppedFile[];
  text?: string;
};

export type WidgetBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WidgetMovePayload = {
  x: number;
  y: number;
};

export type GraphHtmlDocument = {
  html: string;
  path: string;
  updatedAt: string;
};

export type SecondBrainApi = {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<boolean>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
    getWidgetBounds: () => Promise<WidgetBounds | null>;
    moveWidget: (payload: WidgetMovePayload) => Promise<WidgetBounds | null>;
  };
  files: {
    dropped: (payload: FilesDroppedPayload) => Promise<GraphifyIngestionResult | void>;
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
  jobs: {
    list: () => Promise<JobTrackerRecord[]>;
    update: (input: UpdateJobTrackerInput) => Promise<JobTrackerRecord>;
    onIngestionStatus: (handler: (status: JobIngestionStatus) => void) => () => void;
  };
  board: {
    getState: (rule: BoardRule) => Promise<GraphBoardTopic[]>;
    getGraphHtml: () => Promise<GraphHtmlDocument>;
  };
  clipboard: {
    readText: () => Promise<string>;
  };
};

import type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  ExportBoardPlaintextInput,
  GraphifyIngestionResult,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  SmartClip,
  SmartClipKind,
  TrackerIngestionStatus,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
  UserValidationState,
  WriteBrainNodeInput
} from "./brain";
import type { BoardRule, OrganizedBoardTopic as GraphBoardTopic } from "./types/board";

export type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  ExportBoardPlaintextInput,
  GraphifyIngestionResult,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  SearchBrainNodesInput,
  SmartClip,
  SmartClipKind,
  TrackerIngestionStatus,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
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

export const trackerChannels = {
  list: "tracker-list",
  update: "tracker-update",
  ingestionStatus: "tracker-ingestion-status"
} as const;

export const boardChannels = {
  getState: "get-board-state",
  getGraphHtml: "get-graph-html",
  removeSource: "remove-board-source",
  collapseSource: "collapse-board-source"
} as const;

export const clipboardChannels = {
  readText: "clipboard-read-text",
  writeText: "clipboard-write-text",
  listSmartClips: "smart-clips-list",
  useSmartClip: "smart-clips-use"
} as const;

export const settingsChannels = {
  getAi: "settings-get-ai",
  updateAi: "settings-update-ai"
} as const;

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];
export type BrainChannel = (typeof brainChannels)[keyof typeof brainChannels];
export type TrackerChannel = (typeof trackerChannels)[keyof typeof trackerChannels];
export type BoardChannel = (typeof boardChannels)[keyof typeof boardChannels];
export type ClipboardChannel = (typeof clipboardChannels)[keyof typeof clipboardChannels];
export type SettingsChannel = (typeof settingsChannels)[keyof typeof settingsChannels];

export type DroppedFile = {
  name: string;
  path?: string | undefined;
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
  tracker: {
    list: () => Promise<TrackerRecord[]>;
    update: (input: UpdateTrackerInput) => Promise<TrackerRecord>;
    onIngestionStatus: (handler: (status: TrackerIngestionStatus) => void) => () => void;
  };
  board: {
    getState: (rule: BoardRule) => Promise<GraphBoardTopic[]>;
    getGraphHtml: () => Promise<GraphHtmlDocument>;
    removeSource: (sourceFile: string) => Promise<GraphifyIngestionResult>;
    collapseSource: (sourceFile: string, targetSourceFile: string) => Promise<GraphifyIngestionResult>;
  };
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
    listSmartClips: () => Promise<SmartClip[]>;
    useSmartClip: (id: string) => Promise<SmartClip>;
  };
  settings: {
    getAi: () => Promise<AiSettings>;
    updateAi: (input: UpdateAiSettingsInput) => Promise<AiSettings>;
  };
};

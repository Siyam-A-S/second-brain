import type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  AppSettings,
  CallflowHtmlDocument,
  CreateProjectInput,
  CreateTrackerInput,
  ExportBoardPlaintextInput,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphifyIngestionResult,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  ProjectRecord,
  ProjectSelectionInput,
  RenameProjectInput,
  SearchBrainNodesInput,
  TrackerIngestionStatus,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
  UserValidationState,
  WriteBrainNodeInput
} from "./brain";
import type {
  BoardSearchInput,
  BoardSearchResult,
  BoardRule,
  OrganizedBoardTopic as GraphBoardTopic
} from "./types/board";
import type {
  SourceTreeNode,
  SourceTreeNodeDetails,
  SourceTreeSearchInput,
  SourceTreeSearchResult,
  SourceTreeSourceOption
} from "./types/filesystem";

export type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  AppSettings,
  CallflowHtmlDocument,
  CreateProjectInput,
  CreateTrackerInput,
  ExportBoardPlaintextInput,
  GraphBoardLink,
  GraphBoardNeighbor,
  GraphBoardNode,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphifyIngestionResult,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  ProjectRecord,
  ProjectSelectionInput,
  RenameProjectInput,
  SearchBrainNodesInput,
  TrackerIngestionStatus,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
  UserValidationState,
  WriteBrainNodeInput
} from "./brain";
export type {
  BoardItem,
  BoardLayoutType,
  BoardSearchInput,
  BoardSearchKind,
  BoardSearchResult,
  BoardRule,
  OrganizedBoardTopic as GraphBoardTopic
} from "./types/board";
export type {
  SourceTreeNode,
  SourceTreeNodeDetails,
  SourceTreeNodeKind,
  SourceTreeRelationGroup,
  SourceTreeRelationItem,
  SourceTreeSearchInput,
  SourceTreeSearchResult,
  SourceTreeSourceOption
} from "./types/filesystem";

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
  create: "tracker-create",
  update: "tracker-update",
  remove: "tracker-remove",
  ingestionStatus: "tracker-ingestion-status"
} as const;

export const boardChannels = {
  getState: "get-board-state",
  getGraphHtml: "get-graph-html",
  removeSource: "remove-board-source",
  collapseSource: "collapse-board-source",
  renameSource: "rename-board-source",
  commentSource: "comment-board-source",
  search: "search-board"
} as const;

export const filesystemChannels = {
  getRoot: "filesystem-get-root",
  getChildren: "filesystem-get-children",
  getDetails: "filesystem-get-details",
  search: "filesystem-search",
  getSourceOptions: "filesystem-get-source-options"
} as const;

export const projectChannels = {
  list: "projects-list",
  create: "projects-create",
  select: "projects-select",
  rename: "projects-rename",
  archive: "projects-archive",
  getActive: "projects-get-active"
} as const;

export const graphBoardChannels = {
  getState: "graph-board-get-state",
  getNodeDetails: "graph-board-get-node-details",
  generateCallflow: "graph-board-generate-callflow"
} as const;

export const clipboardChannels = {
  readText: "clipboard-read-text",
  writeText: "clipboard-write-text"
} as const;

export const settingsChannels = {
  getAi: "settings-get-ai",
  updateAi: "settings-update-ai",
  getApp: "settings-get-app",
  updateApp: "settings-update-app"
} as const;

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];
export type BrainChannel = (typeof brainChannels)[keyof typeof brainChannels];
export type TrackerChannel = (typeof trackerChannels)[keyof typeof trackerChannels];
export type BoardChannel = (typeof boardChannels)[keyof typeof boardChannels];
export type FilesystemChannel = (typeof filesystemChannels)[keyof typeof filesystemChannels];
export type ProjectChannel = (typeof projectChannels)[keyof typeof projectChannels];
export type GraphBoardChannel = (typeof graphBoardChannels)[keyof typeof graphBoardChannels];
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
    create: (input: CreateTrackerInput) => Promise<TrackerRecord>;
    update: (input: UpdateTrackerInput) => Promise<TrackerRecord>;
    remove: (uuid: string) => Promise<void>;
    onIngestionStatus: (handler: (status: TrackerIngestionStatus) => void) => () => void;
  };
  projects: {
    list: () => Promise<ProjectRecord[]>;
    create: (input: CreateProjectInput) => Promise<ProjectRecord>;
    select: (input: ProjectSelectionInput) => Promise<ProjectRecord>;
    rename: (input: RenameProjectInput) => Promise<ProjectRecord>;
    archive: (input: ProjectSelectionInput) => Promise<ProjectRecord>;
    getActive: () => Promise<ProjectRecord>;
  };
  graphBoard: {
    getState: () => Promise<GraphBoardState>;
    getNodeDetails: (nodeId: string) => Promise<GraphBoardNodeDetails>;
    generateCallflow: (nodeId: string) => Promise<CallflowHtmlDocument>;
  };
  board: {
    getState: (rule: BoardRule) => Promise<GraphBoardTopic[]>;
    getGraphHtml: () => Promise<GraphHtmlDocument>;
    removeSource: (sourceFile: string) => Promise<GraphifyIngestionResult>;
    collapseSource: (sourceFile: string, targetSourceFile: string) => Promise<GraphifyIngestionResult>;
    renameSource: (sourceFile: string, newName: string) => Promise<GraphifyIngestionResult>;
    commentSource: (sourceFile: string, comment: string) => Promise<GraphifyIngestionResult>;
    search: (input: BoardSearchInput) => Promise<BoardSearchResult[]>;
  };
  filesystem: {
    getRoot: () => Promise<SourceTreeNode[]>;
    getChildren: (nodeId: string) => Promise<SourceTreeNode[]>;
    getDetails: (nodeId: string) => Promise<SourceTreeNodeDetails>;
    search: (input: SourceTreeSearchInput) => Promise<SourceTreeSearchResult[]>;
    getSourceOptions: () => Promise<SourceTreeSourceOption[]>;
  };
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  settings: {
    getAi: () => Promise<AiSettings>;
    updateAi: (input: UpdateAiSettingsInput) => Promise<AiSettings>;
    getApp: () => Promise<AppSettings>;
    updateApp: (input: UpdateAppSettingsInput) => Promise<AppSettings>;
  };
};

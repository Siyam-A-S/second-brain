import type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  AppSettings,
  ChatResponse,
  ChatSendInput,
  ChatThread,
  CallflowHtmlDocument,
  CreateProjectInput,
  CreateTrackerInput,
  DependencyRuntimeStatus,
  ExportBoardPlaintextInput,
  GraphifyContextResult,
  GraphDefinitionStatus,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphifyIngestionResult,
  ManagedProxySettings,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  ProjectRecord,
  ProjectSelectionInput,
  RenameProjectInput,
  ResearchDependencyReport,
  ResearchPaperDetails,
  ResearchPaperNote,
  ResearchPaperSummary,
  SaveResearchNodeNoteInput,
  SearchBrainNodesInput,
  TrackerIngestionStatus,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput,
  UpdateNodeSignalsInput,
  UpdateResearchPaperStatusInput,
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
  ExplorerNode,
  ExplorerArtifactContent,
  ExplorerNodeDetails,
  ExplorerSearchInput,
  ExplorerSearchResult,
  ExplorerSourceOption
} from "./types/explorer";

export type {
  BrainNode,
  BrainSearchResult,
  BoardChildNode,
  AiSettings,
  AppSettings,
  ChatResponse,
  ChatSendInput,
  ChatThread,
  CallflowHtmlDocument,
  CreateProjectInput,
  CreateTrackerInput,
  DependencyRuntimeStatus,
  ExportBoardPlaintextInput,
  GraphBoardLink,
  GraphBoardNeighbor,
  GraphBoardNode,
  GraphifyContextCitation,
  GraphifyContextResult,
  GraphDefinitionStatus,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphifyIngestionResult,
  ManagedProxySettings,
  OrganizedBoardTopic,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ListBrainNodesInput,
  McpServerStatus,
  ProjectRecord,
  ProjectSelectionInput,
  RenameProjectInput,
  ResearchDependencyReport,
  ResearchPaperComponentType,
  ResearchPaperDetails,
  ResearchPaperNote,
  ResearchPaperStatus,
  ResearchPaperSummary,
  ResearchLiteratureMatrix,
  ResearchThesisLink,
  SaveResearchNodeNoteInput,
  SearchBrainNodesInput,
  TrackerIngestionStatus,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput,
  UpdateNodeSignalsInput,
  UpdateResearchPaperStatusInput,
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
  ExplorerNode,
  ExplorerArtifactContent,
  ExplorerArtifactFormat,
  ExplorerArtifactKind,
  ExplorerNodeDetails,
  ExplorerNodeKind,
  ExplorerRelationGroup,
  ExplorerRelationItem,
  ExplorerSearchInput,
  ExplorerSearchResult,
  ExplorerSourceOption
} from "./types/explorer";

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

export const explorerChannels = {
  getRoot: "explorer-get-root",
  getChildren: "explorer-get-children",
  getDetails: "explorer-get-details",
  search: "explorer-search",
  getSourceOptions: "explorer-get-source-options",
  getArtifactContent: "explorer-get-artifact-content"
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
  generateCallflow: "graph-board-generate-callflow",
  getDefinitionStatus: "graph-board-get-definition-status"
} as const;

export const researchChannels = {
  getDependencyStatus: "research-get-dependency-status",
  listPapers: "research-list-papers",
  getPaperDetails: "research-get-paper-details",
  saveNodeNote: "research-save-node-note",
  updatePaperStatus: "research-update-paper-status"
} as const;

export const clipboardChannels = {
  readText: "clipboard-read-text",
  writeText: "clipboard-write-text"
} as const;

export const settingsChannels = {
  getAi: "settings-get-ai",
  updateAi: "settings-update-ai",
  getApp: "settings-get-app",
  updateApp: "settings-update-app",
  updateManagedProxy: "settings-update-managed-proxy"
} as const;

export const chatChannels = {
  listThreads: "chat-list-threads",
  createThread: "chat-create-thread",
  sendMessage: "chat-send-message",
  deleteThread: "chat-delete-thread",
  getGrounding: "chat-get-grounding"
} as const;

export const runtimeChannels = {
  getDependencyStatus: "runtime-get-dependency-status",
  installOrRepairDependencies: "runtime-install-or-repair-dependencies"
} as const;

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];
export type BrainChannel = (typeof brainChannels)[keyof typeof brainChannels];
export type TrackerChannel = (typeof trackerChannels)[keyof typeof trackerChannels];
export type BoardChannel = (typeof boardChannels)[keyof typeof boardChannels];
export type ExplorerChannel = (typeof explorerChannels)[keyof typeof explorerChannels];
export type ProjectChannel = (typeof projectChannels)[keyof typeof projectChannels];
export type GraphBoardChannel = (typeof graphBoardChannels)[keyof typeof graphBoardChannels];
export type ResearchChannel = (typeof researchChannels)[keyof typeof researchChannels];
export type ClipboardChannel = (typeof clipboardChannels)[keyof typeof clipboardChannels];
export type SettingsChannel = (typeof settingsChannels)[keyof typeof settingsChannels];
export type ChatChannel = (typeof chatChannels)[keyof typeof chatChannels];
export type RuntimeChannel = (typeof runtimeChannels)[keyof typeof runtimeChannels];

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
    getDefinitionStatus: () => Promise<GraphDefinitionStatus>;
  };
  research: {
    getDependencyStatus: () => Promise<ResearchDependencyReport>;
    listPapers: () => Promise<ResearchPaperSummary[]>;
    getPaperDetails: (nodeId: string) => Promise<ResearchPaperDetails>;
    saveNodeNote: (input: SaveResearchNodeNoteInput) => Promise<ResearchPaperNote>;
    updatePaperStatus: (input: UpdateResearchPaperStatusInput) => Promise<ResearchPaperSummary>;
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
  explorer: {
    getRoot: () => Promise<ExplorerNode[]>;
    getChildren: (nodeId: string) => Promise<ExplorerNode[]>;
    getDetails: (nodeId: string) => Promise<ExplorerNodeDetails>;
    search: (input: ExplorerSearchInput) => Promise<ExplorerSearchResult[]>;
    getSourceOptions: () => Promise<ExplorerSourceOption[]>;
    getArtifactContent: (artifactId: string) => Promise<ExplorerArtifactContent>;
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
    updateManagedProxy: (input: UpdateManagedProxySettingsInput) => Promise<ManagedProxySettings>;
  };
  chat: {
    listThreads: () => Promise<ChatThread[]>;
    createThread: (input?: { title?: string | undefined }) => Promise<ChatThread>;
    sendMessage: (input: ChatSendInput) => Promise<ChatResponse>;
    deleteThread: (threadId: string) => Promise<void>;
    getGrounding: (messageId: string) => Promise<GraphifyContextResult | null>;
  };
  runtime: {
    getDependencyStatus: () => Promise<DependencyRuntimeStatus>;
    installOrRepairDependencies: () => Promise<DependencyRuntimeStatus>;
  };
};

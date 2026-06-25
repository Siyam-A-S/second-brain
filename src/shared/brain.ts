export type BrainNodeFrontmatter = {
  uuid: string;
  title: string;
  type: string;
  summary: string;
  parent_uuid: string | null;
  connections: string[];
  tags: string[];
  created_at: string;
  importance: number;
  user_validation: UserValidationState;
  context_hints: string[];
};

export type UserValidationState = "unreviewed" | "approved" | "rejected" | "pinned";

export type BrainNode = BrainNodeFrontmatter & {
  content: string;
  path: string;
  updatedAt: string;
};

export type WriteBrainNodeInput = {
  uuid?: string | undefined;
  title: string;
  type: string;
  summary: string;
  parent_uuid?: string | null | undefined;
  connections?: string[] | undefined;
  tags?: string[] | undefined;
  created_at?: string | undefined;
  importance?: number | undefined;
  user_validation?: UserValidationState | undefined;
  context_hints?: string[] | undefined;
  content: string;
};

export type ListBrainNodesInput = {
  tag?: string | undefined;
  type?: string | undefined;
};

export type SearchBrainNodesInput = {
  query: string;
  limit?: number | undefined;
};

export type BrainSearchResult = {
  node: BrainNode;
  score: number;
};

export type BoardTopologyNode = Pick<BrainNodeFrontmatter, "uuid" | "title" | "summary" | "connections">;

export type SearchBoardTopologyInput = {
  keywords: string[];
};

export type FetchFileSegmentsInput = {
  uuid: string;
  sections?: string[] | undefined;
};

export type IngestAndRouteFragmentInput = {
  raw_content: string;
  inferred_title: string;
  generated_summary: string;
  target_parent_uuid?: string | undefined;
  importance?: number | undefined;
  context_hints?: string[] | undefined;
};

export type RoutingDecision = {
  strategy: "explicit-parent" | "existing-context" | "new-topic";
  parent_uuid: string;
  parent_title: string;
  confidence: number;
  reasons: string[];
};

export type IngestAndRouteFragmentResult = {
  node: BrainNode;
  routing: RoutingDecision;
};

export type BoardChildNode = Pick<
  BrainNode,
  | "uuid"
  | "title"
  | "type"
  | "summary"
  | "connections"
  | "tags"
  | "updatedAt"
  | "importance"
  | "user_validation"
>;

export type OrganizedBoardTopic = BoardChildNode & {
  children: BoardChildNode[];
};

export type ExportBoardPlaintextInput = {
  root_uuid?: string | undefined;
  include_body?: boolean | undefined;
};

export type UpdateNodeSignalsInput = {
  uuid: string;
  importance?: number | undefined;
  user_validation?: UserValidationState | undefined;
  context_hints?: string[] | undefined;
};

export type ProcessDroppedItem = {
  name?: string | undefined;
  path?: string | undefined;
  type?: string | undefined;
  text?: string | undefined;
  content?: string | undefined;
  buffer?: ArrayBuffer | number[] | undefined;
};

export type GraphifyIngestionResult = {
  completed: boolean;
  writtenFileCount: number;
  graphPath: string;
  reportPath: string;
  graphNodeCount?: number | undefined;
  graphEdgeCount?: number | undefined;
  stdout: string;
  updatedAt: string;
};

export type GroupGraphNodesInput = {
  label: string;
  relation: string;
  nodeIds: string[];
};

export type AiSettings = {
  mode: AiMode;
  endpoint: string;
  apiKey: string;
  model: string;
  updatedAt: string;
};

export type AiMode = "proxy" | "local";

export type ManagedProxySettings = {
  enabled: boolean;
  endpoint: string;
  secretKey: string;
  model: string;
  groundingEnabled: boolean;
  updatedAt: string;
};

export type UpdateAiSettingsInput = {
  endpoint?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
};

export type UpdateManagedProxySettingsInput = Partial<Omit<ManagedProxySettings, "updatedAt">>;

export type GraphifyRuntimeSettings = {
  graphifyBin: string;
  maxTokens: number;
  retryMaxTokens: number;
  timeoutMs: number;
  cardDefinitions: boolean;
  cardDefinitionMaxPerPass: number;
  paperComponents: boolean;
};

export type AppSettings = {
  aiMode: AiMode;
  ai: AiSettings;
  managedProxy: ManagedProxySettings;
  graphify: GraphifyRuntimeSettings;
  updatedAt: string;
};

export type UpdateGraphifyRuntimeSettingsInput = Partial<GraphifyRuntimeSettings>;

export type UpdateAppSettingsInput = {
  aiMode?: AiMode | undefined;
  ai?: UpdateAiSettingsInput | undefined;
  managedProxy?: UpdateManagedProxySettingsInput | undefined;
  graphify?: UpdateGraphifyRuntimeSettingsInput | undefined;
};

export type GraphifyContextCitation = {
  sourceFile: string;
  sourceLocation?: string | undefined;
  label?: string | undefined;
};

export type GraphifyContextResult = {
  query: string;
  stdout: string;
  budget: number;
  command: string;
  graphPath: string;
  citations: GraphifyContextCitation[];
  error?: string | undefined;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatArtifactSource = "assistant-text" | "proxy-attachment" | "local-tool";

export type ChatArtifact = {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "text" | "binary";
  storagePath: string;
  createdAt: string;
  source: ChatArtifactSource;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  artifacts?: ChatArtifact[] | undefined;
  grounding?: {
    graphify: GraphifyContextResult;
    api?: unknown;
  } | undefined;
  error?: string | undefined;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ChatSendInput = {
  threadId?: string | undefined;
  message: string;
  budget?: number | undefined;
};

export type ChatResponse = {
  thread: ChatThread;
  message: ChatMessage;
};

export type ChatStreamEvent =
  | {
      type: "started";
      generationId: string;
      thread: ChatThread;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | {
      type: "grounding";
      generationId: string;
      messageId: string;
      grounding: GraphifyContextResult;
    }
  | {
      type: "delta";
      generationId: string;
      messageId: string;
      delta: string;
      content: string;
    }
  | {
      type: "artifact";
      generationId: string;
      messageId: string;
      artifact: ChatArtifact;
    }
  | {
      type: "done";
      generationId: string;
      thread: ChatThread;
      message: ChatMessage;
    }
  | {
      type: "error";
      generationId: string;
      thread?: ChatThread | undefined;
      message?: ChatMessage | undefined;
      error: string;
    }
  | {
      type: "aborted";
      generationId: string;
      thread?: ChatThread | undefined;
      message?: ChatMessage | undefined;
    };

export type SaveChatArtifactInput = {
  messageId: string;
  title?: string | undefined;
  content?: string | undefined;
};

export type ChatArtifactActionResult = {
  thread: ChatThread;
  message: ChatMessage;
  artifact: ChatArtifact;
  ingestion?: GraphifyIngestionResult | undefined;
  downloadedPath?: string | undefined;
};

export type RuntimeDependencyCheck = {
  name: "python" | "uv" | "graphify";
  available: boolean;
  version: string;
  path?: string | undefined;
  required: boolean;
  guidance: string;
};

export type DependencyRuntimeStatus = {
  available: boolean;
  checkedAt: string;
  dependencies: RuntimeDependencyCheck[];
  guidance: string[];
  repairCommand: string;
  lastRepairOutput?: string | undefined;
};

export type ProjectRecord = {
  id: string;
  name: string;
  rootPath: string;
  vaultPath: string;
  rawVaultPath: string;
  graphPath: string;
  trackerPath: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | undefined;
  active: boolean;
};

export type CreateProjectInput = {
  name: string;
};

export type RenameProjectInput = {
  projectId: string;
  name: string;
};

export type ProjectSelectionInput = {
  projectId: string;
};

export type GraphBoardNode = {
  id: string;
  label: string;
  type: string;
  summary: string;
  sourceFile: string;
  community: string;
  degree: number;
  rawData: Record<string, unknown>;
};

export type GraphBoardLink = {
  source: string;
  target: string;
  label: string;
  weight: number;
  rawData: Record<string, unknown>;
};

export type GraphBoardState = {
  nodes: GraphBoardNode[];
  links: GraphBoardLink[];
  graphPath: string;
  updatedAt: string;
};

export type GraphDefinitionStatus = {
  running: boolean;
  pendingCount: number;
  updatedCount: number;
  failedBatchCount: number;
  lastError?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  updatedAt: string;
  endpointHost: string;
};

export type GraphBoardNeighbor = {
  id: string;
  label: string;
  type: string;
  relation: string;
  direction: "incoming" | "outgoing";
  sourceFile: string;
};

export type ResearchPaperStatus = "unread" | "reading" | "summarized" | "cited" | "discarded";

export type ResearchPaperComponentType =
  | "paper_file"
  | "paper_abstract"
  | "paper_section"
  | "paper_figure"
  | "paper_table"
  | "paper_reference"
  | "paper_claim"
  | "paper_method"
  | "paper_dataset"
  | "paper_result";

export type ResearchDependencyStatus = {
  name: string;
  importName: string;
  installed: boolean;
  version: string;
  required: boolean;
  purpose: string;
  guidance: string;
};

export type ResearchDependencyReport = {
  available: boolean;
  checkedAt: string;
  runtime: string;
  dependencies: ResearchDependencyStatus[];
  guidance: string[];
};

export type ResearchPaperSummary = {
  nodeId: string;
  title: string;
  sourceFile: string;
  year?: string | undefined;
  authors: string[];
  status: ResearchPaperStatus;
  updatedAt: string;
};

export type ResearchPaperNote = {
  nodeId: string;
  note: string;
  updatedAt: string;
};

export type ResearchLiteratureMatrix = {
  problem: string;
  method: string;
  dataset: string;
  keyResult: string;
  limitations: string;
  relevanceToThesis: string;
};

export type ResearchThesisLink = {
  claim: string;
  relation: "supports" | "opposes" | "extends" | "background";
  nodeIds: string[];
  updatedAt: string;
};

export type ResearchPaperDetails = {
  paper: ResearchPaperSummary;
  abstract?: string | undefined;
  components: Array<{
    id: string;
    label: string;
    type: ResearchPaperComponentType | string;
    summary: string;
    sourceLocation: string;
  }>;
  notes: ResearchPaperNote[];
  literature: ResearchLiteratureMatrix;
  thesisLinks: ResearchThesisLink[];
};

export type UpdateResearchPaperStatusInput = {
  nodeId: string;
  status: ResearchPaperStatus;
};

export type SaveResearchNodeNoteInput = {
  nodeId: string;
  note: string;
};

export type GraphBoardNodeDetails = GraphBoardNode & {
  neighbors: GraphBoardNeighbor[];
  research?: ResearchPaperDetails | undefined;
};

export type CallflowHtmlDocument = {
  html: string;
  path: string;
  updatedAt: string;
  stdout: string;
};

export type TrackerStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";

export type TrackerPriority = "low" | "medium" | "high" | "urgent";

export type TrackerRecord = {
  uuid: string;
  title: string;
  description: string;
  status: TrackerStatus;
  priority: TrackerPriority;
  labels: string[];
  dueDate?: string | undefined;
  sourceNodeIds: string[];
  sourceFiles: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateTrackerInput = {
  title: string;
  description?: string | undefined;
  status?: TrackerStatus | undefined;
  priority?: TrackerPriority | undefined;
  labels?: string[] | undefined;
  dueDate?: string | undefined;
  sourceNodeIds?: string[] | undefined;
  sourceFiles?: string[] | undefined;
};

export type UpdateTrackerInput = {
  uuid: string;
  status?: TrackerStatus | undefined;
  title?: string | undefined;
  description?: string | undefined;
  priority?: TrackerPriority | undefined;
  labels?: string[] | undefined;
  dueDate?: string | null | undefined;
  sourceNodeIds?: string[] | undefined;
  sourceFiles?: string[] | undefined;
};

export type TrackerIngestionStatus = {
  stage: "idle" | "extracting" | "saved" | "skipped" | "error";
  message: string;
  error?: string | undefined;
};

export type ClipboardIngestibleItemsResult = {
  items: ProcessDroppedItem[];
  message: string;
};

export type ProcessDroppedItemsResult = {
  prompt: string;
  graphify?: GraphifyIngestionResult | undefined;
  createdNode?: BrainNode | undefined;
  routing?: RoutingDecision | undefined;
};

export type McpServerStatus = {
  running: boolean;
  url: string;
  port: number;
};

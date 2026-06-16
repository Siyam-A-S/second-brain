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

export type AiSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
  updatedAt: string;
};

export type UpdateAiSettingsInput = {
  endpoint?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
};

export type GraphifyRuntimeSettings = {
  graphifyBin: string;
  maxTokens: number;
  retryMaxTokens: number;
  timeoutMs: number;
  cardDefinitions: boolean;
  cardDefinitionMaxPerPass: number;
};

export type AppSettings = {
  ai: AiSettings;
  graphify: GraphifyRuntimeSettings;
  updatedAt: string;
};

export type UpdateGraphifyRuntimeSettingsInput = Partial<GraphifyRuntimeSettings>;

export type UpdateAppSettingsInput = {
  ai?: UpdateAiSettingsInput | undefined;
  graphify?: UpdateGraphifyRuntimeSettingsInput | undefined;
};

export type TrackerStatus = "Tracking" | "Done" | "Dismissed";

export type TrackerRecord = {
  uuid: string;
  title: string;
  date: string;
  time: string;
  endTime?: string | undefined;
  timezone?: string | undefined;
  location?: string | undefined;
  link?: string | undefined;
  context: string;
  source_node_uuid?: string | undefined;
  source?: string | undefined;
  status: TrackerStatus;
  raw_content: string;
  createdAt: string;
  updatedAt: string;
};

export type UpdateTrackerInput = {
  uuid: string;
  status?: TrackerStatus | undefined;
  context?: string | undefined;
};

export type TrackerIngestionStatus = {
  stage: "idle" | "extracting" | "saved" | "skipped" | "error";
  message: string;
  tracker?: TrackerRecord | undefined;
  trackers?: TrackerRecord[] | undefined;
  error?: string | undefined;
};

export type SmartClipKind = "bash" | "path" | "text";

export type SmartClip = {
  id: string;
  title: string;
  value: string;
  kind: SmartClipKind;
  frequency: number;
  createdAt: string;
  lastUsedAt: string;
};

export type ProcessDroppedItemsResult = {
  prompt: string;
  graphify?: GraphifyIngestionResult | undefined;
  createdNode?: BrainNode | undefined;
  routing?: RoutingDecision | undefined;
  tracker?: TrackerRecord | undefined;
  trackers?: TrackerRecord[] | undefined;
  trackerSkipped?: boolean | undefined;
  trackerError?: string | undefined;
  smartClips?: SmartClip[] | undefined;
};

export type McpServerStatus = {
  running: boolean;
  url: string;
  port: number;
};

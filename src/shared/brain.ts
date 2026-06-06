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
};

export type ProcessDroppedItemsResult = {
  prompt: string;
  createdNode: BrainNode;
  routing: RoutingDecision;
};

export type McpServerStatus = {
  running: boolean;
  url: string;
  port: number;
};

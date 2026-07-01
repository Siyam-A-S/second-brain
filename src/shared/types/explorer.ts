export type ExplorerNodeKind = "root" | "folder" | "source" | "component" | "entity" | "artifact" | "related-group";

export type ExplorerArtifactKind =
  | "section"
  | "abstract"
  | "figure"
  | "diagram"
  | "graph"
  | "table"
  | "experiment"
  | "reference"
  | "claim"
  | "method"
  | "dataset"
  | "result"
  | "artifact";

export type ExplorerArtifactFormat = "markdown" | "csv" | "json" | "text";

export type ExplorerNode = {
  id: string;
  title: string;
  kind: ExplorerNodeKind;
  sourceFile?: string | undefined;
  graphNodeId?: string | undefined;
  relation?: string | undefined;
  type?: string | undefined;
  summary?: string | undefined;
  modifiedAt?: string | undefined;
  artifactId?: string | undefined;
  artifactKind?: ExplorerArtifactKind | undefined;
  artifactPath?: string | undefined;
  page?: number | undefined;
  preview?: string | undefined;
  llmFormat?: ExplorerArtifactFormat | undefined;
  systemIconDataUrl?: string | undefined;
  childrenCount: number;
  isExpandable: boolean;
};

export type ExplorerRelationItem = {
  nodeId: string;
  title: string;
  type: string;
  sourceFile: string;
  relation: string;
};

export type ExplorerRelationGroup = {
  relation: string;
  title: string;
  items: ExplorerRelationItem[];
};

export type ExplorerNodeDetails = {
  node: ExplorerNode;
  sourceLocation?: string | undefined;
  community?: string | undefined;
  relationGroups: ExplorerRelationGroup[];
};

export type ExplorerArtifactContent = {
  artifactId: string;
  title: string;
  artifactKind: ExplorerArtifactKind;
  sourceFile: string;
  artifactPath: string;
  page?: number | undefined;
  preview?: string | undefined;
  llmFormat: ExplorerArtifactFormat;
  content: string;
  updatedAt: string;
};

export type ExplorerSearchInput = {
  query: string;
  limit?: number | undefined;
};

export type ExplorerSearchResult = ExplorerNode & {
  score: number;
};

export type ExplorerSourceOption = {
  sourceFile: string;
  title: string;
};

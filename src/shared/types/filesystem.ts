export type SourceTreeNodeKind = "root" | "folder" | "source" | "component" | "entity" | "related-group";

export type SourceTreeNode = {
  id: string;
  title: string;
  kind: SourceTreeNodeKind;
  sourceFile?: string | undefined;
  graphNodeId?: string | undefined;
  relation?: string | undefined;
  type?: string | undefined;
  summary?: string | undefined;
  modifiedAt?: string | undefined;
  childrenCount: number;
  isExpandable: boolean;
};

export type SourceTreeRelationItem = {
  nodeId: string;
  title: string;
  type: string;
  sourceFile: string;
  relation: string;
};

export type SourceTreeRelationGroup = {
  relation: string;
  title: string;
  items: SourceTreeRelationItem[];
};

export type SourceTreeNodeDetails = {
  node: SourceTreeNode;
  sourceLocation?: string | undefined;
  community?: string | undefined;
  relationGroups: SourceTreeRelationGroup[];
};

export type SourceTreeSearchInput = {
  query: string;
  limit?: number | undefined;
};

export type SourceTreeSearchResult = SourceTreeNode & {
  score: number;
};

export type SourceTreeSourceOption = {
  sourceFile: string;
  title: string;
};

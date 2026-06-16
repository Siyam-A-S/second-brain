export type BoardLayoutType = "masonry" | "table" | "list";

export type BoardRule = "community" | "entity" | "source";

export type BoardSearchKind = "entity" | "type" | "source";

export type BoardItem = {
  id: string;
  title: string;
  summary: string;
  type: string;
  sourceFile: string;
  modifiedAt: string;
  rawData: Record<string, unknown>;
};

export type OrganizedBoardTopic = {
  id: string;
  title: string;
  layoutType: BoardLayoutType;
  items: BoardItem[];
};

export type BoardSearchInput = {
  query: string;
  limit?: number | undefined;
};

export type BoardSearchResult = {
  id: string;
  kind: BoardSearchKind;
  title: string;
  subtitle: string;
  sourceFile?: string | undefined;
  type?: string | undefined;
  score: number;
};

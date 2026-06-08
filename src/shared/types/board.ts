export type BoardLayoutType = "masonry" | "table" | "list";

export type BoardRule = "community" | "entity" | "source";

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

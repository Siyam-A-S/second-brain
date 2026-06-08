import { create } from "zustand";
import type { BoardRule, GraphBoardTopic } from "../../shared/ipc";

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState = {
  rule: BoardRule;
  topics: GraphBoardTopic[];
  loadState: LoadState;
  error: string | null;
  setRule: (rule: BoardRule) => void;
  loadBoard: (rule?: BoardRule) => Promise<void>;
};

export const useBoardStore = create<BoardState>((set, get) => ({
  rule: "community",
  topics: [],
  loadState: "idle",
  error: null,
  setRule: (rule) => set({ rule }),
  loadBoard: async (nextRule) => {
    const rule = nextRule ?? get().rule;

    set({ rule, loadState: "loading", error: null });

    try {
      const topics = await window.api.board.getState(rule);
      set({ topics, loadState: "ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load Graphify board.";
      console.error("Unable to load Graphify board", error);
      set({ topics: [], loadState: "error", error: message });
    }
  }
}));

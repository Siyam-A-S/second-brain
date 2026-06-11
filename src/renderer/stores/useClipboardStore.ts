import { create } from "zustand";
import type { SmartClip } from "../../shared/ipc";

type ClipboardState = {
  items: SmartClip[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  copy: (id: string) => Promise<void>;
};

function sortSmartClips(items: SmartClip[]): SmartClip[] {
  return [...items].sort(
    (left, right) =>
      right.frequency - left.frequency ||
      Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) ||
      left.title.localeCompare(right.title)
  );
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: [],
  isLoading: false,
  error: null,
  load: async () => {
    set({ isLoading: true, error: null });

    try {
      set({
        items: sortSmartClips(await window.api.clipboard.listSmartClips()),
        isLoading: false
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Unable to load Smart Clips."
      });
    }
  },
  copy: async (id: string) => {
    try {
      const updated = await window.api.clipboard.useSmartClip(id);
      set((state) => ({
        error: null,
        items: sortSmartClips([
          updated,
          ...state.items.filter((item) => item.id !== updated.id)
        ])
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unable to copy Smart Clip."
      });
    }
  }
}));

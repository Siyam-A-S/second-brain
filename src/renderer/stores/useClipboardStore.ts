import { create } from "zustand";

export type ClipboardKind = "code" | "text" | "path";

export type ClipboardItem = {
  id: string;
  title: string;
  value: string;
  kind: ClipboardKind;
  frequency: number;
  lastUsedAt: number;
};

type ClipboardState = {
  items: ClipboardItem[];
  recordUse: (id: string) => void;
};

const now = Date.now();

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  items: [
    {
      id: "clip-1",
      title: "Shell cleanup",
      value: "rm -rf ./foo/*",
      kind: "code",
      frequency: 2,
      lastUsedAt: now - 3_000
    },
    {
      id: "clip-2",
      title: "Project note",
      value: "Compare local WASM embedding latency against cached vector lookups.",
      kind: "text",
      frequency: 5,
      lastUsedAt: now - 12_000
    },
    {
      id: "clip-3",
      title: "Vault path",
      value: "C:\\Users\\rushat\\Documents\\SecondBrain\\vault",
      kind: "path",
      frequency: 1,
      lastUsedAt: now - 7_000
    },
    {
      id: "clip-4",
      title: "IPC sketch",
      value: "files-dropped -> main MCP router -> embedding queue",
      kind: "text",
      frequency: 3,
      lastUsedAt: now - 1_000
    }
  ],
  recordUse: (id: string) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              frequency: item.frequency + 1,
              lastUsedAt: Date.now()
            }
          : item
      )
    }))
}));

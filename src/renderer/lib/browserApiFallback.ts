import type { SecondBrainApi } from "../../shared/ipc";

const browserApiFallback: SecondBrainApi = {
  window: {
    minimize: async () => undefined,
    maximize: async () => false,
    close: async () => undefined,
    restore: async () => undefined
  },
  files: {
    dropped: async (payload) => {
      console.info("Browser renderer drop payload", payload);
    }
  },
  brain: {
    writeNode: async (input) => ({
      uuid: input.uuid ?? "browser-preview",
      title: input.title,
      type: input.type,
      summary: input.summary,
      parent_uuid: input.parent_uuid ?? null,
      connections: input.connections ?? [],
      tags: input.tags ?? [],
      content: input.content,
      path: "/browser-preview",
      updatedAt: new Date().toISOString(),
      created_at: input.created_at ?? new Date().toISOString(),
      importance: input.importance ?? 0.5,
      user_validation: input.user_validation ?? "unreviewed",
      context_hints: input.context_hints ?? []
    }),
    readNode: async (uuid) => {
      throw new Error(`Browser preview cannot read node "${uuid}".`);
    },
    listNodes: async () => [],
    searchNodes: async () => [],
    getMcpStatus: async () => ({
      running: false,
      url: "http://127.0.0.1:4127/mcp",
      port: 4127
    }),
    processDroppedItems: async (items) => ({
      prompt: `Browser preview received ${items.length} dropped item(s).`,
      createdNode: {
        uuid: "browser-preview",
        title: "Browser Preview Fragment",
        type: "fragment",
        summary: "Preview-only dropped item.",
        parent_uuid: null,
        connections: [],
        tags: [],
        content: items.map((item) => item.text ?? item.content ?? item.name ?? "").join("\n\n"),
        path: "/browser-preview",
        updatedAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
        importance: 0.5,
        user_validation: "unreviewed",
        context_hints: []
      },
      routing: {
        strategy: "new-topic",
        parent_uuid: "browser-preview-topic",
        parent_title: "Browser Preview",
        confidence: 0,
        reasons: ["Browser preview fallback."]
      }
    }),
    getOrganizedBoard: async () => [],
    exportBoardPlaintext: async () => "# Browser Preview Board",
    updateNodeSignals: async (input) => ({
      uuid: input.uuid,
      title: "Browser Preview",
      type: "fragment",
      summary: "Preview-only node.",
      parent_uuid: null,
      connections: [],
      tags: [],
      content: "",
      path: "/browser-preview",
      updatedAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      importance: input.importance ?? 0.5,
      user_validation: input.user_validation ?? "unreviewed",
      context_hints: input.context_hints ?? []
    })
  }
};

export function installBrowserApiFallback(): void {
  if (window.api || !import.meta.env.DEV) {
    return;
  }

  window.api = browserApiFallback;
}

import type {
  BoardRule,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  SecondBrainApi,
  SmartClip,
  TrackerIngestionStatus,
  TrackerRecord,
  UpdateAiSettingsInput,
  UpdateTrackerInput
} from "../../shared/ipc";

const trackerStatusHandlers = new Set<(status: TrackerIngestionStatus) => void>();
const browserTrackers: TrackerRecord[] = [];
const browserSmartClips: SmartClip[] = [];
let browserAiSettings = {
  endpoint: "http://localhost:8080/v1/chat/completions",
  apiKey: "local-dev-placeholder",
  model: "local-model",
  updatedAt: new Date().toISOString()
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLine(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? compact(value) : fallback;
}

function looksTrackable(content: string): boolean {
  return (
    /\b(today|tomorrow|next\s+week|deadline|due|meeting|appointment|follow[- ]?up|remind|schedule|expires)\b/i.test(content) &&
    (/\b\d{4}-\d{2}-\d{2}\b/.test(content) ||
      /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(content) ||
      /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(content) ||
      /\b(today|tomorrow|next\s+week)\b/i.test(content))
  );
}

function emitTrackerStatus(status: TrackerIngestionStatus): void {
  for (const handler of trackerStatusHandlers) {
    handler(status);
  }
}

function extractFallbackDate(content: string): string {
  const iso = content.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) {
    return iso;
  }

  if (/\btomorrow\b/i.test(content)) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  if (/\btoday\b/i.test(content)) {
    return new Date().toISOString().slice(0, 10);
  }

  return "";
}

function extractFallbackTime(content: string): string {
  return content.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i)?.[0] ?? content.match(/\b\d{1,2}\s*(?:am|pm)\b/i)?.[0] ?? "";
}

function extractFallbackUrl(content: string): string {
  return content.match(/https?:\/\/\S+/i)?.[0] ?? "";
}

function addBrowserSmartClip(value: string, kind: SmartClip["kind"]): SmartClip | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const now = new Date().toISOString();
  const id = `browser-${kind}-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`;
  const existing = browserSmartClips.find((item) => item.id === id);

  if (existing) {
    existing.frequency += 1;
    existing.lastUsedAt = now;
    return existing;
  }

  const clip: SmartClip = {
    id,
    title: kind === "path" ? trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed : trimmed.slice(0, 80),
    value: trimmed,
    kind,
    frequency: 1,
    createdAt: now,
    lastUsedAt: now
  };

  browserSmartClips.push(clip);
  return clip;
}

function sortSmartClips(items: SmartClip[]): SmartClip[] {
  return [...items].sort(
    (left, right) =>
      right.frequency - left.frequency ||
      Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) ||
      left.title.localeCompare(right.title)
  );
}

function readDroppedContent(items: ProcessDroppedItem[]): string {
  return items
    .map((item) => item.text ?? item.content ?? item.name ?? item.path ?? "")
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();
}

async function processDroppedItemsInBrowser(items: ProcessDroppedItem[]): Promise<ProcessDroppedItemsResult> {
  const rawContent = readDroppedContent(items);
  const now = new Date().toISOString();
  const smartClips = [
    ...items.map((item) => (item.path ? addBrowserSmartClip(item.path, "path") : null)),
    rawContent ? addBrowserSmartClip(rawContent, "text") : null
  ].filter((item): item is SmartClip => Boolean(item));
  const createdNode = {
    uuid: `browser-preview-${crypto.randomUUID()}`,
    title: compact(rawContent.split(/\r?\n/).find(Boolean) ?? "Browser Preview Fragment").slice(0, 80),
    type: "fragment",
    summary: compact(rawContent).slice(0, 220) || "Preview-only dropped item.",
    parent_uuid: null,
    connections: [],
    tags: [],
    content: rawContent,
    path: "/browser-preview",
    updatedAt: now,
    created_at: now,
    importance: 0.5,
    user_validation: "unreviewed" as const,
    context_hints: []
  };
  const baseResult = {
    prompt: `Browser preview received ${items.length} dropped item(s).`,
    smartClips,
    createdNode,
    routing: {
      strategy: "new-topic" as const,
      parent_uuid: "browser-preview-topic",
      parent_title: "Browser Preview",
      confidence: 0,
      reasons: ["Browser preview fallback."]
    }
  };

  if (!rawContent) {
    return baseResult;
  }

  if (!looksTrackable(rawContent)) {
    return baseResult;
  }

  emitTrackerStatus({
    stage: "extracting",
    message: "Checking dropped content for trackable dates..."
  });

  try {
    const tracker: TrackerRecord = {
      uuid: `browser-tracker-${crypto.randomUUID()}`,
      title: compact(rawContent.split(/\r?\n/).find(Boolean) ?? "Track item").slice(0, 80),
      date: extractFallbackDate(rawContent),
      time: extractFallbackTime(rawContent),
      link: extractFallbackUrl(rawContent),
      context: compact(rawContent).slice(0, 420),
      source: "Browser preview",
      status: "Tracking",
      raw_content: rawContent,
      createdAt: now,
      updatedAt: new Date().toISOString()
    };

    browserTrackers.unshift(tracker);
    emitTrackerStatus({
      stage: "saved",
      message: `Tracking ${tracker.title}`,
      tracker,
      trackers: [tracker]
    });

    return {
      prompt: baseResult.prompt,
      tracker,
      trackers: [tracker]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tracker extraction failed.";
    emitTrackerStatus({
      stage: "error",
      message,
      error: message
    });

    return {
      prompt: baseResult.prompt,
      trackerError: message
    };
  }
}

const browserApiFallback: SecondBrainApi = {
  window: {
    minimize: async () => undefined,
    maximize: async () => false,
    close: async () => undefined,
    restore: async () => undefined,
    getWidgetBounds: async () => ({
      x: 0,
      y: 0,
      width: 96,
      height: 96
    }),
    moveWidget: async (payload) => ({
      x: payload.x,
      y: payload.y,
      width: 96,
      height: 96
    })
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
    processDroppedItems: processDroppedItemsInBrowser,
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
  },
  tracker: {
    list: async () => browserTrackers,
    update: async (input: UpdateTrackerInput) => {
      const trackerIndex = browserTrackers.findIndex((tracker) => tracker.uuid === input.uuid);

      if (trackerIndex < 0) {
        throw new Error(`Browser preview cannot find tracker "${input.uuid}".`);
      }

      const current = browserTrackers[trackerIndex] as TrackerRecord;
      const updated = {
        ...current,
        status: input.status ?? current.status,
        context: input.context ?? current.context,
        updatedAt: new Date().toISOString()
      };

      browserTrackers.splice(trackerIndex, 1);
      browserTrackers.unshift(updated);
      return updated;
    },
    onIngestionStatus: (handler) => {
      trackerStatusHandlers.add(handler);
      return () => {
        trackerStatusHandlers.delete(handler);
      };
    }
  },
  board: {
    getState: async (rule: BoardRule) => [
      {
        id: `browser-${rule}`,
        title: "Browser Preview",
        layoutType: rule === "entity" ? "table" : rule === "source" ? "list" : "masonry",
        items: []
      }
    ],
    getGraphHtml: async () => ({
      html: [
        "<!doctype html>",
        "<html><body style=\"font-family: sans-serif; background: #0f0f1a; color: #e0e0e0; display: grid; place-items: center; height: 100vh; margin: 0;\">",
        "<p>Graph preview is available in the Electron app.</p>",
        "</body></html>"
      ].join(""),
      path: "/browser-preview/graph.html",
      updatedAt: new Date().toISOString()
    }),
    removeSource: async () => ({
      completed: true,
      writtenFileCount: 0,
      graphPath: "/browser-preview/graph.json",
      reportPath: "/browser-preview/GRAPH_REPORT.md",
      stdout: "Browser preview source removal is a no-op.",
      updatedAt: new Date().toISOString()
    }),
    collapseSource: async () => ({
      completed: true,
      writtenFileCount: 0,
      graphPath: "/browser-preview/graph.json",
      reportPath: "/browser-preview/GRAPH_REPORT.md",
      stdout: "Browser preview source collapse is a no-op.",
      updatedAt: new Date().toISOString()
    })
  },
  clipboard: {
    readText: async () => navigator.clipboard?.readText?.() ?? "",
    writeText: async (text: string) => {
      await navigator.clipboard?.writeText?.(text);
    },
    listSmartClips: async () => sortSmartClips(browserSmartClips),
    useSmartClip: async (id: string) => {
      const index = browserSmartClips.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new Error(`Browser preview cannot find Smart Clip "${id}".`);
      }

      const current = browserSmartClips[index] as SmartClip;
      const updated = {
        ...current,
        frequency: current.frequency + 1,
        lastUsedAt: new Date().toISOString()
      };

      browserSmartClips.splice(index, 1, updated);
      await navigator.clipboard?.writeText?.(updated.value);
      return updated;
    }
  },
  settings: {
    getAi: async () => browserAiSettings,
    updateAi: async (input: UpdateAiSettingsInput) => {
      browserAiSettings = {
        endpoint: input.endpoint ?? browserAiSettings.endpoint,
        apiKey: input.apiKey ?? browserAiSettings.apiKey,
        model: input.model ?? browserAiSettings.model,
        updatedAt: new Date().toISOString()
      };
      return browserAiSettings;
    }
  }
};

export function installBrowserApiFallback(): void {
  if (window.api || !import.meta.env.DEV) {
    return;
  }

  window.api = browserApiFallback;
}

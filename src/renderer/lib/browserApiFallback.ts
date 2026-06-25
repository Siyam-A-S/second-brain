import type {
  BoardRule,
  AppSettings,
  ChatStreamEvent,
  ChatThread,
  CreateTrackerInput,
  DependencyRuntimeStatus,
  GraphBoardNodeDetails,
  GraphBoardState,
  GraphDefinitionStatus,
  ProcessDroppedItem,
  ProcessDroppedItemsResult,
  ProjectRecord,
  ResearchDependencyReport,
  ResearchPaperDetails,
  ResearchPaperSummary,
  SecondBrainApi,
  ExplorerSearchInput,
  ExplorerNode,
  TrackerIngestionStatus,
  TrackerPriority,
  TrackerRecord,
  TrackerStatus,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput,
  UpdateTrackerInput
} from "../../shared/ipc";

const trackerStatusHandlers = new Set<(status: TrackerIngestionStatus) => void>();
const chatStreamHandlers = new Set<(event: ChatStreamEvent) => void>();
const browserTrackers: TrackerRecord[] = [];
const browserProxyOrigin = "https://graphify-proxy-724616525781.us-central1.run.app";
const browserProxyChatEndpoint = `${browserProxyOrigin}/chat`;
let activeProjectId = "browser-default";
const browserProjects: ProjectRecord[] = [
  {
    id: activeProjectId,
    name: "Browser Preview",
    rootPath: "/browser-preview",
    vaultPath: "/browser-preview/vault",
    rawVaultPath: "/browser-preview/vault/raw",
    graphPath: "/browser-preview/vault/raw/graphify-out/graph.json",
    trackerPath: "/browser-preview/tracker/tickets.json",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true
  }
];
const browserExplorerTree: ExplorerNode[] = [
  {
    id: "source:browser-preview.txt",
    title: "browser-preview.txt",
    kind: "source",
    sourceFile: "browser-preview.txt",
    type: "TXT",
    summary: "Browser preview source.",
    childrenCount: 1,
    isExpandable: true
  }
];
let browserAiSettings = {
  mode: "local" as const,
  endpoint: "http://localhost:8080/v1/chat/completions",
  apiKey: "local-dev-placeholder",
  model: "local-model",
  updatedAt: new Date().toISOString()
};
let browserAppSettings: AppSettings = {
  aiMode: "proxy",
  ai: browserAiSettings,
  managedProxy: {
    enabled: true,
    endpoint: browserProxyChatEndpoint,
    secretKey: "",
    model: "google/gemini-3.5-flash",
    groundingEnabled: true,
    updatedAt: new Date().toISOString()
  },
  graphify: {
    graphifyBin: "",
    maxTokens: 8192,
    retryMaxTokens: 4096,
    timeoutMs: 600_000,
    cardDefinitions: true,
    cardDefinitionMaxPerPass: 24,
    paperComponents: true
  },
  updatedAt: new Date().toISOString()
};
const browserThreads: ChatThread[] = [];

function browserEffectiveAiSettings() {
  if (browserAppSettings.aiMode === "proxy") {
    return {
      mode: "proxy" as const,
      endpoint: browserProxyChatEndpoint,
      apiKey: browserAppSettings.managedProxy.secretKey || "local-dev-placeholder",
      model: browserAppSettings.managedProxy.model || "google/gemini-3.5-flash",
      updatedAt: browserAppSettings.managedProxy.updatedAt
    };
  }

  return browserAiSettings;
}

const browserResearchDependencyReport: ResearchDependencyReport = {
  available: true,
  checkedAt: new Date().toISOString(),
  runtime: "/browser-preview/python",
  dependencies: [
    {
      name: "Graphify",
      importName: "graphify",
      installed: true,
      version: "preview",
      required: true,
      purpose: "Graph generation and MCP server",
      guidance: ""
    }
  ],
  guidance: []
};

const browserRuntimeStatus: DependencyRuntimeStatus = {
  available: true,
  checkedAt: new Date().toISOString(),
  dependencies: [
    {
      name: "python",
      available: true,
      version: "Python 3.10 preview",
      required: true,
      guidance: ""
    },
    {
      name: "uv",
      available: true,
      version: "uv preview",
      required: true,
      guidance: ""
    },
    {
      name: "graphify",
      available: true,
      version: "graphify preview",
      required: true,
      guidance: ""
    }
  ],
  guidance: [],
  repairCommand: "uv tool install --upgrade \"graphifyy[all]\""
};

const browserPaper: ResearchPaperSummary = {
  nodeId: "browser-preview-paper",
  title: "Browser Preview Paper",
  sourceFile: "browser-preview-paper.pdf",
  authors: [],
  status: "unread",
  updatedAt: new Date().toISOString()
};

const browserDefinitionStatus: GraphDefinitionStatus = {
  running: false,
  pendingCount: 0,
  updatedCount: 0,
  failedBatchCount: 0,
  updatedAt: new Date().toISOString(),
  endpointHost: "localhost:8080"
};

const browserPaperDetails: ResearchPaperDetails = {
  paper: browserPaper,
  abstract: "Browser preview paper details are available in Electron.",
  components: [],
  notes: [],
  literature: {
    problem: "",
    method: "",
    dataset: "",
    keyResult: "",
    limitations: "",
    relevanceToThesis: ""
  },
  thesisLinks: []
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLine(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? compact(value) : fallback;
}

function normalizeTrackerStatus(value: unknown): TrackerStatus {
  return value === "backlog" ||
    value === "todo" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done"
    ? value
    : "todo";
}

function normalizeTrackerPriority(value: unknown): TrackerPriority {
  return value === "low" || value === "medium" || value === "high" || value === "urgent" ? value : "medium";
}

function emitTrackerStatus(status: TrackerIngestionStatus): void {
  for (const handler of trackerStatusHandlers) {
    handler(status);
  }
}

function emitChatStreamEvent(event: ChatStreamEvent): void {
  for (const handler of chatStreamHandlers) {
    handler(event);
  }
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
    createdNode,
    routing: {
      strategy: "new-topic" as const,
      parent_uuid: "browser-preview-topic",
      parent_title: "Browser Preview",
      confidence: 0,
      reasons: ["Browser preview fallback."]
    }
  };

  emitTrackerStatus({
    stage: "saved",
    message: rawContent ? "Browser preview saved the dropped content." : "Browser preview received the drop."
  });

  return baseResult;
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
    create: async (input: CreateTrackerInput) => {
      const now = new Date().toISOString();
      const tracker: TrackerRecord = {
        uuid: `browser-ticket-${crypto.randomUUID()}`,
        title: normalizeLine(input.title, "Untitled ticket"),
        description: normalizeLine(input.description, ""),
        status: normalizeTrackerStatus(input.status),
        priority: normalizeTrackerPriority(input.priority),
        labels: input.labels ?? [],
        dueDate: input.dueDate,
        sourceNodeIds: input.sourceNodeIds ?? [],
        sourceFiles: input.sourceFiles ?? [],
        createdAt: now,
        updatedAt: now
      };

      browserTrackers.unshift(tracker);
      return tracker;
    },
    update: async (input: UpdateTrackerInput) => {
      const trackerIndex = browserTrackers.findIndex((tracker) => tracker.uuid === input.uuid);

      if (trackerIndex < 0) {
        throw new Error(`Browser preview cannot find tracker "${input.uuid}".`);
      }

      const current = browserTrackers[trackerIndex] as TrackerRecord;
      const updated = {
        ...current,
        status: input.status ?? current.status,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        priority: input.priority ?? current.priority,
        labels: input.labels ?? current.labels,
        dueDate: input.dueDate === null ? undefined : input.dueDate ?? current.dueDate,
        sourceNodeIds: input.sourceNodeIds ?? current.sourceNodeIds,
        sourceFiles: input.sourceFiles ?? current.sourceFiles,
        updatedAt: new Date().toISOString()
      };

      browserTrackers.splice(trackerIndex, 1);
      browserTrackers.unshift(updated);
      return updated;
    },
    remove: async (uuid: string) => {
      const index = browserTrackers.findIndex((tracker) => tracker.uuid === uuid);
      if (index >= 0) {
        browserTrackers.splice(index, 1);
      }
    },
    onIngestionStatus: (handler) => {
      trackerStatusHandlers.add(handler);
      return () => {
        trackerStatusHandlers.delete(handler);
      };
    }
  },
  projects: {
    list: async () => browserProjects.filter((project) => !project.archivedAt),
    create: async (input) => {
      const now = new Date().toISOString();
      const id = `browser-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || crypto.randomUUID()}`;
      const project: ProjectRecord = {
        id,
        name: input.name.trim() || "Untitled Project",
        rootPath: `/browser-preview/projects/${id}`,
        vaultPath: `/browser-preview/projects/${id}/vault`,
        rawVaultPath: `/browser-preview/projects/${id}/vault/raw`,
        graphPath: `/browser-preview/projects/${id}/vault/raw/graphify-out/graph.json`,
        trackerPath: `/browser-preview/projects/${id}/tracker/tickets.json`,
        createdAt: now,
        updatedAt: now,
        active: true
      };
      activeProjectId = id;
      browserProjects.forEach((candidate) => {
        candidate.active = false;
      });
      browserProjects.push(project);
      return project;
    },
    select: async (input) => {
      const project = browserProjects.find((candidate) => candidate.id === input.projectId && !candidate.archivedAt);
      if (!project) {
        throw new Error(`Browser preview cannot find project "${input.projectId}".`);
      }

      activeProjectId = project.id;
      browserProjects.forEach((candidate) => {
        candidate.active = candidate.id === activeProjectId;
      });
      return project;
    },
    rename: async (input) => {
      const project = browserProjects.find((candidate) => candidate.id === input.projectId);
      if (!project) {
        throw new Error(`Browser preview cannot find project "${input.projectId}".`);
      }

      project.name = input.name.trim() || project.name;
      project.updatedAt = new Date().toISOString();
      return project;
    },
    archive: async (input) => {
      const project = browserProjects.find((candidate) => candidate.id === input.projectId);
      if (!project) {
        throw new Error(`Browser preview cannot find project "${input.projectId}".`);
      }

      project.archivedAt = new Date().toISOString();
      project.active = false;
      const next = browserProjects.find((candidate) => !candidate.archivedAt);
      if (next) {
        activeProjectId = next.id;
        next.active = true;
      }
      return project;
    },
    getActive: async () => {
      const project = browserProjects.find((candidate) => candidate.id === activeProjectId) ?? browserProjects[0];
      if (!project) {
        throw new Error("Browser preview has no active project.");
      }

      return project;
    }
  },
  graphBoard: {
    getState: async (): Promise<GraphBoardState> => ({
      nodes: [
        {
          id: "browser-preview-fragment",
          label: "Browser Preview",
          type: "fragment",
          summary: "Preview-only graph node.",
          sourceFile: "browser-preview.txt",
          community: "preview",
          degree: 0,
          rawData: {}
        }
      ],
      links: [],
      graphPath: "/browser-preview/graph.json",
      updatedAt: new Date().toISOString()
    }),
    getNodeDetails: async (nodeId: string): Promise<GraphBoardNodeDetails> => ({
      id: nodeId,
      label: "Browser Preview",
      type: "fragment",
      summary: "Preview-only graph node.",
      sourceFile: "browser-preview.txt",
      community: "preview",
      degree: 0,
      rawData: {},
      neighbors: []
    }),
    generateCallflow: async () => ({
      html: "<!doctype html><html><body><p>Call flow export is available in Electron.</p></body></html>",
      path: "/browser-preview/callflow.html",
      updatedAt: new Date().toISOString(),
      stdout: "Browser preview callflow is a no-op."
    }),
    getDefinitionStatus: async () => browserDefinitionStatus
  },
  research: {
    getDependencyStatus: async () => browserResearchDependencyReport,
    listPapers: async () => [browserPaper],
    getPaperDetails: async () => browserPaperDetails,
    saveNodeNote: async (input) => ({
      nodeId: input.nodeId,
      note: input.note,
      updatedAt: new Date().toISOString()
    }),
    updatePaperStatus: async (input) => ({
      ...browserPaper,
      nodeId: input.nodeId,
      status: input.status,
      updatedAt: new Date().toISOString()
    })
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
    }),
    groupNodes: async () => ({
      completed: true,
      writtenFileCount: 0,
      graphPath: "/browser-preview/graph.json",
      reportPath: "/browser-preview/GRAPH_REPORT.md",
      stdout: "Browser preview group relationship is a no-op.",
      updatedAt: new Date().toISOString()
    }),
    renameSource: async () => ({
      completed: true,
      writtenFileCount: 0,
      graphPath: "/browser-preview/graph.json",
      reportPath: "/browser-preview/GRAPH_REPORT.md",
      stdout: "Browser preview source rename is a no-op.",
      updatedAt: new Date().toISOString()
    }),
    commentSource: async () => ({
      completed: true,
      writtenFileCount: 0,
      graphPath: "/browser-preview/graph.json",
      reportPath: "/browser-preview/GRAPH_REPORT.md",
      stdout: "Browser preview source comment is a no-op.",
      updatedAt: new Date().toISOString()
    }),
    search: async () => []
  },
  explorer: {
    getRoot: async () => browserExplorerTree,
    getChildren: async (nodeId: string) =>
      nodeId === "source:browser-preview.txt"
        ? [
            {
              id: "graph:browser-preview-fragment",
              title: "Browser Preview Fragment",
              kind: "entity",
              sourceFile: "browser-preview.txt",
              graphNodeId: "browser-preview-fragment",
              type: "fragment",
              summary: "Preview-only graph node.",
              childrenCount: 0,
              isExpandable: false
            }
          ]
        : [],
    getDetails: async (nodeId: string) => ({
      node:
        browserExplorerTree.find((node) => node.id === nodeId) ?? {
          id: nodeId,
          title: "Browser Preview Fragment",
          kind: "entity",
          sourceFile: "browser-preview.txt",
          graphNodeId: nodeId,
          type: "fragment",
          summary: "Preview-only graph node.",
          childrenCount: 0,
          isExpandable: false
        },
      relationGroups: []
    }),
    search: async (input: ExplorerSearchInput) =>
      browserExplorerTree
        .filter((node) => node.title.toLowerCase().includes(input.query.trim().toLowerCase()))
        .map((node) => ({ ...node, score: 1 })),
    getSourceOptions: async () => [
      {
        sourceFile: "browser-preview.txt",
        title: "browser-preview.txt"
      }
    ],
    getArtifactContent: async (artifactId: string) => ({
      artifactId,
      title: "Browser Preview Artifact",
      artifactKind: "section",
      sourceFile: "browser-preview-paper.pdf",
      artifactPath: "paper-components/browser-preview/sections/section-1.md",
      preview: "Artifact previews are available in Electron.",
      llmFormat: "markdown",
      content: "# Browser Preview Artifact\n\nPaper artifact content is available in Electron.",
      updatedAt: new Date().toISOString()
    }),
    openNode: async () => undefined
  },
  clipboard: {
    readText: async () => navigator.clipboard?.readText?.() ?? "",
    readIngestibleItems: async () => {
      const text = (await navigator.clipboard?.readText?.()) ?? "";
      return {
        items: text.trim()
          ? [
              {
                name: "clipboard.txt",
                type: "text/plain",
                text
              }
            ]
          : [],
        message: text.trim() ? "Clipboard contains text." : "Clipboard does not contain ingestible content."
      };
    },
    writeText: async (text: string) => {
      await navigator.clipboard?.writeText?.(text);
    }
  },
  settings: {
    getAi: async () => browserEffectiveAiSettings(),
    updateAi: async (input: UpdateAiSettingsInput) => {
      browserAiSettings = {
        mode: "local",
        endpoint: input.endpoint ?? browserAiSettings.endpoint,
        apiKey: input.apiKey ?? browserAiSettings.apiKey,
        model: input.model ?? browserAiSettings.model,
        updatedAt: new Date().toISOString()
      };
      browserAppSettings = {
        ...browserAppSettings,
        ai: browserAiSettings,
        updatedAt: new Date().toISOString()
      };
      return browserAiSettings;
    },
    getApp: async () => browserAppSettings,
    updateApp: async (input: UpdateAppSettingsInput) => {
      browserAiSettings = {
        mode: "local",
        endpoint: input.ai?.endpoint ?? browserAiSettings.endpoint,
        apiKey: input.ai?.apiKey ?? browserAiSettings.apiKey,
        model: input.ai?.model ?? browserAiSettings.model,
        updatedAt: new Date().toISOString()
      };
      browserAppSettings = {
        aiMode: input.aiMode ?? browserAppSettings.aiMode,
        ai: browserAiSettings,
        graphify: {
          ...browserAppSettings.graphify,
          ...input.graphify
        },
        managedProxy: {
          ...browserAppSettings.managedProxy,
          ...input.managedProxy,
          endpoint: browserAppSettings.managedProxy.endpoint,
          updatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      return browserAppSettings;
    },
    updateManagedProxy: async (input: UpdateManagedProxySettingsInput) => {
      browserAppSettings = {
        ...browserAppSettings,
        managedProxy: {
          ...browserAppSettings.managedProxy,
          ...input,
          endpoint: browserAppSettings.managedProxy.endpoint,
          updatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      return browserAppSettings.managedProxy;
    }
  },
  chat: {
    listThreads: async () => browserThreads,
    createThread: async (input) => {
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id: crypto.randomUUID(),
        title: input?.title?.trim() || "Browser Preview Chat",
        messages: [],
        createdAt: now,
        updatedAt: now
      };
      browserThreads.unshift(thread);
      return thread;
    },
    sendMessage: async (input) => {
      const now = new Date().toISOString();
      let thread = input.threadId ? browserThreads.find((candidate) => candidate.id === input.threadId) : undefined;
      if (!thread) {
        thread = {
          id: crypto.randomUUID(),
          title: input.message.slice(0, 80) || "Browser Preview Chat",
          messages: [],
          createdAt: now,
          updatedAt: now
        };
        browserThreads.unshift(thread);
      }

      thread.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: input.message,
        createdAt: now
      });
      const message = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: "Browser preview chat is available in Electron. Local Graphify MCP retrieval runs in the Main process.",
        createdAt: new Date().toISOString(),
        grounding: {
          graphify: {
            query: input.message,
            stdout: "Browser preview Graphify context.",
            budget: input.budget ?? 1800,
            command: "graphify query",
            graphPath: "/browser-preview/graph.json",
            citations: []
          }
        }
      };
      thread.messages.push(message);
      thread.updatedAt = new Date().toISOString();
      return { thread, message };
    },
    sendMessageStream: async (input) => {
      const response = await browserApiFallback.chat.sendMessage(input);
      const userMessage = response.thread.messages[response.thread.messages.length - 2];
      if (userMessage) {
        emitChatStreamEvent({
          type: "started",
          generationId: response.message.id,
          thread: response.thread,
          userMessage,
          assistantMessage: response.message
        });
      }
      emitChatStreamEvent({
        type: "grounding",
        generationId: response.message.id,
        messageId: response.message.id,
        grounding: response.message.grounding?.graphify ?? {
          query: input.message,
          stdout: "Browser preview Graphify context.",
          budget: input.budget ?? 1800,
          command: "graphify query",
          graphPath: "/browser-preview/graph.json",
          citations: []
        }
      });
      emitChatStreamEvent({
        type: "delta",
        generationId: response.message.id,
        messageId: response.message.id,
        delta: response.message.content,
        content: response.message.content
      });
      emitChatStreamEvent({
        type: "done",
        generationId: response.message.id,
        thread: response.thread,
        message: response.message
      });
      return response;
    },
    onStreamEvent: (handler) => {
      chatStreamHandlers.add(handler);
      return () => {
        chatStreamHandlers.delete(handler);
      };
    },
    abortGeneration: async (generationId) => {
      emitChatStreamEvent({ type: "aborted", generationId });
    },
    deleteThread: async (threadId) => {
      const index = browserThreads.findIndex((thread) => thread.id === threadId);
      if (index >= 0) {
        browserThreads.splice(index, 1);
      }
    },
    getGrounding: async (messageId) => {
      for (const thread of browserThreads) {
        const message = thread.messages.find((candidate) => candidate.id === messageId);
        if (message?.grounding?.graphify) {
          return message.grounding.graphify;
        }
      }

      return null;
    },
    saveMessageArtifact: async (input) => {
      const messageId = input.messageId;
      for (const thread of browserThreads) {
        const message = thread.messages.find((candidate) => candidate.id === messageId);
        if (message) {
          const content = input.content ?? message.content;
          const title = input.title?.trim() || "browser-preview-response";
          const artifact = {
            id: crypto.randomUUID(),
            messageId,
            filename: `${title}.md`,
            mimeType: "text/markdown",
            sizeBytes: content.length,
            kind: "text" as const,
            storagePath: `/browser-preview/chat/artifacts/${title}.md`,
            createdAt: new Date().toISOString(),
            source: "assistant-text" as const
          };
          message.artifacts = [...(message.artifacts ?? []), artifact];
          return { thread, message, artifact };
        }
      }
      throw new Error(`Browser preview cannot find message "${messageId}".`);
    },
    ingestArtifact: async (messageId, artifactId) => {
      const saved = await browserApiFallback.chat.saveMessageArtifact({ messageId });
      return {
        ...saved,
        artifact: saved.message.artifacts?.find((artifact) => artifact.id === artifactId) ?? saved.artifact,
        ingestion: {
          completed: true,
          writtenFileCount: 1,
          graphPath: "/browser-preview/graph.json",
          reportPath: "/browser-preview/GRAPH_REPORT.md",
          stdout: "Browser preview artifact ingestion is a no-op.",
          updatedAt: new Date().toISOString()
        }
      };
    },
    downloadArtifact: async (messageId, artifactId) => {
      const saved = await browserApiFallback.chat.saveMessageArtifact({ messageId });
      return {
        ...saved,
        artifact: saved.message.artifacts?.find((artifact) => artifact.id === artifactId) ?? saved.artifact,
        downloadedPath: "/browser-preview/downloads/browser-preview-response.md"
      };
    }
  },
  runtime: {
    getDependencyStatus: async () => browserRuntimeStatus,
    installOrRepairDependencies: async () => browserRuntimeStatus
  }
};

export function installBrowserApiFallback(): void {
  if (window.api || !import.meta.env.DEV) {
    return;
  }

  window.api = browserApiFallback;
}

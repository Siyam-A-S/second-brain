import type {
  BoardRule,
  AppSettings,
  AppBuildInfo,
  AccountAuthState,
  AccountSignInInput,
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
  ProjectStorageUsage,
  ResearchDependencyReport,
  ResearchPaperDetails,
  ResearchPaperSummary,
  SecondBrainApi,
  ExplorerSearchInput,
  ExplorerNode,
  TrackerIngestionStatus,
  TrackerListInput,
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
const browserEnv = import.meta.env as ImportMetaEnv & Record<string, string | undefined>;
const browserBuildInfo: AppBuildInfo = {
  channel: browserEnv.VITE_SECOND_BRAIN_BUILD_CHANNEL === "production" ? "production" : "development",
  version: "browser-preview",
  buildId: "browser-preview",
  gitCommit: "browser-preview",
  target: "browser",
  websiteUrl: "https://www.downloadsecondbrain.com",
  proxyUrl: "https://graphify-proxy-724616525781.us-central1.run.app",
  supabaseUrl: browserEnv.VITE_SECOND_BRAIN_SUPABASE_URL ?? "",
  supabaseAnonKey: browserEnv.VITE_SECOND_BRAIN_SUPABASE_ANON_KEY ?? ""
};
const browserProxyOrigin = "https://graphify-proxy-724616525781.us-central1.run.app";
const browserProxyChatEndpoint = `${browserProxyOrigin}/chat`;
const browserAccountUrl = "https://www.downloadsecondbrain.com/login";
const browserCheckoutUrl = "https://www.downloadsecondbrain.com/checkout";
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
  },
  {
    id: "source:architecture-brief.pdf",
    title: "architecture-brief.pdf",
    kind: "source",
    sourceFile: "research/architecture-brief.pdf",
    type: "PDF",
    summary: "Preview PDF source.",
    childrenCount: 1,
    isExpandable: true
  },
  {
    id: "source:interface-snapshot.png",
    title: "interface-snapshot.png",
    kind: "source",
    sourceFile: "images/interface-snapshot.png",
    type: "PNG",
    summary: "Preview image source.",
    childrenCount: 1,
    isExpandable: true
  },
  {
    id: "source:survey-results.xlsx",
    title: "survey-results.xlsx",
    kind: "source",
    sourceFile: "data/survey-results.xlsx",
    type: "XLSX",
    summary: "Preview spreadsheet source.",
    childrenCount: 1,
    isExpandable: true
  },
  {
    id: "source:demo-walkthrough.mov",
    title: "demo-walkthrough.mov",
    kind: "source",
    sourceFile: "clips/demo-walkthrough.mov",
    type: "MOV",
    summary: "Preview video source.",
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
  account: {
    email: "",
    secretKey: "",
    status: "unknown",
    planName: "Second Brain",
    trialEndsAt: "",
    subscriptionRenewsAt: "",
    usage: null,
    websiteUrl: "https://www.downloadsecondbrain.com",
    accountUrl: browserAccountUrl,
    checkoutUrl: browserCheckoutUrl,
    lastVerifiedAt: "",
    updatedAt: new Date().toISOString()
  },
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
    maxTokens: 32768,
    retryMaxTokens: 16384,
    timeoutMs: 600_000,
    cardDefinitions: true,
    cardDefinitionMaxPerPass: 24,
    paperComponents: true
  },
  appearance: {
    topBarMirrored: false
  },
  updatedAt: new Date().toISOString()
};
function createBrowserPreviewThread(title = "New Chat"): ChatThread {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function unusedFreshThread(): ChatThread | undefined {
  return browserThreads.find((thread) => thread.messages.length === 0);
}

const browserThreads: ChatThread[] = [createBrowserPreviewThread()];

function browserAccountState(): AccountAuthState {
  const signedIn = Boolean(browserAppSettings.account.email);
  return {
    signedIn,
    email: browserAppSettings.account.email,
    userId: signedIn ? "browser-preview-user" : "",
    status: signedIn ? "active" : "unknown",
    planName: signedIn ? "Preview Pro" : "Second Brain",
    trialEndsAt: browserAppSettings.account.trialEndsAt,
    subscriptionRenewsAt: browserAppSettings.account.subscriptionRenewsAt,
    usage: signedIn
      ? {
          label: "AI usage",
          used: 128,
          limit: 1000,
          updatedAt: new Date().toISOString()
        }
      : null,
    websiteUrl: "https://www.downloadsecondbrain.com",
    accountUrl: browserAccountUrl,
    checkoutUrl: browserCheckoutUrl,
    lastVerifiedAt: browserAppSettings.account.lastVerifiedAt,
    updatedAt: new Date().toISOString()
  };
}

function browserExplorerNode(nodeId: string): ExplorerNode | undefined {
  return browserExplorerTree.find((node) => node.id === nodeId);
}

function browserExplorerChild(node: ExplorerNode): ExplorerNode {
  const base = node.sourceFile ?? node.title;
  const title = base.split(/[\\/]/).filter(Boolean).at(-1) ?? node.title;
  return {
    id: `graph:${encodeURIComponent(base)}`,
    title: `${title.replace(/\.[^.]+$/, "")} context`,
    kind: "entity",
    sourceFile: base,
    graphNodeId: `browser-preview:${base}`,
    type: node.type ?? "source",
    summary: "Preview-only graph node.",
    childrenCount: 0,
    isExpandable: false
  };
}

function browserExplorerChildren(nodeId: string): ExplorerNode[] {
  const node = browserExplorerNode(nodeId);
  return node?.isExpandable ? [browserExplorerChild(node)] : [];
}

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
  app: {
    getBuildInfo: async () => browserBuildInfo,
    reportRendererError: async (input) => {
      console.error("Browser preview renderer error", input);
    }
  },
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
    }),
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    }
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
    list: async (input?: TrackerListInput) =>
      input?.scope === "all" ? browserTrackers : browserTrackers.filter((tracker) => tracker.projectId === activeProjectId),
    create: async (input: CreateTrackerInput) => {
      const now = new Date().toISOString();
      const tracker: TrackerRecord = {
        uuid: `browser-ticket-${crypto.randomUUID()}`,
        projectId: activeProjectId,
        projectName: browserProjects.find((project) => project.id === activeProjectId)?.name ?? "Browser Preview",
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
    },
    getStorageUsage: async (): Promise<ProjectStorageUsage> => {
      const sourceCount = browserExplorerTree.length;
      const bytes = 42_000_000 + sourceCount * 1_250_000;
      return {
        bytes,
        label: "46.1 MB",
        projectsPath: "/browser-preview/projects",
        checkedAt: new Date().toISOString()
      };
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
    getChildren: async (nodeId: string) => browserExplorerChildren(nodeId),
    getDetails: async (nodeId: string) => ({
      node:
        browserExplorerNode(nodeId) ??
        browserExplorerTree.map(browserExplorerChild).find((node) => node.id === nodeId) ?? {
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
      [...browserExplorerTree, ...browserExplorerTree.map(browserExplorerChild)]
        .filter((node) => node.title.toLowerCase().includes(input.query.trim().toLowerCase()))
        .map((node) => ({ ...node, score: 1 })),
    getSourceOptions: async () => browserExplorerTree.map((node) => ({
      sourceFile: node.sourceFile ?? node.title,
      title: node.title
    })),
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
        account: {
          ...browserAppSettings.account,
          ...input.account,
          secretKey: input.account?.secretKey ?? input.managedProxy?.secretKey ?? browserAppSettings.account.secretKey,
          websiteUrl: "https://www.downloadsecondbrain.com",
          accountUrl: browserAccountUrl,
          checkoutUrl: browserCheckoutUrl,
          updatedAt: new Date().toISOString()
        },
        graphify: {
          ...browserAppSettings.graphify,
          ...input.graphify
        },
        appearance: {
          ...browserAppSettings.appearance,
          ...input.appearance
        },
        managedProxy: {
          ...browserAppSettings.managedProxy,
          ...input.managedProxy,
          secretKey: input.account?.secretKey ?? input.managedProxy?.secretKey ?? browserAppSettings.managedProxy.secretKey,
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
        account: {
          ...browserAppSettings.account,
          secretKey: input.secretKey ?? browserAppSettings.account.secretKey,
          updatedAt: new Date().toISOString()
        },
        managedProxy: {
          ...browserAppSettings.managedProxy,
          ...input,
          endpoint: browserAppSettings.managedProxy.endpoint,
          updatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      return browserAppSettings.managedProxy;
    },
    refreshAccount: async () => {
      browserAppSettings = {
        ...browserAppSettings,
        account: {
          ...browserAppSettings.account,
          status: browserAppSettings.account.secretKey ? "active" : "unknown",
          planName: browserAppSettings.account.secretKey ? "Preview Pro" : "Second Brain",
          usage: browserAppSettings.account.secretKey
            ? {
                label: "AI usage",
                used: 128,
                limit: 1000,
                updatedAt: new Date().toISOString()
              }
            : null,
          lastVerifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      return browserAppSettings;
    }
  },
  account: {
    getState: async () => browserAccountState(),
    signIn: async (input: AccountSignInInput) => {
      browserAppSettings = {
        ...browserAppSettings,
        account: {
          ...browserAppSettings.account,
          email: input.email,
          status: "active",
          planName: "Preview Pro",
          lastVerifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
      return browserAccountState();
    },
    signOut: async () => {
      browserAppSettings = {
        ...browserAppSettings,
        account: {
          ...browserAppSettings.account,
          email: "",
          secretKey: "",
          status: "unknown",
          planName: "Second Brain",
          usage: null,
          lastVerifiedAt: "",
          updatedAt: new Date().toISOString()
        }
      };
      return browserAccountState();
    },
    refresh: async () => browserAccountState()
  },
  chat: {
    listThreads: async () => {
      if (browserThreads.length === 0) {
        browserThreads.unshift(createBrowserPreviewThread());
      }
      return browserThreads;
    },
    createThread: async (input) => {
      const existingFreshThread = unusedFreshThread();
      if (existingFreshThread) {
        return existingFreshThread;
      }

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

      if (thread.messages.length === 0 && (thread.title === "New Chat" || thread.title === "Browser Preview Chat")) {
        thread.title = input.message.slice(0, 80) || "Browser Preview Chat";
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
          const isWholeMessage = !input.content || input.content.trim() === message.content.trim();
          const generatedArtifact = message.artifacts?.find(
            (artifact) => artifact.source === "local-tool" || artifact.source === "proxy-attachment"
          );
          if (isWholeMessage && generatedArtifact) {
            throw new Error("This response already has a generated file. Add, open, or download the file card instead.");
          }
          const existing = isWholeMessage
            ? message.artifacts?.find((artifact) => artifact.source === "assistant-text")
            : undefined;
          if (existing) {
            return { thread, message, artifact: existing };
          }
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
      const thread = browserThreads.find((candidate) => candidate.messages.some((message) => message.id === messageId));
      const message = thread?.messages.find((candidate) => candidate.id === messageId);
      const existingArtifact = message?.artifacts?.find((artifact) => artifact.id === artifactId);
      const saved = existingArtifact && thread && message
        ? { thread, message, artifact: existingArtifact }
        : await browserApiFallback.chat.saveMessageArtifact({ messageId });
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
      const thread = browserThreads.find((candidate) => candidate.messages.some((message) => message.id === messageId));
      const message = thread?.messages.find((candidate) => candidate.id === messageId);
      const existingArtifact = message?.artifacts?.find((artifact) => artifact.id === artifactId);
      const saved = existingArtifact && thread && message
        ? { thread, message, artifact: existingArtifact }
        : await browserApiFallback.chat.saveMessageArtifact({ messageId });
      return {
        ...saved,
        artifact: saved.message.artifacts?.find((artifact) => artifact.id === artifactId) ?? saved.artifact,
        downloadedPath: "/browser-preview/downloads/browser-preview-response.md"
      };
    },
    openArtifact: async () => undefined
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

  document.documentElement.dataset.theme = "keypiphy";
  window.api = browserApiFallback;
}

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell } from "electron";
import path from "node:path";
import {
  appChannels,
  accountChannels,
  boardChannels,
  brainChannels,
  chatChannels,
  clipboardChannels,
  fileChannels,
  explorerChannels,
  graphBoardChannels,
  FilesDroppedPayload,
  projectChannels,
  researchChannels,
  runtimeChannels,
  settingsChannels,
  trackerChannels,
  WidgetMovePayload,
  windowChannels
} from "../shared/ipc";
import type {
  AppBuildInfo,
  AccountSignInInput,
  ChatStreamEvent,
  ClipboardIngestibleItemsResult,
  CreateProjectInput,
  CreateTrackerInput,
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  ProjectSelectionInput,
  RenameProjectInput,
  SaveChatArtifactInput,
  SearchBrainNodesInput,
  GroupGraphNodesInput,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput,
  UpdateNodeSignalsInput,
  SaveResearchNodeNoteInput,
  UpdateResearchPaperStatusInput,
  TrackerListInput,
  UpdateTrackerInput,
  WriteBrainNodeInput
} from "../shared/brain";
import type { BoardRule, BoardSearchInput } from "../shared/types/board";
import type { ExplorerSearchInput } from "../shared/types/explorer";
import { AgentController } from "./services/AgentController";
import { AccountAuthService } from "./services/AccountAuthService";
import { AiSettingsService } from "./services/AiSettingsService";
import { ArtifactToolService } from "./services/ArtifactToolService";
import { loadBuildInfo } from "./services/BuildInfoService";
import { ChatService } from "./services/ChatService";
import { DependencyRuntimeService } from "./services/DependencyRuntimeService";
import { EmbeddingService } from "./services/EmbeddingService";
import { GraphBoardService } from "./services/GraphBoardService";
import { GraphifyBoardService } from "./services/GraphifyBoardService";
import { GraphifyContextService } from "./services/GraphifyContextService";
import { GraphifyController } from "./services/GraphifyController";
import { ExplorerService } from "./services/ExplorerService";
import { GraphRagService } from "./services/GraphRagService";
import { LocalMcpServer } from "./services/LocalMcpServer";
import { LogService } from "./services/LogService";
import { LlmService } from "./services/LlmService";
import { NotificationService } from "./services/NotificationService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { StorageService } from "./services/StorageService";
import { TrackerService } from "./services/TrackerService";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let mcpServer: LocalMcpServer | null = null;
let graphifyController: GraphifyController | null = null;
let notificationService: NotificationService | null = null;
let buildInfo: AppBuildInfo | null = null;
let logService: LogService | null = null;
let accountAuth: AccountAuthService | null = null;

type ProjectRuntime = {
  storage: StorageService;
  graphify: GraphifyController;
  graphifyBoard: GraphifyBoardService;
  graphBoard: GraphBoardService;
  graphExplorer: ExplorerService;
  graphRag: GraphRagService;
  graphifyContext: GraphifyContextService;
  research: ResearchService;
  tracker: TrackerService;
  chat: ChatService;
  mcpServer: LocalMcpServer;
};

let projectRuntime: ProjectRuntime | null = null;

const widgetWindowSize = 96;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const productionErrorMessage = "Something went wrong. Try again.";
const minZoomFactor = 0.75;
const maxZoomFactor = 1.6;
const zoomStep = 0.1;

const rendererEntry = path.join(__dirname, "../renderer/index.html");
const preloadEntry = path.join(__dirname, "../preload/preload.js");

function loadRenderer(window: BrowserWindow, windowName: "main" | "widget"): void {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/?window=${windowName}`);
    return;
  }

  void window.loadFile(rendererEntry, {
    query: {
      window: windowName
    }
  });
}

function clampZoomFactor(value: number): number {
  return Math.min(maxZoomFactor, Math.max(minZoomFactor, Number(value.toFixed(2))));
}

function installZoomShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    const commandModifier = process.platform === "darwin" ? input.meta : input.control;
    if (!commandModifier || input.alt || input.shift || input.type !== "keyDown") {
      return;
    }

    const key = input.key.toLowerCase();
    const code = input.code;
    const current = window.webContents.getZoomFactor();

    if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
      event.preventDefault();
      window.webContents.setZoomFactor(clampZoomFactor(current + zoomStep));
      return;
    }

    if (key === "-" || code === "Minus" || code === "NumpadSubtract") {
      event.preventDefault();
      window.webContents.setZoomFactor(clampZoomFactor(current - zoomStep));
      return;
    }

    if (key === "0" || code === "Digit0" || code === "Numpad0") {
      event.preventDefault();
      window.webContents.setZoomFactor(1);
    }
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 420,
    minHeight: 360,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#FFFAF0",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  installZoomShortcuts(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  loadRenderer(window, "main");
  return window;
}

function createWidgetWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const width = widgetWindowSize;
  const height = widgetWindowSize;

  const window = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + Math.round((workArea.height - height) / 2),
    resizable: false,
    movable: true,
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });

  window.on("closed", () => {
    widgetWindow = null;
  });

  loadRenderer(window, "widget");
  return window;
}

function clampWidgetBounds(input: WidgetMovePayload): Electron.Rectangle | null {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    return null;
  }

  const currentBounds = widgetWindow.getBounds();
  const targetCenter = {
    x: input.x + Math.round(currentBounds.width / 2),
    y: input.y + Math.round(currentBounds.height / 2)
  };
  const { workArea } = screen.getDisplayNearestPoint(targetCenter);
  const maxX = workArea.x + workArea.width - currentBounds.width;
  const maxY = workArea.y + workArea.height - currentBounds.height;

  return {
    x: Math.min(Math.max(Math.round(input.x), workArea.x), maxX),
    y: Math.min(Math.max(Math.round(input.y), workArea.y), maxY),
    width: currentBounds.width,
    height: currentBounds.height
  };
}

function showWidget(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = createWidgetWindow();
  }

  mainWindow?.hide();
  widgetWindow.show();
  widgetWindow.focus();
}

function restoreMainWindow(): void {
  widgetWindow?.hide();

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function clipboardFilePathsFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("file://")) {
        try {
          return decodeURIComponent(new URL(line).pathname);
        } catch {
          return "";
        }
      }

      return path.isAbsolute(line) ? line : "";
    })
    .filter(Boolean);
}

function readClipboardIngestibleItems(): ClipboardIngestibleItemsResult {
  const items: ClipboardIngestibleItemsResult["items"] = [];
  const fileText = clipboard.read("FileNameW") || clipboard.read("FileName") || "";
  const fileCandidates = clipboardFilePathsFromText(fileText || clipboard.readText("clipboard"));

  for (const filePath of fileCandidates) {
    items.push({
      name: path.basename(filePath),
      path: filePath
    });
  }

  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    items.push({
      name: `clipboard-image-${Date.now()}.png`,
      type: "image/png",
      buffer: Array.from(image.toPNG())
    });
  }

  const html = clipboard.readHTML();
  if (html.trim()) {
    items.push({
      name: `clipboard-html-${Date.now()}.html`,
      type: "text/html",
      text: html
    });
  }

  const text = clipboard.readText();
  if (text.trim() && fileCandidates.length === 0) {
    items.push({
      name: `clipboard-text-${Date.now()}.txt`,
      type: "text/plain",
      text
    });
  }

  const unique = new Map<string, ClipboardIngestibleItemsResult["items"][number]>();
  for (const item of items) {
    const key = item.path ? `path:${item.path}` : `${item.name}:${item.type}:${item.text?.slice(0, 80) ?? ""}`;
    unique.set(key, item);
  }

  const normalized = Array.from(unique.values());
  return {
    items: normalized,
    message: normalized.length
      ? `Clipboard contains ${normalized.length} ingestible item${normalized.length === 1 ? "" : "s"}.`
      : "Clipboard does not contain ingestible content."
  };
}

function requireRuntime(): ProjectRuntime {
  if (!projectRuntime) {
    throw new Error("Project runtime has not initialized.");
  }

  return projectRuntime;
}

async function createProjectRuntime(
  project: Awaited<ReturnType<ProjectService["getActiveProject"]>>,
  aiSettings: AiSettingsService,
  embeddings: EmbeddingService,
  accessTokenProvider: () => Promise<string | null>
): Promise<ProjectRuntime> {
  const storage = new StorageService(project.vaultPath);
  const graphify = new GraphifyController(project.rawVaultPath, () => aiSettings.getEffectiveSettings(), accessTokenProvider);
  const research = new ResearchService(project.rootPath, graphify.getGraphPath());
  const graphifyBoard = new GraphifyBoardService(graphify.getGraphPath(), graphify.getRawVaultPath());
  const graphBoard = new GraphBoardService(graphify.getGraphPath(), research);
  const graphExplorer = new ExplorerService(graphify.getRawVaultPath(), graphify.getGraphPath());
  const graphRag = new GraphRagService(storage, embeddings);
  const graphifyContext = new GraphifyContextService(graphify.getRawVaultPath());
  const artifactTools = new ArtifactToolService(project.rootPath);
  const tracker = new TrackerService(path.join(app.getPath("userData"), "tracker.sqlite"), {
    id: project.id,
    name: project.name
  });
  const nextMcpServer = new LocalMcpServer({
    graphRag,
    graphifyContext,
    artifactTools,
    port: Number(process.env.SECOND_BRAIN_MCP_PORT ?? 4127)
  });
  const chat = new ChatService(
    project.rootPath,
    nextMcpServer,
    () => aiSettings.getAppSettings(),
    (items) => graphify.ingestDroppedItems(items),
    accessTokenProvider
  );

  await aiSettings.initialize();
  await storage.initialize();
  await graphify.initialize();
  await research.initialize();
  await tracker.initialize(storage);
  await chat.initialize();
  notificationService?.stop();
  notificationService = new NotificationService(tracker);
  notificationService.start();

  try {
    await nextMcpServer.start();
  } catch (error) {
    console.error("Failed to start local MCP server", error);
  }

  return {
    storage,
    graphify,
    graphifyBoard,
    graphBoard,
    graphExplorer,
    graphRag,
    graphifyContext,
    research,
    tracker,
    chat,
    mcpServer: nextMcpServer
  };
}

async function switchProjectRuntime(
  project: Awaited<ReturnType<ProjectService["getActiveProject"]>>,
  aiSettings: AiSettingsService,
  embeddings: EmbeddingService,
  accessTokenProvider: () => Promise<string | null>
): Promise<ProjectRuntime> {
  const previous = projectRuntime;
  if (previous) {
    notificationService?.stop();
    notificationService = null;
    await previous.graphify.stopMcp();
    await previous.mcpServer.stop();
  }

  projectRuntime = await createProjectRuntime(project, aiSettings, embeddings, accessTokenProvider);
  graphifyController = projectRuntime.graphify;
  mcpServer = projectRuntime.mcpServer;
  return projectRuntime;
}

function registerIpc(
  projects: ProjectService,
  embeddings: EmbeddingService,
  aiSettings: AiSettingsService,
  runtimeDependencies: DependencyRuntimeService,
  currentBuildInfo: AppBuildInfo,
  logs: LogService,
  accounts: AccountAuthService,
  accessTokenProvider: () => Promise<string | null>
): void {
  const handle = (
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await listener(event, ...args);
      } catch (error) {
        void logs.error(`ipc:${channel}`, error, { args }).catch(() => undefined);
        if (currentBuildInfo.channel === "production") {
          throw new Error(productionErrorMessage);
        }
        throw error;
      }
    });
  };

  handle(appChannels.getBuildInfo, () => currentBuildInfo);
  handle(appChannels.reportRendererError, (_event, input) =>
    logs.error("renderer", input && typeof input === "object" && "error" in input ? input.error : "Renderer error", input)
  );

  handle(windowChannels.minimize, () => {
    showWidget();
  });

  handle(windowChannels.maximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  handle(windowChannels.close, () => {
    app.quit();
  });

  handle(windowChannels.restore, () => {
    restoreMainWindow();
  });

  handle(windowChannels.openExternal, async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.downloadsecondbrain.com") {
      throw new Error("External link is not allowed.");
    }

    await shell.openExternal(parsed.toString());
  });

  handle(windowChannels.getWidgetBounds, () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      return null;
    }

    return widgetWindow.getBounds();
  });

  handle(windowChannels.moveWidget, (_event, payload: WidgetMovePayload) => {
    const nextBounds = clampWidgetBounds(payload);
    if (!nextBounds || !widgetWindow || widgetWindow.isDestroyed()) {
      return null;
    }

    widgetWindow.setBounds(nextBounds, false);
    return nextBounds;
  });

  handle(fileChannels.dropped, async (_event, payload: FilesDroppedPayload) => {
    const result = await requireRuntime().graphify.ingestFilesDrop(payload);
    console.info("Files dropped and ingested by Graphify", {
      writtenFileCount: result.writtenFileCount,
      graphNodeCount: result.graphNodeCount,
      graphPath: result.graphPath
    });
    restoreMainWindow();
    return result;
  });

  handle(brainChannels.writeNode, (_event, input: WriteBrainNodeInput) => requireRuntime().storage.writeNode(input));
  handle(brainChannels.readNode, (_event, uuid: string) => requireRuntime().storage.readNode(uuid));
  handle(brainChannels.listNodes, (_event, input?: ListBrainNodesInput) => requireRuntime().storage.listNodes(input));
  handle(brainChannels.searchNodes, async (_event, input: SearchBrainNodesInput) => {
    const nodes = await requireRuntime().storage.listNodes();
    return embeddings.search(input, nodes);
  });
  handle(brainChannels.mcpStatus, () => requireRuntime().mcpServer.getStatus());
  handle(brainChannels.organizedBoard, () => requireRuntime().graphRag.getOrganizedBoard());
  handle(brainChannels.exportBoardPlaintext, (_event, input?: ExportBoardPlaintextInput) =>
    requireRuntime().graphRag.exportBoardPlaintext(input)
  );
  handle(brainChannels.updateNodeSignals, (_event, input: UpdateNodeSignalsInput) =>
    requireRuntime().storage.updateNodeSignals(input)
  );
  handle(trackerChannels.list, (_event, input?: TrackerListInput) => requireRuntime().tracker.listTrackers(input));
  handle(trackerChannels.create, (_event, input: CreateTrackerInput) => requireRuntime().tracker.createTracker(input));
  handle(trackerChannels.update, (_event, input: UpdateTrackerInput) => requireRuntime().tracker.updateTracker(input));
  handle(trackerChannels.remove, (_event, uuid: string) => requireRuntime().tracker.removeTracker(uuid));
  handle(projectChannels.list, () => projects.listProjects());
  handle(projectChannels.getActive, () => projects.getActiveProject());
  handle(projectChannels.getStorageUsage, () => projects.getStorageUsage());
  handle(projectChannels.create, async (_event, input: CreateProjectInput) => {
    const project = await projects.createProject(input);
    await switchProjectRuntime(project, aiSettings, embeddings, accessTokenProvider);
    return projects.getActiveProject();
  });
  handle(projectChannels.select, async (_event, input: ProjectSelectionInput) => {
    const project = await projects.selectProject(input);
    await switchProjectRuntime(project, aiSettings, embeddings, accessTokenProvider);
    return projects.getActiveProject();
  });
  handle(projectChannels.rename, (_event, input: RenameProjectInput) => projects.renameProject(input));
  handle(projectChannels.archive, async (_event, input: ProjectSelectionInput) => {
    const archived = await projects.archiveProject(input);
    await switchProjectRuntime(await projects.getActiveProject(), aiSettings, embeddings, accessTokenProvider);
    return archived;
  });
  handle(graphBoardChannels.getState, () => requireRuntime().graphBoard.getState());
  handle(graphBoardChannels.getNodeDetails, (_event, nodeId: string) =>
    requireRuntime().graphBoard.getNodeDetails(nodeId)
  );
  handle(graphBoardChannels.generateCallflow, (_event, nodeId: string) =>
    requireRuntime().graphify.generateCallflowHtml(nodeId)
  );
  handle(graphBoardChannels.getDefinitionStatus, () => requireRuntime().graphify.getDefinitionStatus());
  handle(researchChannels.getDependencyStatus, () => requireRuntime().graphify.getResearchDependencyStatus());
  handle(researchChannels.listPapers, () => requireRuntime().research.listPapers());
  handle(researchChannels.getPaperDetails, (_event, nodeId: string) =>
    requireRuntime().research.getPaperDetails(nodeId)
  );
  handle(researchChannels.saveNodeNote, (_event, input: SaveResearchNodeNoteInput) =>
    requireRuntime().research.saveNodeNote(input)
  );
  handle(researchChannels.updatePaperStatus, (_event, input: UpdateResearchPaperStatusInput) =>
    requireRuntime().research.updatePaperStatus(input)
  );
  handle(boardChannels.getState, (_event, rule: BoardRule) => requireRuntime().graphifyBoard.buildBoardState(rule));
  handle(boardChannels.getGraphHtml, () => requireRuntime().graphify.readGraphHtml());
  handle(boardChannels.removeSource, (_event, sourceFile: string) => requireRuntime().graphify.removeSource(sourceFile));
  handle(boardChannels.collapseSource, (_event, sourceFile: string, targetSourceFile: string) =>
    requireRuntime().graphify.collapseSourceInto(sourceFile, targetSourceFile)
  );
  handle(boardChannels.groupNodes, (_event, input: GroupGraphNodesInput) =>
    requireRuntime().graphify.groupGraphNodes(input)
  );
  handle(boardChannels.renameSource, (_event, sourceFile: string, newName: string) =>
    requireRuntime().graphify.renameSource(sourceFile, newName)
  );
  handle(boardChannels.commentSource, (_event, sourceFile: string, comment: string) =>
    requireRuntime().graphify.commentSource(sourceFile, comment)
  );
  handle(boardChannels.search, (_event, input: BoardSearchInput) => requireRuntime().graphifyBoard.search(input));
  handle(explorerChannels.getRoot, () => requireRuntime().graphExplorer.getRoot());
  handle(explorerChannels.getChildren, (_event, nodeId: string) => requireRuntime().graphExplorer.getChildren(nodeId));
  handle(explorerChannels.getDetails, (_event, nodeId: string) => requireRuntime().graphExplorer.getDetails(nodeId));
  handle(explorerChannels.search, (_event, input: ExplorerSearchInput) =>
    requireRuntime().graphExplorer.search(input)
  );
  handle(explorerChannels.getSourceOptions, () => requireRuntime().graphExplorer.listSourceOptions());
  handle(explorerChannels.getArtifactContent, (_event, artifactId: string) =>
    requireRuntime().graphExplorer.getArtifactContent(artifactId)
  );
  handle(explorerChannels.openNode, async (_event, nodeId: string) => {
    const filePath = await requireRuntime().graphExplorer.getOpenPath(nodeId);
    const error = await shell.openPath(filePath);
    if (error) {
      throw new Error(error);
    }
  });
  handle(clipboardChannels.readText, () => clipboard.readText());
  handle(clipboardChannels.readIngestibleItems, () => readClipboardIngestibleItems());
  handle(clipboardChannels.writeText, (_event, text: string) => {
    clipboard.writeText(text);
  });
  handle(settingsChannels.getAi, () => aiSettings.getSettings());
  handle(settingsChannels.updateAi, (_event, input: UpdateAiSettingsInput) => aiSettings.updateSettings(input));
  handle(settingsChannels.getApp, () => aiSettings.getAppSettings());
  handle(settingsChannels.updateApp, (_event, input: UpdateAppSettingsInput) => aiSettings.updateAppSettings(input));
  handle(settingsChannels.updateManagedProxy, (_event, input: UpdateManagedProxySettingsInput) =>
    aiSettings.updateManagedProxy(input)
  );
  handle(settingsChannels.refreshAccount, () => aiSettings.refreshAccount());
  handle(accountChannels.getState, () => accounts.getState());
  handle(accountChannels.signIn, (_event, input: AccountSignInInput) => accounts.signIn(input));
  handle(accountChannels.signOut, () => accounts.signOut());
  handle(accountChannels.refresh, () => accounts.refresh());
  handle(chatChannels.listThreads, () => requireRuntime().chat.listThreads());
  handle(chatChannels.createThread, (_event, input?: { title?: string | undefined }) =>
    requireRuntime().chat.createThread(input)
  );
  handle(chatChannels.sendMessage, (_event, input) => requireRuntime().chat.sendMessage(input));
  handle(chatChannels.sendMessageStream, (event, input) =>
    requireRuntime().chat.sendMessageStream(input, (streamEvent: ChatStreamEvent) => {
      event.sender.send(chatChannels.streamEvent, streamEvent);
    })
  );
  handle(chatChannels.abortGeneration, (_event, generationId: string) =>
    requireRuntime().chat.abortGeneration(generationId)
  );
  handle(chatChannels.deleteThread, (_event, threadId: string) => requireRuntime().chat.deleteThread(threadId));
  handle(chatChannels.getGrounding, (_event, messageId: string) => requireRuntime().chat.getGrounding(messageId));
  handle(chatChannels.saveMessageArtifact, (_event, input: SaveChatArtifactInput) =>
    requireRuntime().chat.saveMessageArtifact(input)
  );
  handle(chatChannels.ingestArtifact, (_event, messageId: string, artifactId: string) =>
    requireRuntime().chat.ingestArtifact(messageId, artifactId)
  );
  handle(chatChannels.downloadArtifact, async (_event, messageId: string, artifactId: string) => {
    const saved = await requireRuntime().chat.saveMessageArtifact({ messageId });
    const artifact = saved.message.artifacts?.find((candidate) => candidate.id === artifactId) ?? saved.artifact;
    const options: Electron.SaveDialogOptions = {
      defaultPath: artifact.filename,
      properties: ["createDirectory"]
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return saved;
    }

    return requireRuntime().chat.downloadArtifact(messageId, artifact.id, result.filePath);
  });
  handle(chatChannels.openArtifact, async (_event, messageId: string, artifactId: string) => {
    const filePath = await requireRuntime().chat.getArtifactPath(messageId, artifactId);
    const error = await shell.openPath(filePath);
    if (error) {
      throw new Error(error);
    }
  });
  handle(runtimeChannels.getDependencyStatus, () => runtimeDependencies.getStatus());
  handle(runtimeChannels.installOrRepairDependencies, () => runtimeDependencies.installOrRepair());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const userDataPath = app.getPath("userData");
  buildInfo = await loadBuildInfo(app.getVersion());
  accountAuth = new AccountAuthService(userDataPath, buildInfo);
  const aiSettings = new AiSettingsService(userDataPath, buildInfo.channel);
  const accessTokenProvider = () => accountAuth?.getAccessToken() ?? Promise.resolve(null);
  logService = new LogService(userDataPath, buildInfo, () => aiSettings.getAppSettings(), accessTokenProvider);
  await logService.flushPending();
  process.on("uncaughtException", (error) => {
    void logService?.error("process:uncaughtException", error).catch(() => undefined);
  });
  process.on("unhandledRejection", (reason) => {
    void logService?.error("process:unhandledRejection", reason).catch(() => undefined);
  });
  const runtimeDependencies = new DependencyRuntimeService();
  const projects = new ProjectService(userDataPath);
  const embeddings = new EmbeddingService(path.join(userDataPath, "models"));

  await aiSettings.initialize();
  await projects.initialize();
  await switchProjectRuntime(await projects.getActiveProject(), aiSettings, embeddings, accessTokenProvider);

  registerIpc(projects, embeddings, aiSettings, runtimeDependencies, buildInfo, logService, accountAuth, accessTokenProvider);
  const agentController = new AgentController(() => requireRuntime().graphify);
  agentController.registerIpc();
  mainWindow = createMainWindow();
  widgetWindow = createWidgetWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      widgetWindow = createWidgetWindow();
    } else {
      restoreMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  notificationService?.stop();
  void mcpServer?.stop();
  void graphifyController?.stopMcp();
});

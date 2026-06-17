import { app, BrowserWindow, clipboard, ipcMain, screen } from "electron";
import path from "node:path";
import {
  boardChannels,
  brainChannels,
  clipboardChannels,
  fileChannels,
  filesystemChannels,
  graphBoardChannels,
  FilesDroppedPayload,
  projectChannels,
  settingsChannels,
  trackerChannels,
  WidgetMovePayload,
  windowChannels
} from "../shared/ipc";
import type {
  CreateProjectInput,
  CreateTrackerInput,
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  ProjectSelectionInput,
  RenameProjectInput,
  SearchBrainNodesInput,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateNodeSignalsInput,
  UpdateTrackerInput,
  WriteBrainNodeInput
} from "../shared/brain";
import type { BoardRule, BoardSearchInput } from "../shared/types/board";
import type { SourceTreeSearchInput } from "../shared/types/filesystem";
import { AgentController } from "./services/AgentController";
import { AiSettingsService } from "./services/AiSettingsService";
import { EmbeddingService } from "./services/EmbeddingService";
import { GraphBoardService } from "./services/GraphBoardService";
import { GraphifyBoardService } from "./services/GraphifyBoardService";
import { GraphifyController } from "./services/GraphifyController";
import { GraphFilesystemService } from "./services/GraphFilesystemService";
import { GraphRagService } from "./services/GraphRagService";
import { LocalMcpServer } from "./services/LocalMcpServer";
import { LlmService } from "./services/LlmService";
import { ProjectService } from "./services/ProjectService";
import { StorageService } from "./services/StorageService";
import { TrackerService } from "./services/TrackerService";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let mcpServer: LocalMcpServer | null = null;
let graphifyController: GraphifyController | null = null;

type ProjectRuntime = {
  storage: StorageService;
  graphify: GraphifyController;
  graphifyBoard: GraphifyBoardService;
  graphBoard: GraphBoardService;
  graphFilesystem: GraphFilesystemService;
  graphRag: GraphRagService;
  tracker: TrackerService;
  mcpServer: LocalMcpServer;
};

let projectRuntime: ProjectRuntime | null = null;

const widgetWindowSize = 96;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

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

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 420,
    minHeight: 360,
    frame: false,
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

function requireRuntime(): ProjectRuntime {
  if (!projectRuntime) {
    throw new Error("Project runtime has not initialized.");
  }

  return projectRuntime;
}

async function createProjectRuntime(
  project: Awaited<ReturnType<ProjectService["getActiveProject"]>>,
  aiSettings: AiSettingsService,
  embeddings: EmbeddingService
): Promise<ProjectRuntime> {
  const storage = new StorageService(project.vaultPath);
  const graphify = new GraphifyController(project.rawVaultPath, () => aiSettings.getSettings());
  const graphifyBoard = new GraphifyBoardService(graphify.getGraphPath(), graphify.getRawVaultPath());
  const graphBoard = new GraphBoardService(graphify.getGraphPath());
  const graphFilesystem = new GraphFilesystemService(graphify.getRawVaultPath(), graphify.getGraphPath());
  const graphRag = new GraphRagService(storage, embeddings);
  const tracker = new TrackerService(project.trackerPath);
  const nextMcpServer = new LocalMcpServer({
    graphRag,
    port: Number(process.env.SECOND_BRAIN_MCP_PORT ?? 4127)
  });

  await aiSettings.initialize();
  await storage.initialize();
  await graphify.initialize();
  await tracker.initialize(storage);

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
    graphFilesystem,
    graphRag,
    tracker,
    mcpServer: nextMcpServer
  };
}

async function switchProjectRuntime(
  project: Awaited<ReturnType<ProjectService["getActiveProject"]>>,
  aiSettings: AiSettingsService,
  embeddings: EmbeddingService
): Promise<ProjectRuntime> {
  const previous = projectRuntime;
  if (previous) {
    await previous.graphify.stopMcp();
    await previous.mcpServer.stop();
  }

  projectRuntime = await createProjectRuntime(project, aiSettings, embeddings);
  graphifyController = projectRuntime.graphify;
  mcpServer = projectRuntime.mcpServer;
  return projectRuntime;
}

function registerIpc(projects: ProjectService, embeddings: EmbeddingService, aiSettings: AiSettingsService): void {
  ipcMain.handle(windowChannels.minimize, () => {
    showWidget();
  });

  ipcMain.handle(windowChannels.maximize, (event) => {
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

  ipcMain.handle(windowChannels.close, () => {
    app.quit();
  });

  ipcMain.handle(windowChannels.restore, () => {
    restoreMainWindow();
  });

  ipcMain.handle(windowChannels.getWidgetBounds, () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      return null;
    }

    return widgetWindow.getBounds();
  });

  ipcMain.handle(windowChannels.moveWidget, (_event, payload: WidgetMovePayload) => {
    const nextBounds = clampWidgetBounds(payload);
    if (!nextBounds || !widgetWindow || widgetWindow.isDestroyed()) {
      return null;
    }

    widgetWindow.setBounds(nextBounds, false);
    return nextBounds;
  });

  ipcMain.handle(fileChannels.dropped, async (_event, payload: FilesDroppedPayload) => {
    const result = await requireRuntime().graphify.ingestFilesDrop(payload);
    console.info("Files dropped and ingested by Graphify", {
      writtenFileCount: result.writtenFileCount,
      graphNodeCount: result.graphNodeCount,
      graphPath: result.graphPath
    });
    restoreMainWindow();
    return result;
  });

  ipcMain.handle(brainChannels.writeNode, (_event, input: WriteBrainNodeInput) => requireRuntime().storage.writeNode(input));
  ipcMain.handle(brainChannels.readNode, (_event, uuid: string) => requireRuntime().storage.readNode(uuid));
  ipcMain.handle(brainChannels.listNodes, (_event, input?: ListBrainNodesInput) => requireRuntime().storage.listNodes(input));
  ipcMain.handle(brainChannels.searchNodes, async (_event, input: SearchBrainNodesInput) => {
    const nodes = await requireRuntime().storage.listNodes();
    return embeddings.search(input, nodes);
  });
  ipcMain.handle(brainChannels.mcpStatus, () => requireRuntime().mcpServer.getStatus());
  ipcMain.handle(brainChannels.organizedBoard, () => requireRuntime().graphRag.getOrganizedBoard());
  ipcMain.handle(brainChannels.exportBoardPlaintext, (_event, input?: ExportBoardPlaintextInput) =>
    requireRuntime().graphRag.exportBoardPlaintext(input)
  );
  ipcMain.handle(brainChannels.updateNodeSignals, (_event, input: UpdateNodeSignalsInput) =>
    requireRuntime().storage.updateNodeSignals(input)
  );
  ipcMain.handle(trackerChannels.list, () => requireRuntime().tracker.listTrackers());
  ipcMain.handle(trackerChannels.create, (_event, input: CreateTrackerInput) => requireRuntime().tracker.createTracker(input));
  ipcMain.handle(trackerChannels.update, (_event, input: UpdateTrackerInput) => requireRuntime().tracker.updateTracker(input));
  ipcMain.handle(trackerChannels.remove, (_event, uuid: string) => requireRuntime().tracker.removeTracker(uuid));
  ipcMain.handle(projectChannels.list, () => projects.listProjects());
  ipcMain.handle(projectChannels.getActive, () => projects.getActiveProject());
  ipcMain.handle(projectChannels.create, async (_event, input: CreateProjectInput) => {
    const project = await projects.createProject(input);
    await switchProjectRuntime(project, aiSettings, embeddings);
    return projects.getActiveProject();
  });
  ipcMain.handle(projectChannels.select, async (_event, input: ProjectSelectionInput) => {
    const project = await projects.selectProject(input);
    await switchProjectRuntime(project, aiSettings, embeddings);
    return projects.getActiveProject();
  });
  ipcMain.handle(projectChannels.rename, (_event, input: RenameProjectInput) => projects.renameProject(input));
  ipcMain.handle(projectChannels.archive, async (_event, input: ProjectSelectionInput) => {
    const archived = await projects.archiveProject(input);
    await switchProjectRuntime(await projects.getActiveProject(), aiSettings, embeddings);
    return archived;
  });
  ipcMain.handle(graphBoardChannels.getState, () => requireRuntime().graphBoard.getState());
  ipcMain.handle(graphBoardChannels.getNodeDetails, (_event, nodeId: string) =>
    requireRuntime().graphBoard.getNodeDetails(nodeId)
  );
  ipcMain.handle(graphBoardChannels.generateCallflow, (_event, nodeId: string) =>
    requireRuntime().graphify.generateCallflowHtml(nodeId)
  );
  ipcMain.handle(boardChannels.getState, (_event, rule: BoardRule) => requireRuntime().graphifyBoard.buildBoardState(rule));
  ipcMain.handle(boardChannels.getGraphHtml, () => requireRuntime().graphify.readGraphHtml());
  ipcMain.handle(boardChannels.removeSource, (_event, sourceFile: string) => requireRuntime().graphify.removeSource(sourceFile));
  ipcMain.handle(boardChannels.collapseSource, (_event, sourceFile: string, targetSourceFile: string) =>
    requireRuntime().graphify.collapseSourceInto(sourceFile, targetSourceFile)
  );
  ipcMain.handle(boardChannels.renameSource, (_event, sourceFile: string, newName: string) =>
    requireRuntime().graphify.renameSource(sourceFile, newName)
  );
  ipcMain.handle(boardChannels.commentSource, (_event, sourceFile: string, comment: string) =>
    requireRuntime().graphify.commentSource(sourceFile, comment)
  );
  ipcMain.handle(boardChannels.search, (_event, input: BoardSearchInput) => requireRuntime().graphifyBoard.search(input));
  ipcMain.handle(filesystemChannels.getRoot, () => requireRuntime().graphFilesystem.getRoot());
  ipcMain.handle(filesystemChannels.getChildren, (_event, nodeId: string) => requireRuntime().graphFilesystem.getChildren(nodeId));
  ipcMain.handle(filesystemChannels.getDetails, (_event, nodeId: string) => requireRuntime().graphFilesystem.getDetails(nodeId));
  ipcMain.handle(filesystemChannels.search, (_event, input: SourceTreeSearchInput) =>
    requireRuntime().graphFilesystem.search(input)
  );
  ipcMain.handle(filesystemChannels.getSourceOptions, () => requireRuntime().graphFilesystem.listSourceOptions());
  ipcMain.handle(clipboardChannels.readText, () => clipboard.readText());
  ipcMain.handle(clipboardChannels.writeText, (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle(settingsChannels.getAi, () => aiSettings.getSettings());
  ipcMain.handle(settingsChannels.updateAi, (_event, input: UpdateAiSettingsInput) => aiSettings.updateSettings(input));
  ipcMain.handle(settingsChannels.getApp, () => aiSettings.getAppSettings());
  ipcMain.handle(settingsChannels.updateApp, (_event, input: UpdateAppSettingsInput) => aiSettings.updateAppSettings(input));
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const aiSettings = new AiSettingsService(userDataPath);
  const projects = new ProjectService(userDataPath);
  const embeddings = new EmbeddingService(path.join(userDataPath, "models"));

  await aiSettings.initialize();
  await projects.initialize();
  await switchProjectRuntime(await projects.getActiveProject(), aiSettings, embeddings);

  registerIpc(projects, embeddings, aiSettings);
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
  void mcpServer?.stop();
  void graphifyController?.stopMcp();
});

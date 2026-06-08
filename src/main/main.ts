import { app, BrowserWindow, clipboard, ipcMain, screen } from "electron";
import path from "node:path";
import {
  boardChannels,
  brainChannels,
  clipboardChannels,
  fileChannels,
  FilesDroppedPayload,
  jobChannels,
  WidgetMovePayload,
  windowChannels
} from "../shared/ipc";
import type {
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  SearchBrainNodesInput,
  UpdateJobTrackerInput,
  UpdateNodeSignalsInput,
  WriteBrainNodeInput
} from "../shared/brain";
import type { BoardRule } from "../shared/types/board";
import { AgentController } from "./services/AgentController";
import { EmbeddingService } from "./services/EmbeddingService";
import { GraphifyBoardService } from "./services/GraphifyBoardService";
import { GraphifyController } from "./services/GraphifyController";
import { GraphRagService } from "./services/GraphRagService";
import { JobTrackerService } from "./services/JobTrackerService";
import { LocalMcpServer } from "./services/LocalMcpServer";
import { LlmService } from "./services/LlmService";
import { StorageService } from "./services/StorageService";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let mcpServer: LocalMcpServer | null = null;
let graphifyController: GraphifyController | null = null;

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
    minWidth: 1024,
    minHeight: 680,
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

function registerIpc(
  storage: StorageService,
  embeddings: EmbeddingService,
  graphRag: GraphRagService,
  localMcpServer: LocalMcpServer,
  jobTracker: JobTrackerService,
  graphify: GraphifyController,
  graphifyBoard: GraphifyBoardService
): void {
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
    const result = await graphify.ingestFilesDrop(payload);
    console.info("Files dropped and ingested by Graphify", {
      writtenFileCount: result.writtenFileCount,
      graphNodeCount: result.graphNodeCount,
      graphPath: result.graphPath
    });
    restoreMainWindow();
    return result;
  });

  ipcMain.handle(brainChannels.writeNode, (_event, input: WriteBrainNodeInput) => storage.writeNode(input));
  ipcMain.handle(brainChannels.readNode, (_event, uuid: string) => storage.readNode(uuid));
  ipcMain.handle(brainChannels.listNodes, (_event, input?: ListBrainNodesInput) => storage.listNodes(input));
  ipcMain.handle(brainChannels.searchNodes, async (_event, input: SearchBrainNodesInput) => {
    const nodes = await storage.listNodes();
    return embeddings.search(input, nodes);
  });
  ipcMain.handle(brainChannels.mcpStatus, () => localMcpServer.getStatus());
  ipcMain.handle(brainChannels.organizedBoard, () => graphRag.getOrganizedBoard());
  ipcMain.handle(brainChannels.exportBoardPlaintext, (_event, input?: ExportBoardPlaintextInput) => graphRag.exportBoardPlaintext(input));
  ipcMain.handle(brainChannels.updateNodeSignals, (_event, input: UpdateNodeSignalsInput) => storage.updateNodeSignals(input));
  ipcMain.handle(jobChannels.list, () => jobTracker.listJobs());
  ipcMain.handle(jobChannels.update, (_event, input: UpdateJobTrackerInput) => jobTracker.updateJob(input));
  ipcMain.handle(boardChannels.getState, (_event, rule: BoardRule) => graphifyBoard.buildBoardState(rule));
  ipcMain.handle(boardChannels.getGraphHtml, () => graphify.readGraphHtml());
  ipcMain.handle(clipboardChannels.readText, () => clipboard.readText());
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const storage = new StorageService(path.join(userDataPath, "vault"));
  const graphify = new GraphifyController(path.join(userDataPath, "vault", "raw"));
  const graphifyBoard = new GraphifyBoardService(graphify.getGraphPath(), graphify.getRawVaultPath());
  graphifyController = graphify;
  const embeddings = new EmbeddingService(path.join(userDataPath, "models"));
  const graphRag = new GraphRagService(storage, embeddings);
  const llm = new LlmService();
  const jobTracker = new JobTrackerService(storage, llm, graphify);

  mcpServer = new LocalMcpServer({
    graphRag,
    port: Number(process.env.SECOND_BRAIN_MCP_PORT ?? 4127)
  });
  const agentController = new AgentController(mcpServer, jobTracker, llm, graphify);

  await storage.initialize();
  await graphify.initialize();

  try {
    await mcpServer.start();
  } catch (error) {
    console.error("Failed to start local MCP server", error);
  }

  registerIpc(storage, embeddings, graphRag, mcpServer, jobTracker, graphify, graphifyBoard);
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

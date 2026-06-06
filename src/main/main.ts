import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { brainChannels, fileChannels, FilesDroppedPayload, windowChannels } from "../shared/ipc";
import type {
  ExportBoardPlaintextInput,
  ListBrainNodesInput,
  SearchBrainNodesInput,
  UpdateNodeSignalsInput,
  WriteBrainNodeInput
} from "../shared/brain";
import { AgentController } from "./services/AgentController";
import { EmbeddingService } from "./services/EmbeddingService";
import { GraphRagService } from "./services/GraphRagService";
import { LocalMcpServer } from "./services/LocalMcpServer";
import { StorageService } from "./services/StorageService";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let mcpServer: LocalMcpServer | null = null;

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
  const width = 176;
  const height = 176;

  const window = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + Math.round((workArea.height - height) / 2),
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
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
  localMcpServer: LocalMcpServer
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

  ipcMain.handle(fileChannels.dropped, (_event, payload: FilesDroppedPayload) => {
    console.info("Files dropped", payload);
    restoreMainWindow();
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
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  const storage = new StorageService(path.join(userDataPath, "vault"));
  const embeddings = new EmbeddingService(path.join(userDataPath, "models"));
  const graphRag = new GraphRagService(storage, embeddings);

  mcpServer = new LocalMcpServer({
    graphRag,
    port: Number(process.env.SECOND_BRAIN_MCP_PORT ?? 4127)
  });
  const agentController = new AgentController(mcpServer);

  await storage.initialize();

  try {
    await mcpServer.start();
  } catch (error) {
    console.error("Failed to start local MCP server", error);
  }

  registerIpc(storage, embeddings, graphRag, mcpServer);
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
});

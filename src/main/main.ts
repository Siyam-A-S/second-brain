import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { fileChannels, FilesDroppedPayload, windowChannels } from "../shared/ipc";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;

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

function registerIpc(): void {
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
}

app.whenReady().then(() => {
  registerIpc();
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

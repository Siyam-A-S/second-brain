import { contextBridge, ipcRenderer } from "electron";
import type { FilesDroppedPayload, SecondBrainApi } from "../shared/ipc";

const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore"
} as const;

const fileChannels = {
  dropped: "files-dropped"
} as const;

const api: SecondBrainApi = {
  window: {
    minimize: () => ipcRenderer.invoke(windowChannels.minimize),
    maximize: () => ipcRenderer.invoke(windowChannels.maximize),
    close: () => ipcRenderer.invoke(windowChannels.close),
    restore: () => ipcRenderer.invoke(windowChannels.restore)
  },
  files: {
    dropped: (payload: FilesDroppedPayload) => ipcRenderer.invoke(fileChannels.dropped, payload)
  }
};

contextBridge.exposeInMainWorld("api", api);

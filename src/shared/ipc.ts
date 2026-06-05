export const windowChannels = {
  minimize: "window-minimize",
  maximize: "window-maximize",
  close: "window-close",
  restore: "window-restore"
} as const;

export const fileChannels = {
  dropped: "files-dropped"
} as const;

export type WindowChannel = (typeof windowChannels)[keyof typeof windowChannels];
export type FileChannel = (typeof fileChannels)[keyof typeof fileChannels];

export type DroppedFile = {
  name: string;
  path: string;
  type: string;
  size: number;
};

export type FilesDroppedPayload = {
  source: "main-drop-zone" | "floating-widget";
  files: DroppedFile[];
  text?: string;
};

export type SecondBrainApi = {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<boolean>;
    close: () => Promise<void>;
    restore: () => Promise<void>;
  };
  files: {
    dropped: (payload: FilesDroppedPayload) => Promise<void>;
  };
};

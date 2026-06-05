import type { SecondBrainApi } from "../../shared/ipc";

const browserApiFallback: SecondBrainApi = {
  window: {
    minimize: async () => undefined,
    maximize: async () => false,
    close: async () => undefined,
    restore: async () => undefined
  },
  files: {
    dropped: async (payload) => {
      console.info("Browser renderer drop payload", payload);
    }
  }
};

export function installBrowserApiFallback(): void {
  if (window.api || !import.meta.env.DEV) {
    return;
  }

  window.api = browserApiFallback;
}

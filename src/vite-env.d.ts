/// <reference types="vite/client" />

import type { SecondBrainApi } from "./shared/ipc";

declare global {
  interface Window {
    api: SecondBrainApi;
  }
}

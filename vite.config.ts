import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.VITE_PORT ?? "5173");

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  },
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      "/local-llm": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/local-llm/, "")
      }
    }
  }
});

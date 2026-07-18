import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative base so the built renderer works both when served over HTTP
  // (`aiw ui`) and when loaded from file:// inside the Electron shell.
  base: "./",
  build: { outDir: "dist" },
});

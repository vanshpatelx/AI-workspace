import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // shadcn/ai-elements components import via "@/", so mirror that here
  // and in tsconfig paths.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173 },
  // Relative base so the built renderer works both when served over HTTP
  // (`aiw ui`) and when loaded from file:// inside the Electron shell.
  base: "./",
  build: { outDir: "dist" },
});

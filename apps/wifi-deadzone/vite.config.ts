import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// "@core" is the engine package source. The app imports it by path, so there is no build step for core.
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../../packages/ghostfield-core/src", import.meta.url)),
      "@ui": fileURLToPath(new URL("../../packages/ghostfield-ui/src", import.meta.url)),
    },
  },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: false },
});

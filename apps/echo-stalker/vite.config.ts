import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// "@core" and "@ui" are shared source folders, imported by path (no build step).
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../../packages/ghostfield-core/src", import.meta.url)),
      "@ui": fileURLToPath(new URL("../../packages/ghostfield-ui/src", import.meta.url)),
    },
  },
  build: { target: "es2022", sourcemap: false },
});

// Tests use their own config (no import of "vite"): vitest 2 bundles vite 5, which cannot load the vite 8 package.
import { fileURLToPath } from "node:url";

export default {
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../../packages/ghostfield-core/src", import.meta.url)),
      "@ui": fileURLToPath(new URL("../../packages/ghostfield-ui/src", import.meta.url)),
    },
  },
};

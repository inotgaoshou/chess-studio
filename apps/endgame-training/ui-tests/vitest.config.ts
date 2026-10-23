import { defineConfig } from "../../desktop/node_modules/vitest/dist/config.js";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  define: { __APP_ENV__: JSON.stringify("test"), __APP_VERSION__: JSON.stringify("1.0.6"), __APP_BUILD_TIME__: JSON.stringify("2026-10-23T00:00:00Z") },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { "vitest":fileURLToPath(new URL("../../desktop/node_modules/vitest/dist/index.js",import.meta.url)), "@testing-library/react": fileURLToPath(new URL("../../desktop/node_modules/@testing-library/react", import.meta.url)) },
  },
  test: { environment: "jsdom", include: ["ui-tests/*.test.tsx"], setupFiles: ["ui-tests/setup.ts"] },
});

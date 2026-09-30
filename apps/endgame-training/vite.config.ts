import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const appEnvironment = env.VITE_APP_ENV ?? (mode === "development" ? "test" : "production");
  if (appEnvironment !== "test" && appEnvironment !== "production") {
    throw new Error("VITE_APP_ENV must be test or production");
  }
  return {
    base: "./",
    plugins: [react()],
    clearScreen: false,
    define: {
      __APP_ENV__: JSON.stringify(appEnvironment),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "1.0.0"),
      __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  };
});

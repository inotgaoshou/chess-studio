export type AppEnvironment = "test" | "production";

export const packageEnvironment: AppEnvironment = __APP_ENV__;
export const packageEnvironmentLabel = packageEnvironment === "test" ? "测试版" : "正式版";
const ENVIRONMENT_KEY = "xiangqi-teaching-environment";
const API_URLS: Record<AppEnvironment, string> = {
  test: "https://api-test.qixiapp.cn",
  production: "https://api.qixiapp.cn",
};

export function selectedEnvironment(): AppEnvironment {
  if (packageEnvironment === "production") return "production";
  return localStorage.getItem(ENVIRONMENT_KEY) === "production" ? "production" : "test";
}

export function selectEnvironment(environment: AppEnvironment) {
  if (packageEnvironment !== "test") throw new Error("正式版不支持切换环境。");
  if (environment !== "test" && environment !== "production") throw new Error("无效的连接环境。");
  localStorage.setItem(ENVIRONMENT_KEY, environment);
}

export function environmentServerUrl() {
  if (import.meta.env.DEV && selectedEnvironment() === "test") {
    const configured = String(import.meta.env.VITE_TEACHING_API_BASE || "").trim();
    return configured ? configured.replace(/\/$/, "") : "http://127.0.0.1:8090";
  }
  return API_URLS[selectedEnvironment()];
}

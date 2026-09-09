import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cn.xiangqi.endgame.training",
  appName: "棋研",
  webDir: "dist",
  loggingBehavior: "production",
  backgroundColor: "#f4f8f2",
  android: { path: "android", backgroundColor: "#f4f8f2" },
  ios: { path: "ios", backgroundColor: "#f4f8f2" },
  server: { hostname: "localhost", androidScheme: "https", iosScheme: "capacitor" },
};

export default config;

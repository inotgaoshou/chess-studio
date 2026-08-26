import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cn.xiangqi.studio",
  appName: "棋研",
  webDir: "dist",
  loggingBehavior: "production",
  backgroundColor: "#171b1a",
  android: {
    path: "android",
    backgroundColor: "#171b1a",
  },
  ios: {
    path: "ios",
    scheme: "XiangqiStudio",
    backgroundColor: "#171b1a",
  },
  server: {
    hostname: "localhost",
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;

import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "cn.xiangqi.endgame.training",
  appName: "棋析",
  webDir: "dist",
  loggingBehavior: "production",
  backgroundColor: "#f4f8f2",
  android: { path: "android", backgroundColor: "#f4f8f2", adjustMarginsForEdgeToEdge: "auto" },
  ios: { path: "ios", backgroundColor: "#f4f8f2" },
  plugins: { Keyboard: { resize: KeyboardResize.Native, resizeOnFullScreen: true } },
  server: { hostname: "localhost", androidScheme: "https", iosScheme: "capacitor" },
};

export default config;

import { Capacitor, registerPlugin } from "@capacitor/core";

export type PreferredOrientation = "auto" | "landscape" | "portrait";

type NativeOrientation = {
  set(options: { orientation: PreferredOrientation }): Promise<{ requiresPhysicalRotation?: boolean } | void>;
};

const nativeOrientation = registerPlugin<NativeOrientation>("ScreenOrientation");

export async function setPreferredOrientation(orientation: PreferredOrientation): Promise<{ requiresPhysicalRotation: boolean }> {
  if (Capacitor.isNativePlatform()) {
    const result = await nativeOrientation.set({ orientation });
    return { requiresPhysicalRotation: result?.requiresPhysicalRotation === true };
  }
  const screenOrientation = screen.orientation as ScreenOrientation & { lock?: (value: "landscape" | "portrait") => Promise<void>; unlock?: () => void };
  if (orientation === "auto") screenOrientation?.unlock?.();
  else {
    if (!screenOrientation?.lock) throw new Error("当前浏览器不支持锁定方向，请使用 Android 或 iOS 安装版。");
    await screenOrientation.lock(orientation);
  }
  return { requiresPhysicalRotation: false };
}

import { useEffect, useRef, useState } from "react";
import { setPreferredOrientation, type PreferredOrientation } from "./orientation";

const preferenceKey = "xiangqi-training-orientation";

export function useScreenOrientation() {
  const [preferredOrientation, setPreference] = useState<PreferredOrientation>(() => {
    const saved = localStorage.getItem(preferenceKey);
    return saved === "landscape" || saved === "portrait" ? saved : "auto";
  });
  const [orientationPending, setPending] = useState(false);
  const [orientationMessage, setMessage] = useState("");
  const [orientationError, setError] = useState("");
  const inFlight = useRef(false);
  const restored = useRef(false);

  async function changeOrientation(next: PreferredOrientation) {
    // Guard synchronously: two taps can arrive before React renders disabled buttons.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await setPreferredOrientation(next);
      setPreference(next);
      localStorage.setItem(preferenceKey, next);
      setMessage(next === "auto" ? "自动旋转跟随系统设置；系统锁定方向时不会自动旋转。"
        : result.requiresPhysicalRotation ? `已限制为${next === "landscape" ? "横屏" : "竖屏"}，请按系统提示旋转设备。`
        : `已锁定${next === "landscape" ? "横屏" : "竖屏"}。`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setError(`屏幕方向切换失败：${reason || "系统未允许切换，请重试"}`);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void changeOrientation(preferredOrientation);
  }, []);

  return { preferredOrientation, orientationPending, orientationMessage, orientationError, changeOrientation };
}

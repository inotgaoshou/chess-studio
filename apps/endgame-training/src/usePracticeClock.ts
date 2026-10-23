import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PracticeClock } from "./practiceClock";

export function usePracticeClock(active: boolean) {
  const clock = useRef<PracticeClock>(undefined);
  if (!clock.current) clock.current = new PracticeClock();
  const [requested, setRequested] = useState(true);
  const [foreground, setForeground] = useState(() => document.visibilityState !== "hidden");
  const [revision, setRevision] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const allowed = useRef(false);
  const readElapsed = useCallback(() => clock.current!.read(), []);
  const updateDisplay = useCallback(() => setElapsed(clock.current!.read()), []);
  const start = useCallback(() => {
    setRequested(true);
    clock.current!.setRunning(allowed.current);
    updateDisplay();
  }, [updateDisplay]);
  const stop = useCallback(() => {
    clock.current!.setRunning(false);
    setRequested(false);
    updateDisplay();
  }, [updateDisplay]);
  const reset = useCallback((elapsedMs = 0) => {
    clock.current!.reset(elapsedMs);
    setRequested(true);
    setRevision(n => n + 1);
    updateDisplay();
  }, [updateDisplay]);

  useLayoutEffect(() => {
    allowed.current = active && foreground;
    clock.current!.setRunning(allowed.current && requested);
    updateDisplay();
  }, [active, foreground, requested, revision, updateDisplay]);
  useEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState !== "hidden";
      // Stop synchronously before draft persistence or a late async result reads time.
      if (!visible) { allowed.current = false; clock.current!.setRunning(false); }
      setForeground(visible);
      updateDisplay();
    };
    const hide = () => { allowed.current = false; clock.current!.setRunning(false); setForeground(false); updateDisplay(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      clock.current!.setRunning(false);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
    };
  }, [updateDisplay]);
  const running = active && foreground && requested;
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(updateDisplay, 250);
    return () => window.clearInterval(interval);
  }, [running, updateDisplay]);
  return { elapsed, readElapsed, reset, start, stop, running };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function usePageVisible() {
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    const hide = () => setVisible(false);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("pause", hide);
    document.addEventListener("resume", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("pause", hide);
      document.removeEventListener("resume", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", update);
    };
  }, []);
  return visible;
}

/** A position owns its result and abort signal, including during the debounce. */
export function usePositionAnalysis<T>({ positionKey, enabled, suspended, analyze, delay = 300 }: {
  positionKey: string;
  enabled: boolean;
  suspended: boolean;
  analyze(signal: AbortSignal): Promise<T>;
  delay?: number;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: T }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [working, setWorking] = useState<string>();
  const owner = useRef<{ controller: AbortController; timer?: number } | undefined>(undefined);
  const run = useRef(analyze);
  run.current = analyze;
  const key = `${positionKey}:${revision}`;
  const active = enabled && !suspended;
  const cancel = useCallback((clear = true) => {
    const previous = owner.current;
    owner.current = undefined;
    if (previous) { window.clearTimeout(previous.timer); previous.controller.abort(); }
    setWorking(undefined);
    if (clear) { setResult(undefined); setFailure(undefined); }
  }, []);
  const refresh = useCallback(() => { cancel(); setRevision(value => value + 1); }, [cancel]);

  useLayoutEffect(() => {
    cancel(false);
    if (!active) return;
    const task = { controller: new AbortController(), timer: undefined as number | undefined };
    owner.current = task;
    setWorking(key);
    setFailure(undefined);
    task.timer = window.setTimeout(() => {
      void run.current(task.controller.signal).then(value => {
        if (owner.current === task && !task.controller.signal.aborted) setResult({ key, value });
      }).catch(error => {
        if (owner.current === task && !task.controller.signal.aborted) setFailure({ key, message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        if (owner.current === task) { owner.current = undefined; setWorking(undefined); }
      });
    }, delay);
    return () => {
      window.clearTimeout(task.timer);
      task.controller.abort();
      if (owner.current === task) owner.current = undefined;
    };
  }, [key, active, delay, cancel]);

  return {
    value: enabled && result?.key === key ? result.value : undefined,
    error: enabled && failure?.key === key ? failure.message : undefined,
    pending: active && working === key,
    cancel,
    refresh,
  };
}

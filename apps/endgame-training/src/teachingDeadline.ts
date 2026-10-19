// Bound reads including capability checks: a hung mobile connection must expose retry.
export async function teachingRead<T>(read: (signal: AbortSignal) => Promise<T>, source?: AbortSignal, isCurrent?: () => boolean, timeoutMs = 15_000): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => { abort.abort(); rejectAbort(new DOMException("读取已取消", "AbortError")); };
  source?.addEventListener("abort", cancel, { once: true });
  if (source?.aborted) { source.removeEventListener("abort", cancel); throw new DOMException("读取已取消", "AbortError"); }
  timer = setTimeout(() => { abort.abort(); rejectAbort(new Error("读取超时，请检查网络后重试")); }, timeoutMs);
  const currentTimer = isCurrent ? setInterval(() => { if (!isCurrent()) cancel(); }, 100) : undefined;
  if (isCurrent && !isCurrent()) cancel();
  try { return await Promise.race([cancelled, read(abort.signal)]); }
  finally { clearTimeout(timer); clearInterval(currentTimer); source?.removeEventListener("abort", cancel); }
}

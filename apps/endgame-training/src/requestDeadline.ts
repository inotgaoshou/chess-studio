export const REQUEST_TIMEOUT_MS = 15_000;

// Race as well as abort: native bridges and a stalled response body may ignore a signal.
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  source?: AbortSignal | null,
  message = "请求超时，请检查网络后重试",
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let rejectCancellation: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const cancel = (reason: unknown) => {
    rejectCancellation(reason);
    controller.abort(reason);
  };
  const onAbort = () => cancel(source?.reason ?? new DOMException("操作已取消", "AbortError"));
  if (source?.aborted) throw source.reason ?? new DOMException("操作已取消", "AbortError");
  source?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => cancel(new Error(message)), timeoutMs);
  try {
    return await Promise.race([cancelled, operation(controller.signal)]);
  } finally {
    clearTimeout(timer);
    source?.removeEventListener("abort", onAbort);
  }
}

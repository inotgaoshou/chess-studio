import { withRequestDeadline } from "./requestDeadline";

// Only wrap reads. A lost response to a write can mean it already succeeded.
// Keep the normal request deadline: a slow but valid response must still open.
export async function retryOpeningRead<T>(read: (signal: AbortSignal) => Promise<T>, source: AbortSignal, onRetry: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    source.throwIfAborted();
    try { return await withRequestDeadline(read, source, "读取题目超时"); }
    catch (error) {
      source.throwIfAborted();
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
      if (attempt || !(error instanceof TypeError || [502,503,504].includes(status))) throw error;
      onRetry();
    }
  }
}

import type { AnalysisLine } from "./types";

export const CLOUD_ENGINE_VERSION = "Pikafish-2026-09-06";
export const CLOUD_NNUE_VERSION = "sha256:7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e";

export type CloudAnalysisJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type CloudAnalysisJobRequest = {
  fen: string;
  engineVersion: string;
  nnueVersion: string;
  budget: { mode: "time" | "depth"; value: number };
  multiPv: number;
};

export type CloudAnalysisJob = {
  jobId: string;
  status: CloudAnalysisJobStatus;
  source: "cloud";
  engineVersion: string;
  nnueVersion: string;
  cacheHit: boolean;
  progress?: { depth?: number; elapsedMs?: number; candidateCount: number };
  result?: {
    engine: string;
    elapsedMs: number;
    lines: AnalysisLine[];
    guestQuota?: { limit?: number; remaining?: number; resetsAt?: string };
  };
  error?: string;
};

type RunCloudAnalysisJobOptions = {
  baseUrl: string;
  headers: Record<string, string>;
  request: CloudAnalysisJobRequest;
  signal?: AbortSignal;
  onProgress?: (job: CloudAnalysisJob) => void;
  fetchImpl?: typeof fetch;
  pollDelayMs?: number;
  formatHttpError?: (status: number, detail?: string) => string;
};

export type CompletedCloudAnalysis = {
  job: CloudAnalysisJob;
  lines: AnalysisLine[];
  guestQuota?: { limit?: number; remaining?: number; resetsAt?: string };
};

export async function runCloudAnalysisJob(options: RunCloudAnalysisJobOptions): Promise<CompletedCloudAnalysis> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const jobsUrl = `${options.baseUrl}/api/v1/analysis/jobs`;
  let jobId: string | undefined;
  try {
    const created = await requestJob(fetchImpl, jobsUrl, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.request),
      signal: options.signal,
    }, options.formatHttpError);
    jobId = created.jobId;
    options.onProgress?.(created);
    if (created.status === "completed") return completedResult(created);

    while (true) {
      await abortableDelay(options.pollDelayMs ?? 350, options.signal);
      const job = await requestJob(fetchImpl, `${jobsUrl}/${encodeURIComponent(jobId)}`, {
        method: "GET",
        headers: options.headers,
        signal: options.signal,
      }, options.formatHttpError);
      options.onProgress?.(job);
      if (job.status === "completed") return completedResult(job);
      if (job.status === "failed") throw new Error(job.error || "云端分析失败");
      if (job.status === "cancelled") throw abortError("云端分析已取消");
    }
  } catch (error) {
    if (jobId && (options.signal?.aborted || isAbortError(error))) {
      void fetchImpl(`${jobsUrl}/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers: options.headers,
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function requestJob(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  formatHttpError?: (status: number, detail?: string) => string,
): Promise<CloudAnalysisJob> {
  const response = await fetchImpl(url, init);
  const payload = await response.json().catch(() => ({})) as Partial<CloudAnalysisJob> & { error?: string };
  if (!response.ok) {
    throw new Error(formatHttpError?.(response.status, payload.error) ?? payload.error ?? `云端分析请求失败：${response.status}`);
  }
  if (!payload.jobId || !payload.status) throw new Error("云端分析返回了无效任务");
  return payload as CloudAnalysisJob;
}

function completedResult(job: CloudAnalysisJob): CompletedCloudAnalysis {
  if (!job.result) throw new Error("云端分析任务完成但缺少结果");
  return {
    job,
    guestQuota: job.result.guestQuota,
    lines: job.result.lines.map((line) => ({
      ...line,
      source: "cloud",
      engineVersion: job.engineVersion,
      nnueVersion: job.nnueVersion,
      cached: job.cacheHit,
    })),
  };
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(message = "云端分析已取消"): DOMException {
  return new DOMException(message, "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

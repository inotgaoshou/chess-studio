export class EngineBusyError extends Error {
  constructor() { super("引擎正在处理走棋或分析，本次先提供局面事实；稍后可重新讲解。"); this.name = "EngineBusyError"; }
}

const cancelled = () => new DOMException("引擎请求已取消", "AbortError");
type Job = {
  priority: number;
  start(): Promise<void>;
  reject(error: unknown): void;
  cancelled: boolean;
};

/** One native engine, one owner. A lower priority request never cancels play. */
export class EngineCoordinator {
  private active?: Job;
  private queue: Job[] = [];
  private stopping: Promise<void> = Promise.resolve();
  private readonly stopNative: () => Promise<void>;
  constructor(stopNative: () => Promise<void>) { this.stopNative = stopNative; }

  run<T>(priority: number, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.active && priority < this.active.priority) return Promise.reject(new EngineBusyError());
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        priority, cancelled: false, reject,
        start: async () => {
          try {
            const result = await work();
            if (!job.cancelled) resolve(result);
          } catch (error) { if (!job.cancelled) reject(error); }
          finally { signal?.removeEventListener("abort", abort); }
        },
      };
      const abort = () => this.cancelJob(job);
      signal?.addEventListener("abort", abort, { once: true });
      const originalReject = job.reject;
      job.reject = error => { signal?.removeEventListener("abort", abort); originalReject(error); };
      // Latest equal-priority request replaces obsolete work, matching the
      // native plugin's original semantics, while keeping stop/start ordered.
      for (const queued of [...this.queue]) if (queued.priority <= priority) this.cancelJob(queued);
      this.queue.push(job);
      if (this.active && priority >= this.active.priority) this.cancelJob(this.active);
      void this.drain();
    });
  }

  private cancelJob(job: Job) {
    if (job.cancelled) return;
    job.cancelled = true;
    job.reject(cancelled());
    this.queue = this.queue.filter(item => item !== job);
    if (this.active === job) {
      this.stopping = this.stopping.then(this.stopNative).catch(() => undefined);
    }
  }

  async cancel() {
    for (const job of [...this.queue]) this.cancelJob(job);
    if (this.active) this.cancelJob(this.active);
    await this.stopping;
  }

  private async drain() {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    await this.stopping;
    if (!next.cancelled) await next.start();
    await this.stopping;
    this.active = undefined;
    void this.drain();
  }
}

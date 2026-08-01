export type AutosaveState =
  | { status: "draft" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function autosaveLabel(state: AutosaveState) {
  switch (state.status) {
    case "draft": return "本地草稿";
    case "saving": return "保存中";
    case "saved": return "已保存";
    case "error": return "保存失败，点击重试";
  }
}

export class AutosaveOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private failed?: { run: () => Promise<unknown>; state: Extract<AutosaveState, { status: "error" }> };

  constructor(
    private readonly update: (state: AutosaveState) => void,
    private readonly errorMessage: (error: unknown) => string,
  ) {}

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return this.schedule(run, false);
  }

  hasFailure() {
    return this.failed !== undefined;
  }

  retry(): Promise<unknown> | undefined {
    return this.failed ? this.schedule(this.failed.run, true) : undefined;
  }

  private schedule<T>(run: () => Promise<T>, retrying: boolean): Promise<T> {
    const operation = this.tail.then(async () => {
      if (!retrying && this.failed) {
        throw new Error("请先重试失败的本地保存，再继续修改棋谱");
      }
      this.update({ status: "saving" });
      try {
        const result = await run();
        this.failed = undefined;
        this.update({ status: "saved" });
        return result;
      } catch (error) {
        const state = { status: "error", message: this.errorMessage(error) } as const;
        this.failed = { run: run as () => Promise<unknown>, state };
        this.update(state);
        throw error;
      }
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

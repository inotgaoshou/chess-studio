export type ContentScope = { serverUrl: string; ownerId: string };
export const contentEpochKey = (scope: ContentScope) => `xiangqi-content-epoch:${encodeURIComponent(scope.serverUrl)}:${scope.ownerId}`;
export const belongsToContentScope = (value: { serverUrl?: string; ownerId?: string }, scope: ContentScope) => value.serverUrl === scope.serverUrl && value.ownerId === scope.ownerId;

/** Serializes adoption so a delayed epoch probe cannot delete freshly downloaded content. */
export class ContentEpochTracker {
  private epochs = new Map<string, string>();
  private pending = new Map<string, Promise<boolean>>();
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  constructor(storage: Pick<Storage, "getItem" | "setItem">) { this.storage = storage; }
  current(scope: ContentScope) { return this.epochs.get(contentEpochKey(scope)) ?? this.storage.getItem(contentEpochKey(scope)) ?? undefined; }
  async observe(scope: ContentScope, epoch: string | undefined, purge: () => Promise<void>, isCurrent: () => boolean): Promise<boolean> {
    if (!epoch || !isCurrent()) return false;
    const key = contentEpochKey(scope);
    const previous = this.pending.get(key);
    if (previous) { await previous; return this.observe(scope, epoch, purge, isCurrent); }
    const operation = (async () => {
      if (!isCurrent() || this.current(scope) === epoch) return false;
      await purge();
      if (!isCurrent()) throw new Error("登录账号或环境已变化，请重新操作。");
      this.storage.setItem(key, epoch);
      this.epochs.set(key, epoch);
      return true;
    })();
    this.pending.set(key, operation);
    try { return await operation; }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }
}

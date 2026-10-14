import type { CheckinApi, CheckinPlan, CheckinDetail, CheckinSubmit } from "./checkinDomain";
export type CheckinLocalDraft = { note: string; photos: { id: string; blob: Blob; uploaded?: boolean }[] };
export type PendingCheckin = CheckinLocalDraft & { key: string; scope: string; planId: string; taskId: string; body: CheckinSubmit; createdAt: string; error?: string; blocked?: boolean };
export interface CheckinPersistence {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  all<T>(): Promise<T[]>;
}
export class IndexedCheckinPersistence implements CheckinPersistence {
  private async db() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("qixi-learning-checkins", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("records");
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
  }
  private async operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    try { return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("records", mode); const request = run(tx.objectStore("records"));
      tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error ?? request.error); tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  }
  get<T>(key: string) { return this.operation<T | undefined>("readonly", store => store.get(key)); }
  async put(key: string, value: unknown) { await this.operation("readwrite", store => store.put(value, key)); }
  async remove(key: string) { await this.operation("readwrite", store => store.delete(key)); }
  all<T>() { return this.operation<T[]>("readonly", store => store.getAll()); }
}
export class CheckinStudentClient {
  private flushing?: Promise<void>;
  private draftWrites = new Map<string, Promise<void>>();
  readonly api: CheckinApi;
  readonly scope: string;
  private store: CheckinPersistence;
  private isCurrent: () => boolean;
  constructor(api: CheckinApi, scope: string, store: CheckinPersistence, isCurrent: () => boolean) {
    this.api = api; this.scope = scope; this.store = store; this.isCurrent = isCurrent;
  }
  private assertCurrent() { if (!this.isCurrent()) throw new Error("账号或机构已切换，请重新打开打卡"); }
  private key(kind: string, id = "") { return `${this.scope}:${kind}:${id}`; }
  async plans(): Promise<CheckinPlan[]> {
    this.assertCurrent();
    try { const plans = await this.api.list(); this.assertCurrent(); await this.store.put(this.key("plans"), plans); return plans; }
    catch (error) { this.assertCurrent(); if (!retryable(error)) throw error; const cached = await this.store.get<CheckinPlan[]>(this.key("plans")); if (cached) return cached; throw error; }
  }
  async detail(id: string): Promise<CheckinDetail> {
    this.assertCurrent();
    try { const detail = { ...await this.api.detail(id), cachedAt: new Date().toISOString() }; this.assertCurrent(); await this.store.put(this.key("detail", id), detail); return detail; }
    catch (error) { this.assertCurrent(); if (!retryable(error)) throw error; const cached = await this.store.get<CheckinDetail>(this.key("detail", id)); if (cached) return cached; throw error; }
  }
  async pending(): Promise<PendingCheckin[]> { this.assertCurrent(); return (await this.store.all<PendingCheckin>()).filter(item => item?.scope === this.scope && item.taskId && item.body); }
  async draft(taskId: string) { this.assertCurrent(); return this.store.get<CheckinLocalDraft>(this.key("draft", taskId)); }
  async saveDraft(taskId: string, draft: CheckinLocalDraft) {
    this.assertCurrent(); const previous = this.draftWrites.get(taskId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => { this.assertCurrent(); return this.store.put(this.key("draft", taskId), draft); });
    this.draftWrites.set(taskId, write);
    try { await write; } finally { if (this.draftWrites.get(taskId) === write) this.draftWrites.delete(taskId); }
  }
  async queue(planId: string, taskId: string, revision: number, draft: CheckinLocalDraft): Promise<void> {
    this.assertCurrent(); await this.draftWrites.get(taskId); this.assertCurrent(); const key = this.key("pending", taskId);
    const previous = await this.store.get<PendingCheckin>(key);
    if (previous && !previous.blocked) throw new Error("这项打卡正在同步，请稍候或重试同步");
    const item: PendingCheckin = { ...draft, key, scope: this.scope, planId, taskId, createdAt: new Date().toISOString(), body: { clientId: crypto.randomUUID(), expectedRevision: revision, note: draft.note, photoIds: draft.photos.map(p => p.id) } };
    await this.store.put(key, item); await this.store.remove(this.key("draft", taskId));
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const flush = this.flushItems().finally(() => { if (this.flushing === flush) this.flushing = undefined; });
    this.flushing = flush; return flush;
  }
  private async flushItems() {
    for (const item of await this.pending()) {
      this.assertCurrent(); if (item.blocked) continue;
      try {
        for (const photo of item.photos) {
          if (photo.uploaded) continue;
          await this.api.upload(item.taskId, photo.id, photo.blob); this.assertCurrent(); photo.uploaded = true; await this.store.put(item.key, item);
        }
        await this.api.submit(item.taskId, item.body); this.assertCurrent();
        // Keep the pending record until the confirmed state is durably cached.
        await this.detail(item.planId); this.assertCurrent(); await this.store.remove(item.key);
      } catch (error) {
        this.assertCurrent(); item.error = error instanceof Error ? error.message : "同步失败，请重试";
        item.blocked = !retryable(error); await this.store.put(item.key, item);
        if (!item.blocked) break;
      }
    }
  }
}
export function retryable(error: unknown) {
  const status = (error as { status?: number })?.status;
  return !status || status >= 500 || status === 408 || status === 429;
}
export async function compressCheckinPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) throw new Error("请选择25MB以内的照片");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("照片格式无法读取，请选择JPEG或PNG照片")); image.src = url; });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("照片处理失败"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("照片处理失败")), "image/jpeg", .82));
    if (blob.size > 3 * 1024 * 1024) throw new Error("照片压缩后仍超过3MB，请换一张照片"); return blob;
  } finally { URL.revokeObjectURL(url); }
}

import { useEffect, useRef, useState } from "react";
import type { LocalManualFolder, LocalManualGame, LocalManualMetadata } from "./types";

export function isImeEnter(event: { key: string; nativeEvent: { isComposing?: boolean; keyCode?: number } }, composing = false) {
  return event.key === "Enter" && !composing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function manualMetadata(game: LocalManualGame): LocalManualMetadata {
  return { event: "", redPlayer: "", blackPlayer: "", playedAt: game.createdAt,
    gameType: "full", result: "unknown", ...game.metadata };
}

function localDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export type ManualSaveValues = Pick<LocalManualGame, "title" | "note" | "folderPath" | "metadata">;
export function ManualSaveDialog({ game, folders, onSave, onCreateFolder, onClose }: {
  game: LocalManualGame; folders: LocalManualFolder[];
  onSave(values: ManualSaveValues): Promise<void>;
  onCreateFolder(path: string): Promise<void>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(() => ({ title: game.title, note: game.note,
    folderPath: game.folderPath ?? "", metadata: manualMetadata(game) }));
  const initial = useRef(JSON.stringify(draft));
  const [viewport, setViewport] = useState(() => ({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 }));
  useEffect(() => {
    const update = () => setViewport({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 });
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const composing = useRef(false);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string | undefined>();
  const dirty = JSON.stringify(draft) !== initial.current || Boolean(newFolder?.trim());
  const close = () => {
    if (lock.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || composing.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (discard) setDiscard(false); else close();
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  });
  const metadata = <K extends keyof LocalManualMetadata>(key: K, value: LocalManualMetadata[K]) =>
    setDraft((old) => ({ ...old, metadata: { ...old.metadata, [key]: value } }));
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试。"); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => {
    if (composing.current) return;
    if (!draft.title.trim()) { setError("请填写棋谱名称。"); return; }
    void run(async () => {
      await onSave({ ...draft, title: draft.title.trim(), note: draft.note.trim() });
      onClose();
    });
  };
  const createFolder = () => {
    const name = newFolder?.trim();
    if (!name) { setError("请填写目录名称。"); return; }
    if (name.includes("/")) { setError("请输入单个子目录名称，不要包含 /。"); return; }
    const path = [draft.folderPath, name].filter(Boolean).join("/");
    if (folders.some((folder) => folder.path === path)) { setError("该目录已存在，请直接选择。"); return; }
    void run(async () => {
      await onCreateFolder(path);
      setDraft((old) => ({ ...old, folderPath: path }));
      setNewFolder(undefined);
    });
  };
  return <div className="confirm-backdrop manual-save-backdrop" style={{ height: viewport.height, top: viewport.top, bottom: "auto" }} onClick={close}>
    <section className="manual-save-dialog" style={{ maxHeight: Math.max(160, viewport.height - 36) }} role="dialog" aria-modal="true" aria-label="保存棋谱"
      onClick={(event) => event.stopPropagation()}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (!isImeEnter(event, composing.current) || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        if (newFolder !== undefined) createFolder(); else save();
      }}>
      <header><strong>保存棋谱</strong><button type="button" aria-label="关闭保存棋谱" disabled={busy} onClick={close}>×</button></header>
      <div className="manual-save-body">
        {error && <p className="manual-save-error" role="alert">{error}</p>}
        <fieldset disabled={busy || discard}>
          <label>棋谱名称<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>归属赛事<input value={draft.metadata.event} onChange={(event) => metadata("event", event.target.value)}/></label>
          <div className="manual-save-pair">
            <label>红方棋手<input value={draft.metadata.redPlayer} onChange={(event) => metadata("redPlayer", event.target.value)}/></label>
            <label>黑方棋手<input value={draft.metadata.blackPlayer} onChange={(event) => metadata("blackPlayer", event.target.value)}/></label>
          </div>
          <label>对局时间<input type="datetime-local" value={localDateTime(draft.metadata.playedAt)} onChange={(event) => metadata("playedAt", event.target.value ? new Date(event.target.value).toISOString() : "")}/></label>
          <div className="manual-save-pair">
            <label>棋谱类型<select value={draft.metadata.gameType} onChange={(event) => metadata("gameType", event.target.value as LocalManualMetadata["gameType"])}>
              <option value="full">全局</option><option value="middle">中残局</option><option value="endgame">残局</option>
            </select></label>
            <label>棋谱结果<select value={draft.metadata.result} onChange={(event) => metadata("result", event.target.value as LocalManualMetadata["result"])}>
              <option value="unknown">未知</option><option value="first-win">先胜</option><option value="first-loss">先负</option><option value="draw">先和</option><option value="multiple">多种结果</option>
            </select></label>
          </div>
          <small>“先”指初始局面的先行方（{game.startingFen.split(/\s+/)[1] === "b" ? "黑方" : "红方"}）。</small>
          <label>保存目录<select value={draft.folderPath} onChange={(event) => setDraft({ ...draft, folderPath: event.target.value })}>
            <option value="">未分类</option>
            {[...new Set([...folders.map((folder) => folder.path), ...(draft.folderPath ? [draft.folderPath] : [])])].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).map((path) =>
              <option key={path} value={path}>{path.split("/").map((part, index) => index ? " › " + part : part).join("")}</option>)}
          </select></label>
          <p className="manual-save-destination">保存到：{draft.folderPath || "未分类"}</p>
          {newFolder === undefined ? <button type="button" onClick={() => setNewFolder("")}>＋ 新建子目录</button> :
            <div className="manual-save-new-folder"><label>子目录名称<input value={newFolder} onChange={(event) => setNewFolder(event.target.value)}/></label>
              <button type="button" onClick={createFolder}>创建目录</button><button type="button" onClick={() => setNewFolder(undefined)}>取消新建</button></div>}
          <label>备注<textarea rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })}/></label>
        </fieldset>
      </div>
      <footer><button type="button" disabled={busy || discard} onClick={close}>取消</button><button type="button" className="primary" disabled={busy || discard} onClick={save}>{busy ? "保存中…" : "保存棋谱"}</button></footer>
      {discard && <div className="manual-save-discard" role="alertdialog" aria-label="放弃资料修改">
        <strong>是否放弃本次资料修改？</strong><p>已录入的着法、分支和注释会保留。</p>
        <div><button type="button" onClick={() => setDiscard(false)}>继续编辑</button><button type="button" onClick={onClose}>放弃修改</button></div>
      </div>}
    </section>
  </div>;
}

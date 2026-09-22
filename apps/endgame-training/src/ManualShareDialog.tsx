import { useEffect, useRef, useState } from "react";
import type { LocalManualGame } from "./types";
import { trainingCore } from "./wasm";

export type ShareFormat = "chinese" | "pgn" | "dhtmlxq";
const formats = [
  ["chinese", "中文棋谱", "发微信，方便直接阅读"],
  ["pgn", "PGN 棋谱", "导入其他棋软，作为棋谱文件交换"],
  ["dhtmlxq", "东萍 UBB（DhtmlXQ）", "粘贴到支持东萍棋盘的网站或论坛"],
] as const;
export function manualFileName(title: string) { return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || "棋谱") + ".pgn"; }
export function ManualShareDialog({ game, onClose }: { game: LocalManualGame; onClose: () => void }) {
  const [format, setFormat] = useState<ShareFormat>("chinese");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setText(""); setError(""); setNotice("");
    void trainingCore().then(core => core.exportLocalManual(JSON.stringify(game), format)).then(value => { if (active) setText(value); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [game, format, retry]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !lock.current) { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [onClose]);
  async function act(action: "copy" | "share" | "download") {
    if (lock.current || !text) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const file = new File([text], manualFileName(game.title), { type: "application/x-chess-pgn;charset=utf-8" });
      if (action === "copy") { await navigator.clipboard.writeText(text); setNotice("棋谱已复制"); }
      else if (action === "download") {
        const url = URL.createObjectURL(file); const a = document.createElement("a");
        a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000); setNotice("已发起 PGN 文件下载");
      } else if (!navigator.share) setNotice("系统分享不可用，请使用复制或下载。");
      else if (format === "pgn" && navigator.canShare?.({ files: [file] })) await navigator.share({ title: game.title, files: [file] });
      else await navigator.share({ title: game.title, text });
    } catch (e) { if (!(typeof e === "object" && e !== null && "name" in e && e.name === "AbortError")) setError(`操作失败：${String(e)}，请重试。`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="confirm-backdrop manual-share-backdrop" onMouseDown={() => { if (!lock.current) onClose(); }}>
    <section className="manual-share-dialog" role="dialog" aria-modal="true" aria-label="分享棋谱" onMouseDown={e => e.stopPropagation()}>
      <header><strong>分享棋谱</strong><button aria-label="关闭分享" disabled={busy} onClick={onClose}>×</button></header>
      <div className="manual-share-body">
        <label>分享格式<select aria-label="分享格式" value={format} disabled={busy} onChange={e => setFormat(e.target.value as ShareFormat)}>{formats.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <p>{formats.find(([id]) => id === format)?.[2]}</p>
        {format === "dhtmlxq" && <p className="manual-share-warning">当前仅导出主线，不包含分支和注释。</p>}
        <textarea aria-label="棋谱预览" readOnly value={text} placeholder={error ? "无法生成棋谱" : "正在生成棋谱…"}/>
        {error && <div role="alert">{error}{!text && <button onClick={() => setRetry(v => v+1)}>重新生成</button>}</div>}
      </div>
      {notice && <div role="status" className="manual-share-toast">{notice}</div>}
      <footer><button disabled={!text || busy} onClick={() => void act("copy")}>复制</button><button disabled={!text || busy} onClick={() => void act("share")}>系统分享</button>{format === "pgn" && <button disabled={!text || busy} onClick={() => void act("download")}>导出 .pgn 文件</button>}</footer>
    </section>
  </div>;
}

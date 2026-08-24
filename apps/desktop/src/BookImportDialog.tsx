import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, LoaderCircle, X } from "lucide-react";
import { chessPlatform, type BoardState, type BookImportDraft } from "./platform";

function moveTokens(text: string) {
  return [...text.matchAll(/[车車马馬炮砲兵卒相象仕士帅帥将將][前后後中一二三四五六七八九1-9１-９][进進退平][一二三四五六七八九1-9１-９]/g)].map((match) => match[0]);
}

export function BookImportDialog({ onClose, onImported }: { onClose(): void; onImported(next: Partial<BoardState>): void }) {
  const [draft, setDraft] = useState<BookImportDraft>();
  const [message, setMessage] = useState("选择书页照片后生成本地 OCR 初稿。");
  const [busy, setBusy] = useState(false);

  async function choose() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "书页图片", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (typeof path !== "string") return;
    setBusy(true);
    try {
      setDraft(await chessPlatform.recognizeBookPage(path));
      setMessage("OCR 初稿已生成。请逐项校对，确认棋谱前不要作为正式专题发布。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function validateAndSave() {
    if (!draft) return;
    const notation = moveTokens(draft.movesText);
    if (!notation.length) {
      setMessage("未找到完整中文着法，请将棋谱校对为“车八平五”格式。");
      return;
    }
    setBusy(true);
    try {
      await chessPlatform.parseChineseLine("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1", notation);
      const next = await chessPlatform.saveBookImport({
        imagePath: draft.imagePath, rawText: draft.rawText, title: draft.title,
        redPlayer: draft.redPlayer, blackPlayer: draft.blackPlayer,
        eventName: draft.eventName, movesText: draft.movesText,
      });
      onImported(next);
      setMessage(`已校验 ${notation.length} 个半回合并保存到本机棋谱库。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="book-topic-dialog book-import-dialog" role="dialog" aria-modal="true" aria-label="书页棋谱入库">
      <header><span><FileSearch size={18}/><strong>书页棋谱入库</strong></span><button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button></header>
      <div className="book-topic-body">
        <button className="primary" disabled={busy} onClick={() => void choose()}>{busy ? <LoaderCircle className="spin" size={15}/> : <FileSearch size={15}/>}选择书页并识别</button>
        {draft && <section className="book-topic-learning">
          <label>标题<input value={draft.title} placeholder="书页棋谱导入" onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>红方<input value={draft.redPlayer} onChange={(event) => setDraft({ ...draft, redPlayer: event.target.value })}/></label>
          <label>黑方<input value={draft.blackPlayer} onChange={(event) => setDraft({ ...draft, blackPlayer: event.target.value })}/></label>
          <label>赛事<input value={draft.eventName} onChange={(event) => setDraft({ ...draft, eventName: event.target.value })}/></label>
          <label>OCR 原文<textarea value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} rows={8}/></label>
          <label>棋谱候选<textarea value={draft.movesText} onChange={(event) => setDraft({ ...draft, movesText: event.target.value })} rows={5}/></label>
          <small>置信度 {Math.round(draft.confidence * 100)}%。{draft.warnings.join(" ")}</small>
          <button className="primary" disabled={busy} onClick={() => void validateAndSave()}>{busy ? <LoaderCircle className="spin" size={15}/> : null}校验并入库</button>
        </section>}
        <p className="flyknife-notice">{message}</p>
      </div>
    </section>
  </div>;
}

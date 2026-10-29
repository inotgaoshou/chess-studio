import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { branchAfter, clampPanel, movesToSave, sameMoves } from "../../../packages/variation-session";
import { Bookmark, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis, LoaderCircle, Minus, Pause, Play, Plus, X } from "lucide-react";
import "./variationBoard.css";

export type VariationSquare = { row: number; col: number };
export type VariationFrame = { fen: string; pieces: { row: number; col: number; color: string }[]; notation?: string };
export type VariationReceipt = { message: string; view?(): void | Promise<void> };
type Line<F> = { id: number; moves: string[]; frames: F[] };
export type VariationBoardProps<F extends VariationFrame> = {
  title: string;
  base: F;
  initialMoves: string[];
  mobile?: boolean;
  light?: boolean;
  validate(moves: string[]): Promise<F[]>;
  renderBoard(frame: F, controls: { flipped: boolean; selected?: VariationSquare; onSquare(square: VariationSquare): void; onMove(from: VariationSquare, to: VariationSquare): void }): ReactNode;
  onSave(moves: string[]): Promise<VariationReceipt>;
  onSaveCopy?(moves: string[]): Promise<VariationReceipt>;
  saveLabel?: string;
  onClose(): void;
};

/** This panel owns temporary positions only. All persistent writes are explicit callbacks. */
export function VariationBoard<F extends VariationFrame>(props: VariationBoardProps<F>) {
  const { base, initialMoves, mobile = false, light = false, onClose } = props;
  const [lines, setLines] = useState<Line<F>[]>([{ id: 0, moves: [], frames: [] }]);
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<VariationSquare>();
  const [flipped, setFlipped] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [floating, setFloating] = useState(mobile);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retrySave, setRetrySave] = useState<(() => Promise<void>) | undefined>(undefined);
  const [receipt, setReceipt] = useState<VariationReceipt>();
  const [saved, setSaved] = useState<string[]>([]);
  const [position, setPosition] = useState({ x: 12, y: 80 });
  const panel = useRef<HTMLElement>(null);
  const boardArea = useRef<HTMLDivElement>(null);
  const boardCanvas = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const viewportBounds = useRef<HTMLDivElement>(null);
  const constrainPosition = (x: number, y: number, width: number, height: number) => {
    const safe = viewportBounds.current?.getBoundingClientRect();
    if (!safe?.width || !safe.height) return clampPanel(x, y, width, height, window.innerWidth, window.innerHeight);
    return { x: Math.max(safe.left, Math.min(x, safe.right - width)), y: Math.max(safe.top, Math.min(y, safe.bottom - height)) };
  };
  const lock = useRef(false);
  const generation = useRef(0);
  const nextId = useRef(1);
  const callbacks = useRef(props); callbacks.current = props;
  const line = lines.find(item => item.id === active) ?? lines[0];
  const frame = cursor ? line.frames[cursor - 1] ?? base : base;
  const key = (moves: string[]) => JSON.stringify(moves);
  const sessionState = useRef({ lines, saved }); sessionState.current = { lines, saved };
  const dirty = lines.some(item => item.moves.length && !saved.includes(key(item.moves)));

  useEffect(() => {
    const request = ++generation.current;
    void callbacks.current.validate(initialMoves).then(frames => {
      if (request !== generation.current) return;
      if (frames.length !== initialMoves.length) throw new Error("候选线路校验不完整，请重新打开");
      setLines([{ id: 0, moves: [...initialMoves], frames }]); setBusy(false);
    }).catch(reason => { if (request === generation.current) { setError(String(reason instanceof Error ? reason.message : reason)); setBusy(false); } });
    return () => { generation.current++; };
  }, []);

  useEffect(() => {
    const area = boardArea.current, canvas = boardCanvas.current;
    if (!area || !canvas) return;
    // WKWebView can retain stale container-query lengths across device rotation.
    // Measure the available content box so both axes fit after every native resize.
    const fit = (width: number, height: number) => {
      canvas.style.width = `${Math.max(0, Math.min(480, width, height * 1120 / 1240))}px`;
    };
    const padding = getComputedStyle(area);
    fit(area.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight), area.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom));
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) fit(box.width, box.height);
    });
    observer?.observe(area);
    return () => observer?.disconnect();
  }, [collapsed]);

  useEffect(() => {
    if (!playing || collapsed || busy || saving) return;
    if (cursor >= line.moves.length) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setCursor(step => step + 1), 750);
    return () => clearTimeout(timer);
  }, [playing, cursor, line.moves.length, collapsed, busy, saving]);

  useEffect(() => {
    const constrain = () => {
      if (!panel.current) return;
      const rect = panel.current.getBoundingClientRect();
      setPosition(old => {
        const safe = viewportBounds.current?.getBoundingClientRect();
        const initial = mobile && !placed.current && safe?.width;
        placed.current = true;
        return constrainPosition(initial ? safe.right - rect.width : old.x, initial ? safe.bottom - rect.height : old.y, rect.width, rect.height);
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(constrain);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener("resize", constrain); window.visualViewport?.addEventListener("resize", constrain);
    constrain();
    return () => { observer?.disconnect(); window.removeEventListener("resize", constrain); window.visualViewport?.removeEventListener("resize", constrain); };
  }, [floating, expanded, collapsed]);

  const requestClose = () => { if (lock.current) return; setPlaying(false); if (dirty) setClosing(true); else onClose(); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || lock.current) return;
      // Metadata dialogs above the panel handle their own Escape key.
      if (document.querySelector(".manual-save-backdrop")) return;
      event.stopPropagation(); event.preventDefault();
      if (closing) setClosing(false); else requestClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  });

  async function move(from: VariationSquare, to: VariationSquare) {
    if (busy || lock.current) return;
    const square = (value: VariationSquare) => `${String.fromCharCode(97 + value.col)}${9 - value.row}`;
    const iccs = square(from) + square(to);
    setSelected(undefined); setPlaying(false);
    if (line.moves[cursor] === iccs) { setCursor(cursor + 1); return; }
    const moves = branchAfter(line.moves, cursor, iccs);
    const request = ++generation.current;
    lock.current = true; setBusy(true); setError("");
    try {
      const frames = await callbacks.current.validate(moves);
      if (request !== generation.current) return;
      if (frames.length !== moves.length) throw new Error("推演线路校验不完整");
      const existing = lines.find(item => sameMoves(item.moves, moves));
      const id = existing?.id ?? nextId.current++;
      const extendsManualLine = cursor === line.moves.length && (line.id !== 0 || initialMoves.length === 0);
      const targetId = existing?.id ?? (extendsManualLine ? line.id : id);
      if (!existing) setLines(items => extendsManualLine ? items.map(item => item.id === line.id ? { id: line.id, moves, frames } : item) : [...items, { id, moves, frames }]);
      setActive(targetId); setCursor(moves.length);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "这一步不符合棋规"); }
    finally { if (request === generation.current) { lock.current = false; setBusy(false); } }
  }

  function clickSquare(square: VariationSquare) {
    if (busy || lock.current) return;
    const piece = frame.pieces.find(item => item.row === square.row && item.col === square.col);
    const side = frame.fen.split(/\s+/)[1] === "b" ? "black" : "red";
    if (piece?.color === side) { setSelected(square); setPlaying(false); return; }
    if (selected) void move(selected, square);
  }

  async function save(partial = false, copy = false, closeAfter = false) {
    if (lock.current || busy) return;
    const moves = movesToSave(line.moves, partial ? cursor : undefined);
    if (!moves.length) return;
    const request = generation.current;
    lock.current = true; setSaving(true); setPlaying(false); setError(""); setRetrySave(undefined); setMore(false);
    try {
      const result = await (copy ? callbacks.current.onSaveCopy!(moves) : callbacks.current.onSave(moves));
      if (request !== generation.current) return;
      setReceipt(result); setSaved(items => [...new Set([...items, key(moves)])]);
      if (closeAfter) {
        const othersDirty = sessionState.current.lines.some(item => item.moves.length && key(item.moves) !== key(moves) && !sessionState.current.saved.includes(key(item.moves)));
        if (othersDirty) setError("当前线路已保存，其他临时线路尚未保存；可继续切换保存，或放弃后关闭。");
        else onClose();
      }
      setClosing(false);
    } catch (reason) { if (request === generation.current) { setError(reason instanceof Error ? reason.message : "保存失败，临时线路已保留，请重试"); setRetrySave(() => () => save(partial, copy, closeAfter)); } }
    finally { if (request === generation.current) { lock.current = false; setSaving(false); } }
  }

  const navigate = (step: number) => { if (lock.current || busy) return; setPlaying(false); setSelected(undefined); setCursor(Math.max(0, Math.min(line.moves.length, step))); };
  const style: CSSProperties = floating && !expanded ? { left: position.x, top: position.y } : {};
  return <aside ref={panel} className={`variation-board ${mobile ? "is-mobile mobile-study-pieces" : "is-desktop"} ${light ? "is-light" : ""} ${floating ? "is-floating" : "is-docked"} ${collapsed ? "is-collapsed" : ""} ${expanded ? "is-expanded" : ""}`} style={style} aria-label="小棋盘推演">
    <div ref={viewportBounds} className="variation-safe-bounds" aria-hidden="true"/>
    <header className="variation-board-header" onPointerDown={event => {
      if (!floating || expanded || (event.target as HTMLElement).closest("button,select")) return;
      const target = event.currentTarget; target.setPointerCapture(event.pointerId);
      const rect = panel.current!.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY };
      const update = (next: PointerEvent) => setPosition(constrainPosition(rect.left + next.clientX - start.x, rect.top + next.clientY - start.y, rect.width, rect.height));
      const stop = () => { target.removeEventListener("pointermove", update); target.removeEventListener("pointerup", stop); target.removeEventListener("pointercancel", stop); };
      target.addEventListener("pointermove", update); target.addEventListener("pointerup", stop); target.addEventListener("pointercancel", stop);
    }}>
      <strong>小棋盘</strong>
      <button type="button" className="variation-save" aria-label={saving ? "保存中" : props.saveLabel ? "复制后保存" : "保存分支"} title={`${props.saveLabel ?? "保存整条线路"} · 共 ${line.moves.length} 步`} disabled={busy || saving || !line.moves.length} onClick={() => void save()}>{saving ? <LoaderCircle className="variation-saving"/> : <Bookmark/>}<span>{saving ? "保存中" : props.saveLabel ? "复制后保存" : "保存分支"}</span></button>
      <nav><button type="button" aria-label="更多推演操作" aria-expanded={more} onClick={() => { setCollapsed(false); setMore(value => !value); }}><Ellipsis/></button><button type="button" aria-label={collapsed ? "展开小棋盘" : "收起小棋盘"} onClick={() => { setCollapsed(value => !value); setPlaying(false); setMore(false); }}>{collapsed ? <Plus/> : <Minus/>}</button><button type="button" aria-label="关闭小棋盘" disabled={saving} onClick={requestClose}><X/></button></nav>
    </header>
    {more && <section className="variation-more" aria-label="推演更多操作">
      <strong className="variation-source-title">{props.title}</strong>
      <p>当前线路共 {line.moves.length} 步，顶部保存将保留整条线路。</p>
      <div className="variation-more-actions">
        <button type="button" disabled={!cursor || busy || saving} onClick={() => void save(true)}>保存至当前步 · {cursor} 步</button>
        {props.onSaveCopy && <button type="button" disabled={!line.moves.length || busy || saving} onClick={() => void save(false, true)}>另存到我的棋谱</button>}
        <button type="button" onClick={() => { setFlipped(value => !value); setMore(false); }}>翻转棋盘</button>
        {!mobile && <button type="button" onClick={() => { setFloating(value => !value); setMore(false); }}>{floating ? "并排显示" : "悬浮显示"}</button>}
        <button type="button" onClick={() => { setExpanded(value => !value); setMore(false); }}>{expanded ? "恢复大小" : "展开查看"}</button>
      </div>
      {lines.length > 1 && <label className="variation-line-picker">临时线路<select aria-label="切换临时线路" value={active} disabled={busy || saving} onChange={event => { const id = Number(event.target.value); setActive(id); navigate(0); setReceipt(undefined); setMore(false); }}>
        {lines.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? "原线路" : `推演 ${index}`} · {item.moves.length} 步{saved.includes(key(item.moves)) ? " · 已保存" : ""}</option>)}
      </select></label>}
      <div className="variation-moves">{line.frames.map((item, index) => <button type="button" key={index} className={cursor === index + 1 ? "active" : ""} disabled={busy || saving} onClick={() => { navigate(index + 1); setMore(false); }}>{index + 1}. {item.notation ?? line.moves[index]}</button>)}</div>
      <small>点棋子再点目标位置可试走；点击保存才写入原棋谱。</small>
    </section>}
    {!collapsed && <>
      <div ref={boardArea} className="variation-board-content"><div ref={boardCanvas} className="variation-board-canvas">{props.renderBoard(frame, { flipped, selected, onSquare: clickSquare, onMove: (from, to) => void move(from, to) })}</div></div>
      <footer className="variation-board-footer">
        <p className="variation-board-progress">第 {cursor} 步 / 共 {line.moves.length} 步 <span>{frame.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方"}行棋</span></p>
        <input className="variation-progress-slider" aria-label="推演进度" type="range" min={0} max={line.moves.length} value={cursor} disabled={busy || saving} onChange={event => navigate(Number(event.target.value))}/>
        <nav className="variation-playback" aria-label="推演回放">
          <button type="button" aria-label="推演起点" disabled={!cursor || busy || saving} onClick={() => navigate(0)}><ChevronsLeft/></button>
          <button type="button" aria-label="推演上一步" disabled={!cursor || busy || saving} onClick={() => navigate(cursor - 1)}><ChevronLeft/></button>
          <button type="button" className="variation-play-toggle" aria-label={playing ? "暂停推演" : "播放推演"} disabled={!line.moves.length || busy || saving} onClick={() => { if (!playing && cursor === line.moves.length) setCursor(0); setPlaying(value => !value); }}>{playing ? <Pause/> : <Play/>}</button>
          <button type="button" aria-label="推演下一步" disabled={cursor === line.moves.length || busy || saving} onClick={() => navigate(cursor + 1)}><ChevronRight/></button>
          <button type="button" aria-label="推演终点" disabled={cursor === line.moves.length || busy || saving} onClick={() => navigate(line.moves.length)}><ChevronsRight/></button>
        </nav>
      </footer>
    </>}
    {busy && <p role="status">正在校验推演线路…</p>}
    {receipt && <p className="variation-receipt" role="status">{receipt.message}{receipt.view && <button type="button" onClick={() => { setPlaying(false); void Promise.resolve(receipt.view!()).catch(reason => setError(String(reason))); }}>查看已保存分支</button>}</p>}
    {error && <p className="variation-error" role="alert">{error}{retrySave && <button type="button" disabled={busy || saving || !line.moves.length} onClick={() => void retrySave()}>重试保存</button>}</p>}
    {closing && <section className="variation-close-confirm" role="alertdialog" aria-label="保留未保存推演"><p>还有未保存的临时线路。</p><button type="button" disabled={busy || saving || !line.moves.length} onClick={() => void save(false, false, true)}>保存当前线路</button><button type="button" disabled={saving} onClick={onClose}>放弃并关闭</button><button type="button" onClick={() => setClosing(false)}>继续研究</button></section>}
  </aside>;
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { boardAt, chineseLine } from "./wasm";
import type { BoardState, LocalManualGame } from "./types";

type Square = { row: number; col: number };
type Side = "red" | "black";

export function rehearsalChoices(game: LocalManualGame, path: string[]) {
  const choices = new Set<string>();
  for (const line of [game.moves, ...game.branches.map(branch => [...branch.parentPath, ...branch.moves])]) {
    if (path.length < line.length && path.every((move, index) => line[index] === move)) choices.add(line[path.length]);
  }
  return [...choices];
}

const key = (game: LocalManualGame) => `qixi-local-rehearsal:${game.id}`;
const sideToMove = (fen: string): Side => fen.split(/\s+/)[1] === "b" ? "black" : "red";
const encode = (square: Square) => `${String.fromCharCode(97 + square.col)}${9 - square.row}`;

export function LocalManualRehearsal({ game, initialFlipped = false, onClose, renderBoard }: {
  game: LocalManualGame;
  initialFlipped?: boolean;
  onClose(): void;
  renderBoard(state: BoardState, selected: Square | undefined, hint: string | undefined, flipped: boolean, onSquare: (square: Square) => void, onMove: (from: Square, to: Square) => void): ReactNode;
}) {
  const content = useMemo(() => JSON.stringify([game.startingFen, game.moves, game.branches.map(branch => [branch.parentPath, branch.moves])]), [game]);
  const [path, setPath] = useState<string[]>([]);
  const pathRef = useRef(path); pathRef.current = path;
  const [board, setBoard] = useState<BoardState>();
  const [side, setSide] = useState<Side>(initialFlipped ? "black" : "red");
  const [selected, setSelected] = useState<Square>();
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [hint, setHint] = useState<string>();
  const [notice, setNotice] = useState("请按原谱落子。");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    let saved: { content?: string; path?: string[]; side?: Side; hints?: number; mistakes?: number } = {};
    try { saved = JSON.parse(localStorage.getItem(key(game)) || "{}"); } catch { /* A damaged cache starts from the beginning. */ }
    const candidate = saved.content === content && Array.isArray(saved.path) ? saved.path : [];
    const restored: string[] = [];
    for (const move of candidate) {
      if (!rehearsalChoices(game, restored).includes(move)) break;
      restored.push(move);
    }
    setReady(false);
    void boardAt(game.startingFen, restored).then(state => {
      if (version !== generation.current) return;
      setPath(restored); setBoard(state);
      setSide(saved.content === content && (saved.side === "red" || saved.side === "black") ? saved.side : initialFlipped ? "black" : "red");
      setHints(saved.content === content ? Math.max(0, saved.hints || 0) : 0);
      setMistakes(saved.content === content ? Math.max(0, saved.mistakes || 0) : 0);
      setReady(true);
    }).catch(reason => { if (version === generation.current) setError(`无法恢复背谱局面：${String(reason)}`); });
    return () => { generation.current++; };
  }, [game, content, initialFlipped]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key(game), JSON.stringify({ content, path, side, hints, mistakes })); }
    catch { setNotice("本次进度暂未保存，仍可继续背谱。"); }
  }, [ready, content, game, path, side, hints, mistakes]);

  const choices = rehearsalChoices(game, path);
  const completed = ready && path.length > 0 && !choices.length;

  async function jump(next: string[]) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      const state = await boardAt(game.startingFen, next);
      if (version !== generation.current) return;
      setPath(next); setBoard(state); setReady(true); setSelected(undefined); setHint(undefined);
    } catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { lock.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!ready || busy || !board || completed || sideToMove(board.fen) === side || !choices.length) return;
    const reply = choices[0];
    const timer = window.setTimeout(() => {
      setNotice("对方已按原谱应手，请继续。");
      void jump([...path, reply]);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [ready, busy, board?.fen, side, path.join(","), content]);

  function attemptMove(from: Square, to: Square) {
    if (!board || !ready || busy || completed || sideToMove(board.fen) !== side) return;
    const move = encode(from) + encode(to);
    setSelected(undefined);
    if (!choices.includes(move)) {
      setMistakes(count => count + 1);
      setNotice("与原谱不符，局面已保留；可重试或查看提示。");
      return;
    }
    setNotice("正确，等待对方按原谱应手。");
    void jump([...path, move]);
  }

  function square(to: Square) {
    if (!board || !ready || busy || completed || sideToMove(board.fen) !== side) return;
    const piece = board.pieces.find(item => item.row === to.row && item.col === to.col);
    if (piece?.color === side) { setSelected(to); return; }
    if (selected) attemptMove(selected, to);
  }

  function revealHint() {
    const move = choices[0];
    if (!move) return;
    setHints(count => count + 1); setHint(move);
    const at = path.join(",");
    void chineseLine(game.startingFen, [...path, move]).then(notation => {
      if (pathRef.current.join(",") === at) setNotice(`原谱下一着：${notation.at(-1) ?? "请看棋盘标记"}。`);
    }).catch(() => setNotice("已在棋盘标出原谱下一着。"));
  }

  function restart(nextSide = side) {
    setSide(nextSide); setHints(0); setMistakes(0); setHint(undefined);
    setNotice("已从起点重新开始背谱。");
    void jump([]);
  }

  return <section className="local-manual-rehearsal" role="dialog" aria-modal="true" aria-label="背谱练习">
    <header><button type="button" onClick={onClose}>返回录谱</button><div><strong>{game.title}</strong><small>背谱练习 · 已走 {path.length} 步</small></div><button type="button" disabled={busy} onClick={() => restart()}>重新开始</button></header>
    <div className="rehearsal-side-picker" role="group" aria-label="背谱执棋方"><button type="button" aria-pressed={side === "red"} disabled={busy} onClick={() => restart("red")}>我执红</button><button type="button" aria-pressed={side === "black"} disabled={busy} onClick={() => restart("black")}>我执黑</button></div>
    <p className="rehearsal-progress">提示 {hints} 次 · 偏差 {mistakes} 次{choices.length > 1 ? ` · 此处有 ${choices.length} 种原谱走法` : ""}</p>
    {board ? renderBoard(board, selected, hint, side === "black", square, attemptMove) : <p role="status">正在载入背谱棋盘…</p>}
    <footer>{error && <p role="alert" className="manual-feature-error">{error}</p>}<p role="status">{completed ? "背谱完成！已复现这条完整线路。" : !choices.length ? "棋谱暂无可背走法。" : sideToMove(board?.fen ?? game.startingFen) !== side ? "对方正在按原谱应手…" : notice}</p><div><button type="button" disabled={!path.length || busy} onClick={() => void jump(path.slice(0, -1))}>退回一步</button><button type="button" disabled={!choices.length || busy || !board || sideToMove(board.fen) !== side} onClick={revealHint}>提示下一着</button></div></footer>
  </section>;
}

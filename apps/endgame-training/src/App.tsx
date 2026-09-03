import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileUp, Lightbulb, ListRestart, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { trainingStore } from "./store";
import type { Attempt, BoardPiece, SolutionMove, TrainingLibrary, TrainingProblem } from "./types";
import { acceptsMove, boardAt, chineseLine, parseCbl } from "./wasm";

type Mode = "solver" | "replay" | "free";
type Square = { row: number; col: number };
const modeLabel: Record<Mode, string> = { solver: "只走解题方", replay: "双方复现", free: "自由实战" };
const fmt = (value: number) => `${String(Math.floor(value / 60000)).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}`;
const squareName = (square: Square) => `${String.fromCharCode(97 + square.col)}${9 - square.row}`;
const iccsSquares = (move: string) => ({ from: { col: move.charCodeAt(0) - 97, row: 9 - Number(move[1]) }, to: { col: move.charCodeAt(2) - 97, row: 9 - Number(move[3]) } });
const mainline = (line: SolutionMove[]) => { const moves: string[] = []; let cursor = line[0]; while (cursor) { moves.push(cursor.iccs); cursor = cursor.children[0]; } return moves; };
const AUTO_REPLY_DELAY_MS = 650;

function renderNote(value: string) {
  return value.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, index) => {
    const match = /^\[b\]([\s\S]*)\[\/b\]$/i.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  });
}

function Board({ pieces, selected, lastMove, hintMove, onSquare }: { pieces: BoardPiece[]; selected?: Square; lastMove?: string; hintMove?: string; onSquare(square: Square): void }) {
  const hint = hintMove ? iccsSquares(hintMove).from : undefined;
  const last = lastMove ? iccsSquares(lastMove) : undefined;
  return <div className="board-shell"><div className="xiangqi-board" aria-label="残局棋盘">
    {Array.from({ length: 90 }, (_, index) => { const square = { row: Math.floor(index / 9), col: index % 9 }; const piece = pieces.find((item) => item.row === square.row && item.col === square.col); const isSelected = selected?.row === square.row && selected.col === square.col; const isLastFrom = last?.from.row === square.row && last.from.col === square.col; const isLastTo = last?.to.row === square.row && last.to.col === square.col; const highlighted = hint?.row === square.row && hint.col === square.col; return <button key={index} className={`board-square ${isSelected ? "selected" : ""} ${isLastFrom ? "last-from" : ""} ${isLastTo ? "last-to" : ""} ${highlighted ? "hint" : ""}`} onClick={() => onSquare(square)} aria-label={squareName(square)}>{piece && <span className={`piece ${piece.color}`}>{piece.label}</span>}</button>; })}
  </div></div>;
}

export function App() {
  const input = useRef<HTMLInputElement>(null);
  const [libraries, setLibraries] = useState<TrainingLibrary[]>([]);
  const [library, setLibrary] = useState<TrainingLibrary>();
  const [expanded, setExpanded] = useState<string>();
  const [problems, setProblems] = useState<TrainingProblem[]>([]);
  const [problem, setProblem] = useState<TrainingProblem>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [mode, setMode] = useState<Mode>("solver");
  const [line, setLine] = useState<SolutionMove[]>([]);
  const [moves, setMoves] = useState<string[]>([]);
  const [pieces, setPieces] = useState<BoardPiece[]>([]);
  const [selected, setSelected] = useState<Square>();
  const [lastMove, setLastMove] = useState<string>();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsedSaved, setElapsedSaved] = useState(0);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [, setTick] = useState(0);
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [notice, setNotice] = useState("请选择题目开始训练。");
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<string[]>([]);
  const [answerStep, setAnswerStep] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "library" | "problem"; id: string; title: string }>();
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [autoReplyPending, setAutoReplyPending] = useState(false);
  const session = useRef(0);
  const finishing = useRef(false);
  const elapsed = elapsedSaved + (startedAt ? Date.now() - startedAt : 0);
  const categories = useMemo(() => ["全部", ...new Set(problems.map((item) => item.category))], [problems]);
  const visible = useMemo(() => problems.filter((item) => (category === "全部" || item.category === category) && (!query || `${item.title}${item.category}`.includes(query))), [category, problems, query]);
  const currentIndex = problem ? visible.findIndex((item) => item.id === problem.id) : -1;
  const expected = useMemo(() => line.map((item) => item.iccs), [line]);

  async function refresh() { setLibraries(await trainingStore.libraries()); }
  async function selectLibrary(next: TrainingLibrary) { setLibrary(next); setExpanded(next.id); setProblems(await trainingStore.problems(next.id)); setProblem(undefined); setQuery(""); setCategory("全部"); }
  async function selectProblem(next: TrainingProblem) { session.current += 1; finishing.current = false; setProblem(next); setLine(next.solution); setMoves([]); setPieces((await boardAt(next.startingFen, [])).pieces); setSelected(undefined); setLastMove(undefined); setStartedAt(undefined); setElapsedSaved(0); setAttemptStarted(false); setEnded(false); setAutoReplyPending(false); setHints(0); setMistakes(0); setMode("solver"); setNotice("选中棋子后，再点目标点。第一步开始计时。"); setRevealed(false); setAnswer([]); setAnswerStep(0); setDemoPlaying(false); setShowHistory(false); setAttempts(await trainingStore.attempts(next.id)); setCatalogueOpen(false); }
  useEffect(() => { void refresh().then(async () => { const initial = (await trainingStore.libraries())[0]; if (initial) await selectLibrary(initial); }); }, []);
  useEffect(() => { if (!startedAt) return; const timer = window.setInterval(() => setTick((value) => value + 1), 250); return () => clearInterval(timer); }, [startedAt]);
  useEffect(() => { if (!demoPlaying || !problem || answerStep >= answer.length) return; const timer = window.setTimeout(() => { const next = answerStep + 1; setAnswerStep(next); void boardAt(problem.startingFen, mainline(problem.solution).slice(0, next)).then((state) => setPieces(state.pieces)); setLastMove(mainline(problem.solution)[next - 1]); if (next >= answer.length) setDemoPlaying(false); }, 750); return () => clearTimeout(timer); }, [answer, answerStep, demoPlaying, problem]);

  async function importFile(file?: File) {
    if (!file) return;
    try { const bytes = new Uint8Array(await file.arrayBuffer()); const parsed = await parseCbl(bytes); const imported = await trainingStore.importLibrary(bytes, parsed); await refresh(); await selectLibrary(imported); setNotice(parsed.warnings.length ? `导入完成，跳过 ${parsed.warnings.length} 条损坏记录。` : "题库导入完成，选择题目开始训练。"); }
    catch (error) { setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  async function renderBoard(nextMoves: string[], move?: string) { if (!problem) return; const state = await boardAt(problem.startingFen, nextMoves); setPieces(state.pieces); setMoves(nextMoves); setLastMove(move); }
  async function finish(outcome: Attempt["outcome"], duration = elapsed) { if (!problem || ended || finishing.current) return; finishing.current = true; setEnded(true); setAutoReplyPending(false); setElapsedSaved(duration); setStartedAt(undefined); await trainingStore.saveAttempt({ problemId: problem.id, mode, elapsedMs: duration, hintsUsed: hints, mistakes, outcome }); setAttempts(await trainingStore.attempts(problem.id)); const updated = (await trainingStore.problems(problem.libraryId)).find((item) => item.id === problem.id); if (updated) setProblem(updated); await refresh(); }
  async function move(to: Square) {
    if (!problem || revealed || ended || autoReplyPending) return;
    if (!selected) { if (pieces.some((piece) => piece.row === to.row && piece.col === to.col)) setSelected(to); return; }
    const iccs = `${squareName(selected)}${squareName(to)}`; setSelected(undefined);
    if (mode === "free") { if (!(await acceptsMove(problem.startingFen, moves, iccs))) { setMistakes((value) => value + 1); setNotice("该走法不合法，局面没有改变。"); return; } if (!startedAt) setStartedAt(Date.now()); setAttemptStarted(true); await renderBoard([...moves, iccs], iccs); setNotice("已走出合法着法，可继续自由实战。"); return; }
    const match = line.find((item) => item.iccs === iccs);
    if (!match) { setMistakes((value) => value + 1); setNotice("这步不在题解分支中，局面没有改变，可以继续尝试。"); return; }
    const moveStartedAt = startedAt ?? Date.now();
    const durationAfterMove = elapsedSaved + (startedAt ? moveStartedAt - startedAt : 0);
    if (!startedAt) setStartedAt(moveStartedAt);
    setAttemptStarted(true);
    const nextMoves = [...moves, iccs];
    const nextLine = match.children;
    await renderBoard(nextMoves, iccs);
    if (mode !== "solver" || !nextLine.length) {
      setLine(nextLine);
      setNotice("正确，继续完成题解。");
      if (!nextLine.length) await finish("completed", durationAfterMove);
      return;
    }
    const reply = nextLine[0];
    const currentSession = session.current;
    setLine(nextLine);
    setAutoReplyPending(true);
    setNotice("正确，正在显示对方应手…");
    window.setTimeout(() => {
      if (currentSession !== session.current || finishing.current) return;
      void (async () => {
        const replyMoves = [...nextMoves, reply.iccs];
        await renderBoard(replyMoves, reply.iccs);
        if (currentSession !== session.current || finishing.current) return;
        setLine(reply.children);
        const notation = (await chineseLine(problem.startingFen, replyMoves).catch(() => [reply.iccs])).at(-1) ?? reply.iccs;
        setNotice(`正确，对方应手已自动走出：${notation}。`);
        setAutoReplyPending(false);
        if (!reply.children.length) await finish("completed", durationAfterMove + Date.now() - moveStartedAt);
      })();
    }, AUTO_REPLY_DELAY_MS);
  }
  async function reveal() { if (!problem || ended) return; const notation = await chineseLine(problem.startingFen, mainline(problem.solution)); await finish("revealed"); setAnswer(notation); setRevealed(true); setPieces((await boardAt(problem.startingFen, [])).pieces); setMoves([]); setLastMove(undefined); setAnswerStep(0); setDemoPlaying(false); setNotice("答案已显示，可按回合演示。"); }
  async function restart() { if (!problem) return; if (!ended && (attemptStarted || mistakes || hints)) await finish("abandoned"); await selectProblem(problem); }
  function pause() { if (ended) return; if (startedAt) { setElapsedSaved(elapsed); setStartedAt(undefined); setNotice("已暂停，暂停时间不会计入用时。"); } else if (elapsedSaved) { setStartedAt(Date.now()); setNotice("继续作答。"); } }
  async function confirmDelete() { const target = deleteTarget; if (!target) return; setDeleteTarget(undefined); if (target.type === "library") { await trainingStore.deleteLibrary(target.id); const next = await trainingStore.libraries(); setLibraries(next); if (next[0]) await selectLibrary(next[0]); else { setLibrary(undefined); setProblems([]); setProblem(undefined); } } else { await trainingStore.hideProblem(target.id); if (library) await selectLibrary(library); } }
  const giveHint = async () => { if (!problem || ended) return; const next = Math.min(3, hints + 1); setHints(next); const lead = line[0]?.iccs; if (next === 1) setNotice(problem.note || "先寻找将军、吃子和强制着。"); else if (!lead) setNotice("题解已完成。"); else if (next === 2) setNotice("提示：棋盘上已标出当前应走棋子。"); else { const notation = (await chineseLine(problem.startingFen, [...moves, lead])).at(-1) ?? lead; setNotice(`首着：${notation}`); } };

  return <div className="training-app"><header className="app-header"><span><BookOpen/><strong>残局训练</strong><small>{library?.title ?? "本地 CBL 题库"}</small></span><div><button className="mobile-drawer-toggle" onClick={() => { setCatalogueOpen(true); setControlsOpen(false); }}><BookOpen/>题库</button><button onClick={() => input.current?.click()}><FileUp/>导入 CBL</button><button className="mobile-drawer-toggle" onClick={() => { setControlsOpen(true); setCatalogueOpen(false); }}><Clock3/>控制</button></div><input ref={input} type="file" accept=".cbl,application/octet-stream" onChange={(event) => void importFile(event.target.files?.[0])}/></header><div className="training-layout">
    <aside className={`catalogue ${catalogueOpen ? "drawer-open" : ""}`}><header><strong>题库目录</strong><small>{libraries.length} 本本地题库</small></header><div className="library-list">{libraries.map((item) => <section key={item.id}><button className={`library-row ${expanded === item.id ? "expanded" : ""}`} onClick={() => expanded === item.id ? setExpanded(undefined) : void selectLibrary(item)}><BookOpen/><span><b>{item.title}</b><small>{item.completedCount}/{item.problemCount} 已完成</small></span>{expanded === item.id ? <ChevronDown/> : <ChevronRight/>}</button>{expanded === item.id && <div className="problem-area"><div className="filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题名"/><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></div>{visible.map((item) => <button key={item.id} className={`problem-row ${problem?.id === item.id ? "active" : ""}`} onClick={() => void selectProblem(item)}><b>{item.sourceIndex + 1}</b><span>{item.title}<small>{item.category} · {item.completedAttempts ? `累计 ${fmt(item.totalElapsedMs)}` : "未练"}</small></span></button>)}</div>}</section>)}</div></aside>
    <main className="training-stage">{problem ? <><header className="problem-heading"><small>第 {problem.sourceIndex + 1}/{problems.length} 题</small><strong>{problem.title}</strong><button title="移除当前残局" onClick={() => setDeleteTarget({ type: "problem", id: problem.id, title: problem.title })}><Trash2/></button></header><Board pieces={pieces} selected={selected} lastMove={lastMove} hintMove={hints >= 2 ? line[0]?.iccs : undefined} onSquare={(square) => void move(square)}/><p className="board-tip">选棋子，再点目标点。错误走法不会改变局面。</p></> : <div className="empty"><BookOpen/><strong>导入并选择一道残局</strong><span>题库和练习记录仅保存在这台平板。</span></div>}</main>
    <aside className={`controls ${controlsOpen ? "drawer-open" : ""}`}>{problem ? <><section className="clock"><Clock3/><small>本题用时</small><strong>{fmt(elapsed)}</strong><span>累计用时 {fmt(problem.totalElapsedMs)}</span><button onClick={() => { setShowHistory((value) => !value); void trainingStore.attempts(problem.id).then(setAttempts); }}>记录</button></section><section className="modes">{(["solver", "replay", "free"] as Mode[]).map((value) => <label key={value}><input type="radio" checked={mode === value} disabled={attemptStarted || ended} onChange={() => setMode(value)}/>{modeLabel[value]}{value === "replay" && "（按题解）"}</label>)}</section><section className="actions"><button className="primary" disabled={ended} onClick={() => void giveHint()}><Lightbulb/>提示 {hints}/3</button><button disabled={ended || (!startedAt && !elapsedSaved)} onClick={pause}>{startedAt ? <Pause/> : <Play/>}{startedAt ? "暂停" : "继续"}</button><button onClick={() => void restart()}><RotateCcw/>重来</button>{mode === "free" ? <button disabled={ended} onClick={() => void finish("free_finished")}>结束实战</button> : <button disabled={ended} onClick={() => void reveal()}><ListRestart/>看答案</button>}</section><section className="notice"><b>错误 {mistakes} 次</b><p>{renderNote(notice)}</p></section>{showHistory ? <section className="history"><b>答题记录</b>{attempts.length ? attempts.slice(0, 30).map((item) => <p key={item.id}><strong>{item.outcome === "completed" ? "解出" : item.outcome === "revealed" ? "看答案" : item.outcome === "free_finished" ? "实战结束" : "已放弃"}</strong><span>{modeLabel[item.mode]} · {fmt(item.elapsedMs)} · 错 {item.mistakes} · 提示 {item.hintsUsed}</span></p>) : <p>还没有答题记录</p>}</section> : revealed && <section className="answer"><header><b>题解回合</b><small>{answerStep}/{answer.length} 手</small></header>{Array.from({ length: Math.ceil(answer.length / 2) }, (_, index) => <p key={index}><b>第 {index + 1} 回合</b><span>红方 {answer[index * 2]}{answer[index * 2 + 1] ? ` · 黑方 ${answer[index * 2 + 1]}` : ""}</span></p>)}<footer><button disabled={answerStep >= answer.length} onClick={() => setDemoPlaying((value) => !value)}>{demoPlaying ? <Pause/> : <Play/>}{demoPlaying ? "暂停演示" : "演示答案"}</button><button onClick={() => { setAnswerStep(0); setDemoPlaying(false); void boardAt(problem.startingFen, []).then((state) => setPieces(state.pieces)); }}><RotateCcw/>从头</button></footer></section>}<footer className="navigate"><button disabled={currentIndex <= 0} onClick={() => void selectProblem(visible[currentIndex - 1])}><ChevronLeft/></button><button disabled={currentIndex >= visible.length - 1} onClick={() => void selectProblem(visible[currentIndex + 1])}><ChevronRight/></button></footer></> : <p>从目录选择题目。</p>}</aside>
  </div>{(catalogueOpen || controlsOpen) && <button className="drawer-backdrop" aria-label="关闭抽屉" onClick={() => { setCatalogueOpen(false); setControlsOpen(false); }}/>} {library && <button className="delete-library" title="删除当前题库" onClick={() => setDeleteTarget({ type: "library", id: library.id, title: library.title })}><Trash2/></button>}{deleteTarget && <div className="confirm-backdrop" onMouseDown={() => setDeleteTarget(undefined)}><section onMouseDown={(event) => event.stopPropagation()}><strong>确认删除</strong><p>{deleteTarget.type === "library" ? `删除题库《${deleteTarget.title}》及该应用内的答题记录？` : `从训练目录移除《${deleteTarget.title}》？答题记录会保留。`}</p><footer><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></footer></section></div>}</div>;
}

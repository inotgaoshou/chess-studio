import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, History, Lightbulb, ListRestart, Pause, Play, RotateCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardIntersectionStyle } from "./boardGeometry";
import { chessPlatform, type Piece } from "./platform";
import type { EndgameAttemptDto, EndgameLibraryDto, EndgameProblemDto } from "./platform/types";

type SolutionMove = { iccs: string; comment: string; children: SolutionMove[] };
type Square = { row: number; col: number };
const boardAsset = "/skins/qingxin-zhuyun/board.png";
const localSampleCblPath = "/Users/chenyubin/Documents/chess/残棋棋谱/中国象棋实用残局增订本-陈松顺.CBL";
const labels: Record<string, string> = { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵", k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒" };
const kind: Record<string, string> = { K: "k", A: "a", B: "b", N: "n", R: "r", C: "c", P: "p", k: "k", a: "a", b: "b", n: "n", r: "r", c: "c", p: "p" };
const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const sq = (value: Square) => `${String.fromCharCode(97 + value.col)}${9 - value.row}`;
const attemptModeLabel: Record<string, string> = { solver: "只走解题方", replay: "双方复现", free: "自由实战" };
const attemptOutcomeLabel: Record<string, string> = { completed: "解出", revealed: "已看答案", abandoned: "已放弃", free_finished: "自由对局结束" };

function readFen(fen: string): Piece[] {
  const result: Piece[] = [];
  fen.split(" ")[0].split("/").forEach((rank, row) => {
    let col = 0;
    for (const value of rank) {
      if (/\d/.test(value)) col += Number(value);
      else { result.push({ row, col, color: value === value.toUpperCase() ? "red" : "black", kind: kind[value], label: labels[value] }); col++; }
    }
  });
  return result;
}

function apply(pieces: Piece[], iccs: string) {
  const from = { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) };
  const to = { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) };
  const mover = pieces.find((piece) => piece.row === from.row && piece.col === from.col);
  return mover ? [...pieces.filter((piece) => !(piece.row === from.row && piece.col === from.col) && !(piece.row === to.row && piece.col === to.col)), { ...mover, ...to }] : pieces;
}

function mainline(moves: SolutionMove[]) {
  const result: string[] = [];
  let current = moves[0];
  while (current) { result.push(current.iccs); current = current.children[0]; }
  return result;
}

function moveSquares(iccs: string) {
  return {
    from: { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) },
    to: { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) },
  };
}

function answerRounds(startingFen: string, notation: string[]) {
  const startsWithRed = startingFen.split(/\s+/)[1] !== "b";
  return Array.from({ length: Math.ceil(notation.length / 2) }, (_, index) => {
    const firstSide = (startsWithRed ? "红" : "黑") + "方";
    const secondSide = (startsWithRed ? "黑" : "红") + "方";
    return {
      round: index + 1,
      first: `${firstSide} ${notation[index * 2]}`,
      second: notation[index * 2 + 1] ? `${secondSide} ${notation[index * 2 + 1]}` : undefined,
    };
  });
}

function renderCblText(value: string) {
  return value.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, index) => {
    const match = part.match(/^\[b\]([\s\S]*?)\[\/b\]$/i);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  });
}

export function EndgameTrainingDialog({ onClose }: { onClose(): void }) {
  const [libraries, setLibraries] = useState<EndgameLibraryDto[]>([]);
  const [library, setLibrary] = useState<EndgameLibraryDto>();
  const [expandedLibraryId, setExpandedLibraryId] = useState<string>();
  const [problems, setProblems] = useState<EndgameProblemDto[]>([]);
  const [problem, setProblem] = useState<EndgameProblemDto>();
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"solver" | "replay" | "free">("solver");
  const [line, setLine] = useState<SolutionMove[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [selected, setSelected] = useState<Square>();
  const [last, setLast] = useState<{ from: Square; to: Square }>();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsedBeforePause, setElapsedBeforePause] = useState(0);
  const [, setClock] = useState(0);
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [hasAdvanced, setHasAdvanced] = useState(false);
  const [notice, setNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [answerNotation, setAnswerNotation] = useState<string[]>([]);
  const [answerStep, setAnswerStep] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [freeMoves, setFreeMoves] = useState<string[]>([]);
  const [freeMovePending, setFreeMovePending] = useState(false);
  const [attempts, setAttempts] = useState<EndgameAttemptDto[]>([]);
  const [showAttempts, setShowAttempts] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "library" | "problem";
    id: string;
    libraryId?: string;
    title: string;
  }>();
  const sampleImportAttempted = useRef(false);
  const elapsed = elapsedBeforePause + (startedAt ? Date.now() - startedAt : 0);
  const categories = useMemo(() => ["全部", ...Array.from(new Set(problems.map((item) => item.category))).sort()], [problems]);
  const visibleProblems = useMemo(() => problems.filter((item) => (category === "全部" || item.category === category) && (!query.trim() || `${item.title} ${item.category}`.includes(query.trim()))), [category, problems, query]);
  const index = problem ? visibleProblems.findIndex((item) => item.id === problem.id) : -1;
  const expected = useMemo(() => line.map((move) => move.iccs), [line]);
  const answerMoves = useMemo(() => problem ? mainline(JSON.parse(problem.solutionJson)) : [], [problem]);
  const answerLines = answerNotation.length ? answerNotation : answerMoves;
  const rounds = useMemo(() => problem ? answerRounds(problem.startingFen, answerLines) : [], [answerLines, problem]);
  const demoComplete = answerMoves.length > 0 && answerStep >= answerMoves.length;
  const demoSummary = useMemo(() => {
    if (!problem || !demoComplete) return "";
    if (problem.note.trim()) return problem.note.trim();
    const firstRound = rounds[0];
    return `题解共 ${rounds.length} 回合，先从 ${firstRound?.first ?? "首着"} 开始，再按双方应手完成。`;
  }, [demoComplete, problem, rounds]);
  const refresh = async (openFirst = false) => {
    const nextLibraries = await chessPlatform.listEndgameLibraries();
    setLibraries(nextLibraries);
    if (openFirst && nextLibraries.length) await selectLibrary(nextLibraries[0]);
  };
  const loadAttempts = async (problemId: string) => setAttempts(await chessPlatform.listEndgameAttempts(problemId));

  useEffect(() => {
    void (async () => {
      let refreshWarning = "";
      try {
        const refreshed = await chessPlatform.refreshEndgameLibraries();
        refreshWarning = refreshed.warnings.join("；");
      } catch (error) {
        refreshWarning = `题库刷新失败：${error instanceof Error ? error.message : String(error)}`;
      }
      const existing = await chessPlatform.listEndgameLibraries();
      setLibraries(existing);
      if (existing.length) {
        await selectLibrary(existing[0]);
        if (refreshWarning) setNotice(refreshWarning);
        return;
      }
      if (sampleImportAttempted.current) return;
      sampleImportAttempted.current = true;
      try {
        const result = await chessPlatform.importEndgameCblFromPath(localSampleCblPath);
        await refresh();
        await selectLibrary(result.library);
        setNotice("已自动导入《中国象棋实用残局增订本》。");
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setClock((value) => value + 1), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  useEffect(() => {
    if (!demoPlaying || !problem || !revealed) return;
    const id = window.setInterval(() => {
      setAnswerStep((current) => {
        const next = current + 1;
        if (next >= answerMoves.length) setDemoPlaying(false);
        const displayedMoves = answerMoves.slice(0, Math.min(next, answerMoves.length));
        setPieces(displayedMoves.reduce((position, move) => apply(position, move), readFen(problem.startingFen)));
        const lastMove = displayedMoves.at(-1);
        setLast(lastMove ? moveSquares(lastMove) : undefined);
        return Math.min(next, answerMoves.length);
      });
    }, 750);
    return () => clearInterval(id);
  }, [answerMoves, demoPlaying, problem, revealed]);

  async function selectLibrary(item: EndgameLibraryDto) {
    setLibrary(item);
    setExpandedLibraryId(item.id);
    setProblems(await chessPlatform.listEndgameProblems(item.id));
    setProblem(undefined);
    setAttempts([]);
    setShowAttempts(false);
    setCategory("全部");
    setQuery("");
  }

  function toggleLibrary(item: EndgameLibraryDto) {
    if (expandedLibraryId === item.id) {
      setExpandedLibraryId(undefined);
      return;
    }
    void selectLibrary(item);
  }

  function start(item: EndgameProblemDto) {
    setProblem(item); setLine(JSON.parse(item.solutionJson)); setPieces(readFen(item.startingFen)); setSelected(undefined); setLast(undefined);
    setStartedAt(undefined); setElapsedBeforePause(0); setClock(0); setHints(0); setMistakes(0); setHasAdvanced(false); setNotice("选中棋子后再点目标点。第一步开始计时。"); setRevealed(false); setAnswerNotation([]); setAnswerStep(0); setDemoPlaying(false); setFreeMoves([]); setFreeMovePending(false); setShowAttempts(false); void loadAttempts(item.id);
  }

  function stopClock() {
    const duration = elapsed;
    setElapsedBeforePause(duration);
    setStartedAt(undefined);
    return duration;
  }

  async function finish(outcome: "completed" | "revealed" | "abandoned" | "free_finished", duration = elapsed) {
    if (!problem) return;
    setElapsedBeforePause(duration);
    setStartedAt(undefined);
    await chessPlatform.saveEndgameAttempt({ problemId: problem.id, mode, elapsedMs: duration, hintsUsed: hints, mistakes, outcome });
    setRevealed(outcome === "revealed");
    void loadAttempts(problem.id);
    void refresh();
  }

  async function importCbl() {
    setImportError("");
    try {
      const result = await chessPlatform.importEndgameCbl();
      if (!result) return;
      await refresh();
      await selectLibrary(result.library);
      setNotice(result.warnings.length ? `导入完成，跳过 ${result.warnings.length} 条损坏记录。` : "题库导入完成，选择题目开始练习。");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeLibrary(libraryId: string) {
    await chessPlatform.deleteEndgameLibrary(libraryId);
    const remaining = await chessPlatform.listEndgameLibraries();
    setLibraries(remaining);
    if (remaining.length) await selectLibrary(remaining[0]);
    else { setLibrary(undefined); setProblems([]); setProblem(undefined); }
  }

  async function removeProblem(problemId: string, libraryId: string) {
    await chessPlatform.deleteEndgameProblem(problemId);
    const updatedLibraries = await chessPlatform.listEndgameLibraries();
    setLibraries(updatedLibraries);
    const updated = updatedLibraries.find((item) => item.id === libraryId);
    if (updated) await selectLibrary(updated);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(undefined);
    try {
      if (target.kind === "library") {
        await removeLibrary(target.id);
        setNotice(`已删除题库《${target.title}》。`);
      } else if (target.libraryId) {
        await removeProblem(target.id, target.libraryId);
        setNotice(`已从训练目录移除《${target.title}》，历史记录已保留。`);
      }
    } catch (error) {
      setNotice(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function revealAnswer() {
    if (!problem) return;
    const moves = answerMoves;
    await finish("revealed");
    setPieces(readFen(problem.startingFen));
    setLast(undefined);
    setSelected(undefined);
    setAnswerStep(0);
    setDemoPlaying(false);
    try {
      setAnswerNotation(await chessPlatform.endgameChineseMainline(problem.startingFen, moves));
    } catch {
      // A damaged legacy record can still show its stored coordinate notation.
      setAnswerNotation(moves);
    }
  }

  function restartAnswerDemo() {
    if (!problem) return;
    setPieces(readFen(problem.startingFen));
    setLast(undefined);
    setSelected(undefined);
    setAnswerStep(0);
    setDemoPlaying(false);
  }

  async function playFreeMove(iccs: string, from: Square, to: Square, duration: number) {
    if (!problem || freeMovePending) return;
    setFreeMovePending(true);
    try {
      const result = await chessPlatform.endgameFreePracticeMove(problem.startingFen, freeMoves, iccs);
      setPieces(readFen(result.fen));
      setFreeMoves((moves) => [...moves, iccs]);
      setLast({ from, to });
      setHasAdvanced(true);
      if (!startedAt) setStartedAt(Date.now());
      setNotice(`自由实战：${result.notation}${result.terminal ? "。对局结束，已保存本次自由练习。" : "。"}`);
      if (result.terminal) void finish("free_finished", duration);
    } catch {
      setMistakes((value) => value + 1);
      setNotice("这步不符合中国象棋规则，局面没有改变。");
    } finally {
      setFreeMovePending(false);
    }
  }

  function click(square: Square) {
    if (!problem || revealed || freeMovePending || (!startedAt && elapsedBeforePause > 0)) return;
    const own = pieces.find((piece) => piece.row === square.row && piece.col === square.col);
    if (!selected) { if (own) setSelected(square); return; }
    if (own) { setSelected(square); return; }
    const moveStartedAt = Date.now();
    const durationAfterMove = elapsedBeforePause + (startedAt ? moveStartedAt - startedAt : 0);
    const iccs = `${sq(selected)}${sq(square)}`;
    if (mode === "free") {
      setSelected(undefined);
      void playFreeMove(iccs, selected, square, durationAfterMove);
      return;
    }
    if (!startedAt) setStartedAt(moveStartedAt);
    const answer = line.find((move) => move.iccs === iccs);
    setSelected(undefined);
    if (!answer) { setMistakes((value) => value + 1); setNotice("这步不在题解分支中，局面没有改变，可以继续尝试。"); return; }
    setHasAdvanced(true);
    let nextPieces = apply(pieces, iccs);
    let nextLine = answer.children;
    setLast({ from: selected, to: square });
    if (mode === "solver" && nextLine.length) {
      const reply = nextLine[0]; nextPieces = apply(nextPieces, reply.iccs); nextLine = reply.children;
      setNotice(`正确，对方应手已自动走出：${reply.iccs}。`);
    } else setNotice("正确，继续完成题解。");
    setPieces(nextPieces); setLine(nextLine);
    if (!nextLine.length) void finish("completed", durationAfterMove);
  }

  function togglePause() {
    if (startedAt) { stopClock(); setNotice("已暂停，暂停时间不会计入本题用时。"); }
    else if (elapsedBeforePause > 0 && !revealed) { setStartedAt(Date.now()); setNotice("继续作答。"); }
  }
  function restart() { if (problem && (startedAt || elapsedBeforePause || hints || mistakes)) void finish("abandoned"); if (problem) start(problem); }
  const next = (offset: number) => { const item = visibleProblems[index + offset]; if (item) start(item); };

  return <div className="modal-backdrop endgame-backdrop"><section className="endgame-training-dialog" role="dialog" aria-modal="true" aria-label="残局训练工作台">
    <header className="endgame-topbar"><span><Sparkles size={18}/><strong>残局训练</strong><small>{library?.title ?? "本地题库"}</small></span><div className="endgame-topbar-actions">{library && <button title="删除当前题库" onClick={() => setDeleteTarget({ kind: "library", id: library.id, title: library.title })}><Trash2 size={16}/></button>}<button title="关闭" onClick={onClose}><X size={19}/></button></div></header>
    {!library ? <div className="endgame-empty"><BookOpen size={32}/><strong>导入本地残局题库</strong><span>选择 CBL 文件后即可按题号练习。</span><button className="primary" onClick={() => void importCbl()}>导入 CBL</button>{importError && <p className="endgame-import-error">导入失败：{importError}</p>}{libraries.map((item) => <button key={item.id} onClick={() => void selectLibrary(item)}>{item.title} · {item.completedCount}/{item.problemCount}</button>)}</div> : <div className="endgame-training-layout">
      <aside className="endgame-library-rail"><header><strong>题库目录</strong><small>共 {libraries.length} 本本地题库</small></header><button className="endgame-import" onClick={() => void importCbl()}>新增 CBL 题库</button><div className="endgame-library-tree">{libraries.map((item) => { const expanded = item.id === expandedLibraryId; return <section className={`endgame-library-group ${expanded ? "expanded" : ""}`} key={item.id}><button className={`endgame-library-parent ${expanded ? "active" : ""}`} aria-expanded={expanded} onClick={() => toggleLibrary(item)}><BookOpen size={15}/><span><strong>{item.title}</strong><small>{item.completedCount}/{item.problemCount} 已完成</small></span>{expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button>{expanded && <div className="endgame-library-children"><div className="endgame-filters"><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题名"/></label><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((categoryItem) => <option key={categoryItem}>{categoryItem}</option>)}</select></div><div className="endgame-problem-list">{visibleProblems.map((problemItem) => <button className={problemItem.id === problem?.id ? "active" : ""} key={problemItem.id} onClick={() => start(problemItem)}><b>{problemItem.sourceIndex + 1}</b><span><strong>{problemItem.title}</strong><small>{problemItem.category} · {problemItem.completedAttempts ? `累计 ${fmt(problemItem.totalElapsedMs)}` : "未练"}</small></span></button>)}{visibleProblems.length === 0 && <p className="endgame-no-problems">没有匹配题目</p>}</div></div>}</section>; })}</div>{importError && <p className="endgame-import-error">导入失败：{importError}</p>}</aside>
      <main className="endgame-board-stage">{!problem ? <div className="endgame-empty"><BookOpen size={28}/><strong>选择一道残局</strong><span>从左侧题号开始，完成进度会自动保存。</span></div> : <><header className="endgame-problem-heading"><span>第 {problem.sourceIndex + 1}/{problems.length} 题</span><strong>{problem.title}</strong><small>{problem.category}</small><button className="endgame-problem-delete" title="从训练目录移除当前残局" onClick={() => setDeleteTarget({ kind: "problem", id: problem.id, libraryId: problem.libraryId, title: problem.title })}><Trash2 size={15}/></button></header><div className="endgame-board-wrap"><LinkMiniBoard presentation="preview" markerStyle="corner" animateMoves={false} boardAriaLabel="残局训练棋盘" pieces={pieces} arrows={[]} selectedSquare={selected} lastMove={last ? { ...last, movedBy: "红方" } : undefined} pieceAsset={(piece) => `/skins/qingxin-zhuyun/${piece.color === "red" ? "r" : "b"}${piece.kind}.png`} boardAsset={boardAsset}/><div className="endgame-hit-grid">{Array.from({ length: 90 }, (_, squareIndex) => { const square = { row: Math.floor(squareIndex / 9), col: squareIndex % 9 }; return <button key={squareIndex} aria-label={sq(square)} style={boardIntersectionStyle(square, false, "qingxin-zhuyun")} onClick={() => click(square)}/>; })}</div></div><p className="endgame-board-tip">{mode === "free" ? "自由实战：双方轮流走任意合法着法。" : "选棋子，再点目标点。错误走法不会改变局面。"}</p></>}</main>
      <aside className="endgame-control-rail">{problem ? <><section className="endgame-clock"><span>本题用时</span><strong>{fmt(elapsed)}</strong><small>累计用时 {fmt(problem.totalElapsedMs)}</small><button className="endgame-attempts-trigger" onClick={() => { setShowAttempts((value) => !value); void loadAttempts(problem.id); }}><History size={13}/>记录</button></section><section className="endgame-mode"><label title="只输入解题方着法，系统自动走题解中的对方应手"><input type="radio" checked={mode === "solver"} disabled={hasAdvanced || revealed} onChange={() => setMode("solver")}/>只走解题方</label><label title="红黑双方都必须按题解逐手复现"><input type="radio" checked={mode === "replay"} disabled={hasAdvanced || revealed} onChange={() => setMode("replay")}/>双方复现（按题解）</label><label title="双方轮流走任意合法着法，不校验是否进入题解分支"><input type="radio" checked={mode === "free"} disabled={hasAdvanced || revealed} onChange={() => setMode("free")}/>自由实战</label></section><section className="endgame-actions"><button className="endgame-hint" onClick={() => { const value = Math.min(3, hints + 1); setHints(value); setNotice(value === 1 ? (problem.note || "先寻找将军、吃子和强制着。") : value === 2 ? "提示：请关注题解首着的起点。" : `首着：${expected[0] ?? "题解结束"}`); }}><Lightbulb size={16}/>提示 {hints}/3</button><button disabled={!startedAt && elapsedBeforePause === 0} onClick={togglePause}>{startedAt ? <Pause size={16}/> : <Play size={16}/>}{startedAt ? "暂停" : "继续"}</button><button onClick={restart}><RotateCcw size={16}/>重来</button><button onClick={() => void revealAnswer()}><ListRestart size={16}/>看答案</button></section><section className="endgame-status"><span>错误 {mistakes} 次</span>{notice && <p>{renderCblText(notice)}</p>}</section>{showAttempts ? <section className="endgame-attempt-history"><header><strong>答题记录</strong><small>最近 {attempts.length} 次</small></header><div>{attempts.length ? attempts.map((attempt) => <p key={attempt.id}><b>{attemptOutcomeLabel[attempt.outcome] ?? attempt.outcome}</b><span>{attemptModeLabel[attempt.mode] ?? attempt.mode} · {fmt(attempt.elapsedMs)} · 错 {attempt.mistakes} · 提示 {attempt.hintsUsed}</span><small>{attempt.createdAt.replace("T", " ").slice(0, 16)}</small></p>) : <p className="endgame-no-attempts">还没有答题记录</p>}</div></section> : revealed && <section className="endgame-answer"><header><strong>题解回合</strong><small>{answerStep}/{answerMoves.length} 手</small></header><div className="endgame-answer-rounds">{rounds.map((round) => <p key={round.round}><b>第 {round.round} 回合</b><span>{round.first}{round.second ? ` · ${round.second}` : ""}</span></p>)}</div><footer className="endgame-answer-demo"><button onClick={() => setDemoPlaying((value) => !value)} disabled={answerStep >= answerMoves.length}>{demoPlaying ? <Pause size={14}/> : <Play size={14}/>} {demoPlaying ? "暂停演示" : answerStep ? "继续演示" : "演示答案"}</button><button onClick={restartAnswerDemo} disabled={answerStep === 0}><RotateCcw size={14}/>从头</button></footer>{demoSummary && <section className="endgame-demo-summary"><strong>演示总结</strong><p>{renderCblText(demoSummary)}</p></section>}</section>}<footer className="endgame-navigation"><button disabled={index <= 0} title="上一题" onClick={() => next(-1)}><ChevronLeft size={17}/></button><button disabled={index >= visibleProblems.length - 1} title="下一题" onClick={() => next(1)}><ChevronRight size={17}/></button></footer></> : <p>从左侧选择题目。</p>}</aside>
    </div>}{deleteTarget && <div className="endgame-delete-backdrop" role="alertdialog" aria-modal="true" aria-label="确认删除" onMouseDown={() => setDeleteTarget(undefined)}><section className="endgame-delete-confirm" onMouseDown={(event) => event.stopPropagation()}><strong>确认删除</strong><p>{deleteTarget.kind === "library" ? `删除题库《${deleteTarget.title}》及全部本地答题记录？此操作不可恢复。` : `从训练目录移除《${deleteTarget.title}》？已有答题记录会保留在本机。`}</p><footer><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></footer></section></div>}
  </section></div>;
}

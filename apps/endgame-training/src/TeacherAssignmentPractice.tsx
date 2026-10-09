import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, RotateCcw, MoreHorizontal } from "lucide-react";
import { teachingClient, type TeachingAuth, type TeacherPracticeProblem, type TeacherHistoricalAttempt } from "./teaching";
import { boardAt, cancelPikafishSearch, chineseLine } from "./wasm";
import { teacherTrialReply, trialOutcome } from "./teacherTrial";
import { TeacherProblemEditor } from "./TeacherProblemEditor";
import { TeacherTrialAnswer } from "./TeacherTrialAnswer";
import type { BoardState, SolutionMove } from "./types";

type Square = { row: number; col: number };
type Progress = { moves: string[]; hint: boolean; revealed: boolean; fingerprint: string };
type Position = { problem: TeacherPracticeProblem; board: BoardState; progress: Progress };
export type TeacherPracticeBoardRenderer = (board: BoardState, selected: Square | undefined, lastMove: string | undefined, hintMove: string | undefined, onSquare: (square: Square) => void, onMove: (from: Square, to: Square) => void, setupMode?: boolean) => ReactNode;
const empty = (problem: TeacherPracticeProblem): Progress => ({ moves: [], hint: false, revealed: false, fingerprint: JSON.stringify([problem.startingFen, problem.solution]) });
function continuation(problem: TeacherPracticeProblem, moves: string[]) {
  let line: SolutionMove[] | undefined = problem.solution;
  for (const move of moves) line = line?.find(item => item.iccs === move)?.children;
  return line;
}
const iccs = (square: Square) => `${String.fromCharCode(97 + square.col)}${9 - square.row}`;

export function TeacherAssignmentPractice({ assignmentId, total: initialTotal, initialOrder, auth, renderBoard, onBack }: { assignmentId: string; total: number; initialOrder?: number; auth: TeachingAuth; renderBoard: TeacherPracticeBoardRenderer; onBack(): void }) {
  const [history, setHistory] = useState<TeacherHistoricalAttempt[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>();
  const [showHistory, setShowHistory] = useState(false);
  const [historical, setHistorical] = useState<{ attempt: TeacherHistoricalAttempt; board: BoardState; step: number }>();
  const [total, setTotal] = useState(initialTotal);
  const [editing, setEditing] = useState<TeacherPracticeProblem>();
  const [withdrawn, setWithdrawn] = useState<TeacherPracticeProblem[]>([]);
  const [withdrawnCursor, setWithdrawnCursor] = useState<string | null>();
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [items, setItems] = useState<TeacherPracticeProblem[]>([]);
  const [position, setPosition] = useState<Position>();
  const [selected, setSelected] = useState<Square>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("qixi-teacher-trial-numbers-expanded-v1") === "true"; } catch { return false; } });
  const [failedOrder, setFailedOrder] = useState(0);
  const cursor = useRef<string | undefined>(undefined);
  const cache = useRef<TeacherPracticeProblem[]>([]);
  const request = useRef(0);
  const grid = useRef<HTMLElement | null>(null);
  const lock = useRef(false);
  const trialBeforeAnswer = useRef<Progress | undefined>(undefined);
  const prefix = `qixi-teacher-trial-v1:${teachingClient.serverUrl()}:${auth.user.id}:${auth.user.orgId}:${assignmentId}`;
  const progressKey = (problem: TeacherPracticeProblem) => `${prefix}:${problem.problemId}`;
  function persist(next: Position) {
    try { localStorage.setItem(progressKey(next.problem), JSON.stringify(next.progress)); localStorage.setItem(`${prefix}:current`, String(next.problem.order)); }
    catch { setNotice("本机空间不足，当前试做进度仅在本次打开期间保留。"); }
  }
  async function open(order: number, count = total) {
    if (lock.current || order < 0 || order >= count) return;
    lock.current = true; setBusy(true); setError(""); setFailedOrder(order);
    const version = ++request.current;
    try {
      let problem = cache.current.find(item => item.order === order);
      while (!problem) {
        const previous = cursor.current;
        const page = await teachingClient.teacherPracticeProblems(assignmentId, previous, auth);
        if (request.current !== version) return;
        cache.current = [...cache.current, ...page.items]; cursor.current = page.nextCursor ?? undefined;
        setItems(cache.current);
        problem = cache.current.find(item => item.order === order);
        if (!problem && (!cursor.current || cursor.current === previous)) throw new Error("这道题已调整，请返回作业后重新进入。");
      }
      const initial = empty(problem);
      let progress = initial;
      try {
        const saved = JSON.parse(localStorage.getItem(progressKey(problem)) || "null") as Progress | null;
        if (saved?.fingerprint === initial.fingerprint && Array.isArray(saved.moves) && saved.moves.every(move => typeof move === "string")) progress = saved;
      } catch { /* Invalid or outdated local drafts start from the initial position. */ }
      let board: BoardState;
      try { board = await boardAt(problem.startingFen, progress.moves); }
      catch { progress = initial; board = await boardAt(problem.startingFen, []); }
      if (request.current !== version) return;
      trialBeforeAnswer.current = undefined;
      const next = { problem, board, progress }; setPosition(next); setSelected(undefined); setNotice("教师试做：进度仅保存在本机，无需提交。"); persist(next);
    } catch (reason) { if (request.current === version) setError(reason instanceof Error ? reason.message : "题目读取失败"); }
    finally { if (request.current === version) { lock.current = false; setBusy(false); } }
  }
  useEffect(() => {
    let order = initialOrder ?? 0;
    try { const saved = initialOrder ?? Number(localStorage.getItem(`${prefix}:current`)); if (Number.isInteger(saved) && saved >= 0 && saved < total) order = saved; } catch { /* Storage can be unavailable. */ }
    void open(order);
    return () => { ++request.current; lock.current = false; void cancelPikafishSearch().catch(() => {}); };
  }, []);
  const awaitingReply = Boolean(position && !position.progress.revealed && !trialOutcome(position.board) && position.board.fen.split(/\s+/)[1] !== position.problem.startingFen.split(/\s+/)[1]);
  async function respond(next: Position, version: number) {
    if (trialOutcome(next.board)) return;
    setNotice("对手正在应招…");
    const defense = continuation(next.problem, next.progress.moves)?.[0]?.iccs;
    const reply = await teacherTrialReply(next.board.fen, defense, () => request.current === version);
    if (!reply || request.current !== version) return;
    const moves = [...next.progress.moves, reply.move];
    const board = await boardAt(next.problem.startingFen, moves);
    const notation = (await chineseLine(next.board.fen, [reply.move])).at(-1) ?? reply.move;
    if (request.current !== version) return;
    const answered = { ...next, board, progress: { ...next.progress, moves } };
    setPosition(answered); persist(answered);
    setNotice(`${reply.source}应招：${notation}${trialOutcome(board) ? ` · ${trialOutcome(board)}` : "，继续试做核实。"}`);
  }
  async function retryReply() {
    if (!position || lock.current || !awaitingReply) return;
    lock.current = true; setBusy(true); setError("");
    const version = ++request.current;
    try { await respond(position, version); }
    catch (reason) { if (request.current === version) setError(reason instanceof Error ? reason.message : "应招失败，请重试。"); }
    finally { if (request.current === version) { lock.current = false; setBusy(false); } }
  }
  async function play(from: Square, to: Square) {
    if (!position || lock.current || position.progress.revealed || awaitingReply || trialOutcome(position.board)) return;
    lock.current = true; setBusy(true); setError("");
    const version = ++request.current;
    const move = iccs(from) + iccs(to);
    try {
      const line = continuation(position.problem, position.progress.moves);
      const match = line?.find(item => item.iccs === move);
      const moves = [...position.progress.moves, move];
      const board = await boardAt(position.problem.startingFen, moves);
      if (request.current !== version) return;
      const next = { ...position, board, progress: { ...position.progress, moves, hint: false } };
      setPosition(next); setSelected(undefined); persist(next);
      const outcome = trialOutcome(board);
      setNotice(outcome ?? (match ? "此着符合保存题解。" : "此着不在保存题解中，继续通过对手应招核实。"));
      if (!outcome) {
        try { await respond(next, version); }
        catch (reason) { if (request.current === version) setError(reason instanceof Error ? reason.message : "应招失败，请重试。"); }
      }
    } catch { if (request.current === version) setNotice("这一步不合法，棋盘未改变。"); }
    finally { if (request.current === version) { lock.current = false; setBusy(false); } }
  }
  function square(square: Square) {
    if (!position || busy || position.progress.revealed || awaitingReply || trialOutcome(position.board)) return;
    const piece = position.board.pieces.find(item => item.row === square.row && item.col === square.col);
    const own = piece && (piece.color === "red" ? "w" : "b") === position.board.fen.split(/\s+/)[1];
    if (own) setSelected(current => current?.row === square.row && current.col === square.col ? undefined : square);
    else if (selected) void play(selected, square);
  }
  async function changeMoves(moves: string[], revealed = false, hint = false) {
    if (!position || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const version = ++request.current;
    try {
      const board = await boardAt(position.problem.startingFen, moves);
      if (request.current !== version) return;
      const next = { ...position, board, progress: { ...position.progress, moves, hint, revealed } };
      setPosition(next); setSelected(undefined); if (!revealed) persist(next); setNotice(revealed ? "答案核对：点击中文走法或上一步／下一步查看题解。" : "教师试做：进度仅保存在本机，无需提交。");
    } catch (reason) { if (request.current === version) setError(reason instanceof Error ? reason.message : "局面读取失败"); }
    finally { if (request.current === version) { lock.current = false; setBusy(false); } }
  }
  async function hint() {
    if (!position || busy) return;
    const next = continuation(position.problem, position.progress.moves)?.[0];
    if (!next) { setNotice("当前路线没有保存的后续题解，可退回后查看提示。"); return; }
    const version = request.current;
    try {
    const text = (await chineseLine(position.problem.startingFen, [...position.progress.moves, next.iccs])).at(-1);
    if (request.current !== version) return;
    const value = { ...position, progress: { ...position.progress, hint: true } }; setPosition(value); persist(value); setNotice(`题解提示：${text ?? next.iccs}${next.comment ? ` · ${next.comment}` : ""}`);
    } catch { if (request.current === version) setError("提示无法读取，请核对题解或重试。"); }
  }
  async function loadHistory(more = false) {
    const version = request.current; setError("");
    try { const page = await teachingClient.teacherProblemHistory(assignmentId, more ? historyCursor ?? undefined : undefined, auth);
      if (version !== request.current) return; setHistory(previous => more ? [...previous,...page.items] : page.items); setHistoryCursor(page.nextCursor); setShowHistory(true);
    } catch (e) { if (version === request.current) setError(e instanceof Error ? e.message : "历史读取失败"); }
  }
  async function replayHistory(attempt: TeacherHistoricalAttempt, step = 0) {
    const version = ++request.current; setError("");
    try { const board = await boardAt(attempt.startingFen,attempt.moves.slice(0,step)); if (version === request.current) setHistorical({ attempt,board,step }); }
    catch { if (version === request.current) setError("旧记录回放失败，原记录仍保留。"); }
  }
  async function loadWithdrawn(more = false) {
    setError(""); const version = request.current;
    try { const page = await teachingClient.teacherPracticeProblems(assignmentId, more ? withdrawnCursor ?? undefined : undefined, auth, true);
      if (version !== request.current) return; setWithdrawn(previous => more ? [...previous, ...page.items] : page.items); setWithdrawnCursor(page.nextCursor); setShowWithdrawn(true);
    } catch (reason) { if (version === request.current) setError(reason instanceof Error ? reason.message : "读取撤回题目失败"); }
  }
  async function changed() {
    ++request.current; lock.current = true;
    try {
      const assignments = await teachingClient.teacherAssignments(auth);
      const assignment = assignments.find(item => item.id === assignmentId);
      if (!assignment) throw new Error("作业已不可访问，请返回列表。");
      const count = assignment.itemCount; setTotal(count); cache.current = []; cursor.current = undefined; setItems([]); if (!count) setPosition(undefined); setEditing(undefined); setShowWithdrawn(false); setShowHistory(false); setHistorical(undefined);
      lock.current = false;
      if (count > 0) await open(Math.min(position?.problem.order ?? 0, count - 1), count);
    } finally { lock.current = false; }
  }
  useEffect(() => {
    if (!expanded || !grid.current) return;
    const active = grid.current.querySelector('[aria-current="step"]'); if (!active) return;
    const box = active.getBoundingClientRect(), container = grid.current.getBoundingClientRect();
    if (box.top < container.top) grid.current.scrollTop += box.top-container.top;
    else if (box.bottom > container.bottom) grid.current.scrollTop += box.bottom-container.bottom;
  }, [expanded, position?.problem.order]);
  const problem = position?.problem;
  if (editing) return <TeacherProblemEditor key={editing.problemId} assignmentId={assignmentId} problem={editing} auth={auth} renderBoard={renderBoard} trialMoves={editing.problemId === position?.problem.problemId ? position.progress.moves : []} onClose={() => setEditing(undefined)} onChanged={changed}/>;
  const line = position && continuation(position.problem, position.progress.moves);
  return <section className="teacher-assignment-practice" aria-label="教师试做" aria-busy={busy}>
    <header><button type="button" aria-label="返回作业结果" onClick={onBack}><ChevronLeft/>返回</button><strong>教师试做 · 无需提交</strong><button type="button" aria-label="更多题目管理" aria-expanded={more} onClick={() => setMore(value => !value)}><MoreHorizontal/></button></header>
    <section className="teacher-problem-navigation" aria-label="试做题目导航"><header><strong>{problem ? `第 ${problem.order + 1}/${total} 题` : `共 ${total} 题`}</strong><div>
      <button type="button" disabled={busy || !problem || problem.order === 0} onClick={() => void open(problem!.order - 1)}>上一题</button>
      <button type="button" disabled={busy || !problem || problem.order >= total - 1} onClick={() => void open(problem!.order + 1)}>下一题</button>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => { try { localStorage.setItem("qixi-teacher-trial-numbers-expanded-v1", String(!value)); } catch {} return !value; })}>{expanded ? "收起题号" : "展开题号"}</button>
    </div></header><nav ref={grid} className="teacher-problem-number-grid" hidden={!expanded} aria-label="试做题号列表">{Array.from({ length: total }, (_, order) => <button type="button" key={order} aria-label={`试做第 ${order + 1} 题`} aria-current={problem?.order === order ? "step" : undefined} className={problem?.order === order ? "active" : ""} disabled={busy} onClick={() => void open(order)}>{order + 1}</button>)}</nav></section>
    <div className="teacher-trial-management" hidden={!more}>
    <div className="teacher-trial-actions"><button type="button" disabled={busy} onClick={() => void loadWithdrawn()}>查看已撤回题目</button><button type="button" disabled={busy} onClick={() => void changed().catch(reason => setError(reason instanceof Error ? reason.message : "刷新失败"))}>刷新题目</button></div>
    {showWithdrawn && <section aria-label="已撤回题目"><h3>已撤回题目</h3>{withdrawn.length ? withdrawn.map(item => <button type="button" key={item.problemId} onClick={() => setEditing(item)}>{item.title} · 编辑／重发</button>) : <p>没有已撤回题目</p>}{withdrawnCursor && <button type="button" onClick={() => void loadWithdrawn(true)}>加载更多撤回题目</button>}</section>}
    <button type="button" disabled={busy} onClick={() => void loadHistory()}>查看被修改／撤回题目的历史答题</button>
    {showHistory && <section aria-label="历史答题记录"><h3>历史答题（不计当前成绩）</h3>{history.length ? history.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => void replayHistory(item)}>{item.studentName} · {item.title} · {new Date(item.submittedAt).toLocaleString("zh-CN")}</button>) : <p>暂无历史答题记录</p>}{historyCursor && <button type="button" onClick={() => void loadHistory(true)}>更多历史记录</button>}</section>}
    {historical && <section aria-label="历史回放"><h3>{historical.attempt.studentName} · {historical.attempt.title} · 第 {historical.step} 手</h3>{renderBoard(historical.board,undefined,historical.attempt.moves[historical.step-1],undefined,()=>{},()=>{})}<div className="teacher-trial-actions"><button type="button" disabled={!historical.step} onClick={() => void replayHistory(historical.attempt,historical.step-1)}>历史上一步</button><button type="button" disabled={historical.step>=historical.attempt.moves.length} onClick={() => void replayHistory(historical.attempt,historical.step+1)}>历史下一步</button><button type="button" onClick={() => { ++request.current; setHistorical(undefined); }}>关闭历史回放</button></div></section>}
    </div>
    {total === 0 && <p>本次作业当前没有可试做题目，可从已撤回题目重发。</p>}
    {busy && !position && <p role="status">正在准备题目…</p>}
    {!position && error && <p role="alert">{error}<button type="button" disabled={busy} onClick={() => void open(failedOrder)}>重试</button></p>}
    {position && <><h3 className="teacher-trial-title" title={position.problem.title}>{position.problem.title}</h3>{renderBoard(position.board, selected, position.progress.moves.at(-1), position.progress.hint ? line?.[0]?.iccs : undefined, square, (from, to) => void play(from, to))}
      <div className="teacher-trial-status">
        {error ? <p role="alert">{error}<button type="button" disabled={busy} onClick={() => awaitingReply ? void retryReply() : void open(failedOrder)}>{awaitingReply ? "重试应招" : "重试"}</button></p>
        : <p role="status" className={trialOutcome(position.board) ? "teacher-trial-outcome" : position.board.status === "将军" ? "teacher-trial-check" : undefined}>
          {trialOutcome(position.board) ?? `${position.board.status === "将军" ? `将军 · ${position.board.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方"}正在被将军。` : ""}${busy && !awaitingReply ? "正在准备局面…" : notice}`}
        </p>}
      </div>
      <div className="teacher-trial-actions"><button type="button" disabled={busy || !position.progress.moves.length} onClick={() => void changeMoves(position.progress.moves.slice(0, position.progress.revealed || position.progress.moves.length % 2 === 1 ? -1 : -2), position.progress.revealed)}><ChevronLeft/>上一步</button>
      {position.progress.revealed ? <button type="button" disabled={busy || !line?.length} onClick={() => void changeMoves([...position.progress.moves, line![0].iccs], true)}>下一步<ChevronRight/></button> : <button type="button" disabled={busy || awaitingReply || Boolean(trialOutcome(position.board))} onClick={() => void hint()}><Lightbulb/>提示</button>}
      <button type="button" disabled={busy} onClick={() => {
        if (position.progress.revealed) void changeMoves(trialBeforeAnswer.current?.moves ?? [], false, trialBeforeAnswer.current?.hint ?? false);
        else { trialBeforeAnswer.current = position.progress; void changeMoves([], true); }
      }}>{position.progress.revealed ? "继续试做" : "看答案"}</button><button type="button" disabled={busy} onClick={() => void changeMoves([])}><RotateCcw/>重新试做</button></div>
      {position.progress.revealed && <TeacherTrialAnswer fen={position.problem.startingFen} solution={position.problem.solution} moves={position.progress.moves} busy={busy} onJump={moves => void changeMoves(moves, true)}/>}
      <button type="button" disabled={busy} onClick={() => setEditing(position.problem)}>修改／替换／撤回本题</button>
      {position.problem.note && <p className="teacher-trial-note">{position.problem.note}</p>}
      {awaitingReply && !busy && !error && <button type="button" onClick={() => void retryReply()}>继续 AI 应招</button>}
    </>}
    <small>{items.length}/{total} 题已读取 · 本机试做进度独立保存</small>
  </section>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, GraduationCap, Lightbulb, LogIn, LogOut, RefreshCw, RotateCcw, X } from "lucide-react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardIntersectionStyle } from "./boardGeometry";
import {
  createTeachingAssignment, flushTeachingAttempts, getTeachingAccount,
  getTeachingAssignmentResults, listTeachingAssignmentProblems, listTeachingAssignments,
  listTeachingClasses, listTeachingProblemLibraries, loginTeachingAccount,
  logoutTeachingAccount, submitTeachingAssetReview, submitTeachingAttempt, uploadTeachingCbl,
  type Piece, type TeachingAccountDto, type TeachingAssetDto, type TeachingAssignmentDto,
  type TeachingAssignmentResultDto, type TeachingLibraryDto, type TeachingProblemDto,
} from "./platform";
import type { TeachingSolutionMove } from "./platform/types";

const URL_KEY = "xiangqi-studio-teaching-server-url";
const labels: Record<string, string> = { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵", k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒" };
const kinds: Record<string, string> = { K: "k", A: "a", B: "b", N: "n", R: "r", C: "c", P: "p", k: "k", a: "a", b: "b", n: "n", r: "r", c: "c", p: "p" };
type Square = { row: number; col: number };
type Outcome = "completed" | "revealed" | "abandoned";

function readFen(fen: string): Piece[] {
  const pieces: Piece[] = [];
  fen.split(" ")[0].split("/").forEach((rank, row) => {
    let col = 0;
    for (const value of rank) {
      if (/\d/.test(value)) col += Number(value);
      else { pieces.push({ row, col, color: value === value.toUpperCase() ? "red" : "black", kind: kinds[value], label: labels[value] }); col += 1; }
    }
  });
  return pieces;
}

function squareName(square: Square) { return `${String.fromCharCode(97 + square.col)}${9 - square.row}`; }
function moveSquares(iccs: string) { return { from: { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) }, to: { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) } }; }
function applyMove(pieces: Piece[], iccs: string) {
  const { from, to } = moveSquares(iccs);
  const mover = pieces.find((piece) => piece.row === from.row && piece.col === from.col);
  return mover ? [...pieces.filter((piece) => !(piece.row === from.row && piece.col === from.col) && !(piece.row === to.row && piece.col === to.col)), { ...mover, ...to }] : pieces;
}
function mainline(solution: TeachingSolutionMove[]) {
  const result: string[] = []; let current = solution[0];
  while (current) { result.push(current.iccs); current = current.children[0]; }
  return result;
}

function TeachingSolver({ serverUrl, problem, onFinished }: { serverUrl: string; problem: TeachingProblemDto; onFinished(problemId: string, completed: boolean): void }) {
  const [pieces, setPieces] = useState<Piece[]>(() => readFen(problem.startingFen));
  const [line, setLine] = useState<TeachingSolutionMove[]>(problem.solution);
  const [moves, setMoves] = useState<string[]>([]);
  const [selected, setSelected] = useState<Square>();
  const [lastMove, setLastMove] = useState<string>();
  const [notice, setNotice] = useState("选中棋子，再点目标位置。错误着法不会改变局面。");
  const [mistakes, setMistakes] = useState(0); const [hints, setHints] = useState(0);
  const [finished, setFinished] = useState(false); const [, setClock] = useState(0);
  const startedAt = useRef(Date.now()); const submitting = useRef(false);
  const answer = useMemo(() => mainline(problem.solution), [problem.solution]);

  useEffect(() => {
    setPieces(readFen(problem.startingFen)); setLine(problem.solution); setMoves([]); setSelected(undefined); setLastMove(undefined);
    setNotice("选中棋子，再点目标位置。错误着法不会改变局面。"); setMistakes(0); setHints(0); setFinished(false);
    startedAt.current = Date.now(); submitting.current = false;
  }, [problem.problemId]);
  useEffect(() => { if (finished) return; const timer = window.setInterval(() => setClock((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [finished]);

  async function finish(outcome: Outcome, finalMoves = moves, finalMistakes = mistakes) {
    if (submitting.current) return;
    submitting.current = true; setFinished(true);
    try {
      const result = await submitTeachingAttempt(serverUrl, {
        clientAttemptId: crypto.randomUUID(), assignmentId: problem.assignmentId, problemId: problem.problemId,
        elapsedMs: Math.max(0, Date.now() - startedAt.current), hintsUsed: hints, mistakes: finalMistakes,
        moves: finalMoves, outcome, completedAt: new Date().toISOString(),
      });
      setNotice(result.queued ? "当前离线，答题记录已保存到本机，联网后会自动补交。" : outcome === "completed" ? "回答正确，记录已提交。" : outcome === "revealed" ? `主线答案：${answer.join(" ")}` : "本次练习已记录为放弃。");
      onFinished(problem.problemId, outcome === "completed");
    } catch (error) { setFinished(false); submitting.current = false; setNotice(`提交失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  function restart() {
    setPieces(readFen(problem.startingFen)); setLine(problem.solution); setMoves([]); setSelected(undefined); setLastMove(undefined);
    setNotice("已回到初始局面。"); setMistakes(0); setHints(0); setFinished(false); startedAt.current = Date.now(); submitting.current = false;
  }
  function click(square: Square) {
    if (finished) return;
    const occupied = pieces.find((piece) => piece.row === square.row && piece.col === square.col);
    const selectedPiece = selected && pieces.find((piece) => piece.row === selected.row && piece.col === selected.col);
    if (!selected || occupied && selectedPiece?.color === occupied.color) { setSelected(occupied ? square : undefined); return; }
    const candidate = `${squareName(selected)}${squareName(square)}`;
    const node = line.find((item) => item.iccs === candidate);
    if (!node) { setMistakes((value) => value + 1); setSelected(undefined); setNotice("这一步不在当前题解中，请重新判断。"); return; }
    let nextPieces = applyMove(pieces, node.iccs); const nextMoves = [...moves, node.iccs];
    setLastMove(node.iccs); setSelected(undefined);
    if (!node.children.length) { setPieces(nextPieces); setMoves(nextMoves); setLine([]); void finish("completed", nextMoves); return; }
    const reply = node.children[0]; nextPieces = applyMove(nextPieces, reply.iccs); const repliedMoves = [...nextMoves, reply.iccs];
    setPieces(nextPieces); setMoves(repliedMoves); setLastMove(reply.iccs); setLine(reply.children);
    if (!reply.children.length) void finish("completed", repliedMoves); else setNotice(reply.comment || "系统已自动应手，请继续。");
  }
  const last = lastMove ? moveSquares(lastMove) : undefined;
  return <section className="teaching-solver">
    <header><div><strong>{problem.title || "未命名题目"}</strong><small>{problem.category || "未分类"} · 已尝试 {problem.attemptCount} 次</small></div>{problem.completed && <span><CheckCircle2 size={14}/>已完成</span>}</header>
    <div className="teaching-solver-body"><div className="teaching-board-wrap"><LinkMiniBoard presentation="preview" markerStyle="corner" boardAriaLabel="教学作业棋盘" pieces={pieces} arrows={[]} selectedSquare={selected} lastMove={last ? { ...last, movedBy: "红方" } : undefined} pieceAsset={(piece) => `/skins/qingxin-zhuyun/${piece.color === "red" ? "r" : "b"}${piece.kind}.png`} boardAsset="/skins/qingxin-zhuyun/board.png"/><div className="teaching-hit-grid">{Array.from({ length: 90 }, (_, index) => { const square = { row: Math.floor(index / 9), col: index % 9 }; return <button key={index} aria-label={squareName(square)} style={boardIntersectionStyle(square, false, "qingxin-zhuyun")} onClick={() => click(square)}/>; })}</div></div>
      <aside><div className="teaching-solver-stats"><span>用时 {Math.floor((Date.now() - startedAt.current) / 1000)} 秒</span><span>错误 {mistakes}</span><span>提示 {hints}/3</span></div><p>{notice}</p><div className="teaching-solver-actions"><button disabled={finished || !line[0]} onClick={() => { const next = Math.min(3, hints + 1); setHints(next); setNotice(next === 1 ? problem.note || "先寻找将军、吃子和强制着。" : next === 2 ? `应走棋子在 ${line[0] ? squareName(moveSquares(line[0].iccs).from) : "--"}` : `提示着法：${line[0]?.iccs ?? "--"}`); }}><Lightbulb size={15}/>提示</button><button onClick={restart}><RotateCcw size={15}/>重来</button><button disabled={finished} onClick={() => void finish("revealed")}><BookOpen size={15}/>看答案</button><button disabled={finished || (!moves.length && !mistakes && !hints)} onClick={() => void finish("abandoned")}>放弃</button></div></aside>
    </div>
  </section>;
}

function TeacherWorkspace({ serverUrl, assignments, classes, onCreated }: { serverUrl: string; assignments: TeachingAssignmentDto[]; classes: Array<{ id: string; name: string; studentCount: number; coachCount: number }>; onCreated(): Promise<void> }) {
  const [libraries, setLibraries] = useState<TeachingLibraryDto[]>([]); const [title, setTitle] = useState("");
  const [libraryId, setLibraryId] = useState(""); const [classIds, setClassIds] = useState<string[]>([]);
  const [results, setResults] = useState<TeachingAssignmentResultDto[]>([]); const [resultTitle, setResultTitle] = useState("");
  const [uploaded, setUploaded] = useState<TeachingAssetDto>(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void listTeachingProblemLibraries(serverUrl).then((items) => setLibraries(items.filter((item) => item.reviewStatus === "published"))); }, [serverUrl]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim() || !libraryId || !classIds.length) return; setBusy(true); setMessage("");
    try {
      await createTeachingAssignment(serverUrl, { title: title.trim(), description: "", libraryIds: [libraryId], classIds, studentIds: [], problemIds: [], problemSelections: [], publishNow: true, maxAttempts: 0, allowAnswer: false, randomizeItems: false, boardSettings: {} });
      setTitle(""); setLibraryId(""); setClassIds([]); setMessage("作业已发布，学生名单已生成快照。"); await onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function inspect(item: TeachingAssignmentDto) {
    if (item.status === "draft") { setMessage("草稿发布后才会生成学生结果。"); return; }
    setBusy(true); setResultTitle(item.title);
    try { setResults(await getTeachingAssignmentResults(serverUrl, item.id)); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function uploadDraft() {
    setBusy(true); setMessage("");
    try { const asset = await uploadTeachingCbl(serverUrl); if (asset) { setUploaded(asset); setMessage(asset.parseStatus === "parsed" ? "CBL 已解析为个人草稿，可提交管理员审核。" : asset.parseMessage || "CBL 已上传。"); } }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function submitReview() {
    if (!uploaded) return; setBusy(true);
    try { setUploaded(await submitTeachingAssetReview(serverUrl, uploaded.id)); setMessage("个人 CBL 草稿已提交管理员审核。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  const classNames = new Map(classes.map((item) => [item.id, item.name]));
  return <div className="teaching-teacher-workspace"><section><h3>快速布置作业</h3><form onSubmit={create}><input placeholder="作业标题" value={title} onChange={(event) => setTitle(event.target.value)}/><select value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">选择已发布题库</option>{libraries.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.publishedCount} 题）</option>)}</select><fieldset><legend>负责班级（可多选）</legend>{classes.map((item) => <label key={item.id}><input type="checkbox" checked={classIds.includes(item.id)} onChange={(event) => setClassIds(event.target.checked ? [...classIds, item.id] : classIds.filter((id) => id !== item.id))}/>{item.name}<small>{item.studentCount} 人</small></label>)}</fieldset><button disabled={busy || !title.trim() || !libraryId || !classIds.length}>发布作业</button></form><div className="teaching-draft-upload"><h3>个人 CBL 草稿</h3><button disabled={busy} onClick={() => void uploadDraft()}>选择 CBL 上传</button>{uploaded && <div><strong>{uploaded.originalFilename}</strong><span>{uploaded.parseStatus} · {uploaded.reviewStatus}</span>{uploaded.parseStatus === "parsed" && ["draft", "rejected"].includes(uploaded.reviewStatus) && <button onClick={() => void submitReview()}>提交管理员审核</button>}</div>}</div>{message && <p>{message}</p>}</section><section><h3>我的作业与结果</h3><div className="teaching-assignment-list">{assignments.map((item) => <article key={item.id}><BookOpen size={18}/><div><strong>{item.title}</strong><span>{item.completedCount}/{item.targetCount} 人完成 · {item.itemCount} 题</span><button onClick={() => void inspect(item)}>查看结果</button></div></article>)}</div>{resultTitle && <div className="teaching-results"><h4>{resultTitle}</h4>{results.map((row) => <div key={row.studentId}><span><strong>{row.displayName}</strong><small>{row.loginName}</small></span><b>{row.completedCount}/{row.totalCount}</b><span>{row.sources.map((source) => source.sourceType === "student" ? "个人" : classNames.get(source.sourceId) || "原班级").join("、")}</span></div>)}{!results.length && !busy && <p>暂无接收学生。</p>}</div>}</section></div>;
}

export function TeachingCenter({ open, onClose }: { open: boolean; onClose(): void }) {
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(URL_KEY) || "http://127.0.0.1:8090");
  const [account, setAccount] = useState<TeachingAccountDto>(); const [loginName, setLoginName] = useState(""); const [password, setPassword] = useState("");
  const [assignments, setAssignments] = useState<TeachingAssignmentDto[]>([]); const [classes, setClasses] = useState<Array<{ id: string; name: string; studentCount: number; coachCount: number }>>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeachingAssignmentDto>(); const [problems, setProblems] = useState<TeachingProblemDto[]>([]); const [selectedProblem, setSelectedProblem] = useState<TeachingProblemDto>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [syncNote, setSyncNote] = useState("");
  async function refresh(target = account) {
    if (!target || target.status !== "signedIn") return;
    setBusy(true); setError("");
    try {
      const flushed = await flushTeachingAttempts(serverUrl).catch(() => ({ submitted: 0, remaining: 0 }));
      const nextAssignments = await listTeachingAssignments(serverUrl); setAssignments(nextAssignments);
      setClasses(target.role === "student" ? [] : await listTeachingClasses(serverUrl));
      setSyncNote(flushed.submitted ? `已补交 ${flushed.submitted} 条离线记录${flushed.remaining ? `，剩余 ${flushed.remaining} 条` : ""}` : flushed.remaining ? `仍有 ${flushed.remaining} 条记录等待联网提交` : "");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open) return; let active = true;
    void getTeachingAccount(serverUrl).then((next) => { if (!active) return; setAccount(next); if (next.status === "signedIn") void refresh(next); }).catch((error) => active && setError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, [open]);
  if (!open) return null;
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const normalized = serverUrl.replace(/\/$/, ""); localStorage.setItem(URL_KEY, normalized); setServerUrl(normalized); const next = await loginTeachingAccount(normalized, loginName, password); setAccount(next); setPassword(""); await refresh(next); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function logout() { setAccount(await logoutTeachingAccount(serverUrl)); setAssignments([]); setClasses([]); setProblems([]); setSelectedAssignment(undefined); setSelectedProblem(undefined); }
  async function openAssignment(item: TeachingAssignmentDto) {
    setBusy(true); setError(""); setSelectedAssignment(item); setSelectedProblem(undefined);
    try { const next = await listTeachingAssignmentProblems(serverUrl, item.id); setProblems(next); setSelectedProblem(next.find((problem) => !problem.completed) ?? next[0]); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  return <div className="teaching-center-scrim" role="dialog" aria-modal="true" onMouseDown={onClose}><section className="teaching-center" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><GraduationCap size={20}/><div><strong>教学中心</strong><small>独立教学账号，不影响个人棋谱同步</small></div></div><button title="关闭" onClick={onClose}><X size={18}/></button></header>
    {account?.status === "signedIn" ? <><div className="teaching-account-row"><div><strong>{account.displayName}</strong><span>{account.loginName} · {account.role === "student" ? "学生" : account.role === "coach" ? "教学老师" : "管理员"}</span></div><button onClick={() => void logout()}><LogOut size={15}/>退出</button></div>
      <div className="teaching-center-toolbar"><span>{account.role === "student" ? "我的作业" : "我的班级与作业"}{syncNote && <small>{syncNote}</small>}</span><button disabled={busy} onClick={() => void refresh()}><RefreshCw size={15}/>{busy ? "刷新中" : "同步"}</button></div>
      {classes.length > 0 && <div className="teaching-class-strip">{classes.map((item) => <span key={item.id}>{item.name}<small>{item.studentCount} 名学生 · {item.coachCount} 名老师</small></span>)}</div>}
      {account.role === "student" ? <div className="teaching-student-workspace"><aside className="teaching-assignment-list">{assignments.map((item) => <article key={item.id} className={selectedAssignment?.id === item.id ? "selected" : ""}><BookOpen size={19}/><div><strong>{item.title}</strong><span>{item.itemCount} 题</span><small>{item.dueAt ? `截止 ${new Date(item.dueAt).toLocaleString("zh-CN")}` : "无截止时间"}</small><button onClick={() => void openAssignment(item)}>打开作业</button></div></article>)}{!assignments.length && !busy && <p>暂无作业</p>}</aside>{selectedAssignment && <section className="teaching-problem-workspace"><nav>{problems.map((item, index) => <button key={item.problemId} className={`${selectedProblem?.problemId === item.problemId ? "active" : ""} ${item.completed ? "completed" : ""}`} onClick={() => setSelectedProblem(item)}>{index + 1}{item.completed && <CheckCircle2 size={12}/>}</button>)}</nav>{selectedProblem ? <TeachingSolver serverUrl={serverUrl} problem={selectedProblem} onFinished={(problemId, completed) => setProblems((current) => current.map((item) => item.problemId === problemId ? { ...item, completed: item.completed || completed, attemptCount: item.attemptCount + 1 } : item))} /> : <p>选择一道题开始。</p>}</section>}</div> : <TeacherWorkspace serverUrl={serverUrl} assignments={assignments} classes={classes} onCreated={() => refresh(account)}/>}</> : <form className="teaching-login" onSubmit={login}><label>教学服务地址<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label><label>用户名 / 学号<input autoFocus value={loginName} onChange={(event) => setLoginName(event.target.value)} /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button disabled={busy || !loginName || !password}><LogIn size={16}/>{busy ? "登录中" : "登录教学账号"}</button></form>}
    {error && <p className="teaching-center-error">{error}</p>}
  </section></div>;
}

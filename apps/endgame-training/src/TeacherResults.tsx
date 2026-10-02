import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { teachingClient, type TeacherAssignmentResult, type TeacherAssignmentSummary, type TeacherProblemResult, type TeacherSubmittedProblem } from "./teaching";
import { boardAt, chineseLine } from "./wasm";

export type ResultBoardRenderer = (fen: string, label: string) => ReactNode;
const recorded = (value?: number | null) => value == null ? "未记录" : String(value);
const time = (value?: number | null) => value == null ? "未记录" : `${Math.floor(value / 60000)}分${Math.round(value % 60000 / 1000)}秒`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未收到提交";
const errorText = (error: unknown) => error instanceof Error ? error.message : "读取结果失败";
const outcome = (item: TeacherProblemResult) => !item.submittedAt ? "未收到提交" : item.completed ? item.outcome === "completed" ? "已做对" : `已做对 · 最近${item.outcome === "revealed" ? "看解析" : "未做对"}` : item.outcome === "revealed" ? "已看解析" : "未做对";

export function TeacherResults({ assignmentId, students, summary, renderBoard, revision = 0 }: { assignmentId: string; students: TeacherAssignmentResult[]; summary?: TeacherAssignmentSummary; renderBoard?: ResultBoardRenderer; revision?: number }) {
  const [studentId, setStudentId] = useState<string>();
  const [problem, setProblem] = useState<TeacherProblemResult>();
  const [items, setItems] = useState<TeacherProblemResult[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const positions = useRef<number[]>([]);
  const loaded = useRef({ studentId: "", count: 0 });
  const student = students.find((item) => item.studentId === studentId);
  function enter(action: () => void) {
    const page = root.current?.closest(".teacher-mobile-page");
    positions.current.push(page?.scrollTop ?? 0);
    action(); page?.scrollTo(0, 0);
  }
  function back() {
    if (problem) setProblem(undefined); else setStudentId(undefined);
    const scroll = positions.current.pop() ?? 0;
    requestAnimationFrame(() => root.current?.closest(".teacher-mobile-page")?.scrollTo(0, scroll));
  }
  useEffect(() => {
    const version = ++generation.current;
    setItems([]); setCursor(undefined); setError("");
    if (!studentId) return;
    setBusy(true);
    const targetCount = loaded.current.studentId === studentId ? Math.max(50, loaded.current.count) : 50;
    (async () => {
      let cursor: string | undefined; const items: TeacherProblemResult[] = [];
      do {
        const page = await teachingClient.teacherStudentResults(assignmentId, studentId, cursor);
        if (version !== generation.current) return;
        items.push(...page.items); cursor = page.nextCursor ?? undefined;
      } while (cursor && items.length < targetCount);
      if (version === generation.current) { setItems(items); setCursor(cursor); loaded.current = { studentId, count: items.length }; }
    })().catch((error) => { if (version === generation.current) setError(errorText(error)); })
      .finally(() => { if (version === generation.current) setBusy(false); });
    return () => { ++generation.current; };
  }, [assignmentId, studentId, retry, revision]);
  async function more() {
    if (!studentId || !cursor || busy) return;
    const version = generation.current;
    setBusy(true); setError("");
    try {
      const page = await teachingClient.teacherStudentResults(assignmentId, studentId, cursor);
      if (version === generation.current) { setItems((items) => [...items, ...page.items]); setCursor(page.nextCursor); loaded.current.count += page.items.length; }
    } catch (error) { if (version === generation.current) setError(errorText(error)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  return <div ref={root} className="teacher-results">
    {!student ? <>
      {summary && <section className="teacher-result-summary" aria-label="作业统计">
        <Metric label="接收学生" value={`${summary.recipientCount} 人`}/><Metric label="部分提交" value={`${summary.partialSubmissionCount} 人`}/>
        <Metric label="全部提交" value={`${summary.fullSubmissionCount} 人`}/><Metric label="全部做对" value={`${summary.fullySolvedCount} 人`}/>
        <Metric label="题目完成率" value={`${summary.completionRate.toFixed(1)}%`}/><Metric label="已全交平均分" value={summary.averageTotalScore == null ? "暂无成绩" : `${summary.averageTotalScore.toFixed(1)} 分`}/>
      </section>}
      <section className="teacher-mobile-section"><header><strong>学生完成情况</strong><small>{students.length} 名学生</small></header>
        {students.map((item) => <button type="button" className="teacher-result-row" key={item.studentId} onClick={() => enter(() => setStudentId(item.studentId))}>
          <span><b>{item.displayName}</b><small>{item.loginName}</small><small>已提交 {recorded(item.submittedCount)}/{item.totalCount} · 已做对 {item.completedCount}/{item.totalCount}</small></span>
          <strong>{recorded(item.totalScore)}/{item.totalCount * 3} 分</strong><ChevronRight/>
        </button>)}
        {!students.length && <p className="teacher-mobile-empty">暂无接收学生</p>}
      </section>
    </> : problem ? <>
      <button className="teacher-results-back" type="button" onClick={back}><ChevronLeft/>返回逐题结果</button>
      {busy ? <p role="status">正在刷新逐题结果…</p> : error ? <p role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></p> : <SubmittedReplay key={`${studentId}:${problem.problemId}:${revision}`} assignmentId={assignmentId} studentId={student.studentId} problem={items.find((item) => item.problemId === problem.problemId) ?? problem} renderBoard={renderBoard}/>}
    </> : <>
      <button className="teacher-results-back" type="button" onClick={back}><ChevronLeft/>返回学生列表</button>
      <h3>{student.displayName} · 作业结果</h3>
      <section className="teacher-result-summary" aria-label="学生成绩">
        <Metric label="已提交" value={`${recorded(student.submittedCount)}/${student.totalCount}`}/><Metric label="已做对" value={`${student.completedCount}/${student.totalCount}`}/>
        <Metric label="总分" value={`${recorded(student.totalScore)}/${student.totalCount * 3}`}/><Metric label="首次正确率" value={student.firstTryCorrectCount == null ? "未记录" : `${(student.totalCount ? student.firstTryCorrectCount / student.totalCount * 100 : 0).toFixed(1)}%`}/>
        <Metric label="已交答案用时" value={time(student.totalElapsedMs)}/><Metric label="最近提交" value={date(student.lastSubmittedAt)}/>
      </section>
      {error && <p role="alert" className="teacher-mobile-error">{error}<button type="button" onClick={() => cursor ? void more() : setRetry((value) => value + 1)}><RefreshCw/>重试</button></p>}
      <section className="teacher-mobile-section" aria-label="逐题结果">{items.map((item) => <button type="button" className="teacher-result-row" key={item.problemId} onClick={() => enter(() => setProblem(item))}>
        <span><b>{item.order + 1}. {item.title}</b><small>{outcome(item)} · 错误 {recorded(item.mistakes)} · 提示 {recorded(item.hintsUsed)}</small><small>{time(item.elapsedMs)} · {item.firstTryCorrect ? "首次正确" : "非首次正确"}</small></span>
        <strong>{item.score == null ? "—" : `${item.score} 分 · ${item.stars} 星`}</strong><ChevronRight/>
      </button>)}</section>
      {busy && <p role="status">正在读取结果…</p>}{cursor && <button type="button" disabled={busy} onClick={() => void more()}>加载更多</button>}
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }

function SubmittedReplay({ assignmentId, studentId, problem, renderBoard }: { assignmentId: string; studentId: string; problem: TeacherProblemResult; renderBoard?: ResultBoardRenderer }) {
  const [detail, setDetail] = useState<TeacherSubmittedProblem>();
  const [fen, setFen] = useState<string>();
  const [notation, setNotation] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError(""); setDetail(undefined);
    teachingClient.teacherSubmittedProblem(assignmentId, studentId, problem.problemId).then(async (next) => {
      const line = next.moves?.length ? await chineseLine(next.startingFen, next.moves) : [];
      if (active) { setDetail(next); setFen(next.startingFen); setNotation(line); }
    }).catch((error) => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [assignmentId, studentId, problem.problemId, retry]);
  useEffect(() => {
    if (!detail) return;
    let active = true;
    boardAt(detail.startingFen, detail.moves?.slice(0, step) ?? []).then((board) => { if (active) setFen(board.fen); })
      .catch((error) => { if (active) { setError(errorText(error)); setPlaying(false); } });
    return () => { active = false; };
  }, [detail, step]);
  useEffect(() => {
    if (!playing || !detail?.moves?.length) return;
    if (step >= detail.moves.length) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep((step) => step + 1), 1000);
    return () => clearTimeout(timer);
  }, [playing, step, detail]);
  const count = detail?.moves?.length ?? 0;
  function seek(next: number) { setPlaying(false); setStep(next); }
  return <section className="teacher-submitted-replay">
    <h3>{problem.title}</h3><p>{outcome(problem)} · {recorded(problem.score)} 分 · {recorded(problem.stars)} 星</p>
    {error && <p role="alert" className="teacher-mobile-error">{error}<button type="button" onClick={() => { setStep(0); setPlaying(false); setRetry((value) => value + 1); }}>重试</button></p>}
    {!detail && !error && <p role="status">正在加载棋盘…</p>}
    {fen && renderBoard?.(fen, `${problem.title} · 第 ${step} 手`)}
    {detail && <><div className="teacher-replay-controls">
      <button type="button" title="回到初始局面" aria-label="回到初始局面" disabled={!step} onClick={() => seek(0)}><ChevronsLeft/></button>
      <button type="button" title="上一步" aria-label="上一步" disabled={!step} onClick={() => seek(step - 1)}><ChevronLeft/></button>
      <span>{step}/{count}</span><button type="button" title={playing ? "暂停回放" : "播放已提交着法"} aria-label={playing ? "暂停回放" : "播放已提交着法"} disabled={!count} onClick={() => { if (step >= count) setStep(0); setPlaying(!playing); }}>{playing ? <Pause/> : <Play/>}</button>
      <button type="button" title="下一步" aria-label="下一步" disabled={step >= count} onClick={() => seek(step + 1)}><ChevronRight/></button>
      <button type="button" title="最后一步" aria-label="最后一步" disabled={step >= count} onClick={() => seek(count)}><ChevronsRight/></button>
    </div>
    <p>{date(problem.submittedAt)} · 用时 {time(problem.elapsedMs)}</p>
    {!count && <p>{detail.moves == null ? "尚无已提交的着法记录" : "此记录未包含着法"}</p>}
    <ol className="teacher-submitted-moves">{notation.map((move, index) => <li key={index}><button type="button" className={step === index + 1 ? "active" : ""} onClick={() => seek(index + 1)}>{index + 1}. {move}</button></li>)}</ol></>}
  </section>;
}

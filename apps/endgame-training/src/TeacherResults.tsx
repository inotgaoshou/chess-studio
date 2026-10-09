import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { teachingClient, type TeacherAssignmentResult, type TeacherAssignmentSummary, type TeacherProblemResult, type TeacherSubmittedProblem } from "./teaching";
import { boardAt, chineseLine } from "./wasm";
import { prepareResultBoardAssets } from "./resultBoardAssets";

export type ResultBoardRenderer = (fen: string, label: string) => ReactNode;
const recorded = (value?: number | null) => value == null ? "未记录" : String(value);
const studentName = (value?: string | null) => value?.trim() || "姓名未填写";
const time = (value?: number | null) => value == null ? "未记录" : `${Math.floor(value / 60000)}分${Math.round(value % 60000 / 1000)}秒`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未收到提交";
const errorText = (error: unknown) => error instanceof Error ? error.message : "读取结果失败";
const outcome = (item: TeacherProblemResult) => !item.submittedAt ? "未收到提交" : item.completed ? item.outcome === "completed" ? "已做对" : `已做对 · 最近${item.outcome === "revealed" ? "看解析" : "未做对"}` : item.outcome === "revealed" ? "已看解析" : "未做对";
const studentFilters = { all: "接收学生", partial: "部分提交学生", submitted: "全部提交学生", solved: "全部做对学生" } as const;
type StudentFilter = keyof typeof studentFilters;
type ReplaySnapshot = { problem: TeacherProblemResult; detail: TeacherSubmittedProblem; notation: string[]; initialFen: string };
const EXPANDED_KEY = "xiangqi-teacher-problem-navigation-expanded-v1";
function readExpanded() { try { return localStorage.getItem(EXPANDED_KEY) === "true"; } catch { return false; } }
async function prepareReplay(assignmentId: string, studentId: string, problem: TeacherProblemResult): Promise<ReplaySnapshot> {
  const detail = await teachingClient.teacherSubmittedProblem(assignmentId, studentId, problem.problemId);
  const [board, notation] = await Promise.all([boardAt(detail.startingFen, []), detail.moves?.length ? chineseLine(detail.startingFen, detail.moves) : Promise.resolve([] as string[])]);
  await prepareResultBoardAssets(board.fen);
  return { problem, detail, notation, initialFen: board.fen };
}
function matchesFilter(student: TeacherAssignmentResult, filter: StudentFilter) {
  if (filter === "partial") return student.submittedCount != null && student.submittedCount > 0 && student.submittedCount < student.totalCount;
  if (filter === "submitted") return student.totalCount > 0 && student.submittedCount != null && student.submittedCount >= student.totalCount;
  if (filter === "solved") return student.totalCount > 0 && student.completedCount >= student.totalCount;
  return true;
}

export function TeacherResults({ assignmentId, students, summary, renderBoard, onPractice, revision = 0 }: { assignmentId: string; students: TeacherAssignmentResult[]; summary?: TeacherAssignmentSummary; renderBoard?: ResultBoardRenderer; onPractice?(order: number): void; revision?: number }) {
  const [studentId, setStudentId] = useState<string>();
  const [filter, setFilter] = useState<StudentFilter>("all");
  const [replay, setReplay] = useState<ReplaySnapshot>();
  const problem = replay?.problem;
  const [pendingOrder, setPendingOrder] = useState<number>();
  const [failedOrder, setFailedOrder] = useState<number>();
  const [expanded, setExpanded] = useState(readExpanded);
  const [items, setItems] = useState<TeacherProblemResult[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const studentList = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const positions = useRef<number[]>([]);
  const loaded = useRef({ studentId: "", count: 0 });
  const navigationLock = useRef(false);
  const navigationRequest = useRef(0);
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const student = students.find((item) => item.studentId === studentId);
  const filteredStudents = students.filter((item) => matchesFilter(item, filter));
  function selectFilter(next: StudentFilter) {
    setFilter(next);
    requestAnimationFrame(() => {
      const page = root.current?.closest(".teacher-mobile-page");
      if (page && studentList.current) page.scrollTo({ top: page.scrollTop + studentList.current.getBoundingClientRect().top - page.getBoundingClientRect().top - 8, behavior: "auto" });
    });
  }
  function enter(action: () => void) {
    const page = root.current?.closest(".teacher-mobile-page");
    positions.current.push(page?.scrollTop ?? 0);
    action(); page?.scrollTo(0, 0);
  }
  function back() {
    ++navigationRequest.current; navigationLock.current = false; setPendingOrder(undefined); setFailedOrder(undefined);
    if (problem) setReplay(undefined); else setStudentId(undefined);
    const scroll = positions.current.pop() ?? 0;
    requestAnimationFrame(() => root.current?.closest(".teacher-mobile-page")?.scrollTo(0, scroll));
  }
  useEffect(() => {
    const version = ++generation.current;
    ++navigationRequest.current; navigationLock.current = false; setPendingOrder(undefined); setFailedOrder(undefined);
    setError("");
    if (!studentId) { setItems([]); setCursor(undefined); setBusy(false); return; }
    if (loaded.current.studentId !== studentId) { setItems([]); setCursor(undefined); }
    setBusy(true);
    const targetCount = loaded.current.studentId === studentId ? Math.max(50, loaded.current.count) : 50;
    (async () => {
      let cursor: string | undefined; const items: TeacherProblemResult[] = [];
      do {
        const page = await teachingClient.teacherStudentResults(assignmentId, studentId, cursor);
        if (version !== generation.current) return;
        items.push(...page.items); cursor = page.nextCursor ?? undefined;
      } while (cursor && items.length < targetCount);
      const current = replayRef.current;
      const selected = current && items.find((item) => item.problemId === current.problem.problemId);
      const refreshed = selected ? await prepareReplay(assignmentId, studentId, selected) : undefined;
      if (version === generation.current) {
        setItems(items); setCursor(cursor); loaded.current = { studentId, count: items.length };
        if (replayRef.current === current && current) setReplay(refreshed);
      }
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
  async function openProblem(order: number) {
    if (!student || busy || navigationLock.current || order < 0 || order >= student.totalCount) return;
    navigationLock.current = true;
    const request = ++navigationRequest.current;
    const version = generation.current;
    let available = items;
    let nextCursor = cursor;
    setError(""); setPendingOrder(order); setFailedOrder(undefined);
    try {
      let selected = available.find((item) => item.order === order);
      if (!selected) {
        while (!selected && nextCursor) {
          const page = await teachingClient.teacherStudentResults(assignmentId, student.studentId, nextCursor);
          if (version !== generation.current || request !== navigationRequest.current) return;
          available = [...available, ...page.items];
          const previousCursor = nextCursor;
          nextCursor = page.nextCursor;
          setItems(available); setCursor(nextCursor);
          loaded.current = { studentId: student.studentId, count: available.length };
          selected = available.find((item) => item.order === order);
          if (nextCursor === previousCursor) throw new Error("题目分页未前进，请刷新结果后重试。");
        }
      }
      if (!selected) throw new Error("未找到这道题，请刷新结果后重试。");
      const next = await prepareReplay(assignmentId, student.studentId, selected);
      if (version !== generation.current || request !== navigationRequest.current) return;
      if (problem) setReplay(next); else enter(() => setReplay(next));
    } catch (reason) { if (version === generation.current && request === navigationRequest.current) { setError(errorText(reason)); setFailedOrder(order); } }
    finally { if (request === navigationRequest.current) { navigationLock.current = false; setPendingOrder(undefined); } }
  }
  function toggleExpanded() {
    setExpanded((current) => { try { localStorage.setItem(EXPANDED_KEY, String(!current)); } catch { /* Session preference still works without storage. */ } return !current; });
  }
  function retryRead() { if (failedOrder != null) void openProblem(failedOrder); else setRetry((value) => value + 1); }
  const problemNavigator = student && <ProblemNumberNavigation total={student.totalCount} current={problem?.order} items={items} busy={busy || pendingOrder != null} expanded={expanded} onToggle={toggleExpanded} onSelect={(order) => void openProblem(order)}/>;
  const switchStatus = <p className="teacher-problem-switch-status" role="status">{pendingOrder != null ? `正在切换到第 ${pendingOrder + 1} 题…` : busy ? "正在刷新逐题结果…" : ""}</p>;
  return <div ref={root} className="teacher-results">
    {!student ? <>
      {summary && <section className="teacher-result-summary" aria-label="作业统计">
        <Metric label="接收学生" value={`${summary.recipientCount} 人`} selected={filter === "all"} onClick={() => selectFilter("all")}/><Metric label="部分提交" value={`${summary.partialSubmissionCount} 人`} selected={filter === "partial"} onClick={() => selectFilter("partial")}/>
        <Metric label="全部提交" value={`${summary.fullSubmissionCount} 人`} selected={filter === "submitted"} onClick={() => selectFilter("submitted")}/><Metric label="全部做对" value={`${summary.fullySolvedCount} 人`} selected={filter === "solved"} onClick={() => selectFilter("solved")}/>
        <Metric label="题目完成率" value={`${summary.completionRate.toFixed(1)}%`}/><Metric label="已全交平均分" value={summary.averageTotalScore == null ? "暂无成绩" : `${summary.averageTotalScore.toFixed(1)} 分`}/>
      </section>}
      <section ref={studentList} className="teacher-mobile-section teacher-student-list" aria-label="学生名单"><header><strong aria-live="polite">{studentFilters[filter]} · {filteredStudents.length} 人</strong>{filter !== "all" && <button type="button" className="teacher-result-clear" onClick={() => selectFilter("all")}>查看全部学生</button>}</header>
        {filteredStudents.map((item) => <button type="button" className="teacher-result-row" key={item.studentId} onClick={() => enter(() => setStudentId(item.studentId))}>
          <span><b>学生姓名：{studentName(item.displayName)}</b><small>登录账号：{item.loginName}</small><small>已提交 {recorded(item.submittedCount)}/{item.totalCount} · 已做对 {item.completedCount}/{item.totalCount}</small></span>
          <strong>{recorded(item.totalScore)}/{item.totalCount * 3} 分</strong><ChevronRight/>
        </button>)}
        {!filteredStudents.length && <p className="teacher-mobile-empty">{filter === "all" ? "暂无接收学生" : `暂无${studentFilters[filter]}`}</p>}
      </section>
    </> : problem ? <>
      <button className="teacher-results-back" type="button" onClick={back}><ChevronLeft/>返回逐题结果</button>
      {problemNavigator}
      {switchStatus}
      {error && <p role="alert" className="teacher-mobile-error">{error}<button type="button" onClick={retryRead}>重试</button></p>}
      {replay && <SubmittedReplay snapshot={replay} pending={busy || pendingOrder != null} renderBoard={renderBoard} onPractice={onPractice}/>}
    </> : <>
      <button className="teacher-results-back" type="button" onClick={back}><ChevronLeft/>返回学生列表</button>
      <header className="teacher-student-identity" aria-label="学生身份"><h3>学生姓名：{studentName(student.displayName)}</h3><p>登录账号：{student.loginName}</p></header>
      <section className="teacher-result-summary" aria-label="学生成绩">
        <Metric label="已提交" value={`${recorded(student.submittedCount)}/${student.totalCount}`}/><Metric label="已做对" value={`${student.completedCount}/${student.totalCount}`}/>
        <Metric label="总分" value={`${recorded(student.totalScore)}/${student.totalCount * 3}`}/><Metric label="首次正确率" value={student.firstTryCorrectCount == null ? "未记录" : `${(student.totalCount ? student.firstTryCorrectCount / student.totalCount * 100 : 0).toFixed(1)}%`}/>
        <Metric label="已交答案用时" value={time(student.totalElapsedMs)}/><Metric label="最近提交" value={date(student.lastSubmittedAt)}/>
      </section>
      {problemNavigator}
      {switchStatus}
      {error && <p role="alert" className="teacher-mobile-error">{error}<button type="button" onClick={() => failedOrder != null ? retryRead() : cursor ? void more() : setRetry((value) => value + 1)}><RefreshCw/>重试</button></p>}
      <section className="teacher-mobile-section" aria-label="逐题结果">{items.map((item) => <button type="button" disabled={busy || pendingOrder != null} className="teacher-result-row" key={item.problemId} onClick={() => void openProblem(item.order)}>
        <span><b>{item.order + 1}. {item.title}</b><small>{outcome(item)} · 错误 {recorded(item.mistakes)} · 提示 {recorded(item.hintsUsed)}</small><small>{time(item.elapsedMs)} · {item.firstTryCorrect ? "首次正确" : "非首次正确"}</small></span>
        <strong>{item.score == null ? "—" : `${item.score} 分 · ${item.stars} 星`}</strong><ChevronRight/>
      </button>)}</section>
      {busy && <p role="status">正在读取结果…</p>}{cursor && <button type="button" disabled={busy} onClick={() => void more()}>加载更多</button>}
    </>}
  </div>;
}

function ProblemNumberNavigation({ total, current, items, busy, expanded, onToggle, onSelect }: { total: number; current?: number; items: TeacherProblemResult[]; busy: boolean; expanded: boolean; onToggle(): void; onSelect(order: number): void }) {
  const byOrder = new Map(items.map((item) => [item.order, item]));
  const grid = useRef<HTMLElement>(null);
  const gridId = useId();
  useLayoutEffect(() => {
    const list = grid.current, active = list?.querySelector('[aria-current="step"]');
    if (!expanded || !list || !active) return;
    const row = active.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [expanded, current]);
  return <section className="teacher-problem-navigation" aria-label="作业题目导航">
    <header><strong>{current == null ? `题目预览 · ${total} 题` : `第 ${current + 1}/${total} 题`}</strong><div>
      {current != null && <><button type="button" aria-label="上一题" disabled={busy || current <= 0} onClick={() => onSelect(current - 1)}><ChevronLeft/>上一题</button>
      <button type="button" aria-label="下一题" disabled={busy || current >= total - 1} onClick={() => onSelect(current + 1)}>下一题<ChevronRight/></button></>}
      <button type="button" aria-expanded={expanded} aria-controls={gridId} onClick={onToggle}>{expanded ? "收起题号" : "展开题号"}{expanded ? <ChevronUp/> : <ChevronDown/>}</button>
    </div></header>
    <nav ref={grid} id={gridId} hidden={!expanded} className="teacher-problem-number-grid" aria-label="题号列表">{Array.from({ length: total }, (_, order) => {
      const item = byOrder.get(order);
      return <button type="button" key={order} disabled={busy} aria-current={current === order ? "step" : undefined} aria-label={`第 ${order + 1} 题${item ? `：${item.title}` : ""}`} title={item ? `${item.title} · ${outcome(item)}` : `第 ${order + 1} 题`} className={`${current === order ? "active" : ""} ${item?.completed ? "completed" : item?.submittedAt ? "submitted" : ""}`} onClick={() => onSelect(order)}>{order + 1}</button>;
    })}</nav>
  </section>;
}

function Metric({ label, value, selected, onClick }: { label: string; value: string; selected?: boolean; onClick?: () => void }) {
  const content = <><small>{label}</small><strong>{value}</strong></>;
  return onClick ? <button type="button" className="teacher-result-metric" aria-label={`${label} ${value}，查看学生名单`} aria-pressed={selected} onClick={onClick}>{content}<ChevronRight aria-hidden="true"/></button> : <div className="teacher-result-metric">{content}</div>;
}

function SubmittedReplay({ snapshot, pending, renderBoard, onPractice }: { snapshot: ReplaySnapshot; pending: boolean; renderBoard?: ResultBoardRenderer; onPractice?(order: number): void }) {
  const { problem, detail, notation } = snapshot;
  const initial = () => ({ snapshot, fen: snapshot.initialFen, step: 0, playing: false, error: "" });
  const [position, setPosition] = useState(initial);
  // Derive the new starting position during the commit, before effects run.
  // The board stays mounted and can never render new metadata with old pieces.
  const current = position.snapshot === snapshot ? position : initial();
  const { fen, step, playing, error } = current;
  const search = useRef(0);
  useLayoutEffect(() => { ++search.current; setPosition(initial()); }, [snapshot]);
  useLayoutEffect(() => {
    if (pending) { ++search.current; setPosition((old) => ({ ...old, playing: false })); }
  }, [pending]);
  useEffect(() => {
    if (pending || !step) return;
    const request = ++search.current;
    let active = true;
    boardAt(detail.startingFen, detail.moves?.slice(0, step) ?? []).then((board) => {
      if (active && request === search.current) setPosition((old) => old.snapshot === snapshot ? { ...old, fen: board.fen } : old);
    }).catch((reason) => {
      if (active && request === search.current) setPosition((old) => old.snapshot === snapshot ? { ...old, error: errorText(reason), playing: false } : old);
    });
    return () => { active = false; };
  }, [snapshot, step, pending]);
  useEffect(() => {
    if (!playing || pending || !detail.moves?.length) return;
    if (step >= detail.moves.length) { setPosition((old) => ({ ...old, playing: false })); return; }
    const timer = setTimeout(() => setPosition((old) => old.snapshot === snapshot ? { ...old, step: old.step + 1 } : old), 1000);
    return () => clearTimeout(timer);
  }, [playing, step, snapshot, pending]);
  const count = detail.moves?.length ?? 0;
  function seek(next: number) {
    ++search.current;
    setPosition((old) => ({ ...old, playing: false, step: next, ...(next === 0 ? { fen: snapshot.initialFen } : {}) }));
  }
  return <section className="teacher-submitted-replay" aria-busy={pending}>
    <h3>{problem.title}</h3><p>{outcome(problem)} · {recorded(problem.score)} 分 · {recorded(problem.stars)} 星</p>
    {error && <p role="alert" className="teacher-mobile-error">{error}<button type="button" onClick={() => { setPosition(initial()); }}>重试</button></p>}
    {onPractice && <button type="button" className="teacher-trial-entry" disabled={pending} onClick={() => onPractice(problem.order)}>试做本题（无需提交）</button>}
    {renderBoard?.(fen, `${problem.title} · 第 ${step} 手`)}
    <div className="teacher-replay-controls">
      <button type="button" title="回到初始局面" aria-label="回到初始局面" disabled={pending || !step} onClick={() => seek(0)}><ChevronsLeft/></button>
      <button type="button" title="上一步" aria-label="上一步" disabled={pending || !step} onClick={() => seek(step - 1)}><ChevronLeft/></button>
      <span>{step}/{count}</span><button type="button" title={playing ? "暂停回放" : "播放已提交着法"} aria-label={playing ? "暂停回放" : "播放已提交着法"} disabled={pending || !count} onClick={() => setPosition((old) => ({ ...old, ...(step >= count ? { step: 0, fen: snapshot.initialFen } : {}), playing: !playing }))}>{playing ? <Pause/> : <Play/>}</button>
      <button type="button" title="下一步" aria-label="下一步" disabled={pending || step >= count} onClick={() => seek(step + 1)}><ChevronRight/></button>
      <button type="button" title="最后一步" aria-label="最后一步" disabled={pending || step >= count} onClick={() => seek(count)}><ChevronsRight/></button>
    </div>
    <p>{date(problem.submittedAt)} · 用时 {time(problem.elapsedMs)}</p>
    {!count && <p>{detail.moves == null ? "尚无已提交的着法记录" : "此记录未包含着法"}</p>}
    <ol className="teacher-submitted-moves">{notation.map((move, index) => <li key={index}><button type="button" disabled={pending} className={step === index + 1 ? "active" : ""} onClick={() => seek(index + 1)}>{index + 1}. {move}</button></li>)}</ol>
  </section>;
}

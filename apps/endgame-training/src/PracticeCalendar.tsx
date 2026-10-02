import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { teachingClient, type PracticeHistory, type PracticeSession } from "./teaching";
import { practiceHistoryByDay, recentPracticeDays } from "./practiceHistory";

const weekday = (date: string) => ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00`).getDay()];
const shortDate = (date: string) => date.slice(5).replace("-", "/");

export function PracticeCalendar({ history, remote = false }: { history: PracticeHistory[]; remote?: boolean }) {
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const [loaded, setLoaded] = useState<PracticeHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [details, setDetails] = useState<string>();
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsRetry, setDetailsRetry] = useState(0);
  useEffect(() => {
    if (range === 7 || !remote) return;
    let active = true;
    setLoading(true); setError(""); setLoaded([]);
    void teachingClient.practiceHistory(range).then((records) => { if (active) setLoaded(records); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "读取学习记录失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, remote, retry, history]);
  const days = recentPracticeDays(range === 7 ? history : loaded, new Date(), range);
  const today = days.at(-1)!.localDate;
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const selected = days.find((day) => day.localDate === selectedDate) ?? days.at(-1)!;
  const months = [...new Set(days.map((day) => day.localDate.slice(0, 7)))];
  const monthIndex = months.indexOf(month);
  const visible = range === 7 ? days : days.filter((day) => day.localDate.startsWith(month));
  const offset = range === 7 ? 0 : new Date(`${visible[0]?.localDate ?? today}T12:00:00`).getDay();
  const totals = days.reduce((sum, day) => ({ completed: sum.completed + day.completedCount, correct: sum.correct + day.correctCount }), { completed: 0, correct: 0 });
  useEffect(() => {
    if (!details) return;
    let active = true;
    const records = range === 7 ? history : loaded;
    const ids = [...new Set(records.filter((record) => record.localDate === details).map((record) => record.sessionId))];
    setDetailsLoading(true); setDetailsError(""); setSessions([]);
    void Promise.all(ids.map((id) => teachingClient.practiceSession(id))).then((items) => { if (active) setSessions(items); }).catch((reason) => { if (active) setDetailsError(reason instanceof Error ? reason.message : "读取练习详情失败"); }).finally(() => { if (active) setDetailsLoading(false); });
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetails(undefined); };
    document.addEventListener("keydown", close);
    document.querySelector<HTMLButtonElement>(".practice-calendar-details .mobile-back-button")?.focus();
    return () => { active = false; document.body.style.overflow = overflow; document.removeEventListener("keydown", close); previous?.focus(); };
  }, [details, detailsRetry, history, loaded, range]);
  function selectRange(next: 7 | 30 | 90) { setRange(next); setMonth(today.slice(0, 7)); setSelectedDate(today); setError(""); setLoading(false); }
  return <div className="practice-calendar">
    {remote && <div className="mobile-segmented practice-calendar-range" role="group" aria-label="学习记录范围">{([7, 30, 90] as const).map((value) => <button type="button" key={value} className={range === value ? "active" : ""} aria-pressed={range === value} onClick={() => selectRange(value)}>{value === 7 ? "近 7 天" : value === 30 ? "近 1 个月" : "近 3 个月"}</button>)}</div>}
    {range > 7 && <div className="practice-calendar-month"><button type="button" aria-label="上个月学习记录" title="上个月学习记录" disabled={monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1])}><ChevronLeft/></button><strong>{month.replace("-", " 年 ")} 月</strong><button type="button" aria-label="下个月学习记录" title="下个月学习记录" disabled={monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1])}><ChevronRight/></button></div>}
    {loading ? <p role="status" className="practice-calendar-state">正在读取学习记录…</p> : error ? <div role="alert" className="practice-calendar-state"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw/>重试</button></div> : <>
    <div className={`practice-calendar-week ${range > 7 ? "practice-calendar-month-grid" : ""}`} role="group" aria-label={range === 7 ? "近七天练习日历" : "每月练习日历"}>
      {range > 7 && ["日", "一", "二", "三", "四", "五", "六"].map((name) => <small className="practice-calendar-weekday" key={name}>周{name}</small>)}
      {Array.from({ length: offset }, (_, index) => <span aria-hidden="true" key={`blank-${index}`}/>)}
      {visible.map((day) => <button type="button" key={day.localDate} aria-pressed={selected.localDate === day.localDate} aria-current={day.localDate === today ? "date" : undefined} aria-label={`${day.localDate}，完成 ${day.completedCount} 题，正确 ${day.correctCount} 题`} onClick={() => setSelectedDate(day.localDate)}>
        {range === 7 && <small>周{weekday(day.localDate)}</small>}<strong>{shortDate(day.localDate)}</strong><span>{day.completedCount} 题</span>
      </button>)}
    </div>
    <div className="practice-calendar-summary" aria-live="polite"><strong>{selected.localDate === today ? "今天" : shortDate(selected.localDate)} · 周{weekday(selected.localDate)}</strong><span>完成 <b>{selected.completedCount}</b> 题 · 正确 <b>{selected.correctCount}</b> 题</span>{remote && <button type="button" className="practice-calendar-details-trigger" onClick={() => setDetails(selected.localDate)}>查看详情<ChevronRight/></button>}</div>
    {range > 7 && <div className="practice-calendar-summary"><strong>{shortDate(days[0].localDate)}–{shortDate(today)}</strong><span>累计完成 <b>{totals.completed}</b> 题 · 首次正确 <b>{totals.correct}</b> 题</span></div>}
    </>}
    {details && <div className="assignment-review-backdrop" onClick={() => setDetails(undefined)}><section className="practice-calendar-details" role="dialog" aria-modal="true" aria-label="学习记录详情" onClick={(event) => event.stopPropagation()}>
      <header className="mobile-page-heading"><button type="button" className="mobile-back-button" aria-label="返回学习日历" title="返回学习日历" onClick={() => setDetails(undefined)}><ChevronLeft/></button><span><strong>学习记录详情</strong><small>{details} · 周{weekday(details)}</small></span></header>
      {detailsLoading ? <p role="status">正在读取练习详情…</p> : detailsError ? <div role="alert"><p>{detailsError}</p><button type="button" onClick={() => setDetailsRetry((value) => value + 1)}><RefreshCw/>重试</button></div> : sessions.length ? <div className="practice-calendar-session-list">{sessions.map((session, index) => <section key={session.id}><header><strong>练习 {index + 1}</strong><small>{session.items.length} 题 · {session.status === "completed" ? "已结束" : "练习中"}</small></header><ol>{session.items.map((item) => <li key={item.id}><strong>{item.problem.title}</strong><span>{item.status === "completed" ? "已完成" : item.status === "revealed" ? "已看解析" : item.status === "abandoned" ? "未完成" : "待完成"}{item.grade ? ` · ${item.grade.score} 分 / ${item.grade.stars} 星 · 错 ${item.grade.mistakes} 次 · 提示 ${item.grade.hintsUsed} 次` : ""}</span></li>)}</ol></section>)}</div> : <p>当天暂无平台练习记录</p>}
    </section></div>}
  </div>;
}

export function PracticeHistoryList({ history }: { history: PracticeHistory[] }) {
  const days = practiceHistoryByDay(history).slice(0, 7);
  return days.length ? <table className="practice-history-table"><thead><tr><th scope="col">日期</th><th scope="col">完成</th><th scope="col">正确</th></tr></thead><tbody>{days.map((day) => <tr key={day.localDate}><th scope="row">{shortDate(day.localDate)} <small>周{weekday(day.localDate)}</small></th><td>{day.completedCount} 题</td><td>{day.correctCount} 题</td></tr>)}</tbody></table> : <p className="mobile-detail-state">暂无练习记录</p>;
}

import { useState } from "react";
import type { PracticeHistory } from "./teaching";
import { practiceHistoryByDay, recentPracticeDays } from "./practiceHistory";

const weekday = (date: string) => ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00`).getDay()];
const shortDate = (date: string) => date.slice(5).replace("-", "/");

export function PracticeCalendar({ history }: { history: PracticeHistory[] }) {
  const days = recentPracticeDays(history);
  const today = days[6].localDate;
  const [selectedDate, setSelectedDate] = useState(today);
  const selected = days.find((day) => day.localDate === selectedDate) ?? days[6];
  return <div className="practice-calendar">
    <div className="practice-calendar-week" role="group" aria-label="近七天练习日历">
      {days.map((day) => <button type="button" key={day.localDate} aria-pressed={selected.localDate === day.localDate} aria-current={day.localDate === today ? "date" : undefined} aria-label={`${day.localDate}，完成 ${day.completedCount} 题，正确 ${day.correctCount} 题`} onClick={() => setSelectedDate(day.localDate)}>
        <small>周{weekday(day.localDate)}</small><strong>{shortDate(day.localDate)}</strong><span>{day.completedCount} 题</span>
      </button>)}
    </div>
    <div className="practice-calendar-summary" aria-live="polite"><strong>{selected.localDate === today ? "今天" : shortDate(selected.localDate)} · 周{weekday(selected.localDate)}</strong><span>完成 <b>{selected.completedCount}</b> 题 · 正确 <b>{selected.correctCount}</b> 题</span></div>
  </div>;
}

export function PracticeHistoryList({ history }: { history: PracticeHistory[] }) {
  const days = practiceHistoryByDay(history).slice(0, 7);
  return days.length ? <table className="practice-history-table"><thead><tr><th scope="col">日期</th><th scope="col">完成</th><th scope="col">正确</th></tr></thead><tbody>{days.map((day) => <tr key={day.localDate}><th scope="row">{shortDate(day.localDate)} <small>周{weekday(day.localDate)}</small></th><td>{day.completedCount} 题</td><td>{day.correctCount} 题</td></tr>)}</tbody></table> : <p className="mobile-detail-state">暂无练习记录</p>;
}

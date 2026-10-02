import type { PracticeHistory } from "./teaching";

export type PracticeDay = Pick<PracticeHistory, "localDate" | "completedCount" | "correctCount">;

export function practiceHistoryByDay(history: PracticeHistory[]): PracticeDay[] {
  const days = new Map<string, PracticeDay>();
  for (const item of history) {
    const day = days.get(item.localDate) ?? { localDate: item.localDate, completedCount: 0, correctCount: 0 };
    day.completedCount += item.completedCount;
    day.correctCount += item.correctCount;
    days.set(item.localDate, day);
  }
  return [...days.values()].sort((a, b) => b.localDate.localeCompare(a.localDate));
}

export function recentPracticeDays(history: PracticeHistory[], now = new Date()): PracticeDay[] {
  const counts = new Map(practiceHistoryByDay(history).map((day) => [day.localDate, day]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index));
    const localDate = date.toISOString().slice(0, 10);
    return counts.get(localDate) ?? { localDate, completedCount: 0, correctCount: 0 };
  });
}

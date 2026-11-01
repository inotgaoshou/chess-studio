// The practice API accepts at most 20 questions. Keep the clicked question in its
// original group rather than silently replacing a list with a one-question test.
export function currentListNumbers(items: { id: string }[]): Record<string, number> {
  return Object.fromEntries([...new Set(items.map(item => item.id))].map((id, i) => [id, i + 1]));
}
const NUMBER_CACHE="qixi-list-numbers-v107";
function numberVisits():Record<string,Record<string,number>>{try{return JSON.parse(localStorage.getItem(NUMBER_CACHE)||"{}");}catch{return {};}}
export function saveListNumbers(scope:string,sessionId:string,numbers:Record<string,number>){
  try{const visits=numberVisits(),key=JSON.stringify([scope,sessionId]);delete visits[key];visits[key]=numbers;localStorage.setItem(NUMBER_CACHE,JSON.stringify(Object.fromEntries(Object.entries(visits).slice(-80))));}catch{/* Numbering is optional presentation context. */}
}
export function loadListNumbers(scope:string,sessionId:string):Record<string,number>{return numberVisits()[JSON.stringify([scope,sessionId])]??{};}

export function practiceGroupIds(items: { id: string }[], selectedId: string): string[] {
  const ids = [...new Set(items.map(item => item.id))];
  const index = ids.indexOf(selectedId);
  if (index < 0) return [];
  const start = Math.floor(index / 20) * 20;
  return ids.slice(start, start + 20);
}

export function initialPracticeItem<T extends { id: string; problem: { id: string }; status: string }>(
  items: T[], currentItemId?: string | null, preferredItemId?: string, preferredProblemId?: string,
): T | undefined {
  if (preferredProblemId) return items.find(item => item.problem.id === preferredProblemId);
  return items.find(item => item.id === preferredItemId)
    ?? items.find(item => item.id === currentItemId)
    ?? items.find(item => item.status === "pending")
    ?? items[0];
}

// Presentation context contains the loaded list, not just the API's 20-item session.
function orderedPracticeIds(numbers: Record<string, number>): string[] {
  return Object.entries(numbers).filter(([, n]) => Number.isInteger(n) && n > 0).sort((a,b) => a[1]-b[1]).map(([id])=>id);
}

export function practiceGroupSummary(numbers: Record<string, number>, currentId: string, totalProblems?: number | null) {
  const ids = orderedPracticeIds(numbers), index = ids.indexOf(currentId);
  if (index < 0) return undefined;
  const complete = typeof totalProblems === "number" && Number.isInteger(totalProblems) && totalProblems >= ids.length;
  const problemCount = complete ? totalProblems : ids.length;
  return { current: Math.floor(index / 20) + 1, total: Math.ceil(problemCount / 20), problemCount, complete };
}

export function adjacentPracticeGroup(numbers: Record<string, number>, currentId: string, direction: -1 | 1): string[] {
  const ids = orderedPracticeIds(numbers);
  const index = ids.indexOf(currentId);
  if (index < 0) return [];
  const start = (Math.floor(index / 20) + direction) * 20;
  return start < 0 ? [] : ids.slice(start, start + 20);
}

export function numberedProblemTitle(title: string): string {
  // Strip only a source ordinal when a separate display ordinal is shown.
  // Mate lengths and substantive names remain untouched; stored titles do not change.
  return title.replace(/^\s*(?:第\s*\d+\s*[题局]|[图题]\s*\d+|\d{3,}(?=[\s.、:：\-－—]))\s*[.、:：·\-－—]*\s*/, "").trim();
}

/** A single list ordinal, with a substantive title only when one exists. */
export function numberedProblemLabel(number: number | undefined, title: string): string {
  if (number == null) return title;
  const name = numberedProblemTitle(title);
  return `第 ${number} 题${name ? ` · ${name}` : ""}`;
}

export type ProblemNavigationStatus = "pending" | "completed" | "revealed" | "verifying";
export function navigationStatus(status: string, verificationState?: "pending_server"): ProblemNavigationStatus {
  if (status === "completed") return verificationState === "pending_server" ? "verifying" : "completed";
  return status === "revealed" ? "revealed" : "pending";
}
export const navigationStatusLabel: Record<ProblemNavigationStatus, string> = {
  pending: "待完成", completed: "已完成", revealed: "已查看解析", verifying: "待复核",
};
export const navigationStatusMark: Record<ProblemNavigationStatus, string> = {
  pending: "", completed: "✓", revealed: "阅", verifying: "…",
};

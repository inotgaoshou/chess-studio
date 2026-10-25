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
export function adjacentPracticeGroup(numbers: Record<string, number>, currentId: string, direction: -1 | 1): string[] {
  const ids = Object.entries(numbers).filter(([, n]) => Number.isInteger(n) && n > 0).sort((a,b) => a[1]-b[1]).map(([id])=>id);
  const index = ids.indexOf(currentId);
  if (index < 0) return [];
  const start = (Math.floor(index / 20) + direction) * 20;
  return start < 0 ? [] : ids.slice(start, start + 20);
}

export function numberedProblemTitle(title: string): string {
  // Strip only a source ordinal when a separate display ordinal is shown.
  // Mate lengths and substantive names remain untouched; stored titles do not change.
  return title.replace(/^\s*(?:第\s*\d+\s*[题局]|[图题]\s*\d+|\d{3,}(?=[\s.、:：\-－—]))\s*[.、:：·\-－—]*\s*/, "") || title;
}

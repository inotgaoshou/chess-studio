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

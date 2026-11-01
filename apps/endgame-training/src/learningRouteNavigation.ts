import type { CatalogProblem } from "./TeachingCatalog";

export type LearningRouteKind = "mate" | "endgame";
export type LearningRouteAction = { label: string; entry: string; step?: string; goal?: string; material?: string; books?: boolean };
export type LearningRouteSelection = { route: LearningRouteKind; stage: string; title: string; entry: string; action?: LearningRouteAction };
const topics: Record<string,string> = {basic_mates:"基础杀法",checking_mates:"连将杀",quiet_mates:"非连将杀",practical_mates:"实战杀法",endgame_mates:"残局杀法",practical_endgames:"实用残局"};
const materials: Record<string,string> = {p:"含兵卒（任一方）",r:"含车（任一方）",n:"含马（任一方）",c:"含炮（任一方）"};

export function learningRouteTarget(action: LearningRouteAction): string {
  const range = action.books ? "书本目录" : action.goal === "draw" ? "求和防守" : action.goal === "endgame_win" ? "残局胜法" : action.material ? materials[action.material] : action.step && action.step !== "all" ? `${action.step}步杀` : "全部题目";
  return `${topics[action.entry] ?? "题库"} › ${range}`;
}
export function learningRouteQuery(action: LearningRouteAction) {
  return {goal:action.goal ?? "",material:action.material ?? "",mateMoves:action.step && action.step !== "all" ? Number(action.step) : undefined};
}
export function learningRouteApplied(selection: LearningRouteSelection | undefined, entry: string, filters: {goal:string;material:string;mateMoves:string;mateGroup:string;difficulty:string;motif:string}, bookView: string, query: string) {
  const action = selection?.action;
  if (!action || action.entry !== entry || query || filters.difficulty || filters.mateGroup || filters.motif) return false;
  const expected = learningRouteQuery(action);
  return filters.goal === expected.goal && filters.material === expected.material && filters.mateMoves === (expected.mateMoves ? String(expected.mateMoves) : "") && bookView === (action.books ? "books" : "all");
}
// Check authoritative goal/step metadata and actual FEN, never infer from titles.
// An older server ignoring a filter must not route the learner into unrelated questions.
export function validateLearningRouteItems(action: LearningRouteAction, items: CatalogProblem[]) {
  const expected = learningRouteQuery(action);
  const invalid = items.some(item => {
    if (expected.goal && item.trainingGoal?.kind !== expected.goal) return true;
    if (expected.mateMoves && item.verifiedMateMoves !== expected.mateMoves) return true;
    const placement = item.startingFen.trim().split(/\s+/)[0].toLowerCase();
    return expected.material ? !(expected.material === "n" ? /[nh]/.test(placement) : placement.includes(expected.material)) : false;
  });
  if (invalid) throw new Error("返回题目与所选范围不一致，暂未跳转。请重试或从题库目录核对，系统不会改跳全部题目。");
}

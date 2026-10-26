import type { VerificationGoal } from "../../../packages/training-verification/types";

// Public source text is archival metadata. Mobile exercise names use only safe
// numbered labels; never try to strip arbitrary authors/book names with a regex.
export function mobileExerciseTitle(problem: {title:string;sourceIndex?:number;displayNumber?:number}): string {
  const title=problem.title.trim();
  if (/^(?:图|题)\s*\d+$/.test(title) || /^(?:净得子|吃子|杀棋)练习\s*\d+$/.test(title)) return title;
  return `第 ${problem.displayNumber ?? (problem.sourceIndex ?? 0)+1} 题`;
}
export function mobileExerciseGoal(goal?: VerificationGoal | null): string {
  return goal ? ({mate:"杀棋",gain_material:"净得子",draw:"求和",endgame_win:"取胜"}[goal.kind] || "习题") : "习题";
}
export function mobileGoalDescription(goal?: VerificationGoal | null): string {
  return goal ? ({mate:"完成绝杀或困毙才算答对。",gain_material:"考虑对方回吃后，仍需获得净子力收益。",draw:"按题目条件保持不败。",endgame_win:"实际取得胜利才算完成。"}[goal.kind] || "") : "";
}
export function mobileTopicName(entry?:string): string {
 return ({basic_mates:"基础杀法",mate_series:"杀法练习",checking_mates:"连将杀",quiet_mates:"非连将杀",capture:"吃子",practical_mates:"实战杀法",middlegame:"中局战术",endgame_mates:"残局杀法",practical_endgames:"实用残局",flying_knives:"飞刀与陷阱"} as Record<string,string>)[entry??""] || "专项练习";
}

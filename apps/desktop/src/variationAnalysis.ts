import { evaluationLabel, evaluationRedShare } from "./analysisView";

export type VariationAnalysisLine = {
  pv: string[];
  notation?: string[];
  scoreCp?: number;
  mate?: number;
  depth?: number;
  nodes?: number;
  timeMs?: number;
};
export type VariationAnalysis = { lines: VariationAnalysisLine[]; elapsedMs?: number };

/** Engine scores are from the side to move; display all evaluations from red's side. */
export function variationEvaluation(fen: string, line?: VariationAnalysisLine) {
  const sign = fen.split(/\s+/)[1] === "b" ? -1 : 1;
  if (line?.mate != null) {
    const redWins = (line.mate > 0 ? 1 : -1) * sign > 0;
    return { label: `${redWins ? "红方" : "黑方"}胜势 · 杀 ${Math.abs(line.mate)}`, redShare: redWins ? 95 : 5 };
  }
  if (line?.scoreCp == null) return { label: "局势待计算", redShare: 50 };
  const score = sign * line.scoreCp;
  return { label: `${Math.abs(score) <= 50 ? "均势" : evaluationLabel(score)} · 红分 ${score > 0 ? "+" : ""}${score}`, redShare: evaluationRedShare(score) };
}

export function variationRound(baseFen: string, cursor: number) {
  const fields = baseFen.split(/\s+/);
  const fullmove = Math.max(1, Number(fields[5]) || 1);
  return fullmove + Math.floor((cursor + (fields[1] === "b" ? 1 : 0)) / 2);
}

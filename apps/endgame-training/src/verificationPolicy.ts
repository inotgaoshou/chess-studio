import type { VerificationResult } from "../../../packages/training-verification/types";
import type { BoardState, TrainingProblem } from "./types";

export const VERIFIER_VERSION = "training-multisolution-v2";
export function needsTerminalWin(problem: Pick<TrainingProblem, "trainingGoal" | "targetMateMoves">) {
  return problem.targetMateMoves != null || ["mate", "endgame_win"].includes(problem.trainingGoal?.kind ?? "");
}
export function terminalWin(problem: Pick<TrainingProblem, "startingFen">, state: BoardState) {
  const solverBlack = problem.startingFen.split(/\s+/)[1] === "b";
  const turnBlack = state.fen.split(/\s+/)[1] === "b";
  return ["将死", "困毙"].includes(state.status) && solverBlack !== turnBlack;
}
export function currentVerification(result: VerificationResult) {
  if (result.verifierVersion !== VERIFIER_VERSION) throw new Error("判题规则已更新，需要重新复核");
  return result;
}

export function missingPlatformGoal(problem: Pick<TrainingProblem,"source"|"serverProblemId"|"trainingGoal"|"targetMateMoves">) {
  return (!!problem.serverProblemId || problem.source === "platform" || problem.source === "teaching") && !problem.trainingGoal && problem.targetMateMoves == null;
}

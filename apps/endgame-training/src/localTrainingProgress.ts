import type { TrainingProblem } from "./types";
import { verificationRequest } from "./answerVerification";
export type LocalTrainingProgress = { content: string; moves: string[]; hints: number; mistakes: number; elapsedMs: number };
const KEY = "qixi-private-training-progress-v1";
function read(): Record<string, LocalTrainingProgress> { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
export function localTrainingProgress(problem: TrainingProblem) {
  if (problem.source === "platform" || problem.source === "teaching") return undefined;
  const saved = read()[problem.id];
  return saved?.content === JSON.stringify(verificationRequest(problem, [], "")) ? saved : undefined;
}
export function saveLocalTrainingProgress(problem: TrainingProblem, progress?: Omit<LocalTrainingProgress, "content">) {
  if (problem.source === "platform" || problem.source === "teaching") return;
  try {
    const records = read(); delete records[problem.id];
    if (progress && (problem.trialOwner || progress.moves.length || progress.elapsedMs > 0 || progress.hints || progress.mistakes)) records[problem.id] = { ...progress, content: JSON.stringify(verificationRequest(problem, [], "")) };
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-100))));
  } catch { /* Private progress remains optional if local storage is full. */ }
}

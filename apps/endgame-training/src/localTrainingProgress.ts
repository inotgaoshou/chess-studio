import type { TrainingProblem } from "./types";
import type { ProblemNavigationStatus } from "./practiceNavigation";
import { verificationRequest } from "./answerVerification";
export type LocalTrainingProgress = { content: string; moves: string[]; hints: number; mistakes: number; elapsedMs: number; outcome?: "completed" | "revealed"; trialOwner?: string; serverProblemId?: string };
const KEY = "qixi-private-training-progress-v1";
function read(): Record<string, LocalTrainingProgress> { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
export function localTrainingProgress(problem: TrainingProblem) {
  if (problem.source === "platform" || problem.source === "teaching") return undefined;
  const saved = read()[problem.id];
  return saved?.content === JSON.stringify(verificationRequest(problem, [], "")) ? saved : undefined;
}
type Draft = Pick<LocalTrainingProgress, "moves" | "hints" | "mistakes" | "elapsedMs">;
function write(records: Record<string, LocalTrainingProgress>) {
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-100))));
}
export function saveLocalTrainingProgress(problem: TrainingProblem, progress?: Draft) {
  if (problem.source === "platform" || problem.source === "teaching") return;
  try {
    const records = read(), saved = localTrainingProgress(problem);
    // A changed content fingerprint must not inherit the old question's result.
    if (problem.trialOwner && problem.serverProblemId) {
      for (const [id, record] of Object.entries(records)) {
        if (record.trialOwner === problem.trialOwner && record.serverProblemId === problem.serverProblemId) delete records[id];
      }
    }
    delete records[problem.id];
    if (progress || saved?.outcome) records[problem.id] = {
      ...(progress ?? {moves:[],hints:0,mistakes:0,elapsedMs:0}),
      content: JSON.stringify(verificationRequest(problem, [], "")),
      outcome: saved?.outcome, trialOwner: problem.trialOwner, serverProblemId: problem.serverProblemId,
    };
    write(records);
  } catch { /* Private progress remains optional if local storage is full. */ }
}
/** Local history stays on this device; teacher trials remain owner-scoped. */
export function saveLocalTrainingOutcome(problem: TrainingProblem, outcome: string) {
  if (problem.source === "platform" || problem.source === "teaching" || (outcome !== "completed" && outcome !== "revealed")) return;
  const draft = localTrainingProgress(problem);
  saveLocalTrainingProgress(problem,draft ?? {moves:[],hints:0,mistakes:0,elapsedMs:0});
  try {
    const records = read(), saved = localTrainingProgress(problem);
    records[problem.id] = {
      ...(saved ?? {moves:[],hints:0,mistakes:0,elapsedMs:0}),
      content: JSON.stringify(verificationRequest(problem, [], "")),
      outcome: saved?.outcome === "completed" ? "completed" : outcome,
      trialOwner: problem.trialOwner, serverProblemId: problem.serverProblemId,
    };
    write(records);
  } catch { /* Trial badges must not prevent completing an exercise. */ }
}
export function localTrialNavigationStatus(owner: string, serverProblemId: string): ProblemNavigationStatus {
  const record = Object.values(read()).reverse().find(record => record.trialOwner === owner && record.serverProblemId === serverProblemId);
  return record?.outcome ?? "pending";
}

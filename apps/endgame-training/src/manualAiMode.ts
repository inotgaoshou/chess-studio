/** The two evaluation phases look identical, but lead to different next modes. */
export type ManualAiPhase = 0 | 1 | 2 | 3;
export type ManualAiMode = "disabled" | "evaluation" | "hints";

export function manualAiMode(phase: ManualAiPhase): ManualAiMode {
  return phase === 0 ? "disabled" : phase === 2 ? "hints" : "evaluation";
}

export function nextManualAiPhase(phase: ManualAiPhase): ManualAiPhase {
  return ((phase + 1) % 4) as ManualAiPhase;
}

export function analysisEntryPhase(phase: ManualAiPhase): ManualAiPhase {
  return phase === 0 ? 2 : phase;
}

export function manualAiLabel(mode: ManualAiMode): string {
  return mode === "disabled" ? "AI 禁用" : mode === "hints" ? "AI 提示" : "AI 局势";
}

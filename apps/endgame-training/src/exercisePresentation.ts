type Account = { user: { role: string; isPlatformAdmin?: boolean } };

// A missing/restoring account must not briefly expose a previous teacher's answers.
export function canViewExerciseSolutions(auth?: Account): boolean {
  if (!auth || auth.user.role === "student") return false;
  return ["coach", "admin"].includes(auth.user.role) || auth.user.isPlatformAdmin === true;
}

export type AnswerAccess = { scope: string; allowed: boolean; generation: number };
export function ownsAnswerAccess(owner: AnswerAccess, current: AnswerAccess): boolean {
  return owner.allowed && current.allowed && owner.scope === current.scope && owner.generation === current.generation;
}

export function exerciseMode<T extends string>(mode: T, allowed: boolean): T | "solver" {
  return !allowed && (mode === "learning" || mode === "replay") ? "solver" : mode;
}

export function hasQuestionNavigation(total: number): boolean {
  return total > 1;
}

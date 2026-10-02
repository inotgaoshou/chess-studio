export function practiceScore(outcome: string | undefined, mistakes: number) {
  return outcome === "completed" ? Math.max(0, 3 - Math.max(0, Math.trunc(mistakes))) : 0;
}

export function firstTryCorrect(outcome: string | undefined, mistakes: number, hints: number) {
  return outcome === "completed" && mistakes === 0 && hints === 0;
}

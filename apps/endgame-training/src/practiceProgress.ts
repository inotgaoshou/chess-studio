import type { PracticeSession, PracticeSessionItem, PracticeAttempt } from "./teaching";

export type PracticeDraft = { cacheKey: string; sessionKey: string; sessionId: string; currentItemId: string; revision: string; draft?: PracticeSessionItem["draft"] };

// Drafts belong to immutable session problem snapshots, never a later content version.
export function mergePracticeDrafts(session: PracticeSession, drafts: PracticeDraft[], navigationAfter = ""): PracticeSession {
  const ordered = [...drafts].sort((a, b) => a.revision.localeCompare(b.revision));
  return {
    ...session,
    currentItemId: ordered.filter(d => d.revision > navigationAfter).at(-1)?.currentItemId ?? session.currentItemId,
    items: session.items.map(item => {
      const saved = [...ordered].reverse().find(d => d.currentItemId === item.id && d.draft);
      if (!saved?.draft) return item;
      const expected = JSON.stringify({ startingFen: item.problem.startingFen, solution: item.problem.solution, goal: item.problem.trainingGoal ?? null, targetMateMoves: item.problem.targetMateMoves ?? null });
      if (saved.draft.verificationContent !== expected) return item;
      return { ...item, status: "pending", grade: undefined, verificationState: undefined, localDraftRevision: saved.revision, draft: saved.draft };
    }),
  };
}

export function practiceContent(problem: PracticeSessionItem["problem"]) {
  return JSON.stringify({ startingFen: problem.startingFen, solution: problem.solution, goal: problem.trainingGoal ?? null, targetMateMoves: problem.targetMateMoves ?? null });
}

export function mergePracticeAttempts(session: PracticeSession, attempts: (PracticeAttempt & { queuedRevision?: string })[]): PracticeSession {
  return { ...session, items: session.items.map(item => {
    const attempt = [...attempts].sort((a,b) => (b.queuedRevision ?? "").localeCompare(a.queuedRevision ?? "")).find(a => a.itemId === item.id);
    if (!attempt || (item.localDraftRevision && item.localDraftRevision > (attempt.queuedRevision ?? ""))) return item;
    return { ...item, status: attempt.outcome, grade: undefined, verificationState: "pending_server", draft: { ...item.draft, moves: attempt.moves, hints: attempt.hintsUsed, mistakes: attempt.mistakes, elapsedMs: attempt.elapsedMs, verificationContent: practiceContent(item.problem) } };
  }) };
}

import type { LocalManualGame } from "./types";
import { appendManualVariation, manualPathExists } from "./variationEditing";
import type { StudyManualBranch } from "./StudyManualTree";
import { moveNotationLabel } from "./moveNotation";

export type ManualContinuation = { id: string; move: string; notation: string; selected: boolean; isMainline: boolean; path: string[] };

/** Build direct children from complete paths, including nested/common-prefix variations. */
export function manualContinuations(moves: string[], notation: string[], branches: StudyManualBranch[], path: string[], activeMoves = moves, activeNotation = notation): ManualContinuation[] {
  const atParent = branches.filter(branch => branch.parentCursor === path.length && branch.parentPath.every((move, index) => path[index] === move));
  const mainSource = atParent.find(branch => branch.moves.join(",") === moves.slice(path.length).join(","))
    ?? atParent.find(branch => branch.moves[0] === moves[path.length]);
  const order = (branch: StudyManualBranch) => branch.branchOrder ?? atParent.indexOf(branch);
  const lines = [
    ...branches.map((branch, index) => ({ id: branch.id, moves: [...branch.parentPath, ...branch.moves], notation: [...Array(branch.parentCursor).fill(""), ...branch.notation], order: branch.parentCursor === path.length ? order(branch) : Infinity, index })),
    { id: "mainline", moves, notation, order: mainSource ? order(mainSource) : Infinity, index: -1 },
    { id: "active-path", moves: activeMoves, notation: activeNotation, order: Infinity, index: branches.length },
  ].sort((a, b) => a.order - b.order || a.index - b.index);
  const result: ManualContinuation[] = [];
  for (const line of lines) {
    if (line.moves.length <= path.length || !path.every((move, index) => line.moves[index] === move)) continue;
    const move = line.moves[path.length];
    const existing = result.find(item => item.move === move);
    if (existing) {
      if (existing.notation === "着法待核对") existing.notation = moveNotationLabel(line.notation[path.length]);
      if (line.id === "mainline") { existing.id = line.id; existing.path = line.moves; }
      continue;
    }
    result.push({ id: line.id, move, notation: moveNotationLabel(line.notation[path.length]), selected: activeMoves[path.length] === move, isMainline: path.every((item, index) => moves[index] === item) && moves[path.length] === move, path: line.moves });
  }
  return result;
}

/** Browsing another path never promotes it to the persisted mainline. */
export function preserveManualMainline(view: LocalManualGame, source: LocalManualGame, notation: string[]): LocalManualGame {
  if (view.id !== source.id || view.startingFen !== source.startingFen) return view;
  let canonical = { ...view, moves: source.moves, cursor: source.cursor, currentFen: source.currentFen, currentNodeId: source.currentNodeId };
  if (!manualPathExists(canonical, view.moves)) canonical = appendManualVariation(canonical, [], view.moves, notation.length === view.moves.length ? notation : view.moves).game;
  return canonical;
}

/** A live projection of a saved append must keep the IDs returned by storage. */
export function reuseSavedBranchIds(branches: StudyManualBranch[], saved: StudyManualBranch[]) {
  return branches.map(branch => {
    const stored = saved.find(item => item.parentPath.join(",") === branch.parentPath.join(",") && item.moves.join(",") === branch.moves.join(","));
    return stored ? { ...branch, id:stored.id, createdAt:stored.createdAt } : branch;
  });
}

/** Expand only a unique tail; a fork waits for the reader to choose a route. */
export function extendManualContinuation(game: Pick<LocalManualGame,"moves"|"branches">, viewed: string[]): string[] {
  if (!manualPathExists(game,viewed)) return viewed;
  const path=[...viewed];
  for (;;) {
    const choices=manualContinuations(game.moves,[],game.branches,path,[],[]);
    if (choices.length!==1) return path;
    path.push(choices[0].move);
  }
}

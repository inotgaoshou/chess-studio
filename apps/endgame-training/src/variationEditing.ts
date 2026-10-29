import type { LocalManualGame } from "./types";
import { sameMoves } from "../../../packages/variation-session";

export function manualPathExists(game: Pick<LocalManualGame, "moves" | "branches">, path: string[]): boolean {
  return [game.moves, ...game.branches.map(branch => [...branch.parentPath, ...branch.moves])].some(line => path.length <= line.length && path.every((move, index) => line[index] === move));
}

/** Merge at the longest common path, never by FEN (transpositions are distinct nodes). */
export function appendManualVariation(game: LocalManualGame, anchor: string[], moves: string[], notation: string[]) {
  if (game.readOnly || game.origin?.kind === "providerMirror") throw new Error("只读棋谱请先复制到我的棋谱");
  if (!moves.length || notation.length !== moves.length) throw new Error("请先校验完整推演线路");
  if (!manualPathExists(game, anchor)) throw new Error("来源节点已删除，请另存临时线路");
  const path = [...anchor, ...moves];
  const paths = [game.moves, ...game.branches.map(branch => [...branch.parentPath, ...branch.moves])];
  let common = 0;
  for (const line of paths) {
    let count = 0;
    while (count < line.length && count < path.length && line[count] === path[count]) count++;
    common = Math.max(common, count);
  }
  if (common >= path.length) return { game, added: 0, path };
  const branch = { id: crypto.randomUUID(), parentCursor: common, parentPath: path.slice(0, common), moves: path.slice(common), notation: notation.slice(common - anchor.length), createdAt: Date.now(), branchOrder: game.branches.filter(item => sameMoves(item.parentPath, path.slice(0, common))).length };
  // A brand new tree has no original mainline to preserve.
  const updated = game.moves.length || game.branches.length ? { ...game, branches: [...game.branches, branch] } : { ...game, moves: path };
  return { game: { ...updated, updatedAt: new Date(Math.max(Date.now(), Date.parse(game.updatedAt) + 1)).toISOString() }, added: path.length - common, path };
}

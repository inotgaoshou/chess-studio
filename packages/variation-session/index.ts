/** Pure session rules shared by phone and desktop. A cursor never changes a line. */
export const sameMoves = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((move, index) => move === b[index]);
export function branchAfter(moves: readonly string[], cursor: number, move: string): string[] {
  // Following the recorded move is navigation; a deviation ends at the new move.
  return moves[cursor] === move ? [...moves] : [...moves.slice(0, cursor), move];
}
export function movesToSave(moves: readonly string[], cursor?: number): string[] {
  return [...(cursor == null ? moves : moves.slice(0, cursor))];
}
export function clampPanel(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { x: Math.max(8, Math.min(x, viewportWidth - Math.min(width, viewportWidth - 16) - 8)), y: Math.max(8, Math.min(y, viewportHeight - Math.min(height, viewportHeight - 16) - 8)) };
}

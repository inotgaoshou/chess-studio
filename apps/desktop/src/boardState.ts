import type { Piece } from "./platform";

const PIECE_LABELS: Record<string, { kind: string; red: string; black: string }> = {
  r: { kind: "rook", red: "车", black: "车" },
  n: { kind: "horse", red: "马", black: "马" },
  b: { kind: "elephant", red: "相", black: "象" },
  a: { kind: "advisor", red: "仕", black: "士" },
  k: { kind: "king", red: "帅", black: "将" },
  c: { kind: "cannon", red: "炮", black: "炮" },
  p: { kind: "pawn", red: "兵", black: "卒" },
};

/**
 * Reconstructs the renderable piece list from a validated Xiangqi FEN.
 * Bridge snapshots are allowed to omit their redundant `pieces` array, but
 * the FEN remains the canonical position and must never be replaced with the
 * standard opening position.
 */
export function piecesFromFen(fen: string): Piece[] {
  const placement = String(fen || "").trim().split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 10) return [];
  const pieces: Piece[] = [];
  for (const [row, rank] of ranks.entries()) {
    let col = 0;
    for (const symbol of rank) {
      if (/^[1-9]$/.test(symbol)) {
        col += Number(symbol);
        continue;
      }
      const descriptor = PIECE_LABELS[symbol.toLowerCase()];
      if (!descriptor || col >= 9) return [];
      const red = symbol === symbol.toUpperCase();
      pieces.push({
        row,
        col,
        color: red ? "red" : "black",
        kind: descriptor.kind,
        label: red ? descriptor.red : descriptor.black,
      });
      col += 1;
    }
    if (col !== 9) return [];
  }
  if (pieces.filter((piece) => piece.kind === "king" && piece.color === "red").length !== 1
    || pieces.filter((piece) => piece.kind === "king" && piece.color === "black").length !== 1) {
    return [];
  }
  return pieces;
}

/** Uses the FEN layout when a bridge response omitted, duplicated or moved pieces. */
export function reconcilePiecesWithFen(fen: string, provided?: Piece[]): Piece[] {
  const expected = piecesFromFen(fen);
  const actual = Array.isArray(provided)
    ? provided.filter((piece): piece is Piece => Boolean(piece && typeof piece === "object"))
    : [];
  // A malformed FEN is not evidence for any piece placement. Returning the
  // bridge's partial list here would render a misleading hybrid position;
  // callers can surface the damaged-position state instead.
  if (expected.length === 0) return [];
  const expectedSquares = new Set(expected.map((piece) => `${piece.row}-${piece.col}-${piece.color}`));
  const actualSquares = new Set(actual.map((piece) => `${piece.row}-${piece.col}-${piece.color}`));
  const complete = actual.length === expected.length
    && actualSquares.size === expectedSquares.size
    && [...expectedSquares].every((square) => actualSquares.has(square));
  return complete ? actual : expected;
}

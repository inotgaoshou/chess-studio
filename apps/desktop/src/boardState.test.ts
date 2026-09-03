import { describe, expect, it } from "vitest";
import { piecesFromFen, reconcilePiecesWithFen } from "./boardState";

describe("piecesFromFen", () => {
  it("restores every piece from the standard position", () => {
    const pieces = piecesFromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    expect(pieces).toHaveLength(32);
    expect(pieces.filter((piece) => piece.color === "red")).toHaveLength(16);
    expect(pieces.filter((piece) => piece.color === "black")).toHaveLength(16);
    expect(pieces.find((piece) => piece.row === 9 && piece.col === 7)).toMatchObject({ kind: "horse", color: "red", label: "马" });
  });

  it("preserves custom endgame positions instead of falling back to the opening", () => {
    expect(piecesFromFen("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1")).toEqual([
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
    ]);
  });

  it("rejects malformed positions", () => {
    expect(piecesFromFen("fen")).toEqual([]);
    expect(piecesFromFen("9/9/9/9/9/9/9/9/9/9 w - - 0 1")).toEqual([]);
  });

  it("does not trust bridge pieces when the FEN is malformed", () => {
    const provided = [{ row: 9, col: 4, color: "red" as const, kind: "king", label: "帅" }];
    expect(reconcilePiecesWithFen("not-a-fen", provided)).toEqual([]);
  });

  it("repairs a partial bridge list from the FEN layout", () => {
    const fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    const pieces = piecesFromFen(fen);
    expect(reconcilePiecesWithFen(fen, pieces.slice(0, -3))).toHaveLength(32);
    expect(reconcilePiecesWithFen(fen, pieces.slice(0, -3))).toEqual(pieces);
  });
});

import { describe, expect, it } from "vitest";
import { buildSelectedPieceThought } from "./pieceThoughtModel";
import type { AnalysisLine, BoardState, MoveItem, Piece } from "./platform/types";

const redHorse: Piece = { row: 9, col: 1, color: "red", kind: "horse", label: "马" };
const redRook: Piece = { row: 9, col: 0, color: "red", kind: "rook", label: "车" };
const blackCannon: Piece = { row: 2, col: 1, color: "black", kind: "cannon", label: "炮" };

const board: Pick<BoardState, "fen" | "sideToMove"> = {
  fen: "position-fen",
  sideToMove: "红方",
};

function selection(piece: Piece) {
  return {
    piece,
    square: { row: piece.row, col: piece.col },
    fen: board.fen,
    sideToMove: board.sideToMove,
  };
}

describe("pieceThoughtModel", () => {
  it("matches fresh engine candidates by the selected piece source square", () => {
    const lines: AnalysisLine[] = [
      { multipv: 1, depth: 20, scoreCp: 80, pv: ["b0c2", "h9g7"], notation: ["马八进七", "马8进7"] },
      { multipv: 2, depth: 18, scoreCp: 35, pv: ["h2e2"], notation: ["炮二平五"] },
      { multipv: 3, depth: 16, scoreCp: 20, pv: ["b0a2"], notation: ["马八进九"] },
    ];

    const thought = buildSelectedPieceThought({
      selection: selection(redHorse),
      board,
      analysisLines: lines,
      analysisFen: board.fen,
      analysisIsStale: false,
    });

    expect(thought?.source).toBe("engine");
    expect(thought?.sourceLabel).toBe("引擎候选");
    expect(thought?.role).toContain("至少有 2 个推荐方向");
    expect(thought?.candidates.map((candidate) => candidate.notation)).toEqual(["马八进七", "马八进九"]);
    expect(thought?.candidates[0]).toMatchObject({ scoreText: "+80", depth: 20 });
  });

  it("falls back to piece-type chess principles when no engine candidate matches", () => {
    const thought = buildSelectedPieceThought({
      selection: selection(redRook),
      board,
      analysisLines: [{ multipv: 1, scoreCp: 50, pv: ["b0c2"], notation: ["马八进七"] }],
      analysisFen: board.fen,
      analysisIsStale: false,
    });

    expect(thought?.source).toBe("fallback");
    expect(thought?.role).toContain("直线控制");
    expect(thought?.risk).toContain("关键防线");
    expect(thought?.nextAction).toContain("开放线");
  });

  it("rejects opposing pieces and stale positions", () => {
    expect(buildSelectedPieceThought({
      selection: selection(blackCannon),
      board,
      analysisLines: [],
      analysisFen: board.fen,
    })).toBeUndefined();

    expect(buildSelectedPieceThought({
      selection: { ...selection(redHorse), fen: "old-fen" },
      board,
      analysisLines: [],
      analysisFen: "old-fen",
    })).toBeUndefined();
  });

  it("can reuse the current move thought when the selected square is the moved piece", () => {
    const currentMove: MoveItem = {
      id: "m1",
      iccs: "b0c2",
      notation: "马八进七",
      movedBy: "红方",
      from: { row: 9, col: 1 },
      to: { row: 7, col: 2 },
      comment: "意图：补马护中兵\n风险：左车出动稍慢\n计划：再出车占线",
      isMainline: true,
    };
    const movedHorse: Piece = { ...redHorse, row: 7, col: 2 };
    const thought = buildSelectedPieceThought({
      selection: { piece: movedHorse, square: { row: 7, col: 2 }, fen: board.fen, sideToMove: "红方" },
      board,
      analysisLines: [],
      analysisFen: undefined,
      currentMove,
    });

    expect(thought?.source).toBe("move");
    expect(thought?.role).toContain("补马护中兵");
    expect(thought?.risk).toContain("左车出动稍慢");
    expect(thought?.nextAction).toContain("再出车占线");
  });
});

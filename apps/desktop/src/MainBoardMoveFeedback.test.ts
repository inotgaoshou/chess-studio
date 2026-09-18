import { describe, expect, it } from "vitest";
import { createMoveFeedback } from "./MainBoardMoveFeedback";
import type { BoardState, Piece } from "./platform";

const redRook: Piece = { row: 9, col: 0, color: "red", kind: "rook", label: "车" };
const blackPawn: Piece = { row: 5, col: 0, color: "black", kind: "pawn", label: "卒" };
const blackKing: Piece = { row: 0, col: 4, color: "black", kind: "king", label: "将" };

function board(overrides: Partial<BoardState> = {}): BoardState {
  return {
    fen: "test-fen",
    rootSideToMove: "红方",
    sideToMove: "红方",
    status: "进行中",
    pieces: [redRook, blackPawn, blackKing],
    history: [],
    continuation: [],
    branches: [],
    title: "测试棋谱",
    note: "",
    playable: true,
    ...overrides,
  };
}

const move = { id: "move-1", iccs: "a0a4", notation: "车一进五", movedBy: "红方" as const, from: { row: 9, col: 0 }, to: { row: 5, col: 0 }, comment: "", isMainline: true };

describe("createMoveFeedback", () => {
  it("derives a capture from the before-move board snapshot", () => {
    const feedback = createMoveFeedback(board(), board({ currentNode: "move-1", pieces: [{ ...redRook, row: 5 }, blackKing], history: [move] }));

    expect(feedback).toMatchObject({ kind: "capture", mover: redRook, captured: blackPawn });
  });

  it("prioritizes the check feedback while retaining the captured piece", () => {
    const feedback = createMoveFeedback(board(), board({ status: "将军", currentNode: "move-1", pieces: [{ ...redRook, row: 5 }, blackKing], history: [move] }));

    expect(feedback).toMatchObject({ kind: "check", captured: blackPawn, checkedKing: blackKing });
  });

  it("uses distinct feedback for checkmate", () => {
    const feedback = createMoveFeedback(board(), board({ status: "将死", currentNode: "move-1", pieces: [{ ...redRook, row: 5 }, blackKing], history: [move] }));

    expect(feedback).toMatchObject({ kind: "checkmate", captured: blackPawn, checkedKing: blackKing });
  });

  it("ignores snapshots that are not exactly one real move later", () => {
    expect(createMoveFeedback(board(), board({ history: [move, { ...move, id: "move-2" }] }))).toBeUndefined();
  });
});

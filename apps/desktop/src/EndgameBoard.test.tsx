/// <reference path="../../endgame-training/src/build-meta.d.ts" />
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__APP_BUILD_TIME__", "2026-09-21T00:00:00Z");
});
import { Board, ManualFolderTree, setupPiecePlacementError, setupValidationError } from "../../endgame-training/src/App";
import type { BoardPiece } from "../../endgame-training/src/types";

const pieces: BoardPiece[] = [
  { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
  { row: 9, col: 1, color: "red", kind: "horse", label: "马" },
];
const defaults = { pieces, boardSkin: "default", pieceSkin: "default", riverText: "", riverTextColor: "#000", riverTextSize: 20, supportsCustomRiverText: false };
function InteractiveBoard({ setupMode = false }: { setupMode?: boolean }) {
  const [selected, setSelected] = useState<{ row: number; col: number }>();
  return <Board {...defaults} setupMode={setupMode} selected={selected} onSquare={(square) => setSelected((old) => old?.row === square.row && old.col === square.col ? undefined : square)}/>;
}
afterEach(cleanup);

describe("endgame shared board selection", () => {
  it.each([false, true])("lifts only one piece and switches selection (setup=%s)", (setupMode) => {
    const { container, getByRole } = render(<InteractiveBoard setupMode={setupMode}/>);
    const rook = getByRole("button", { name: "a0 红车" });
    const horse = getByRole("button", { name: "b0 红马" });
    fireEvent.click(rook);
    expect(rook.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(horse);
    expect(rook.getAttribute("aria-pressed")).toBe("false");
    expect(horse.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".selected .piece-lift")).toHaveLength(1);
    expect(container.querySelectorAll(".piece-ground-shadow")).toHaveLength(2);
  });

  it.each([1, 2])("keeps a picked-up piece down after double tap/click (detail=%s)", (detail) => {
    const { getByRole } = render(<InteractiveBoard/>);
    const rook = getByRole("button", { name: "a0 红车" });
    fireEvent.click(rook);
    fireEvent.click(rook, { detail: 1 });
    fireEvent.click(rook, { detail });
    expect(rook.getAttribute("aria-pressed")).toBe("false");
    // Suppression is consumed, not a permanent ban on this square.
    fireEvent.click(rook);
    expect(rook.getAttribute("aria-pressed")).toBe("true");
  });

  it("clears double-tap suppression when the board position changes", () => {
    const onSquare = vi.fn();
    const { getByRole, rerender } = render(<Board {...defaults} selected={pieces[0]} onSquare={onSquare}/>);
    fireEvent.click(getByRole("button", { name: "a0 红车" }));
    rerender(<Board {...defaults} pieces={[...pieces]} onSquare={onSquare}/>);
    fireEvent.click(getByRole("button", { name: "a0 红车" }), { detail: 2 });
    expect(onSquare).toHaveBeenCalledTimes(2);
  });
});


describe("endgame selection markers", () => {
  it("uses lift alone for selection and restores overlapping last-move markers on release", () => {
    const { container, rerender } = render(<Board {...defaults} selected={pieces[0]} onSquare={() => {}}/>);
    expect(container.querySelectorAll(".board-marker-layer path")).toHaveLength(0);
    rerender(<Board {...defaults} selected={pieces[0]} lastMove="a1a0" onSquare={() => {}}/>);
    expect(container.querySelectorAll(".board-marker-layer path")).toHaveLength(1);
    rerender(<Board {...defaults} lastMove="a1a0" onSquare={() => {}}/>);
    expect(container.querySelectorAll(".board-marker-layer path")).toHaveLength(2);
    rerender(<Board {...defaults} selected={pieces[0]} lastMove="a0a1" flipped onSquare={() => {}}/>);
    expect(container.querySelectorAll(".board-marker-layer path")).toHaveLength(1);
  });
});


describe("setup king placement", () => {
  it.each(["red", "black"] as const)("allows every %s palace square and rejects all other intersections", (color) => {
    const king = { color, kind: "king", label: color === "red" ? "帅" : "将" };
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const inPalace = col >= 3 && col <= 5 && (color === "red" ? row >= 7 : row <= 2);
        expect(setupPiecePlacementError(king, { row, col }) === "").toBe(inPalace);
      }
    }
  });
  it("allows repositioning a king while retaining final facing-kings validation", () => {
    const kings: BoardPiece[] = [
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
    ];
    expect(setupValidationError(kings)).toContain("白脸相对");
    expect(setupValidationError([{ ...kings[0], row: 2, col: 3 }, kings[1]])).toBe("");
    expect(setupValidationError([kings[0]])).toContain("各一个");
  });
});

describe("endgame capture hit targets", () => {
  it.each([false, true])("forwards an enemy target even after putting down a piece (flipped=%s)", (flipped) => {
    const black: BoardPiece = { row: 4, col: 4, color: "black", kind: "pawn", label: "卒" };
    const red: BoardPiece = { row: 5, col: 4, color: "red", kind: "pawn", label: "兵" };
    const onSquare = vi.fn();
    const props = { ...defaults, pieces: [black, red], flipped, onSquare };
    const { getByRole, rerender } = render(<Board {...props} selected={red}/>);
    fireEvent.click(getByRole("button", { name: "e4 红兵" }));
    rerender(<Board {...props} selected={black}/>);
    fireEvent.click(getByRole("button", { name: "e5 黑卒" }));
    rerender(<Board {...props} selected={black}/>);
    fireEvent.click(getByRole("button", { name: "e4 红兵" }), { detail: 2 });
    expect(onSquare).toHaveBeenLastCalledWith({ row: 5, col: 4 });
    expect(onSquare).toHaveBeenCalledTimes(3);
  });
});

describe("setup pawn restrictions", () => {
  it.each(["red", "black"] as const)("accepts only reachable %s pawn placement squares", (color) => {
    const pawn = { color, kind: "pawn", label: color === "red" ? "兵" : "卒" };
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const legal = color === "red"
          ? row <= 4 || row <= 6 && col % 2 === 0
          : row >= 5 || row >= 3 && col % 2 === 0;
        expect(setupPiecePlacementError(pawn, { row, col }) === "").toBe(legal);
      }
    }
  });
  it.each(["red", "black"] as const)("allows repositioning %s pawns backwards and across home files in setup", (color) => {
    const pawn = { color, kind: "pawn", label: color === "red" ? "兵" : "卒" };
    const riverRow = color === "red" ? 5 : 4;
    const initialRow = color === "red" ? 6 : 3;
    // Setup validates the destination, independent of any prior position.
    expect(setupPiecePlacementError(pawn, { row: initialRow, col: 4 })).toBe("");
    expect(setupPiecePlacementError(pawn, { row: riverRow, col: 2 })).toBe("");
    expect(setupPiecePlacementError(pawn, { row: riverRow, col: 3 })).toContain("未过河");
  });
  it("validates illegal pawn locations again when completing a setup", () => {
    expect(setupValidationError([{ row: 5, col: 3, color: "red", kind: "pawn", label: "兵" }])).toContain("未过河");
    expect(setupValidationError([{ row: 7, col: 4, color: "red", kind: "pawn", label: "兵" }])).toContain("初始兵卒线后方");
  });
});

describe("manual folder hierarchy", () => {
  it("keeps parent and new nested folders visible, marks current directory, and navigates", () => {
    const onSelect = vi.fn();
    const parent = { path: "比赛", createdAt: "2026-09-22" };
    const { getByRole, rerender } = render(<ManualFolderTree folders={[parent]} currentPath="比赛" onSelect={onSelect}/>);
    rerender(<ManualFolderTree folders={[parent, { path: "比赛/第1轮", createdAt: "2026-09-22" }]} currentPath="比赛/第1轮" onSelect={onSelect}/>);
    const child = getByRole("button", { name: "目录：比赛/第1轮" });
    expect(child.getAttribute("aria-current")).toBe("location");
    const parentButton = getByRole("button", { name: "目录：比赛" });
    expect(parentButton.getAttribute("aria-current")).toBeNull();
    expect(parentButton.closest("li")?.contains(child)).toBe(true);
    fireEvent.click(parentButton);
    expect(onSelect).toHaveBeenLastCalledWith("比赛");
    fireEvent.click(getByRole("button", { name: "全部棋谱" }));
    expect(onSelect).toHaveBeenLastCalledWith("");
  });
});

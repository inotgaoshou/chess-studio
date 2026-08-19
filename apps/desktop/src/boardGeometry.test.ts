import { describe, expect, it } from "vitest";
import {
  BOARD_ART_HEIGHT,
  BOARD_ART_WIDTH,
  BOARD_CELL_ORIGIN,
  BOARD_CELL_WIDTH,
  boardCellStyle,
  boardIntersectionPoint,
  boardCanonicalSquare,
  boardDisplaySquare,
  boardSkinFromAssetPath,
} from "./boardGeometry";

describe("boardGeometry", () => {
  it("keeps a main-board hit cell centred on the same native intersection as pieces and markers", () => {
    const square = { row: 6, col: 4 };
    const intersection = boardIntersectionPoint(square);
    const cell = boardCellStyle(square);

    const cellLeft = Number.parseFloat(cell.left) / 100 * BOARD_ART_WIDTH;
    const cellTop = Number.parseFloat(cell.top) / 100 * BOARD_ART_HEIGHT;
    expect(cellLeft).toBe(BOARD_CELL_ORIGIN + square.col * BOARD_CELL_WIDTH);
    expect(cellTop).toBe(BOARD_CELL_ORIGIN + square.row * BOARD_CELL_WIDTH);
    expect(cellLeft + BOARD_CELL_WIDTH / 2).toBe(intersection.x);
    expect(cellTop + BOARD_CELL_WIDTH / 2).toBe(intersection.y);
  });

  it("flips only presentation coordinates while preserving the canonical square", () => {
    const canonical = { row: 2, col: 1 };
    expect(boardDisplaySquare(canonical, true)).toEqual({ row: 7, col: 7 });
    expect(boardCanonicalSquare({ row: 7, col: 7 }, true)).toEqual(canonical);
    expect(boardIntersectionPoint(canonical, true)).toEqual({ x: 920, y: 920 });
    expect(boardCellStyle(canonical, true)).toEqual({
      left: `${(860 / BOARD_ART_WIDTH) * 100}%`,
      top: `${(860 / BOARD_ART_HEIGHT) * 100}%`,
    });
  });

  it("uses the actual qingxin-zhuyun artwork intersections for pieces, hit cells, and markers", () => {
    const square = { row: 0, col: 1 };
    const intersection = boardIntersectionPoint(square, false, "qingxin-zhuyun");
    const cell = boardCellStyle(square, false, "qingxin-zhuyun");

    expect(intersection).toEqual({ x: 205, y: 85 });
    expect(boardIntersectionPoint(square, true, "qingxin-zhuyun")).toEqual({ x: 915, y: 1145 });
    expect(Number.parseFloat(cell.left) / 100 * BOARD_ART_WIDTH + BOARD_CELL_WIDTH / 2).toBeCloseTo(intersection.x, 8);
    expect(Number.parseFloat(cell.top) / 100 * BOARD_ART_HEIGHT + BOARD_CELL_WIDTH / 2).toBeCloseTo(intersection.y, 8);
  });

  it("keeps the default wood-board move marker on its measured line intersection", () => {
    const square = { row: 1, col: 1 };
    const intersection = boardIntersectionPoint(square, false, "default");
    const cell = boardCellStyle(square, false, "default");

    expect(intersection).toEqual({ x: 197, y: 188 });
    expect(boardIntersectionPoint(square, true, "default")).toEqual({ x: 923, y: 1044 });
    expect(Number.parseFloat(cell.left) / 100 * BOARD_ART_WIDTH + BOARD_CELL_WIDTH / 2).toBeCloseTo(intersection.x, 8);
    expect(Number.parseFloat(cell.top) / 100 * BOARD_ART_HEIGHT + BOARD_CELL_WIDTH / 2).toBeCloseTo(intersection.y, 8);
  });

  it("derives measured geometry only from a bundled board asset path", () => {
    expect(boardSkinFromAssetPath("/skins/qingxin-zhuyun/board.png")).toBe("qingxin-zhuyun");
    expect(boardSkinFromAssetPath("/skins/default/board.png?rev=3")).toBe("default");
    expect(boardSkinFromAssetPath("/skins/qingxin-zhuyun/mask2.png")).toBeUndefined();
  });
});

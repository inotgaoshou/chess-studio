import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PositionEditorBoard } from "./PositionEditorBoard";

describe("PositionEditorBoard", () => {
  it("uses the workbench artwork, current skins, and measured board intersections", () => {
    const edit = vi.fn();
    render(
      <PositionEditorBoard
        cells={[{ row: 0, col: 0 }]}
        pieces={new Map([["0-0", { row: 0, col: 0, color: "black", kind: "rook", label: "车" }]])}
        boardSkin="hongmu"
        pieceSkin="jingdian"
        pieceAsset={() => "/skins/jingdian/br.png"}
        onPieceAssetError={() => undefined}
        onEditSquare={edit}
        squareLabel={() => "a9"}
      />,
    );

    const board = screen.getByLabelText("局面编辑棋盘");
    expect(board.className).toContain("board-skin-hongmu");
    expect(board.className).toContain("piece-skin-jingdian");
    expect(board.querySelector(".board-art")).toBeTruthy();
    expect(board.querySelector(".editor-board-square")?.getAttribute("style")).toContain("--piece-left");

    fireEvent.click(screen.getByRole("button", { name: "编辑 a9" }));
    expect(edit).toHaveBeenCalledWith(0, 0);
  });
});

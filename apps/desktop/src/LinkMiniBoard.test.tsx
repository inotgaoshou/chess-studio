import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_ART_HEIGHT, BOARD_ART_WIDTH, boardIntersectionPoint, boardIntersectionStyle, LinkMiniBoard, reconcileLinkMiniPieces } from "./LinkMiniBoard";
import type { Piece } from "./platform";

const pieces: Piece[] = [
  { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
  { row: 0, col: 4, color: "black", kind: "king", label: "将" },
];

describe("LinkMiniBoard", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("marks the previous linked move on the mini board", () => {
    const view = render(
      <LinkMiniBoard
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByLabelText("上一着红方：兵五进一")).toBeTruthy();
    expect(screen.getByText("黑方行棋")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-last-from")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-to")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow-flow")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-move.red")).not.toBeNull();
  });

  it("uses a black marker when the previous linked move was made by black", () => {
    const view = render(
      <LinkMiniBoard
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 0, col: 1 }, to: { row: 2, col: 2 }, notation: "马8进7", movedBy: "黑方" }}
        sideToMove="红方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByLabelText("上一着黑方：马8进7")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-last-move.black")).not.toBeNull();
  });

  it("renders a preview move marker above pieces so the flyknife arrow remains visible", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    const board = screen.getByLabelText("飞刀预演棋盘");
    const marker = view.container.querySelector(".link-mini-last-move.overlay");
    expect(marker).not.toBeNull();
    expect(board.lastElementChild).toBe(marker);
    expect(view.container.querySelector(".link-mini-board-wrap.preview")).not.toBeNull();
  });

  it("uses four-corner source and destination marks for screenshot recognition", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        markerStyle="corner"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-corner-source")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-corner-target")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
  });

  it("renders the tiantian-style previous move with a source ring and target piece border", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        markerStyle="tiantian"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByLabelText("上一着红方：兵五进一")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-last-move.tiantian-marker")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source-ring")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target-ring")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source-crosshair")).toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source-center")?.getAttribute("r")).toBe("7.6");
    expect(view.container.querySelector(".link-mini-tiantian-source-flow")).toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target-flow-white")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target-flow-blue")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target-flow-red")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-from")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-to")).toBeNull();
  });

  it("uses a compact static white ring with a centered red dot for the tiantian move source", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        markerStyle="tiantian"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelector(".link-mini-tiantian-source-ring")?.getAttribute("r")).toBe("19");
    expect(view.container.querySelector(".link-mini-tiantian-source-crosshair")).toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source-center")?.getAttribute("r")).toBe("7.6");
    expect(view.container.querySelector(".link-mini-tiantian-source-center")?.getAttribute("fill")).toBe("rgba(255, 255, 255, .98)");
    expect(view.container.querySelector(".link-mini-tiantian-source-glow")).toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-source-flow")).toBeNull();
  });

  it("keeps four-corner markers red when the previous move was made by black", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        markerStyle="corner"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 0, col: 1 }, to: { row: 2, col: 2 }, notation: "马8进7", movedBy: "黑方" }}
        sideToMove="红方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelector(".link-mini-last-move.corner-marker.red")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-move.corner-marker.black")).toBeNull();
  });

  it("shares the 1120 × 1240 main-board intersections with pieces and corner markers", () => {
    expect(BOARD_ART_WIDTH).toBe(1120);
    expect(BOARD_ART_HEIGHT).toBe(1240);
    expect(boardIntersectionPoint({ row: 0, col: 0 })).toEqual({ x: 80, y: 80 });
    expect(boardIntersectionPoint({ row: 9, col: 8 })).toEqual({ x: 1040, y: 1160 });
    expect(boardIntersectionPoint({ row: 0, col: 0 }, true)).toEqual({ x: 1040, y: 1160 });
    expect(boardIntersectionStyle({ row: 0, col: 0 })).toEqual({ left: "7.142857142857142%", top: "6.451612903225806%" });
  });

  it("renders a selected source as a red corner marker without a move arrow", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        markerStyle="corner"
        selectedSquare={{ row: 6, col: 4 }}
        pieces={pieces}
        arrows={[]}
        boardAriaLabel="U10 临时推演棋盘"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByLabelText("U10 临时推演棋盘")).toBeTruthy();
    expect(screen.getByLabelText("已选起点")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-to")).toBeNull();
  });

  it("keeps preview arrow endpoints attached to the moved piece intersections", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        pieces={pieces}
        arrows={[]}
        lastMove={{ from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, notation: "兵五进一", movedBy: "红方" }}
        pieceAsset={() => "/piece.png"}
      />,
    );

    const arrow = view.container.querySelector(".link-mini-last-arrow");
    expect(Math.abs(Number(arrow?.getAttribute("y1")) - 800)).toBeLessThanOrEqual(4);
    expect(Math.abs(Number(arrow?.getAttribute("y2")) - 680)).toBeLessThanOrEqual(4);
  });

  it("shows numbered candidate arrow labels in the linked preview", () => {
    render(
      <LinkMiniBoard
        pieces={pieces}
        arrows={[
          { rank: 1, color: "#d75a5a", from: { row: 7, col: 4 }, to: { row: 8, col: 4 } },
          { rank: 2, color: "#5aa0d7", from: { row: 7, col: 4 }, to: { row: 8, col: 3 } },
          { rank: 3, color: "#b889d7", from: { row: 7, col: 4 }, to: { row: 8, col: 5 } },
        ]}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByLabelText("候选箭头编号：1、2、3")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(document.querySelectorAll(".link-mini-arrow-label.high-contrast")).toHaveLength(3);
    expect(document.querySelector(".link-mini-arrow-stem-backdrop")).not.toBeNull();
    expect(document.querySelector(".link-mini-arrow-stem-outline")).not.toBeNull();
    expect(document.querySelector(".link-mini-arrow-stem")).not.toBeNull();
    expect(document.querySelectorAll(".link-mini-arrow-flow-marker")).toHaveLength(3);
  });

  it("renders the xiangqi river gap and labels", () => {
    const view = render(
      <LinkMiniBoard
        pieces={pieces}
        arrows={[]}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(screen.getByText("楚河")).toBeTruthy();
    expect(screen.getByText("汉界")).toBeTruthy();
    expect(view.container.querySelectorAll(".link-mini-board-grid g").length).toBeGreaterThan(0);
  });

  it("uses the supplied board skin without drawing a second fallback grid or enlarging pieces", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        pieces={pieces}
        arrows={[]}
        boardAsset="/skins/default/board.png"
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelector(".link-mini-board-grid")).toBeNull();
    expect(view.container.querySelector(".link-mini-piece")?.getAttribute("style")).toContain("width: 9.214285714285715%");
  });

  it("keeps the moved piece render key stable so synced moves can animate smoothly", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const first = reconcileLinkMiniPieces(before, undefined);
    const second = reconcileLinkMiniPieces(
      after,
      { from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一平二", movedBy: "红方" },
      first.pieces,
      first.nextId,
    );

    expect(first.pieces.find((piece) => piece.kind === "rook")?.renderKey)
      .toBe(second.pieces.find((piece) => piece.kind === "rook")?.renderKey);
    expect(second.pieces.find((piece) => piece.kind === "rook")?.shouldAnimateMove).toBe(true);
    expect(second.pieces.find((piece) => piece.kind === "rook")?.moveFrom).toEqual({ row: 9, col: 8 });
    expect(second.pieces.filter((piece) => piece.shouldAnimateMove)).toHaveLength(1);
    expect(second.pieces.filter((piece) => piece.kind === "king").some((piece) => piece.shouldAnimateMove)).toBe(false);
  });

  it("only gives the moved piece the movement animation class during sync", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
    ];
    const view = render(
      <LinkMiniBoard
        pieces={before}
        arrows={[]}
        pieceAsset={() => "/piece.png"}
      />,
    );

    view.rerender(
      <LinkMiniBoard
        pieces={after}
        arrows={[]}
        lastMove={{ from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" }}
        pieceAsset={() => "/piece.png"}
      />,
    );

    const animatedPieces = view.container.querySelectorAll(".link-mini-piece.move-animate");
    expect(animatedPieces).toHaveLength(1);
    expect(animatedPieces[0]?.getAttribute("data-piece")).toBe("red-rook");
    expect(animatedPieces[0]?.getAttribute("data-square")).toBe("8-8");
    expect(animatedPieces[0]?.getAttribute("style")).toContain("--link-mini-move-from-left");
    expect(animatedPieces[0]?.getAttribute("style")).toContain("--link-mini-move-to-left");
    expect(Array.from(view.container.querySelectorAll(".link-mini-piece:not(.move-animate)")).every((piece) => !piece.getAttribute("style")?.includes("--link-mini-move-from"))).toBe(true);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(1);
    expect(Array.from(view.container.querySelectorAll(".link-mini-piece:not(.move-animate):not(.move-arrive)")).every((piece) => !piece.classList.contains("capture-animate"))).toBe(true);
  });

  it("can keep an interactive training board static while its temporary line changes", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        animateMoves={false}
        pieces={before}
        arrows={[]}
        pieceAsset={() => "/piece.png"}
      />,
    );

    view.rerender(
      <LinkMiniBoard
        presentation="preview"
        animateMoves={false}
        pieces={after}
        arrows={[]}
        lastMove={{ from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" }}
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(0);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(0);
    expect(view.container.querySelectorAll(".link-mini-piece.capture-animate")).toHaveLength(0);
  });

  it("expires linked move animation classes after the smooth sync window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
    ];
    const lastMove = { from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" as const };
    const view = render(
      <LinkMiniBoard
        pieces={before}
        arrows={[]}
        pieceAsset={() => "/piece.png"}
      />,
    );

    view.rerender(
      <LinkMiniBoard
        pieces={after}
        arrows={[]}
        lastMove={lastMove}
        pieceAsset={() => "/piece.png"}
      />,
    );
    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(1);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(1);

    vi.setSystemTime(400);
    view.rerender(
      <LinkMiniBoard
        pieces={after}
        arrows={[]}
        lastMove={lastMove}
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(0);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("keeps a short capture ghost when a synced move takes a piece", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 8, col: 8, color: "black", kind: "pawn", label: "卒" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const view = render(
      <LinkMiniBoard
        pieces={before}
        arrows={[]}
        pieceAsset={() => "/piece.png"}
      />,
    );

    view.rerender(
      <LinkMiniBoard
        pieces={after}
        arrows={[]}
        lastMove={{ from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" }}
        pieceAsset={() => "/piece.png"}
      />,
    );

    const capturedPieces = view.container.querySelectorAll(".link-mini-piece.capture-animate");
    expect(capturedPieces).toHaveLength(1);
    expect(capturedPieces[0]?.getAttribute("data-piece")).toBe("black-pawn");
    expect(capturedPieces[0]?.getAttribute("data-square")).toBe("8-8");
    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(1);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(1);
  });

  it("ignores unrelated jitter frames and only applies the confirmed linked move", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
    ];
    const jitterAfter: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 8, col: 0, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 2, color: "red", kind: "cannon", label: "炮" },
    ];
    const first = reconcileLinkMiniPieces(before, undefined);
    const second = reconcileLinkMiniPieces(
      jitterAfter,
      { from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" },
      first.pieces,
      first.nextId,
      { stabilizeLinkedMove: true },
    );

    expect(second.pieces.map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "red-cannon-7-1",
      "red-king-9-4",
      "red-rook-8-8",
      "red-rook-9-0",
    ]);
    expect(second.pieces.filter((piece) => piece.shouldAnimateMove)).toHaveLength(1);
    expect(second.pieces.find((piece) => piece.row === 8 && piece.col === 8)?.shouldAnimateMove).toBe(true);
  });

  it("recovers a missing static piece during a linked move without animating it", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 2, color: "red", kind: "cannon", label: "炮" },
      { row: 9, col: 2, color: "red", kind: "elephant", label: "相" },
    ];
    const first = reconcileLinkMiniPieces(before, undefined);
    const second = reconcileLinkMiniPieces(
      after,
      { from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" },
      first.pieces,
      first.nextId,
      { stabilizeLinkedMove: true },
    );

    expect(second.pieces.map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "red-cannon-7-1",
      "red-elephant-9-2",
      "red-king-9-4",
      "red-rook-8-8",
    ]);
    expect(second.pieces.find((piece) => piece.kind === "elephant")?.shouldAnimateMove).toBe(false);
    expect(second.pieces.filter((piece) => piece.shouldAnimateMove)).toHaveLength(1);
  });

  it("rejects static recovery when the incoming frame only color-flips a piece", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 6, col: 0, color: "black", kind: "pawn", label: "卒" },
    ];
    const colorFlickerAfter: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 6, col: 1, color: "red", kind: "pawn", label: "兵" },
    ];
    const first = reconcileLinkMiniPieces(before, undefined);
    const second = reconcileLinkMiniPieces(
      colorFlickerAfter,
      { from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" },
      first.pieces,
      first.nextId,
      { stabilizeLinkedMove: true },
    );

    expect(second.pieces.map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "black-pawn-6-0",
      "red-king-9-4",
      "red-rook-8-8",
    ]);
    expect(second.pieces.filter((piece) => piece.shouldAnimateMove)).toHaveLength(1);
  });

  it("renders a recovered static piece without a move animation class", () => {
    const before: Piece[] = [
      ...pieces,
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const after: Piece[] = [
      ...pieces,
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 2, color: "red", kind: "elephant", label: "相" },
    ];
    const view = render(
      <LinkMiniBoard
        pieces={before}
        arrows={[]}
        pieceAsset={() => "/piece.png"}
      />,
    );

    view.rerender(
      <LinkMiniBoard
        pieces={after}
        arrows={[]}
        lastMove={{ from: { row: 9, col: 8 }, to: { row: 8, col: 8 }, notation: "车一进一", movedBy: "红方" }}
        pieceAsset={() => "/piece.png"}
      />,
    );

    const recoveredElephant = view.container.querySelector(".link-mini-piece[data-piece='red-elephant']");
    expect(recoveredElephant).not.toBeNull();
    expect(recoveredElephant?.classList.contains("move-animate")).toBe(false);
    expect(recoveredElephant?.classList.contains("move-arrive")).toBe(false);
    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(1);
  });

  it("treats an empty skin path as absent instead of rendering a blank asset board", () => {
    const view = render(
      <LinkMiniBoard
        presentation="preview"
        pieces={pieces}
        arrows={[]}
        boardAsset="   "
        pieceAsset={() => "/piece.png"}
      />,
    );

    expect(view.container.querySelector(".link-mini-board.with-board-asset")).toBeNull();
    expect(view.container.querySelector(".link-mini-board-grid")).not.toBeNull();
  });

  it("keeps adjacent candidate arrows long enough to be readable", () => {
    const view = render(
      <LinkMiniBoard
        pieces={pieces}
        arrows={[{ rank: 1, color: "#50aa50", from: { row: 7, col: 4 }, to: { row: 8, col: 4 } }]}
        sideToMove="黑方"
        pieceAsset={() => "/piece.png"}
      />,
    );

    const line = view.container.querySelector(".link-mini-arrow-stem");
    const y1 = Number(line?.getAttribute("y1"));
    const y2 = Number(line?.getAttribute("y2"));
    expect(Math.abs(y2 - y1)).toBeGreaterThan(9);
  });
});

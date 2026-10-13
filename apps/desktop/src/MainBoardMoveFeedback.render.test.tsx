import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainBoardMoveFeedback, type MoveFeedback } from "./MainBoardMoveFeedback";

afterEach(cleanup);

const feedback: MoveFeedback = {
  id: "feedback-1",
  kind: "move",
  move: { from: { row: 9, col: 4 }, to: { row: 8, col: 4 } },
  mover: { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
};

describe("MainBoardMoveFeedback", () => {
  it("falls back to a CSS piece when the animated skin asset fails", () => {
    const view = render(
      <MainBoardMoveFeedback
        feedback={feedback}
        reversed={false}
        pieceAsset={() => "/missing-piece.png"}
        onComplete={vi.fn()}
      />,
    );

    const movingPiece = view.container.querySelector<HTMLImageElement>(".main-board-feedback-piece.moving")!;
    fireEvent.error(movingPiece);

    expect(view.container.querySelector(".main-board-feedback-piece.moving.feedback-piece-fallback")?.textContent).toBe("帅");
    expect(view.container.querySelector(".main-board-feedback-piece.moving img")).toBeNull();
  });
});

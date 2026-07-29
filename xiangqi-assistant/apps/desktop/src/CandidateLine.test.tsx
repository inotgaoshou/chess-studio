import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateLine } from "./CandidateLine";

afterEach(cleanup);

describe("CandidateLine", () => {
  it("shows Chinese moves in paired red and black columns", () => {
    render(<CandidateLine
      color="#53b848"
      fen="9/9/9/9/9/9/9/9/9/9 w - - 0 12"
      line={{ multipv: 1, depth: 18, scoreCp: 36, pv: ["h2e2", "h9g7", "h0g2"], notation: ["炮二平五", "马8进7", "马二进三"] }}
      sideToMove="红方"
      onPlay={vi.fn()}
    />);

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("马8进7")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByRole("button", { name: "走候选着法 炮二平五" })).toBeTruthy();
  });

  it("executes the first ICCS move against the analyzed position", () => {
    const onPlay = vi.fn();
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 2, pv: ["h9g7", "h0g2"], notation: ["马8进7", "马二进三"] }}
      sideToMove="黑方"
      onPlay={onPlay}
    />);

    fireEvent.click(screen.getByRole("button", { name: "走候选着法 马8进7" }));
    expect(onPlay).toHaveBeenCalledWith("h9g7", "position-fen");
  });
});

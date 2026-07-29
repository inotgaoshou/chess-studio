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

  it("shows coach explanation and a three-round continuation", () => {
    const view = render(<CandidateLine
      coach={{
        rank: 1,
        move: "炮二平五",
        scoreText: "+80",
        depthText: "深度 20",
        intent: "主候选「炮二平五」：优先作为红方当前局面的基准方案。",
        possibility: "主攻线：作为当前局面的第一参考线。",
        risk: "风险参考：仍需检查对方是否有直接反击。",
        followUp: ["炮二平五", "马8进7", "马二进三", "卒7进1", "车一平二", "车9平8"],
        shortLine: false,
        usesIccs: false,
      }}
      color="#53b848"
      fen="9/9/9/9/9/9/9/9/9/9 w - - 0 12"
      line={{ multipv: 1, depth: 20, scoreCp: 80, pv: ["h2e2"], notation: ["炮二平五", "马8进7"] }}
      sideToMove="红方"
      onPlay={vi.fn()}
    />);

    expect(screen.getByLabelText("候选线路 1 私教讲解").textContent).toContain("主候选");
    expect(screen.getByRole("table", { name: "候选线路 1 3回合推演" }).textContent).toContain("车9平8");
    expect(view.container.querySelector('[role="table"]')?.getAttribute("aria-label")).toBe("候选线路 1 3回合推演");
  });

  it("keeps black-to-move continuation aligned under black first", () => {
    render(<CandidateLine
      coach={{
        rank: 2,
        move: "马8进7",
        scoreText: "+20",
        depthText: "深度 18",
        intent: "备选「马8进7」。",
        possibility: "等价候选。",
        risk: "风险较低。",
        followUp: ["马8进7", "马二进三", "卒7进1"],
        shortLine: true,
        usesIccs: false,
      }}
      color="#43a4ff"
      fen="9/9/9/9/9/9/9/9/9/9 b - - 0 12"
      line={{ multipv: 2, pv: ["h9g7"], notation: ["马8进7"] }}
      sideToMove="黑方"
      onPlay={vi.fn()}
    />);

    const firstRow = screen.getByRole("table", { name: "候选线路 2 3回合推演" }).querySelectorAll(".pv-move-row")[0];
    expect(firstRow.textContent).toBe("12马8进7");
  });
});

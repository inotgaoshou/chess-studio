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
      onPreview={vi.fn()}
    />);

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText("马8进7")).toHaveLength(2);
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByRole("button", { name: "走候选着法 炮二平五" })).toBeTruthy();
  });

  it("shows Pikafish-style live engine metrics above the textual PV", () => {
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, depth: 28, scoreCp: 49, timeMs: 19_500, nps: 5_425_000, pv: ["h2e2", "h9g7"], notation: ["炮二平五", "马8进7"] }}
      scoreText="+49"
      sideToMove="红方"
      onPlay={vi.fn()}
      onPreview={vi.fn()}
    />);

    const metrics = screen.getByLabelText("候选 1 实时引擎指标");
    expect(metrics.textContent).toContain("着法 1：");
    expect(metrics.textContent).toContain("深度 28");
    expect(metrics.textContent).toContain("红分 +49");
    expect(metrics.textContent).toContain("耗时 19.5s");
    expect(metrics.textContent).toContain("NPS 5425K");
    expect(screen.getByLabelText("候选 1 后续走法").textContent).toContain("炮二平五");
  });

  it("marks every visible continuation move with the candidate line score", () => {
    const { container } = render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, depth: 28, scoreCp: 49, pv: ["h2e2", "h9g7", "h0g2", "i9h9"], notation: ["炮二平五", "马8进7", "马二进三", "车9平8"] }}
      scoreText="+49"
      sideToMove="红方"
      visibleMoveCount={4}
      onPlay={vi.fn()}
      onPreview={vi.fn()}
    />);

    const scores = container.querySelectorAll(".pv-continuation-moves .pv-step-score");
    expect(scores).toHaveLength(4);
    expect(Array.from(scores).every((score) => score.textContent === "+49")).toBe(true);
    expect(scores[0].getAttribute("title")).toContain("候选线路根局面分");
  });

  it("reserves configured continuation slots while a short PV is still growing", () => {
    const { container, rerender } = render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, depth: 8, pv: ["h2e2"], notation: ["炮二平五"] }}
      sideToMove="红方"
      visibleMoveCount={6}
      onPlay={vi.fn()}
      onPreview={vi.fn()}
    />);

    expect(container.querySelectorAll(".pv-continuation-moves > *")).toHaveLength(6);
    expect(container.querySelectorAll(".placeholder-slot")).toHaveLength(5);

    rerender(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, depth: 12, pv: ["h2e2", "h9g7", "h0g2"], notation: ["炮二平五", "马8进7", "马二进三"] }}
      sideToMove="红方"
      visibleMoveCount={6}
      onPlay={vi.fn()}
      onPreview={vi.fn()}
    />);

    expect(container.querySelectorAll(".pv-continuation-moves > *")).toHaveLength(6);
    expect(container.querySelectorAll(".placeholder-slot")).toHaveLength(3);
  });

  it("executes the first ICCS move against the analyzed position", () => {
    const onPlay = vi.fn();
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 2, pv: ["h9g7", "h0g2"], notation: ["马8进7", "马二进三"] }}
      sideToMove="黑方"
      onPlay={onPlay}
      onPreview={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "走候选着法 马8进7" }));
    expect(onPlay).toHaveBeenCalledWith("h9g7", "position-fen");
  });

  it("starts a non-mutating preview for the selected candidate line", () => {
    const onPreview = vi.fn();
    const line = { multipv: 1, pv: ["h2e2", "h9g7"], notation: ["炮二平五", "马8进7"] };
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={line}
      sideToMove="红方"
      onPlay={vi.fn()}
      onPreview={onPreview}
    />);

    fireEvent.click(screen.getByRole("button", { name: "预览候选 1" }));
    expect(onPreview).toHaveBeenCalledWith(line, "position-fen");
  });

  it("marks stale candidates and disables stale actions while the new position updates", () => {
    const onPlay = vi.fn();
    const onPreview = vi.fn();
    const { container } = render(<CandidateLine
      color="#53b848"
      disabled
      fen="previous-fen"
      line={{ multipv: 1, pv: ["h2e2", "h9g7"], notation: ["炮二平五", "马8进7"] }}
      sideToMove="红方"
      stale
      onPlay={onPlay}
      onPreview={onPreview}
    />);

    expect(container.querySelector(".pv-line")?.classList.contains("stale")).toBe(true);
    expect(screen.getByText(/旧候选/)).toBeTruthy();
    expect(screen.getByText("更新中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "预览候选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "走候选着法 炮二平五" }));
    expect(onPreview).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("keeps the full PV table collapsed behind a clear summary", () => {
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, pv: ["h2e2", "h9g7"], notation: ["炮二平五", "马8进7"] }}
      sideToMove="红方"
      onPlay={vi.fn()}
      onPreview={vi.fn()}
    />);

    expect(screen.getByText("完整 PV 表")).toBeTruthy();
    expect(screen.getByLabelText("候选 1 实时引擎指标").textContent).toContain("着法 1：");
    expect(screen.getByText(/炮二平五 · 主候选/)).toBeTruthy();
  });

  it("shows coach explanation and a ten-round continuation", () => {
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
      onPreview={vi.fn()}
    />);

    expect(screen.getByLabelText("候选 1 后续走法").textContent).toContain("车9平8");
    expect(screen.getByText("私教讲解 / 10回合表")).toBeTruthy();
    expect(screen.getByText("当前深度仅返回 6/20 个半回合")).toBeTruthy();
    expect(screen.getByLabelText("候选线路 1 私教讲解").textContent).toContain("主候选");
    expect(view.container.querySelector('[role="table"]')?.getAttribute("aria-label")).toBe("候选线路 1 10回合推演");
  });

  it("shows the current preview move and the following textual moves beside the board", () => {
    const onPreviewStep = vi.fn();
    render(<CandidateLine
      color="#53b848"
      fen="position-fen"
      line={{ multipv: 1, pv: ["h2e2", "h9g7", "h0g2"], notation: ["炮二平五", "马8进7", "马二进三"] }}
      preview={{
        activeStep: 1,
        steps: [
          { fen: "fen-1", notation: "炮二平五", movedBy: "红方", from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, pieces: [], status: "进行中" },
          { fen: "fen-2", notation: "马8进7", movedBy: "黑方", from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, pieces: [], status: "进行中" },
          { fen: "fen-3", notation: "马二进三", movedBy: "红方", from: { row: 9, col: 7 }, to: { row: 7, col: 6 }, pieces: [], status: "进行中" },
        ],
      }}
      sideToMove="红方"
      onPlay={vi.fn()}
      onPreview={vi.fn()}
      onPreviewStep={onPreviewStep}
    />);

    expect(screen.getByText("当前与后续")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "第 2 步，黑方，马8进7" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "第 3 步，红方，马二进三" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "第 3 步，红方，马二进三" }));
    expect(onPreviewStep).toHaveBeenCalledWith(2);
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
      onPreview={vi.fn()}
    />);

    const firstRow = screen.getByRole("table", { name: "候选线路 2 10回合推演" }).querySelectorAll(".pv-move-row")[0];
    expect(firstRow.textContent).toBe("12马8进7");
  });

  it("uses the configured half-move count for the always-visible continuation", () => {
    const notation = Array.from({ length: 24 }, (_, index) => `着法${index + 1}`);
    render(<CandidateLine
      color="#53b848"
      fen="9/9/9/9/9/9/9/9/9/9 w - - 0 1"
      line={{ multipv: 1, pv: notation.map((_, index) => `a${index % 10}a${(index + 1) % 10}`), notation }}
      coach={{
        rank: 1,
        move: notation[0],
        scoreText: "0",
        depthText: "深度 20",
        intent: "控制中心",
        possibility: "主攻线",
        risk: "注意反击",
        followUp: notation,
        shortLine: false,
        usesIccs: false,
      }}
      sideToMove="红方"
      visibleMoveCount={4}
      onPlay={() => undefined}
      onPreview={() => undefined}
    />);

    const quick = screen.getByLabelText("候选 1 后续走法");
    expect(quick.querySelectorAll(".pv-continuation-moves > span")).toHaveLength(4);
    expect(quick.textContent).toContain("先看 4 步");
    expect(quick.textContent).toContain("着法4");
    expect(quick.textContent).not.toContain("着法5");
  });
});

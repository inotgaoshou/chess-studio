import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiEngineComparison } from "./MultiEngineComparison";

const props = {
  busy: false,
  fen: "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
  sideToMove: "红方" as const,
  onPlay: vi.fn(),
  onPreview: vi.fn(),
};

afterEach(cleanup);

describe("MultiEngineComparison", () => {
  it("marks matching first moves as agreement and exposes engine actions", async () => {
    const user = userEvent.setup();
    render(<MultiEngineComparison {...props} groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16, depth: 20 }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["b2b9", "h7h0"], notation: ["炮二平五", "马8进7"], scoreCp: 20, depth: 18 }] },
    ]}/>);

    expect(screen.getAllByText("首着一致 · 后续不同 · 评分接近（差 4 分）").length).toBeGreaterThan(0);
    expect(screen.getByText("Pikafish")).toBeTruthy();
    expect(screen.getByText("Fairy")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "预览" })[1]);
    expect(props.onPreview).toHaveBeenCalledWith(expect.objectContaining({ multipv: 1 }), expect.objectContaining({ id: "fairy" }));
  });

  it("marks a conflicting first move without declaring a winner", () => {
    render(<MultiEngineComparison {...props} groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16 }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 22 }] },
    ]}/>);

    expect(screen.getAllByText("引擎分歧").length).toBeGreaterThan(0);
    expect(screen.queryByText(/更强|胜出|推荐胜者/)).toBeNull();
  });

  it("shows a pending state when a comparison engine has not returned", () => {
    render(<MultiEngineComparison {...props} busy groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"] }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [] },
    ]}/>);

    expect(screen.getAllByText("部分引擎尚未返回").length).toBeGreaterThan(0);
    expect(screen.getByText("正在计算")).toBeTruthy();
  });

  it("shows comparison engine moves and metrics in compact mode", () => {
    render(<MultiEngineComparison {...props} compact groups={[
      { id: "pika", name: "内置 Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16, depth: 20 }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["h2h9", "b9b8"], notation: ["炮八平五", "马2进3"], scoreCp: 22, depth: 18 }] },
    ]}/>);

    expect(screen.getByText("次")).toBeTruthy();
    expect(screen.getByText("Fairy")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "首着 炮八平五")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "红方视角 +22 · 深度 18")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "主变 炮八平五 马2进3")).toBeTruthy();
  });

  it("collapses to a compact summary and can expand again", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    render(<MultiEngineComparison {...props} collapsed onCollapsedChange={onCollapsedChange} groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16 }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 22 }] },
    ]}/>);

    expect(screen.getByText("多引擎对照")).toBeTruthy();
    expect(screen.queryByText("候选 1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "展开多引擎对照" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("exposes a divergence popout only when the engines disagree", async () => {
    const user = userEvent.setup();
    const onPopOut = vi.fn();
    render(<MultiEngineComparison {...props} onPopOut={onPopOut} groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16 }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 22 }] },
    ]}/>);

    await user.click(screen.getByRole("button", { name: "弹出引擎分歧" }));
    expect(onPopOut).toHaveBeenCalledOnce();
  });

  it("can render only the divergent candidate ranks for the standalone dialog", () => {
    render(<MultiEngineComparison {...props} divergencesOnly groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [
        { multipv: 1, pv: ["b2b9"], notation: ["炮二平五"], scoreCp: 16 },
        { multipv: 2, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 10 },
      ] },
      { id: "fairy", name: "Fairy", primary: false, lines: [
        { multipv: 1, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 22 },
        { multipv: 2, pv: ["h2h9"], notation: ["炮八平五"], scoreCp: 14 },
      ] },
    ]}/>);

    expect(screen.getByRole("region", { name: "引擎分歧对照" })).toBeTruthy();
    expect(screen.getByText("候选 1")).toBeTruthy();
    expect(screen.queryByText("候选 2")).toBeNull();
  });

  it("uses the standalone comparison header as the drag handle", () => {
    const onDragStart = vi.fn();
    render(<MultiEngineComparison {...props} divergencesOnly onDragStart={onDragStart} groups={[
      { id: "pika", name: "Pikafish", primary: true, lines: [{ multipv: 1, pv: ["b2b9"], notation: ["炮二平五"] }] },
      { id: "fairy", name: "Fairy", primary: false, lines: [{ multipv: 1, pv: ["h2h9"], notation: ["炮八平五"] }] },
    ]}/>);

    const header = screen.getByRole("region", { name: "引擎分歧对照" }).querySelector("header");
    expect(header).toBeTruthy();
    fireEvent.pointerDown(header!, { button: 0 });
    expect(onDragStart).toHaveBeenCalledOnce();
  });
});

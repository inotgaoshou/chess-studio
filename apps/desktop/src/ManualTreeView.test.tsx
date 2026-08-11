import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualTreeView } from "./ManualTreeView";
import type { ManualTreeNode, MoveItem } from "./platform";

afterEach(cleanup);

function move(id: string, notation: string, isMainline = true): MoveItem {
  return { id, notation, movedBy: "红方", iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "", isMainline };
}

function renderTree(overrides: Partial<Parameters<typeof ManualTreeView>[0]> = {}) {
  const navigate = vi.fn();
  const toggle = vi.fn();
  const remove = vi.fn();
  const nodes: ManualTreeNode[] = [{
    move: move("main", "炮二平五"),
    children: [
      { move: move("reply", "马8进7"), children: [{ move: move("nested", "马二进三", false), children: [] }] },
      { move: move("variation", "车8进6", false), children: [] },
    ],
  }];
  render(<ManualTreeView
    activePath={new Set(["main", "reply"])}
    collapsed={new Set()}
    currentNode="reply"
    editing={false}
    formatScore={() => ""}
    nodes={nodes}
    onMakeMainline={vi.fn()}
    onNavigate={navigate}
    onRemove={remove}
    onReorder={vi.fn()}
    onToggle={toggle}
    qualityByMoveId={new Map()}
    {...overrides}
  />);
  return { navigate, toggle, remove };
}

describe("ManualTreeView", () => {
  it("shows the active route and sibling variation as a nested tree", () => {
    const { navigate } = renderTree();
    expect(screen.getAllByText("主线").length).toBeGreaterThan(0);
    expect(screen.getAllByText("分支 1").length).toBeGreaterThan(0);
    expect(screen.getByText("当前局面")).toBeTruthy();
    expect(screen.getByText("马二进三")).toBeTruthy();
    fireEvent.click(screen.getByText("车8进6"));
    expect(navigate).toHaveBeenCalledWith("variation");
  });

  it("switches sibling variations through the dropdown without changing the tree", () => {
    const { navigate } = renderTree();

    fireEvent.change(screen.getByLabelText("变招选择"), { target: { value: "variation" } });

    expect(navigate).toHaveBeenCalledWith("variation");
    expect(screen.getByRole("option", { name: /A · 主线 · 马8进7/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /B · 车8进6/ })).toBeTruthy();
  });

  it("keeps the current path visible even when ancestors were collapsed before navigation", () => {
    renderTree({
      activePath: new Set(["main", "reply", "nested"]),
      collapsed: new Set(["main", "reply"]),
      currentNode: "nested",
    });

    expect(screen.getByText("马二进三")).toBeTruthy();
    expect(screen.getByText("当前局面")).toBeTruthy();
  });

  it("keeps continuations vertical and indents only actual variations", () => {
    const root = move("root", "炮二平五");
    const reply = move("reply", "马8进7");
    const continuation = move("continuation", "马二进三");
    const alternate = move("alternate", "车8进6", false);
    const alternateReply = move("alternate-reply", "炮二平五");
    renderTree({
      nodes: [{
        move: root,
        children: [{
          move: reply,
          children: [
            { move: continuation, children: [] },
            { move: alternate, children: [{ move: alternateReply, children: [] }] },
          ],
        }],
      }],
      activePath: new Set(["root", "reply", "alternate", "alternate-reply"]),
      currentNode: "alternate-reply",
    });

    expect(screen.getByTestId("tree-node-root").getAttribute("data-depth")).toBe("0");
    expect(screen.getByTestId("tree-node-reply").getAttribute("data-depth")).toBe("0");
    expect(screen.getByTestId("tree-node-continuation").getAttribute("data-depth")).toBe("0");
    expect(screen.getByTestId("tree-node-alternate").getAttribute("data-depth")).toBe("1");
    expect(screen.getByTestId("tree-node-alternate-reply").getAttribute("data-depth")).toBe("1");
  });

  it("delegates collapsing and edit actions to the owning workspace", () => {
    const { toggle, remove } = renderTree({ editing: true });
    fireEvent.click(screen.getAllByTitle("收起后续分支")[0]);
    expect(toggle).toHaveBeenCalledWith("main");
    fireEvent.click(screen.getAllByTitle("删除分支及其后续")[0]);
    expect(remove).toHaveBeenCalledWith("main");
  });

  it("marks moves adopted from a comparison engine", () => {
    const nodes: ManualTreeNode[] = [{
      move: { ...move("fairy", "炮八平五"), comment: "引擎来源：内置 Fairy-Stockfish" },
      children: [],
    }];
    renderTree({ nodes, activePath: new Set(["fairy"]), currentNode: "fairy" });

    expect(screen.getByText("对比")).toBeTruthy();
    expect(screen.getByText("内置 Fairy-Stockfish")).toBeTruthy();
  });

  it("shows a distinct review marker for a marked move", () => {
    const nodes: ManualTreeNode[] = [{
      move: { ...move("marked", "炮八平五"), comment: "【复盘标记】\n需要复盘" },
      children: [],
    }];
    renderTree({ nodes, activePath: new Set(["marked"]), currentNode: "marked" });

    expect(screen.getByText("复盘")).toBeTruthy();
  });
});

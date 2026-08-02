import { describe, expect, it } from "vitest";
import { hasUpcomingBranchPoint } from "./branchNavigation";
import type { ManualTreeNode, MoveItem } from "./platform";

function move(id: string, notation: string, isMainline = true): MoveItem {
  return {
    id,
    notation,
    movedBy: "红方",
    iccs: "a0a1",
    from: { row: 9, col: 0 },
    to: { row: 8, col: 0 },
    comment: "",
    isMainline,
  };
}

function node(id: string, notation: string, isMainline = true, children: ManualTreeNode[] = []): ManualTreeNode {
  return { move: move(id, notation, isMainline), children };
}

describe("branch navigation", () => {
  it("skips the current branch point and finds the next branch point on the selected continuation", () => {
    const tree = [
      node("root-1", "炮八平五", true, [
        node("branch-point", "车九进一", true, [
          node("main-next", "马8进7", true, [
            node("deep-main", "车9进1", true, [
              node("deep-choice-main", "车九平六", true),
              node("deep-choice-var", "车一进一", false),
            ]),
          ]),
          node("same-point-var-1", "车9进1", false),
          node("same-point-var-2", "士4进5", false),
          node("same-point-var-3", "炮2进2", false),
        ]),
      ]),
    ];

    expect(hasUpcomingBranchPoint(tree, "branch-point")).toBe(true);
  });

  it("keeps 下变 available when the selected child immediately reaches another branch point", () => {
    const tree = [
      node("parent", "卒3进1", true, [
        node("main-branch", "车九进一", true),
        node("selected-child", "车九平八", false, [
          node("nested-main", "马8进7", true),
          node("nested-variation", "炮2平5", false),
        ]),
      ]),
    ];

    expect(hasUpcomingBranchPoint(tree, "selected-child")).toBe(true);
  });
});

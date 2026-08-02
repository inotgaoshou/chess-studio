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

  it("does not treat the current node's own alternatives as an upcoming branch point", () => {
    const tree = [
      node("current", "卒3进1", true, [
        node("main-next", "车九进一", true),
        node("same-point-var", "车九平八", false),
      ]),
    ];

    expect(hasUpcomingBranchPoint(tree, "current")).toBe(false);
  });
});

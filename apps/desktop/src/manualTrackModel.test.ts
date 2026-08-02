import { describe, expect, it } from "vitest";
import { buildBranchComparisonModel, buildManualBranchTreeModel } from "./manualTrackModel";
import type { ManualTreeNode, MoveItem, Side } from "./platform";

function move(id: string, notation: string, movedBy: Side, isMainline = true, scoreCp?: number): MoveItem {
  return { id, notation, movedBy, iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "", isMainline, scoreCp };
}

describe("manualTrackModel", () => {
  const red1 = move("r1", "马八进七", "红方", true, 23);
  const black1 = move("b1", "马8进7", "黑方", true, -12);
  const red2 = move("r2", "车九平八", "红方", true, 16);
  const varA = move("v1", "炮2平5", "红方", false, 31);
  const varB = move("v2", "卒7进1", "红方", false, 8);
  const tree: ManualTreeNode[] = [{
    move: red1,
    children: [{
      move: black1,
      children: [
        { move: red2, children: [] },
        { move: varA, children: [] },
        { move: varB, children: [] },
      ],
    }],
  }];

  it("keeps mainline nodes on depth zero and records current route", () => {
    const model = buildManualBranchTreeModel(tree, [red1, black1], "b1", {
      collapsed: new Set(),
      expanded: new Set(),
      qualityByMoveId: new Map(),
      formatScore: (move) => `${move.scoreCp ?? 0}`,
    });

    expect(model.rows.map((row) => row.label)).toEqual(["马八进七", "马8进7", "炮2平5", "卒7进1", "车九平八"]);
    expect(model.rows.filter((row) => row.mainline).every((row) => row.depth === 0)).toBe(true);
    expect(model.rows.find((row) => row.nodeId === "b1")).toMatchObject({ active: true, onRoute: true, expanded: true });
    expect(model.rows.find((row) => row.nodeId === "v1")).toMatchObject({ depth: 1, onRoute: false });
  });

  it("shows branch counts and hides unrelated variations when collapsed", () => {
    const model = buildManualBranchTreeModel(tree, [red1, black1], "b1", {
      collapsed: new Set(),
      expanded: new Set(["b1"]),
      qualityByMoveId: new Map(),
      formatScore: (move) => `${move.scoreCp ?? 0}`,
      previewLimit: 1,
    });

    const fork = model.rows.find((row) => row.nodeId === "b1");
    expect(fork?.branchCount).toBe(2);
    expect(fork?.branchPreview).toHaveLength(1);
    expect(fork?.hiddenBranchCount).toBe(1);
    const variation = model.rows.find((row) => row.nodeId === "v1");
    expect(variation?.depth).toBe(1);
    expect(variation?.dimmed).toBe(true);

    const collapsed = buildManualBranchTreeModel(tree, [red1], "r1", {
      collapsed: new Set(["b1"]),
      expanded: new Set(),
      qualityByMoveId: new Map(),
      formatScore: (move) => `${move.scoreCp ?? 0}`,
    });
    expect(collapsed.rows.map((row) => row.nodeId)).not.toContain("v1");
  });

  it("supports black-first rows by leaving the red cell empty", () => {
    const black = move("black-first", "炮8平5", "黑方");
    const model = buildManualBranchTreeModel([{ move: black, children: [] }], [black], "black-first", {
      collapsed: new Set(),
      expanded: new Set(),
      qualityByMoveId: new Map(),
      formatScore: () => "",
    });

    expect(model.rows[0].move.movedBy).toBe("黑方");
    expect(model.rows[0].label).toBe("炮8平5");
    expect(model.rows[0].fullmove).toBe(1);
  });

  it("keeps a branchless mainline vertical regardless of its length", () => {
    const r3 = move("r3", "兵七进一", "红方");
    const b2 = move("b2", "炮8平5", "黑方");
    const longLine: ManualTreeNode[] = [{
      move: red1,
      children: [{
        move: black1,
        children: [{
          move: red2,
          children: [{
            move: b2,
            children: [{ move: r3, children: [] }],
          }],
        }],
      }],
    }];

    const model = buildManualBranchTreeModel(longLine, [red1, black1, red2, b2, r3], "r3", {
      collapsed: new Set(),
      expanded: new Set(),
      qualityByMoveId: new Map(),
      formatScore: () => "",
    });

    expect(model.rows.map((row) => row.depth)).toEqual([0, 0, 0, 0, 0]);
  });

  it("keeps variation continuations in their branch lane until another fork", () => {
    const variationStart = move("variation-start", "炮2平5", "红方", false);
    const variationReply = move("variation-reply", "马8进7", "黑方", true);
    const variationContinue = move("variation-continue", "车九平八", "红方", true);
    const nestedVariation = move("nested-variation", "兵七进一", "红方", false);
    const nestedContinue = move("nested-continue", "炮8平5", "黑方", true);
    const nestedTree: ManualTreeNode[] = [{
      move: red1,
      children: [{
        move: black1,
        children: [
          { move: red2, children: [] },
          {
            move: variationStart,
            children: [{
              move: variationReply,
              children: [
                { move: variationContinue, children: [] },
                { move: nestedVariation, children: [{ move: nestedContinue, children: [] }] },
              ],
            }],
          },
        ],
      }],
    }];

    const model = buildManualBranchTreeModel(nestedTree, [red1, black1, variationStart, variationReply], "variation-reply", {
      collapsed: new Set(),
      expanded: new Set(["variation-reply"]),
      qualityByMoveId: new Map(),
      formatScore: () => "",
    });

    expect(model.rows.find((row) => row.nodeId === "variation-start")?.depth).toBe(1);
    expect(model.rows.find((row) => row.nodeId === "variation-reply")?.depth).toBe(1);
    expect(model.rows.find((row) => row.nodeId === "variation-continue")?.depth).toBe(1);
    expect(model.rows.find((row) => row.nodeId === "nested-variation")?.depth).toBe(2);
    expect(model.rows.find((row) => row.nodeId === "nested-continue")?.depth).toBe(2);
  });

  it("builds branch comparison from existing tree only", () => {
    const comparison = buildBranchComparisonModel("b1", "v1", tree, {
      qualityByMoveId: new Map(),
      formatScore: (move) => `${move.scoreCp ?? 0}`,
    });

    expect(comparison?.forkLabel).toBe("马8进7");
    expect(comparison?.rows[0].mainline?.notation).toBe("车九平八");
    expect(comparison?.rows[0].variation?.notation).toBe("炮2平5");
  });
});

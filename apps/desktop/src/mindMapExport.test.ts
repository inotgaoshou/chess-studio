import { describe, expect, it } from "vitest";
import { buildMindMapSvg } from "./mindMapExport";
import type { ManualTreeNode, MoveItem } from "./platform";

function move(id: string, notation: string, mainline = true): MoveItem {
  return { id, notation, movedBy: id === "one" ? "红方" : "黑方", iccs: "a0a1", from: { row: 0, col: 0 }, to: { row: 1, col: 0 }, comment: "", isMainline: mainline, scoreCp: mainline ? 21 : -12 };
}

describe("buildMindMapSvg", () => {
  it("renders the root, mainline and variation labels into a standalone SVG", () => {
    const nodes: ManualTreeNode[] = [{ move: move("one", "炮二平五"), children: [{ move: move("two", "马8进7"), children: [] }, { move: move("alt", "炮8平5", false), children: [] }] }];
    const svg = buildMindMapSvg("测试棋谱", nodes);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("起始局面");
    expect(svg).toContain("炮二平五");
    expect(svg).toContain("炮8平5");
    expect(svg).toContain("link variation");
    expect(svg).toContain("局势 · 黑优 -21");
    expect(svg).toContain("局势 · 红优 +21");
    expect(svg).toContain("局势 · 黑优 -12");
  });

  it("marks unanalysed positions and mate results instead of leaving a score blank", () => {
    const nodes: ManualTreeNode[] = [{ move: { ...move("mate", "车一进一"), scoreCp: undefined, mate: -3 }, children: [{ move: { ...move("none", "卒7进1"), scoreCp: undefined }, children: [] }] }];
    const svg = buildMindMapSvg("测试棋谱", nodes);
    expect(svg).toContain("局势 · 黑方剩余 3 步杀");
    expect(svg).toContain("局势 · 待分析");
  });
});

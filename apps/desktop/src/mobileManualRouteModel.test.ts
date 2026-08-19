import { describe, expect, it } from "vitest";
import { buildMobileManualRoute } from "./mobileManualRouteModel";
import type { ManualTreeNode, MoveItem, Side } from "./platform";

function move(id: string, notation: string, movedBy: Side, isMainline = false): MoveItem {
  return { id, notation, movedBy, isMainline, iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "" };
}

describe("buildMobileManualRoute", () => {
  it("groups two half-moves into one turn and leaves an unfinished turn blank", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const black = move("b1", "马8进7", "黑方", true);
    const red2 = move("r2", "马二进三", "红方", true);
    const rows = buildMobileManualRoute([{ move: red, children: [{ move: black, children: [{ move: red2, children: [] }] }] }], [red, black, red2], "r2");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ turn: 1, red: { move: { id: "r1" } }, black: { move: { id: "b1" } } });
    expect(rows[1]).toMatchObject({ turn: 2, red: { move: { id: "r2" } }, active: true });
    expect(rows[1].black).toBeUndefined();
  });

  it("uses mainline-first letters and reports the stable branch-count label", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const black = move("b1", "马8进7", "黑方", true);
    const a = move("a", "马八进七", "红方", true);
    const b = move("b", "马二进三", "红方");
    const c = move("c", "兵七进一", "红方");
    const d = move("d", "马二进一", "红方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: a, children: [] }, { move: b, children: [] }, { move: c, children: [] }, { move: d, children: [] }] }] }];
    const lastBranch = buildMobileManualRoute(tree, [red, black, d], "d")[1].red!;
    const firstBranch = buildMobileManualRoute(tree, [red, black, a], "a")[1].red!;
    expect(lastBranch.branchLabel).toBe("4D");
    expect(firstBranch.branchLabel).toBe("4D");
    expect(lastBranch.branchChoices.map((choice) => `${choice.letter}:${choice.notation}`)).toEqual(["A:马八进七", "B:马二进三", "C:兵七进一", "D:马二进一"]);
  });

  it("keeps the mainline continuation visible after navigating to an earlier node", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const black = move("b1", "马8进7", "黑方", true);
    const red2 = move("r2", "马二进三", "红方", true);
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: red2, children: [] }] }] }];
    const rows = buildMobileManualRoute(tree, [red], "r1", [black, red2]);

    expect(rows).toHaveLength(2);
    expect(rows[0].black).toMatchObject({ move: { id: "b1" }, continuation: true });
    expect(rows[1].red).toMatchObject({ move: { id: "r2" }, continuation: true });
  });

  it("keeps the mainline branch first when assigning A/B labels", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const mainline = move("a", "马八进七", "黑方", true);
    const reordered = move("b", "炮2平5", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: reordered, children: [] }, { move: mainline, children: [] }] }];
    const selected = buildMobileManualRoute(tree, [red, reordered], "b")[0].black!;

    expect(selected.branchLabel).toBe("2B");
    expect(selected.branchChoices.map((choice) => choice.id)).toEqual(["a", "b"]);
  });

  it("continues variation labels after Z without punctuation", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const branches = Array.from({ length: 28 }, (_, index) => ({ move: move(`b${index}`, `马${index + 1}进${index + 1}`, "黑方", index === 0), children: [] }));
    const selected = buildMobileManualRoute([{ move: red, children: branches }], [red, branches[27].move], branches[27].move.id)[0].black!;

    expect(selected.branchLabel).toBe("28AB");
    expect(selected.branchChoices.at(25)?.letter).toBe("Z");
    expect(selected.branchChoices.at(26)?.letter).toBe("AA");
    expect(selected.branchChoices.at(27)?.letter).toBe("AB");
  });
});

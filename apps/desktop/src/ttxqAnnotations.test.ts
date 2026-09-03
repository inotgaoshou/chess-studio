import { describe, expect, it } from "vitest";
import type { ManualTreeNode, MoveItem, Side } from "./platform/types";
import { currentTtxqAnnotationValue, currentTtxqAnnotationValueForNode, hasTtxqAnnotation, mergeTtxqLocalComment, splitTtxqComment } from "./ttxqAnnotations";

const imported = [
  "【天天象棋注解】",
  "金玉满堂 · 25-01-07 19:13",
  "进边兵制马，针锋相对。",
  "【天天象棋注解结束】",
].join("\n");

const move = (id: string, comment = ""): MoveItem => ({
  id,
  iccs: "h2e2",
  notation: id,
  movedBy: "红方" as Side,
  from: { row: 7, col: 7 },
  to: { row: 7, col: 4 },
  comment,
  isMainline: true,
});

describe("TTXQ managed annotations", () => {
  it("keeps imported source text read-only while editing the local note", () => {
    const combined = `${imported}\n\n我的复盘：这里先出马。`;
    expect(splitTtxqComment(combined)).toEqual({
      sourceText: "金玉满堂 · 25-01-07 19:13\n进边兵制马，针锋相对。",
      localText: "我的复盘：这里先出马。",
    });
    expect(mergeTtxqLocalComment(combined, "本地修改")).toBe(`${imported}\n\n本地修改`);
    expect(hasTtxqAnnotation(combined)).toBe(true);
  });

  it("treats ordinary comments as editable local text", () => {
    expect(splitTtxqComment("普通注释")).toEqual({ sourceText: "", localText: "普通注释" });
    expect(mergeTtxqLocalComment("普通注释", "更新注释")).toBe("更新注释");
    expect(hasTtxqAnnotation("普通注释")).toBe(false);
  });

  it("hides importer route labels but preserves them as branch metadata on save", () => {
    const existing = "天天象棋路线 3";
    expect(splitTtxqComment(existing)).toEqual({ sourceText: "", localText: "" });
    expect(mergeTtxqLocalComment(existing, "我的分支备注")).toBe("天天象棋路线 3\n\n我的分支备注");
  });

  it("selects the annotation for the current board position", () => {
    expect(currentTtxqAnnotationValue(imported, undefined, "")).toBe(imported);
    expect(currentTtxqAnnotationValue(imported, "move-2", "第二半回合注解")).toBe("第二半回合注解");
    expect(currentTtxqAnnotationValue(imported, "move-without-note", "")).toBe("");
  });

  it("selects annotations by current node instead of the last path move", () => {
    const branchNote = [
      "【天天象棋注解】",
      "曹振华 · 23-08-17 15:22",
      "第二步唯一注解",
      "【天天象棋注解结束】",
    ].join("\n");
    const first = move("move-1", "");
    const second = move("move-2", branchNote);
    const last = move("move-11", "不属于当前节点");
    const tree: ManualTreeNode[] = [{ move: first, children: [{ move: second, children: [] }] }];

    expect(currentTtxqAnnotationValueForNode(imported, "move-1", [first, last], tree)).toBe("");
    expect(currentTtxqAnnotationValueForNode(imported, "move-2", [first, last], tree)).toBe(branchNote);
  });
});

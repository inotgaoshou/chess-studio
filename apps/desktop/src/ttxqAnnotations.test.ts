import { describe, expect, it } from "vitest";
import { hasTtxqAnnotation, mergeTtxqLocalComment, splitTtxqComment } from "./ttxqAnnotations";

const imported = [
  "【天天象棋注解】",
  "金玉满堂 · 25-01-07 19:13",
  "进边兵制马，针锋相对。",
  "【天天象棋注解结束】",
].join("\n");

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
});

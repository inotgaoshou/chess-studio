import { describe, expect, it } from "vitest";
import { flyknifeMarker, hasReviewMarker, toggleReviewMarker } from "./reviewMarker";

describe("reviewMarker", () => {
  it("adds a visible marker without discarding an existing comment", () => {
    const marked = toggleReviewMarker("这里需要复盘");

    expect(marked).toBe("【复盘标记】\n这里需要复盘");
    expect(hasReviewMarker(marked)).toBe(true);
  });

  it("removes only the review marker when toggled again", () => {
    const unmarked = toggleReviewMarker("【复盘标记】\n这里需要复盘");

    expect(unmarked).toBe("这里需要复盘");
    expect(hasReviewMarker(unmarked)).toBe(false);
  });

  it("extracts the visible role and intent from saved flyknife annotations", () => {
    expect(flyknifeMarker("【飞刀标注】\n阶段：knife\n意图：牵制中路后抢攻。\n【/飞刀标注】")).toEqual({
      label: "飞刀",
      intent: "牵制中路后抢攻。",
    });
  });
});

import { describe, expect, it } from "vitest";
import { appendManualVariation, manualPathExists } from "../src/variationEditing";
import type { LocalManualGame } from "../src/types";
import { trainingStore } from "../src/store";

const game = (): LocalManualGame => ({ id: "source", title: "布局", note: "根注释", startingFen: "initial", currentFen: "current", currentNodeId: "current-node", cursor: 1, moves: ["h2e2", "h9g7", "h0g2"], branches: [], comments: { h2e2: "原注释" }, createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z" });
describe("phone non-destructive variation merge", () => {
  it("reuses the shared prefix and leaves the mainline, cursor and annotations unchanged", () => {
    const source = game(), before = structuredClone(source);
    const result = appendManualVariation(source, [], ["h2e2", "b9c7"], ["炮二平五", "马2进3"]);
    expect(result.added).toBe(1); expect(result.game.moves).toEqual(source.moves);
    expect(result.game.branches[0]).toMatchObject({ parentPath: ["h2e2"], moves: ["b9c7"], notation: ["马2进3"] });
    expect(result.game.cursor).toBe(1); expect(result.game.currentNodeId).toBe("current-node");
    expect(result.game.comments).toEqual(source.comments); expect(source).toEqual(before);
  });
  it("deduplicates full lines and their already existing prefixes", () => {
    const first = appendManualVariation(game(), ["h2e2"], ["b9c7", "h0g2"], ["马2进3", "马二进三"]);
    expect(appendManualVariation(first.game, ["h2e2"], ["b9c7", "h0g2"], ["马2进3", "马二进三"]).added).toBe(0);
    expect(appendManualVariation(first.game, ["h2e2"], ["b9c7"], ["马2进3"]).game.branches).toHaveLength(1);
  });
  it("supports nested forks at the exact saved path", () => {
    const first = appendManualVariation(game(), ["h2e2"], ["b9c7", "h0g2"], ["马2进3", "马二进三"]);
    const second = appendManualVariation(first.game, ["h2e2", "b9c7"], ["b0c2"], ["马八进七"]);
    expect(second.game.branches[1].parentPath).toEqual(["h2e2", "b9c7"]);
    expect(manualPathExists(second.game, ["h2e2", "b9c7", "b0c2"])).toBe(true);
  });
  it("rejects removed anchors and read-only sources", () => {
    expect(() => appendManualVariation(game(), ["removed"], ["a0a1"], ["车九进一"])).toThrow("来源节点已删除");
    expect(() => appendManualVariation({ ...game(), readOnly: true }, [], ["a0a1"], ["车九进一"])).toThrow("只读");
  });
  it("rejects a stale atomic save without changing the newer full record", async () => {
    const source = { ...game(), id: crypto.randomUUID() };
    await trainingStore.saveManualGame(source);
    const merged = appendManualVariation(source, [], ["a0a1"], ["车九进一"]).game;
    await trainingStore.saveManualGame(merged, source.updatedAt);
    await expect(trainingStore.saveManualGame(source, source.updatedAt)).rejects.toThrow("棋谱已变化");
    expect(await trainingStore.openManualGame(source.id)).toEqual(merged);
  });
  it("checks read-only ownership again at the storage boundary", async () => {
    const source = { ...game(), id: crypto.randomUUID(), readOnly: true };
    await trainingStore.saveManualGame(source);
    await expect(trainingStore.saveManualGame({ ...source, readOnly: false }, source.updatedAt)).rejects.toThrow("只读");
    expect(await trainingStore.openManualGame(source.id)).toEqual(source);
  });
});

import { describe, expect, it } from "vitest";
import { beginAnalysisStream, completeAnalysisStream, isAnalysisSessionCurrent, updateAnalysisHistory, updateAnalysisStream } from "./analysisStream";

describe("analysis stream buffering", () => {
  it("keeps the previous candidate cards visible until every MultiPV rank arrives", () => {
    const first = updateAnalysisStream(beginAnalysisStream("next-fen"), "next-fen", {
      multipv: 1,
      depth: 8,
      pv: ["h2e2"],
    }, 3);
    const second = updateAnalysisStream(first.buffer, "next-fen", {
      multipv: 2,
      depth: 8,
      pv: ["b2e2"],
    }, 3);
    const third = updateAnalysisStream(second.buffer, "next-fen", {
      multipv: 3,
      depth: 8,
      pv: ["h0g2"],
    }, 3);

    expect(first.visible).toBeUndefined();
    expect(second.visible).toBeUndefined();
    expect(third.visible?.map((line) => line.multipv)).toEqual([1, 2, 3]);
  });

  it("updates published slots in place without reducing the candidate count", () => {
    const complete = completeAnalysisStream("fen", [
      { multipv: 1, depth: 12, pv: ["h2e2"] },
      { multipv: 2, depth: 12, pv: ["b2e2"] },
    ]);
    const update = updateAnalysisStream(complete, "fen", {
      multipv: 1,
      depth: 13,
      pv: ["h2e2", "h9g7"],
    }, 2);

    expect(update.visible).toHaveLength(2);
    expect(update.visible?.[0]).toMatchObject({ multipv: 1, depth: 13 });
    expect(update.visible?.[1]).toMatchObject({ multipv: 2, depth: 12 });
  });

  it("starts a fresh buffer when the analyzed position changes", () => {
    const complete = completeAnalysisStream("old-fen", [
      { multipv: 1, pv: ["h2e2"] },
      { multipv: 2, pv: ["b2e2"] },
    ]);
    const update = updateAnalysisStream(complete, "new-fen", {
      multipv: 1,
      pv: ["h9g7"],
    }, 2);

    expect(update.visible).toBeUndefined();
    expect(update.buffer.lines).toHaveLength(1);
  });

  it("publishes the available lines when the position has fewer moves than MultiPV", () => {
    const first = updateAnalysisStream(beginAnalysisStream("forced-fen"), "forced-fen", {
      multipv: 1,
      depth: 8,
      pv: ["e0e1"],
    }, 4);
    const nextDepth = updateAnalysisStream(first.buffer, "forced-fen", {
      multipv: 1,
      depth: 9,
      pv: ["e0e1"],
    }, 4);

    expect(first.visible).toBeUndefined();
    expect(nextDepth.visible).toEqual([expect.objectContaining({ multipv: 1, depth: 9 })]);
  });

  it("keeps recent engine info history even when MultiPV is one", () => {
    const first = updateAnalysisHistory(undefined, "fen", { multipv: 1, depth: 40, pv: ["h2e2"] }, 3);
    const second = updateAnalysisHistory(first, "fen", { multipv: 1, depth: 41, pv: ["h2e2", "h9g7"] }, 3);
    const duplicate = updateAnalysisHistory(second, "fen", { multipv: 1, depth: 41, pv: ["h2e2", "h9g7"] }, 3);
    const fourth = updateAnalysisHistory(duplicate, "fen", { multipv: 1, depth: 42, pv: ["h2e2", "h9g7", "b0c2"] }, 3);

    expect(fourth.lines.map((line) => line.depth)).toEqual([42, 41, 40]);
    expect(duplicate.lines.map((line) => line.depth)).toEqual([41, 40]);
  });

  it("rejects analysis work from an older session, board revision, or FEN", () => {
    const snapshot = { revision: 7, boardRevision: 12, fen: "current-fen" };

    expect(isAnalysisSessionCurrent(snapshot, 7, 12, "current-fen")).toBe(true);
    expect(isAnalysisSessionCurrent(snapshot, 8, 12, "current-fen")).toBe(false);
    expect(isAnalysisSessionCurrent(snapshot, 7, 13, "current-fen")).toBe(false);
    expect(isAnalysisSessionCurrent(snapshot, 7, 12, "other-fen")).toBe(false);
  });
});

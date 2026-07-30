import { describe, expect, it } from "vitest";
import type { GameReportDatasetDto } from "./platform";
import { buildGameReportPresentation } from "./gameReport";

const dataset: GameReportDatasetDto = {
  gameId: "game-1",
  lineSignature: "root:red:black",
  engineFingerprint: "/private/engine",
  configHash: "private-config",
  generatedAt: "2026-07-29T08:30:00Z",
  stale: true,
  positions: [
    { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 500 },
    { fen: "after-red", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: -500, move: { nodeId: "red", notation: "炮二平五", movedBy: "红方" } },
    { fen: "after-black", sideToMove: "红方", ply: 2, phase: "opening", scoreCp: 1000, move: { nodeId: "black", notation: "马8进7", movedBy: "黑方" } },
  ],
};

describe("buildGameReportPresentation", () => {
  it("builds the shared five-grade report without leaking local engine data", () => {
    const report = buildGameReportPresentation("测试棋局", dataset);

    expect(report.title).toBe("测试棋局");
    expect(report.stale).toBe(true);
    expect(report.red).toMatchObject({ overall: 100, grade: "优", coachQuality: "优" });
    expect(report.black).toMatchObject({ overall: 14, grade: "错", coachQuality: "错" });
    expect(report.black.counts).toMatchObject({ error: 1 });
    expect(report.coachInsights.branchName).toContain("马8进7");
    expect(report.coachInsights.weaknessFixes.join("")).toContain("开局");
    expect(report.coachInsights.namingTips.join("")).toContain("变招A/B");
    expect(report.issues).toEqual([
      expect.objectContaining({
        nodeId: "black",
        notation: "马8进7",
        score: 14,
        grade: "错",
        coach: expect.objectContaining({
          intent: expect.stringContaining("严重局面损失"),
          solution: expect.stringContaining("马炮车出动"),
          branchPlan: expect.stringContaining("变招分支"),
        }),
      }),
    ]);
    expect(report.standards.map(({ grade, qualityRange }) => `${grade}:${qualityRange}`)).toEqual([
      "优:80-100 分", "良:60-79 分", "中:40-59 分", "差:20-39 分", "错:0-19 分",
    ]);
    expect(JSON.stringify(report)).not.toContain("/private/engine");
    expect(JSON.stringify(report)).not.toContain("private-config");
  });

  it("does not invent grades for a side or phase without samples", () => {
    const report = buildGameReportPresentation("空样本", { ...dataset, stale: false, positions: dataset.positions.slice(0, 2) });

    expect(report.black.overall).toBeUndefined();
    expect(report.black.grade).toBeUndefined();
    expect(report.black.phaseGrades).toEqual({ opening: undefined, middle: undefined, endgame: undefined });
  });
});

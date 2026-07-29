import { describe, expect, it } from "vitest";
import { branchCoachInsights, moveCoachInsight, moveThoughtHint } from "./coachInsights";
import type { GameReportMove, SideReport } from "./analysisView";

const sideReport = (opening: number, middle: number): SideReport => ({
  overall: Math.round((opening + middle) / 2),
  phases: { opening, middle, endgame: undefined },
  counts: { excellent: 1, good: 0, average: 0, poor: 1, error: 0, missedMate: 0 },
});

const move: GameReportMove = {
  nodeId: "n1",
  notation: "马8进7",
  movedBy: "黑方",
  phase: "opening",
  lossCp: 320,
  score: 39,
  grade: "差",
  missedMate: false,
  redScoreCp: 420,
  deltaCp: 320,
  bestNotation: "炮8平5",
  pvNotation: ["炮8平5", "马二进三"],
};

describe("coachInsights", () => {
  it("explains a move purpose, weakness, solution, and variation plan", () => {
    const insight = moveCoachInsight(move);

    expect(insight.intent).toContain("明显放大");
    expect(insight.weakness).toContain("布局阶段");
    expect(insight.solution).toContain("炮8平5");
    expect(insight.branchPlan).toContain("变招分支");
  });

  it("turns opening hits into per-move thought hints", () => {
    expect(moveThoughtHint({
      notation: "炮二平五",
      movedBy: "红方",
      grade: "优",
      opening: { code: "R01", name: "中炮局", ply: 1, source: "内置开局库" },
    })).toContain("延续中炮局官着");
  });

  it("builds branch naming and study guidance from the weakest line", () => {
    const insights = branchCoachInsights(sideReport(55, 88), sideReport(90, 40), [move], {
      code: "R01",
      name: "中炮局",
      ply: 1,
      source: "内置开局库",
    });

    expect(insights.branchName).toContain("中炮局");
    expect(insights.branchPurpose).toContain("马8进7");
    expect(insights.namingTips.join("")).toContain("变招A/B");
    expect(insights.weaknessFixes.join("")).toContain("红方开局评分最低");
    expect(insights.studyPlan.join("")).toContain("最大转折");
  });
});

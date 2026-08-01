import { describe, expect, it } from "vitest";
import { branchCoachInsights, candidateCoachInsights, currentCoachAdvice, moveCoachInsight, moveThoughtHint } from "./coachInsights";
import type { GameReportMove, SideReport } from "./analysisView";
import type { BoardState, GameReportPresentationDto } from "./platform";

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

  it("shows opening advice before the first move or any engine line", () => {
    const advice = currentCoachAdvice({
      board: board({ history: [] }),
    });

    expect(advice.title).toBe("开局前的 AI 私教建议");
    expect(advice.suggestions.join("")).toContain("布局目标");
    expect(advice.nextAction).toContain("分析当前局面");
  });

  it("uses the current engine candidate when available", () => {
    const advice = currentCoachAdvice({
      board: board({ history: [moveItem("n1")] }),
      primaryAnalysis: { multipv: 1, notation: ["马二进三", "马8进7"], pv: ["h0g2"] },
      analysisLines: [
        { multipv: 1, notation: ["马二进三", "马8进7"], pv: ["h0g2"] },
        { multipv: 2, notation: ["炮二平五", "马8进7"], pv: ["h2e2"] },
      ],
    });

    expect(advice.title).toBe("当前局面 AI 私教建议");
    expect(advice.status).toContain("马二进三");
    expect(advice.status).toContain("MultiPV 2");
    expect(advice.suggestions.join("")).toContain("主线最多 10 回合推演：马二进三 马8进7");
    expect(advice.suggestions.join("")).toContain("2 条候选");
  });

  it("falls back to report issue coaching for the selected move", () => {
    const advice = currentCoachAdvice({
      board: board({ currentNode: "n1", history: [moveItem("n1")] }),
      report: {
        issues: [{
          nodeId: "n1",
          notation: "马8进7",
          movedBy: "黑方",
          lossCp: 320,
          score: 39,
          grade: "差",
          missedMate: false,
          redScoreCp: 420,
          deltaCp: 320,
          coach: moveCoachInsight(move),
        }],
      } as GameReportPresentationDto,
    });

    expect(advice.title).toContain("马8进7");
    expect(advice.status).toContain("39分");
    expect(advice.nextAction).toContain("变招分支");
  });

  it("builds one ten-round coach insight for each MultiPV line", () => {
    const insights = candidateCoachInsights([
      { multipv: 1, depth: 20, scoreCp: 80, pv: ["h0g2"], notation: ["马二进三", "马8进7", "炮二平五", "炮8平5", "车一平二", "车9平8", "兵七进一"] },
      { multipv: 2, depth: 20, scoreCp: 52, pv: ["h2e2"], notation: ["炮二平五", "马8进7", "马二进三", "卒7进1", "车一平二", "车9平8"] },
      { multipv: 3, depth: 18, scoreCp: -120, pv: ["b0c2", "b9c7"], notation: ["马八进七", "马2进3"] },
      { multipv: 4, depth: 16, scoreCp: -260, pv: ["c3c4", "h9g7", "h0g2", "i9h9", "h2e2", "b9c7"] },
    ], board({ sideToMove: "红方" }));

    expect(insights).toHaveLength(4);
    expect(insights[0]).toMatchObject({ rank: 1, move: "马二进三", followUp: ["马二进三", "马8进7", "炮二平五", "炮8平5", "车一平二", "车9平8", "兵七进一"], shortLine: true, usesIccs: false });
    expect(insights[1].possibility).toContain("等价候选");
    expect(insights[1].risk).toContain("首选 +80，本线 +52，相差 28 分");
    expect(insights[1].risk).not.toContain("cp");
    expect(insights[1].risk).not.toContain("约");
    expect(insights[2].shortLine).toBe(true);
    expect(insights[2].risk).toContain("线路较短");
    expect(insights[3]).toMatchObject({ usesIccs: true, followUp: ["c3c4", "h9g7", "h0g2", "i9h9", "h2e2", "b9c7"] });
  });
});

function moveItem(id: string): BoardState["history"][number] {
  return {
    id,
    iccs: "h9g7",
    notation: "马8进7",
    movedBy: "黑方",
    from: { row: 0, col: 7 },
    to: { row: 2, col: 6 },
    comment: "",
    isMainline: true,
  };
}

function board(overrides: Partial<Pick<BoardState, "history" | "currentNode" | "sideToMove" | "playable" | "status">> = {}): Pick<BoardState, "history" | "sideToMove" | "currentNode" | "playable" | "status"> {
  return {
    history: [moveItem("n1")],
    sideToMove: "红方",
    currentNode: undefined,
    playable: true,
    status: "进行中",
    ...overrides,
  };
}

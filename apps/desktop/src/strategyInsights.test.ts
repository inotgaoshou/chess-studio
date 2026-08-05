import { describe, expect, it } from "vitest";
import { buildStrategyInsight } from "./strategyInsights";
import type { Piece } from "./platform";

const pieces: Piece[] = [
  { row: 0, col: 4, color: "black", kind: "king", label: "将" },
  { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
  { row: 0, col: 0, color: "black", kind: "rook", label: "车" },
  { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
  { row: 2, col: 1, color: "black", kind: "cannon", label: "炮" },
  { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
];

describe("buildStrategyInsight", () => {
  it("uses the confirmed Zhao opening framework as explanation, never a move score", () => {
    const insight = buildStrategyInsight({ sideToMove: "红方", ply: 8, phase: "opening", pieces, history: ["炮二平五", "炮8平5"] });

    expect(insight.phase).toBe("opening");
    expect(insight.principles.some((card) => card.title === "重理解轻记忆" && card.source.label.includes("赵鑫鑫"))).toBe(true);
    expect(insight.facts.some((fact) => fact.includes("红方走"))).toBe(true);
    expect(insight.engine.status).toBe("theory");
    expect(insight.engine.text).toContain("棋理推断");
  });

  it("keeps a theory-first conclusion while analysis is running", () => {
    const insight = buildStrategyInsight({ sideToMove: "黑方", ply: 30, phase: "middle", pieces, history: [], analysisBusy: true });

    expect(insight.phase).toBe("middle");
    expect(insight.engine.status).toBe("analyzing");
    expect(insight.engine.text).toContain("分析中");
    expect(insight.principles.every((card) => card.source.label === "通用棋理" || card.source.label.includes("赵鑫鑫"))).toBe(true);
  });

  it("does not use stale or too-short PV as proof", () => {
    const stale = buildStrategyInsight({ sideToMove: "红方", ply: 90, pieces, history: [], analysis: { notation: ["车一平二", "车9平8"], pv: [], multipv: 1 }, analysisStale: true });
    const short = buildStrategyInsight({ sideToMove: "红方", ply: 90, pieces, history: [], analysis: { notation: ["车一平二"], pv: [], multipv: 1 } });

    expect(stale.phase).toBe("endgame");
    expect(stale.engine.status).toBe("theory");
    expect(short.engine.status).toBe("insufficient");
  });

  it("records current engine PV as evidence without claiming engine superiority", () => {
    const insight = buildStrategyInsight({ sideToMove: "红方", ply: 36, pieces, history: [], analysis: { notation: ["车一平二", "马8进7", "炮二平五"], pv: ["a0a1", "b9b8", "b2e2"], multipv: 1, depth: 18, scoreCp: 32 }, engineName: "Pikafish" });

    expect(insight.engine.status).toBe("supported");
    expect(insight.engine.text).toContain("Pikafish");
    expect(insight.engine.depth).toBe(18);
  });

  it("marks a clearly unfavorable valid line as a plan conflict and asks for defense", () => {
    const insight = buildStrategyInsight({ sideToMove: "红方", ply: 32, phase: "middle", pieces, history: [], analysis: { notation: ["炮二进七", "士4进5"], pv: ["b2b9", "d9e8"], multipv: 1, scoreCp: -180 } });

    expect(insight.engine.status).toBe("conflicted");
    expect(insight.engine.text).toContain("防守候选");
  });

  it("prioritizes confirmed course cards that match the latest training tags", () => {
    const insight = buildStrategyInsight({
      sideToMove: "红方", ply: 32, phase: "middle", pieces, history: [], studyTags: ["反击"],
      courseCards: [{
        id: "course-counterplay", phase: "middle", title: "先看反击", summary: "进攻前检查对手反击。",
        appliesWhen: "局面准备强攻时。", risk: "忽略反击会丢先手。",
        source: { label: "赵鑫鑫课程", review: "已确认" },
      }],
    });

    expect(insight.principles[0]?.title).toBe("先看反击");
  });

  it("demotes cards that were marked inaccurate or need recheck", () => {
    const insight = buildStrategyInsight({
      sideToMove: "红方", ply: 32, phase: "middle", pieces, history: [], studyTags: ["反击"],
      courseCards: [
        {
          id: "bad-counterplay", phase: "middle", title: "反击卡但常误配", summary: "进攻前检查对手反击。",
          appliesWhen: "局面准备强攻时。", risk: "忽略反击会丢先手。", matchPenalty: 4, needsRecheck: true,
          source: { label: "赵鑫鑫棋理三部曲", book: "赵鑫鑫中局棋理48讲", pageStart: 20, review: "已确认" },
        },
        {
          id: "good-counterplay", phase: "middle", title: "反击核验", summary: "进攻前检查对手反击。",
          appliesWhen: "局面准备强攻时。", risk: "忽略反击会丢先手。",
          source: { label: "赵鑫鑫课程", review: "已确认" },
        },
      ],
    });

    expect(insight.principles[0]?.title).toBe("反击核验");
  });
});

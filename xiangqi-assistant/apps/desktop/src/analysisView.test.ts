import { describe, expect, it } from "vitest";
import { calculateGameReport, coachProfile, pvMoveRows, reportMovePhase, trendTurningPoints } from "./analysisView";
import type { AnalysisLine, GameReportDatasetDto } from "./platform";

function dataset(positions: GameReportDatasetDto["positions"]): GameReportDatasetDto {
  return {
    gameId: "game-1",
    lineSignature: "root:first:second",
    engineFingerprint: "/opt/pikafish",
    configHash: "time:1000",
    generatedAt: "2026-07-29T00:00:00Z",
    stale: false,
    positions,
  };
}

describe("calculateGameReport", () => {
  it("scores losses from the mover perspective", () => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 100 },
      { fen: "after-red", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: -80, move: { nodeId: "first", notation: "炮二平五", movedBy: "红方" } },
      { fen: "after-black", sideToMove: "红方", ply: 2, phase: "opening", scoreCp: 180, move: { nodeId: "second", notation: "马8进7", movedBy: "黑方" } },
    ]));

    expect(report.moves[0]).toMatchObject({ lossCp: 20, score: 100, grade: "优", missedMate: false });
    expect(report.moves[1]).toMatchObject({ lossCp: 100, score: 88, grade: "疑", missedMate: false });
    expect(report.red.overall).toBe(100);
    expect(report.black.overall).toBe(88);
  });

  it("marks a forced mate that disappears as a missed mate", () => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", mate: 3 },
      { fen: "after-red", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: -200, move: { nodeId: "first", notation: "车一平二", movedBy: "红方" } },
    ]));

    expect(report.moves[0]).toMatchObject({ lossCp: 800, score: 0, grade: "漏", missedMate: true });
    expect(report.red.counts.missedMate).toBe(1);
  });

  it("treats mate zero as a loss for the side to move", () => {
    const report = calculateGameReport(dataset([
      { fen: "before", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 0 },
      { fen: "mated", sideToMove: "黑方", ply: 1, phase: "opening", mate: 0, move: { nodeId: "first", notation: "车一进九", movedBy: "红方" } },
    ]));

    expect(report.moves[0]).toMatchObject({ redScoreCp: 1000, lossCp: 0, score: 100 });
  });

  it.each([
    [20, 100, "优"],
    [60, 96, "佳"],
    [120, 84, "疑"],
    [250, 52, "错"],
    [251, 51, "漏"],
    [1000, 0, "漏"],
  ] as const)("applies the segmented penalty at %icp loss", (lossCp, score, grade) => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 500 },
      { fen: "after", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: -(500 - lossCp), move: { nodeId: "first", notation: "炮二平五", movedBy: "红方" } },
    ]));

    expect(report.moves[0]).toMatchObject({ lossCp, score, grade });
  });

  it("reports missing side and phase samples as unavailable", () => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 0 },
      { fen: "after", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: 0, move: { nodeId: "first", notation: "炮二平五", movedBy: "红方" } },
    ]));

    expect(report.red.overall).toBe(100);
    expect(report.red.phases).toEqual({ opening: 100, middle: undefined, endgame: undefined });
    expect(report.black.overall).toBeUndefined();
  });

  it("classifies report moves from ply and remaining material", () => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 20, phase: "opening", material: 5000, scoreCp: 0 },
      { fen: "middle", sideToMove: "黑方", ply: 21, phase: "opening", material: 5000, scoreCp: 0, move: { nodeId: "first", notation: "炮二平五", movedBy: "红方" } },
      { fen: "endgame", sideToMove: "红方", ply: 22, phase: "middle", material: 2500, scoreCp: 0, move: { nodeId: "second", notation: "马8进7", movedBy: "黑方" } },
    ]));

    expect(report.moves.map((move) => move.phase)).toEqual(["middle", "endgame"]);
    expect(report.red.phases.middle).toBe(100);
    expect(report.black.phases.endgame).toBe(100);
  });
});

describe("coachProfile", () => {
  it("builds explainable phase, accuracy, and stability dimensions", () => {
    const report = calculateGameReport(dataset([
      { fen: "root", sideToMove: "红方", ply: 0, phase: "opening", scoreCp: 200 },
      { fen: "red-1", sideToMove: "黑方", ply: 1, phase: "opening", scoreCp: -180, move: { nodeId: "red-1", notation: "炮二平五", movedBy: "红方" } },
      { fen: "black-1", sideToMove: "红方", ply: 2, phase: "opening", scoreCp: 180, move: { nodeId: "black-1", notation: "马8进7", movedBy: "黑方" } },
      { fen: "red-2", sideToMove: "黑方", ply: 21, phase: "middle", scoreCp: -80, move: { nodeId: "red-2", notation: "车一平二", movedBy: "红方" } },
    ]));

    const red = coachProfile(report, "红方");
    expect(red.quality).toBe("精准");
    expect(red.dimensions).toEqual({ opening: 100, middle: 88, endgame: undefined, accuracy: 94, stability: 94 });
    expect(red.summary).toContain("红方");
    expect(red.summary).toContain("车一平二");
  });

  it("reports insufficient samples without inventing a score", () => {
    const empty = coachProfile({
      red: { overall: undefined, phases: { opening: undefined, middle: undefined, endgame: undefined }, counts: { excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, missedMate: 0 } },
      black: { overall: undefined, phases: { opening: undefined, middle: undefined, endgame: undefined }, counts: { excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, missedMate: 0 } },
      moves: [],
    }, "黑方");

    expect(empty.quality).toBe("样本不足");
    expect(empty.dimensions.accuracy).toBeUndefined();
  });
});

describe("trendTurningPoints", () => {
  it("finds steep score changes and preserves the destination node", () => {
    const turns = trendTurningPoints([
      { label: "第 1 着", scoreCp: 10, nodeId: "one" },
      { label: "第 2 着", scoreCp: 80, nodeId: "two" },
      { label: "第 3 着", scoreCp: -80, nodeId: "three" },
      { label: "第 4 着", scoreCp: 230, nodeId: "four" },
    ]);

    expect(turns).toEqual([
      expect.objectContaining({ nodeId: "three", deltaCp: -160, severity: "major" }),
      expect.objectContaining({ nodeId: "four", deltaCp: 310, severity: "critical" }),
    ]);
  });
});

describe("reportMovePhase", () => {
  it("recognizes edited low-material endgames before move-count thresholds", () => {
    expect(reportMovePhase(20, 1000)).toBe("endgame");
    expect(reportMovePhase(20, 5000)).toBe("opening");
    expect(reportMovePhase(21, 5000)).toBe("middle");
    expect(reportMovePhase(21, 2500)).toBe("endgame");
    expect(reportMovePhase(81, 5000)).toBe("endgame");
  });
});

describe("pvMoveRows", () => {
  const line = (notation: string[]): AnalysisLine => ({ multipv: 1, pv: notation.map((_, index) => `a${index}a${index + 1}`), notation });

  it("pairs a red-to-move line into red and black columns", () => {
    expect(pvMoveRows(line(["炮二平五", "马8进7", "马二进三"]), "红方", "9/9/9/9/9/9/9/9/9/9 w - - 0 12")).toEqual([
      { number: 12, red: "炮二平五", black: "马8进7" },
      { number: 13, red: "马二进三" },
    ]);
  });

  it("keeps the red cell empty when the position starts with black to move", () => {
    expect(pvMoveRows(line(["马8进7", "马二进三", "车9平8"]), "黑方", "9/9/9/9/9/9/9/9/9/9 b - - 0 7")).toEqual([
      { number: 7, black: "马8进7" },
      { number: 8, red: "马二进三", black: "车9平8" },
    ]);
  });
});

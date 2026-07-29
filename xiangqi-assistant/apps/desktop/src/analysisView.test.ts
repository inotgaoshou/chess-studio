import { describe, expect, it } from "vitest";
import { calculateGameReport, reportMovePhase } from "./analysisView";
import type { GameReportDatasetDto } from "./platform";

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

describe("reportMovePhase", () => {
  it("recognizes edited low-material endgames before move-count thresholds", () => {
    expect(reportMovePhase(20, 1000)).toBe("endgame");
    expect(reportMovePhase(20, 5000)).toBe("opening");
    expect(reportMovePhase(21, 5000)).toBe("middle");
    expect(reportMovePhase(21, 2500)).toBe("endgame");
    expect(reportMovePhase(81, 5000)).toBe("endgame");
  });
});

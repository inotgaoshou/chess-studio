import { describe, expect, it } from "vitest";
import { classifyBookCandidateAudit } from "./bookCandidateAudit";
import type { AnalysisLine } from "./platform";

function line(move: string, scoreCp?: number, extra: Partial<AnalysisLine> = {}): AnalysisLine {
  return {
    multipv: extra.multipv ?? 1,
    pv: [move],
    scoreCp,
    ...extra,
  };
}

describe("book candidate Pikafish audit", () => {
  const baseline = [
    line("h2e2", 120, { multipv: 1 }),
    line("b0c2", 95, { multipv: 2 }),
  ];

  it("marks top candidates within 30cp as supported", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "b0c2",
      baselineLines: baseline,
      candidateLine: line("b0c2", 94, { multipv: 1, depth: 18 }),
    })).toMatchObject({ status: "support", scoreGapCp: 26, depth: 18 });
  });

  it("marks non-top candidates up to 80cp as acceptable", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "c3c4",
      baselineLines: baseline,
      candidateLine: line("c3c4", 42),
    })).toMatchObject({ status: "acceptable", scoreGapCp: 78 });
  });

  it("marks candidates from 81 to 150cp behind as dubious", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "g3g4",
      baselineLines: baseline,
      candidateLine: line("g3g4", 0),
    })).toMatchObject({ status: "dubious", scoreGapCp: 120 });
  });

  it("marks candidates more than 150cp behind as not recommended", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "a0a1",
      baselineLines: baseline,
      candidateLine: line("a0a1", -60),
    })).toMatchObject({ status: "notRecommended", scoreGapCp: 180 });
  });

  it("prioritizes mate risk over centipawn thresholds", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "a0a1",
      baselineLines: [line("h2e2", 0)],
      candidateLine: line("a0a1", undefined, { mate: -3 }),
    })).toMatchObject({ status: "notRecommended", note: "Pikafish 显示该候选存在被杀风险。" });
  });

  it("marks supported mating candidates as supported", () => {
    expect(classifyBookCandidateAudit({
      candidateMove: "h2e2",
      baselineLines: [line("h2e2", undefined, { mate: 3 })],
      candidateLine: line("h2e2", undefined, { mate: 3 }),
    })).toMatchObject({ status: "support", note: "Pikafish 支持该候选，且存在杀棋信号。" });
  });
});

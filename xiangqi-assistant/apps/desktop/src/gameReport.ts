import { calculateGameReport, coachProfile, moveGradeStandards, qualityGradeForScore } from "./analysisView";
import type { GameReportDatasetDto, GameReportPresentationDto, ReportPhase, ReportSidePresentationDto, Side } from "./platform";

const phases: ReportPhase[] = ["opening", "middle", "endgame"];

function reportPositionValue(position: GameReportDatasetDto["positions"][number]) {
  const perspective = position.sideToMove === "红方" ? 1 : -1;
  if (position.mate != null) return (position.mate === 0 ? -1 : Math.sign(position.mate)) * perspective * 1000;
  return position.scoreCp == null ? undefined : position.scoreCp * perspective;
}

function sidePresentation(
  side: Side,
  report: ReturnType<typeof calculateGameReport>,
): ReportSidePresentationDto {
  const value = side === "红方" ? report.red : report.black;
  const coach = coachProfile(report, side);
  return {
    side,
    overall: value.overall,
    grade: value.overall == null ? undefined : qualityGradeForScore(value.overall),
    phases: value.phases,
    phaseGrades: Object.fromEntries(phases.map((phase) => [
      phase,
      value.phases[phase] == null ? undefined : qualityGradeForScore(value.phases[phase]),
    ])) as ReportSidePresentationDto["phaseGrades"],
    counts: value.counts,
    coachQuality: coach.quality,
    coachSummary: coach.summary,
    dimensions: coach.dimensions,
  };
}

export function buildGameReportPresentation(title: string, dataset: GameReportDatasetDto): GameReportPresentationDto {
  const calculated = calculateGameReport(dataset);
  return {
    title: title.trim() || "未命名棋局",
    generatedAt: dataset.generatedAt,
    stale: dataset.stale,
    red: sidePresentation("红方", calculated),
    black: sidePresentation("黑方", calculated),
    trend: dataset.positions.flatMap((position, index) => {
      const scoreCp = reportPositionValue(position);
      if (scoreCp == null) return [];
      return [{
        label: position.move?.notation ?? (index === 0 ? "初始局面" : `第 ${position.ply} 着`),
        scoreCp,
        nodeId: position.move?.nodeId,
      }];
    }),
    issues: calculated.moves
      .filter((move) => move.grade === "差" || move.grade === "错" || move.missedMate)
      .map(({ nodeId, notation, movedBy, lossCp, score, grade, missedMate, redScoreCp, deltaCp }) => ({
        nodeId,
        notation,
        movedBy,
        lossCp,
        score,
        grade,
        missedMate,
        redScoreCp,
        deltaCp,
      })),
    standards: moveGradeStandards,
    disclaimer: "参考常见象棋复盘产品的信息层次与分档方式；评分由本应用基于 Pikafish 局面损失计算，不等同于天天象棋内部算法。",
  };
}

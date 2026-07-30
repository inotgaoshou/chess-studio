import { calculateGameReport, coachProfile, moveGradeStandards, qualityGradeForScore } from "./analysisView";
import { branchCoachInsights, moveCoachInsight } from "./coachInsights";
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

function engineLabel(fingerprint: string) {
  if (!fingerprint) return "Pikafish";
  if (fingerprint.startsWith("sha256:")) return `Pikafish · ${fingerprint.slice(0, 18)}…`;
  return "Pikafish · 已识别";
}

function signedCp(scoreCp: number) {
  const rounded = Math.round(scoreCp);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function enhancedSideSummary(
  side: Side,
  presentation: ReportSidePresentationDto,
  calculated: ReturnType<typeof calculateGameReport>,
  openingName: string | undefined,
  officialMoves: number,
  analysisDepth: number | undefined,
) {
  const moves = calculated.moves.filter((move) => move.movedBy === side);
  const worst = moves.reduce<typeof moves[number] | undefined>((current, move) => !current || move.lossCp > current.lossCp ? move : current, undefined);
  const swing = moves.reduce<typeof moves[number] | undefined>((current, move) => !current || Math.abs(move.deltaCp) > Math.abs(current.deltaCp) ? move : current, undefined);
  const openingText = openingName
    ? `开局识别为${openingName}，本线官着 ${officialMoves} 步。`
    : "未命中内置官着库。";
  const depthText = analysisDepth ? `深度${analysisDepth}` : "当前深度";
  const swingText = swing ? `主要转折在 ${swing.notation}，局面变化 ${signedCp(swing.deltaCp)}。` : "";
  const worstText = worst && worst.lossCp > 50
    ? `最值得复盘的是 ${worst.notation}，损失 ${worst.lossCp}cp${worst.bestNotation ? `，${depthText}推荐 ${worst.bestNotation}` : ""}。`
    : "没有明显需要单独追查的差错。";
  return {
    ...presentation,
    coachSummary: `${openingText}${presentation.coachSummary}${swingText}${worstText}`,
  };
}

export function buildGameReportPresentation(title: string, dataset: GameReportDatasetDto): GameReportPresentationDto {
  const calculated = calculateGameReport(dataset);
  const officialMoves = calculated.moves.filter((move) => move.opening).length;
  const opening = calculated.moves
    .filter((move) => move.opening)
    .sort((left, right) => (right.opening?.ply ?? 0) - (left.opening?.ply ?? 0) || (left.opening?.code ?? "").localeCompare(right.opening?.code ?? ""))[0]?.opening;
  const totalElapsedMs = dataset.positions.reduce((sum, position) => sum + (position.elapsedMs ?? 0), 0);
  let previousScore: number | undefined;
  const red = enhancedSideSummary("红方", sidePresentation("红方", calculated), calculated, opening?.name, officialMoves, dataset.analysisDepth);
  const black = enhancedSideSummary("黑方", sidePresentation("黑方", calculated), calculated, opening?.name, officialMoves, dataset.analysisDepth);
  const coachInsights = branchCoachInsights(calculated.red, calculated.black, calculated.moves, opening);
  return {
    title: title.trim() || "未命名棋局",
    generatedAt: dataset.generatedAt,
    stale: dataset.stale,
    analysisDepth: dataset.analysisDepth,
    engineLabel: engineLabel(dataset.engineFingerprint),
    totalElapsedMs,
    cachedPositions: dataset.cachedPositions ?? dataset.positions.filter((position) => position.cached).length,
    openingSummary: opening ? { ...opening, officialMoves } : undefined,
    red,
    black,
    coachInsights,
    trend: dataset.positions.flatMap((position, index) => {
      const scoreCp = reportPositionValue(position);
      if (scoreCp == null) return [];
      const deltaCp = previousScore == null ? undefined : scoreCp - previousScore;
      previousScore = scoreCp;
      return [{
        label: position.move?.notation ?? (index === 0 ? "初始局面" : `第 ${position.ply} 着`),
        scoreCp,
        deltaCp,
        nodeId: position.move?.nodeId,
      }];
    }),
    issues: calculated.moves
      .filter((move) => move.grade === "差" || move.grade === "错" || move.missedMate)
      .map((move) => ({
        ...move,
        coach: moveCoachInsight(move),
      }))
      .map(({ nodeId, notation, movedBy, lossCp, score, grade, missedMate, redScoreCp, deltaCp, opening, bestIccs, bestNotation, pvNotation, coach }) => ({
        nodeId,
        notation,
        movedBy,
        lossCp,
        score,
        grade,
        missedMate,
        redScoreCp,
        deltaCp,
        opening,
        bestIccs,
        bestNotation,
        pvNotation,
        coach,
      })),
    standards: moveGradeStandards,
    scoreGuide: [
      { scoreCp: 1000, label: "约一车" },
      { scoreCp: 500, label: "约一马或炮" },
      { scoreCp: 200, label: "约过河兵" },
      { scoreCp: 100, label: "约一兵/卒" },
      { scoreCp: 50, label: "50以内可忽略" },
    ],
    disclaimer: "参考常见象棋复盘产品的信息层次与分档方式；评分由本应用基于 Pikafish 局面损失计算，不等同于天天象棋内部算法，实际强度受 Pikafish 版本、NNUE、线程和机器性能影响。",
  };
}

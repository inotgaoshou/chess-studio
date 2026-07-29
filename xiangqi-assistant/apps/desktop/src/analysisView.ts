import type { AnalysisLine, BoardState, GameReportDatasetDto, QualityGrade, ReportPhase, MoveItem, Side } from "./platform";

export type PvMoveRow = { number: number; red?: string; black?: string };
export type TrendSample = { label: string; scoreCp: number; nodeId?: string; moveIndex?: number };
export type TrendPoint = TrendSample & { x: number; y: number };
export type MoveGrade = QualityGrade;
export type MoveReport = {
  move: MoveItem;
  index: number;
  redScoreCp?: number;
  deltaCp?: number;
  moverLossCp?: number;
  score?: number;
  grade?: MoveGrade;
  missedMate?: boolean;
};
export type MoveGradeStandard = {
  grade: QualityGrade;
  qualityRange: string;
  description: string;
};
export type PositionEvaluation = {
  label: string;
  scoreText: string;
  detail: string;
  redShare: number;
  mateSide?: Side;
  mateIn?: number;
  deltaText?: string;
  samples: TrendSample[];
};
export type GameReportMove = {
  nodeId: string;
  iccs?: string;
  notation: string;
  movedBy: Side;
  phase: ReportPhase;
  lossCp: number;
  score: number;
  grade: MoveGrade;
  missedMate: boolean;
  redScoreCp: number;
  deltaCp: number;
  opening?: GameReportDatasetDto["positions"][number]["opening"];
  bestIccs?: string;
  bestNotation?: string;
  pvNotation?: string[];
};
export type SideReport = {
  overall?: number;
  phases: Record<ReportPhase, number | undefined>;
  counts: Record<"excellent" | "good" | "average" | "poor" | "error" | "missedMate", number>;
};
export type GameReport = { red: SideReport; black: SideReport; moves: GameReportMove[] };
export type CoachDimensions = Record<"opening" | "middle" | "endgame" | "accuracy" | "stability", number | undefined>;
export type CoachProfile = {
  quality: QualityGrade | "样本不足";
  dimensions: CoachDimensions;
  summary: string;
  criticalMove?: GameReportMove;
};
export type TrendTurningPoint = TrendSample & {
  deltaCp: number;
  severity: "major" | "critical";
};

const initialMaterial = 5660;
type LossPenaltyBand = {
  minLossCp: number;
  maxLossCp?: number;
  penaltyOriginCp: number;
  penaltyAtOrigin: number;
  penaltyPerCp: number;
};
type QualityGradeBand = {
  grade: QualityGrade;
  minScore: number;
  qualityRange: string;
  hint: string;
  description: string;
};

const lossPenaltyBands: LossPenaltyBand[] = [
  { minLossCp: 0, maxLossCp: 20, penaltyOriginCp: 0, penaltyAtOrigin: 0, penaltyPerCp: 0 },
  { minLossCp: 21, maxLossCp: 60, penaltyOriginCp: 20, penaltyAtOrigin: 0, penaltyPerCp: .1 },
  { minLossCp: 61, maxLossCp: 120, penaltyOriginCp: 60, penaltyAtOrigin: 4, penaltyPerCp: .2 },
  { minLossCp: 121, maxLossCp: 250, penaltyOriginCp: 120, penaltyAtOrigin: 16, penaltyPerCp: .25 },
  { minLossCp: 251, penaltyOriginCp: 250, penaltyAtOrigin: 48.5, penaltyPerCp: .15 },
];

const qualityGradeBands: QualityGradeBand[] = [
  { grade: "优", minScore: 80, qualityRange: "80-100 分", hint: "接近最佳", description: "整体接近引擎首选，局面价值保持良好" },
  { grade: "良", minScore: 60, qualityRange: "60-79 分", hint: "质量良好", description: "整体可靠，局面价值损失仍在可控范围" },
  { grade: "中", minScore: 40, qualityRange: "40-59 分", hint: "可以改进", description: "造成一定局面损失，存在更稳健的选择" },
  { grade: "差", minScore: 20, qualityRange: "20-39 分", hint: "明显失误", description: "造成明显局面损失，通常会改变优势程度" },
  { grade: "错", minScore: 0, qualityRange: "0-19 分", hint: "严重错误", description: "造成严重局面损失，可能直接改变胜负趋势" },
];

export const moveGradeStandards: MoveGradeStandard[] = qualityGradeBands.map((band) => ({
  grade: band.grade,
  qualityRange: band.qualityRange,
  description: band.description,
}));

export function moveQualityFeedback(grade: MoveGrade, missedMate = false) {
  if (missedMate) return { hint: "漏掉杀棋", description: "走前存在强制杀棋，本着后杀棋消失" };
  const band = qualityGradeBands.find((candidate) => candidate.grade === grade)!;
  return { hint: band.hint, description: band.description };
}

export function reportMovePhase(ply: number, material: number): ReportPhase {
  if (material <= initialMaterial * .45 || ply > 80) return "endgame";
  if (ply <= 20) return "opening";
  return "middle";
}

function redPositionValue(position: GameReportDatasetDto["positions"][number]) {
  const side = position.sideToMove === "红方" ? 1 : -1;
  if (position.mate != null) return (position.mate === 0 ? -1 : Math.sign(position.mate)) * side * 1000;
  return position.scoreCp == null ? undefined : position.scoreCp * side;
}

function redMateSide(position: GameReportDatasetDto["positions"][number]) {
  if (position.mate == null) return 0;
  return (position.mate === 0 ? -1 : Math.sign(position.mate)) * (position.sideToMove === "红方" ? 1 : -1);
}

export function qualityGradeForScore(score: number): QualityGrade {
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return qualityGradeBands.find((band) => normalized >= band.minScore)!.grade;
}

function movePenalty(lossCp: number) {
  const band = lossPenaltyBands.find((candidate) => candidate.maxLossCp == null || lossCp <= candidate.maxLossCp)!;
  return Math.min(100, band.penaltyAtOrigin + (lossCp - band.penaltyOriginCp) * band.penaltyPerCp);
}

export function moveQualityScore(lossCp: number, missedMate = false): { score: number; grade: MoveGrade } {
  if (missedMate) return { score: 0, grade: "错" };
  const normalizedLoss = Math.max(0, lossCp);
  const score = Math.max(0, Math.round(100 - movePenalty(normalizedLoss)));
  return {
    score,
    grade: qualityGradeForScore(score),
  };
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined;
}

function sideReport(moves: GameReportMove[], side: Side): SideReport {
  const selected = moves.filter((move) => move.movedBy === side);
  const phaseScore = (phase: ReportPhase) => average(selected.filter((move) => move.phase === phase).map((move) => move.score));
  return {
    overall: average(selected.map((move) => move.score)),
    phases: { opening: phaseScore("opening"), middle: phaseScore("middle"), endgame: phaseScore("endgame") },
    counts: {
      excellent: selected.filter((move) => move.grade === "优").length,
      good: selected.filter((move) => move.grade === "良").length,
      average: selected.filter((move) => move.grade === "中").length,
      poor: selected.filter((move) => move.grade === "差").length,
      error: selected.filter((move) => move.grade === "错").length,
      missedMate: selected.filter((move) => move.missedMate).length,
    },
  };
}

export function calculateGameReport(dataset: GameReportDatasetDto): GameReport {
  const moves: GameReportMove[] = [];
  for (let index = 1; index < dataset.positions.length; index += 1) {
    const before = dataset.positions[index - 1];
    const after = dataset.positions[index];
    if (!after.move) continue;
    const beforeValue = redPositionValue(before);
    const afterValue = redPositionValue(after);
    if (beforeValue == null || afterValue == null) continue;
    const moverSign = after.move.movedBy === "红方" ? 1 : -1;
    const missedMate = redMateSide(before) === moverSign && redMateSide(after) !== moverSign;
    const rawLoss = moverSign === 1 ? beforeValue - afterValue : afterValue - beforeValue;
    const deltaCp = afterValue - beforeValue;
    const lossCp = Math.max(0, Math.round(rawLoss));
    const quality = moveQualityScore(lossCp, missedMate);
    moves.push({
      ...after.move,
      phase: after.material == null ? after.phase : reportMovePhase(after.ply, after.material),
      lossCp,
      ...quality,
      missedMate,
      redScoreCp: afterValue,
      deltaCp,
      opening: after.opening,
      bestIccs: before.bestIccs,
      bestNotation: before.bestNotation,
      pvNotation: before.pvNotation,
    });
  }
  return { red: sideReport(moves, "红方"), black: sideReport(moves, "黑方"), moves };
}

export function coachProfile(report: GameReport, side: Side): CoachProfile {
  const sideKey = side === "红方" ? "red" : "black";
  const sideReport = report[sideKey];
  const moves = report.moves.filter((move) => move.movedBy === side);
  const mean = sideReport.overall;
  const stability = mean == null || moves.length === 0
    ? undefined
    : Math.max(0, Math.round(100 - Math.sqrt(moves.reduce((sum, move) => sum + (move.score - mean) ** 2, 0) / moves.length)));
  const criticalMove = moves.reduce<GameReportMove | undefined>((worst, move) => !worst || move.lossCp > worst.lossCp ? move : worst, undefined);
  const errors = sideReport.counts.poor + sideReport.counts.error;
  const quality = mean == null ? "样本不足" : qualityGradeForScore(mean);
  const summary = mean == null
    ? `${side}尚无足够的已分析着法，无法生成质量结论。`
    : `${side}本局表现${quality}，综合 ${mean} 分；${errors > 0 ? `共有 ${errors} 次错着或漏着` : "没有达到错着等级的着法"}${criticalMove && criticalMove.lossCp > 20 ? `，最值得复盘的是 ${criticalMove.notation}（损失 ${criticalMove.lossCp}cp）` : ""}。`;
  return {
    quality,
    dimensions: {
      opening: sideReport.phases.opening,
      middle: sideReport.phases.middle,
      endgame: sideReport.phases.endgame,
      accuracy: mean,
      stability,
    },
    summary,
    criticalMove,
  };
}

function fullmoveNumber(fen: string) {
  const value = Number(fen.trim().split(/\s+/)[5]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function toRedPerspective(scoreCp: number, sideToMove: Side) {
  return sideToMove === "红方" ? scoreCp : -scoreCp;
}

export function redScoreAfterMove(move: MoveItem) {
  const mateSide = redMateSideAfterMove(move);
  if (move.mate != null) return mateSide * 1000;
  if (move.scoreCp == null) return undefined;
  return move.movedBy === "黑方" ? move.scoreCp : -move.scoreCp;
}

function redMateSideAfterMove(move: MoveItem) {
  if (move.mate == null) return 0;
  const sideToMove = move.movedBy === "黑方" ? 1 : -1;
  return (move.mate === 0 ? -1 : Math.sign(move.mate)) * sideToMove;
}

type PositionScore = { sideToMove: Side; scoreCp?: number; mate?: number };

function redScoreForPosition(position: PositionScore) {
  const side = position.sideToMove === "红方" ? 1 : -1;
  if (position.mate != null) return (position.mate === 0 ? -1 : Math.sign(position.mate)) * side * 1000;
  return position.scoreCp == null ? undefined : position.scoreCp * side;
}

function redMateSideForPosition(position: PositionScore) {
  if (position.mate == null) return 0;
  return (position.mate === 0 ? -1 : Math.sign(position.mate)) * (position.sideToMove === "红方" ? 1 : -1);
}

export function moveReports(history: MoveItem[], initial?: PositionScore): MoveReport[] {
  return history.map((move, index) => {
    const redScoreCp = redScoreAfterMove(move);
    const previousScore = index > 0 ? redScoreAfterMove(history[index - 1]) : initial ? redScoreForPosition(initial) : undefined;
    if (redScoreCp == null || previousScore == null) return { move, index, redScoreCp };

    const deltaCp = redScoreCp - previousScore;
    const moverImprovement = move.movedBy === "红方" ? deltaCp : -deltaCp;
    const moverLossCp = Math.max(0, -moverImprovement);
    const moverSign = move.movedBy === "红方" ? 1 : -1;
    const previousMateSide = index > 0
      ? redMateSideAfterMove(history[index - 1])
      : initial ? redMateSideForPosition(initial) : 0;
    const missedMate = previousMateSide === moverSign && redMateSideAfterMove(move) !== moverSign;
    const quality = moveQualityScore(moverLossCp, missedMate);
    return { move, index, redScoreCp, deltaCp, moverLossCp, ...quality, missedMate };
  });
}

function scoreText(scoreCp: number) {
  const value = Math.round(scoreCp);
  return value > 0 ? `+${value}` : `${value}`;
}

function evaluationLabel(scoreCp: number) {
  const magnitude = Math.abs(scoreCp);
  if (magnitude < 30) return "局面均衡";
  const side = scoreCp > 0 ? "红方" : "黑方";
  if (magnitude < 90) return `${side}微优`;
  if (magnitude < 200) return `${side}优势`;
  if (magnitude < 400) return `${side}明显优势`;
  return `${side}胜势`;
}

export function pvMoveRows(line: AnalysisLine, sideToMove: Side, fen: string): PvMoveRow[] {
  const moves = line.notation?.length ? line.notation : line.pv;
  const rows: PvMoveRow[] = [];
  let number = fullmoveNumber(fen);
  let side = sideToMove;
  for (const move of moves) {
    let row = rows.at(-1);
    if (!row || row.number !== number) {
      row = { number };
      rows.push(row);
    }
    if (side === "红方") {
      row.red = move;
      side = "黑方";
    } else {
      row.black = move;
      side = "红方";
      number += 1;
    }
  }
  return rows;
}

export function positionEvaluation(board: BoardState, analysis: AnalysisLine[]): PositionEvaluation | null {
  const primary = analysis.slice().sort((left, right) => left.multipv - right.multipv)[0];
  const currentMove = board.history.at(-1);
  const currentScore = primary?.scoreCp != null
    ? toRedPerspective(primary.scoreCp, board.sideToMove)
    : currentMove ? redScoreAfterMove(currentMove) : undefined;
  const currentMate = primary?.mate != null
    ? (board.sideToMove === "红方" ? primary.mate : -primary.mate)
    : currentMove?.mate != null
      ? (board.sideToMove === "红方" ? currentMove.mate : -currentMove.mate)
      : undefined;
  if (currentScore == null && currentMate == null) return null;

  const samples: TrendSample[] = board.history.flatMap((move, index) => {
    const score = redScoreAfterMove(move);
    return score == null ? [] : [{ label: `第 ${index + 1} 着`, scoreCp: score, nodeId: move.id, moveIndex: index }];
  });
  if (currentScore != null) {
    const currentLabel = board.currentNode ? `第 ${board.history.length} 着` : "开始局面";
    if (samples.at(-1)?.nodeId === board.currentNode) {
      samples[samples.length - 1] = { label: currentLabel, scoreCp: currentScore, nodeId: currentMove?.id, moveIndex: board.history.length - 1 };
    } else {
      samples.push({ label: currentLabel, scoreCp: currentScore, nodeId: currentMove?.id, moveIndex: board.history.length - 1 });
    }
  }

  const previous = samples.length > 1 ? samples[samples.length - 2].scoreCp : undefined;
  const delta = currentScore != null && previous != null ? currentScore - previous : undefined;
  const mateSide = currentMate == null ? undefined : currentMate > 0 ? "红方" : "黑方";
  const boundedScore = currentMate != null ? (currentMate > 0 ? 800 : -800) : currentScore ?? 0;
  return {
    label: mateSide ? `${mateSide}绝杀` : evaluationLabel(boundedScore),
    scoreText: currentMate != null ? `剩余 ${Math.abs(currentMate)} 步杀` : scoreText(boundedScore),
    detail: primary
      ? `深度 ${primary.depth ?? "-"} · ${primary.nps ? `${(primary.nps / 1_000_000).toFixed(1)}M` : "-"} NPS · ${((primary.timeMs ?? 0) / 1000).toFixed(1)}s`
      : "已保存节点分数",
    redShare: Math.max(5, Math.min(95, 50 + boundedScore / 16)),
    mateSide,
    mateIn: currentMate == null ? undefined : Math.abs(currentMate),
    deltaText: delta == null ? undefined : `较上一局面 ${delta >= 0 ? "+" : ""}${Math.round(delta)}`,
    samples,
  };
}

export function trendPoints(samples: TrendSample[], totalMoves = samples.length): TrendPoint[] {
  if (samples.length === 0) return [];
  const lastMoveIndex = Math.max(totalMoves - 1, ...samples.map((sample) => sample.moveIndex ?? 0));
  return samples.map((sample, index) => ({
    ...sample,
    x: samples.length === 1
      ? 150
      : 10 + (sample.moveIndex ?? index) * (280 / Math.max(1, lastMoveIndex)),
    y: 60 - Math.max(-1, Math.min(1, sample.scoreCp / 1000)) * 40,
  }));
}

export function trendTurningPoints(samples: TrendSample[], thresholdCp = 120): TrendTurningPoint[] {
  return samples.slice(1).flatMap((sample, index) => {
    const deltaCp = sample.scoreCp - samples[index].scoreCp;
    if (Math.abs(deltaCp) < thresholdCp) return [];
    return [{ ...sample, deltaCp, severity: Math.abs(deltaCp) > 250 ? "critical" as const : "major" as const }];
  });
}

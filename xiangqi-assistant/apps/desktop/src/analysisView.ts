import type { AnalysisLine, BoardState, GameReportDatasetDto, ReportPhase, MoveItem, Side } from "./platform";

export type PvMoveRow = { number: number; red?: string; black?: string };
export type TrendSample = { label: string; scoreCp: number; nodeId?: string; moveIndex?: number };
export type TrendPoint = TrendSample & { x: number; y: number };
export type MoveGrade = "优" | "佳" | "疑" | "错" | "漏";
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
  grade: MoveGrade;
  lossRangeCp: string;
  lossPawnRange: string;
  qualityRange: string;
  description: string;
};
export type PositionEvaluation = {
  label: string;
  scoreText: string;
  detail: string;
  redShare: number;
  deltaText?: string;
  samples: TrendSample[];
};
export type GameReportMove = {
  nodeId: string;
  notation: string;
  movedBy: Side;
  phase: ReportPhase;
  lossCp: number;
  score: number;
  grade: MoveGrade;
  missedMate: boolean;
  redScoreCp: number;
};
export type SideReport = {
  overall?: number;
  phases: Record<ReportPhase, number | undefined>;
  counts: Record<"excellent" | "good" | "inaccuracy" | "mistake" | "blunder" | "missedMate", number>;
};
export type GameReport = { red: SideReport; black: SideReport; moves: GameReportMove[] };
export type CoachDimensions = Record<"opening" | "middle" | "endgame" | "accuracy" | "stability", number | undefined>;
export type CoachProfile = {
  quality: "卓越" | "精准" | "稳健" | "尚可" | "待提高" | "样本不足";
  dimensions: CoachDimensions;
  summary: string;
  criticalMove?: GameReportMove;
};
export type TrendTurningPoint = TrendSample & {
  deltaCp: number;
  severity: "major" | "critical";
};

const initialMaterial = 5660;
type MoveGradeBand = {
  grade: MoveGrade;
  minLossCp: number;
  maxLossCp?: number;
  penaltyOriginCp: number;
  penaltyAtOrigin: number;
  penaltyPerCp: number;
  qualityRange: string;
  description: string;
};

const moveGradeBands: MoveGradeBand[] = [
  { grade: "优", minLossCp: 0, maxLossCp: 20, penaltyOriginCp: 0, penaltyAtOrigin: 0, penaltyPerCp: 0, qualityRange: "通常 100 分", description: "接近引擎首选，局面价值基本没有损失" },
  { grade: "佳", minLossCp: 21, maxLossCp: 60, penaltyOriginCp: 20, penaltyAtOrigin: 0, penaltyPerCp: .1, qualityRange: "约 96-100 分", description: "质量较高，只有轻微的局面价值损失" },
  { grade: "疑", minLossCp: 61, maxLossCp: 120, penaltyOriginCp: 60, penaltyAtOrigin: 4, penaltyPerCp: .2, qualityRange: "约 84-96 分", description: "值得复盘，局面优势出现可见下降" },
  { grade: "错", minLossCp: 121, maxLossCp: 250, penaltyOriginCp: 120, penaltyAtOrigin: 16, penaltyPerCp: .25, qualityRange: "约 51-84 分", description: "明显失误，通常会改变局面的优劣程度" },
  { grade: "漏", minLossCp: 251, penaltyOriginCp: 250, penaltyAtOrigin: 48.5, penaltyPerCp: .15, qualityRange: "0-51 分", description: "严重失误，可能丢失大量优势或直接改变胜负趋势" },
];

function rangeText(band: MoveGradeBand, divisor: number, suffix = "") {
  const format = (value: number) => divisor === 1 ? String(value) : (value / divisor).toFixed(2);
  if (band.maxLossCp == null) return `>${format(band.penaltyOriginCp)}${suffix}`;
  return `${format(band.minLossCp)}-${format(band.maxLossCp)}${suffix}`;
}

export const moveGradeStandards: MoveGradeStandard[] = moveGradeBands.map((band) => ({
  grade: band.grade,
  lossRangeCp: rangeText(band, 1, " cp"),
  lossPawnRange: rangeText(band, 100),
  qualityRange: band.qualityRange,
  description: band.description,
}));

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

function gradeForLoss(lossCp: number): MoveGrade {
  return moveGradeBands.find((band) => band.maxLossCp == null || lossCp <= band.maxLossCp)!.grade;
}

function movePenalty(lossCp: number) {
  const band = moveGradeBands.find((candidate) => candidate.maxLossCp == null || lossCp <= candidate.maxLossCp)!;
  return Math.min(100, band.penaltyAtOrigin + (lossCp - band.penaltyOriginCp) * band.penaltyPerCp);
}

export function moveQualityScore(lossCp: number, missedMate = false): { score: number; grade: MoveGrade } {
  if (missedMate) return { score: 0, grade: "漏" };
  const normalizedLoss = Math.max(0, lossCp);
  return {
    score: Math.max(0, Math.round(100 - movePenalty(normalizedLoss))),
    grade: gradeForLoss(normalizedLoss),
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
      good: selected.filter((move) => move.grade === "佳").length,
      inaccuracy: selected.filter((move) => move.grade === "疑").length,
      mistake: selected.filter((move) => move.grade === "错").length,
      blunder: selected.filter((move) => move.grade === "漏").length,
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
    const lossCp = Math.max(0, Math.round(rawLoss));
    const quality = moveQualityScore(lossCp, missedMate);
    moves.push({
      ...after.move,
      phase: after.material == null ? after.phase : reportMovePhase(after.ply, after.material),
      lossCp,
      ...quality,
      missedMate,
      redScoreCp: afterValue,
    });
  }
  return { red: sideReport(moves, "红方"), black: sideReport(moves, "黑方"), moves };
}

function qualityForScore(score?: number): CoachProfile["quality"] {
  if (score == null) return "样本不足";
  if (score >= 95) return "卓越";
  if (score >= 90) return "精准";
  if (score >= 80) return "稳健";
  if (score >= 70) return "尚可";
  return "待提高";
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
  const errors = sideReport.counts.mistake + sideReport.counts.blunder;
  const quality = qualityForScore(mean);
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

export function moveReports(history: MoveItem[]): MoveReport[] {
  return history.map((move, index) => {
    const redScoreCp = redScoreAfterMove(move);
    const previousScore = index > 0 ? redScoreAfterMove(history[index - 1]) : undefined;
    if (redScoreCp == null || previousScore == null) return { move, index, redScoreCp };

    const deltaCp = redScoreCp - previousScore;
    const moverImprovement = move.movedBy === "红方" ? deltaCp : -deltaCp;
    const moverLossCp = Math.max(0, -moverImprovement);
    const moverSign = move.movedBy === "红方" ? 1 : -1;
    const missedMate = redMateSideAfterMove(history[index - 1]) === moverSign && redMateSideAfterMove(move) !== moverSign;
    const quality = moveQualityScore(moverLossCp, missedMate);
    return { move, index, redScoreCp, deltaCp, moverLossCp, ...quality, missedMate };
  });
}

function scoreText(scoreCp: number) {
  const value = (scoreCp / 100).toFixed(2);
  return scoreCp > 0 ? `+${value}` : value;
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
    label: mateSide ? `${mateSide}有杀` : evaluationLabel(boundedScore),
    scoreText: currentMate != null ? `${mateSide} ${Math.abs(currentMate)} 步杀` : scoreText(boundedScore),
    detail: primary
      ? `深度 ${primary.depth ?? "-"} · ${primary.nps ? `${(primary.nps / 1_000_000).toFixed(1)}M` : "-"} NPS · ${((primary.timeMs ?? 0) / 1000).toFixed(1)}s`
      : "已保存节点分数",
    redShare: Math.max(5, Math.min(95, 50 + boundedScore / 16)),
    deltaText: delta == null ? undefined : `较上一局面 ${delta >= 0 ? "+" : ""}${(delta / 100).toFixed(2)}`,
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
      : 12 + (sample.moveIndex ?? index) * (276 / Math.max(1, lastMoveIndex)),
    y: 28 - Math.max(-1, Math.min(1, sample.scoreCp / 500)) * 21,
  }));
}

export function trendTurningPoints(samples: TrendSample[], thresholdCp = 120): TrendTurningPoint[] {
  return samples.slice(1).flatMap((sample, index) => {
    const deltaCp = sample.scoreCp - samples[index].scoreCp;
    if (Math.abs(deltaCp) < thresholdCp) return [];
    return [{ ...sample, deltaCp, severity: Math.abs(deltaCp) > 250 ? "critical" as const : "major" as const }];
  });
}

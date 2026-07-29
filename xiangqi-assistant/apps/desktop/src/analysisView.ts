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
  grade?: MoveGrade;
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

const initialMaterial = 5660;

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
  if (lossCp <= 20) return "优";
  if (lossCp <= 60) return "佳";
  if (lossCp <= 120) return "疑";
  if (lossCp <= 250) return "错";
  return "漏";
}

function movePenalty(lossCp: number) {
  if (lossCp <= 20) return 0;
  if (lossCp <= 60) return (lossCp - 20) * .1;
  if (lossCp <= 120) return 4 + (lossCp - 60) * .2;
  if (lossCp <= 250) return 16 + (lossCp - 120) * .25;
  return Math.min(100, 48.5 + (lossCp - 250) * .15);
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
    const score = missedMate ? 0 : Math.max(0, Math.round(100 - movePenalty(lossCp)));
    moves.push({
      ...after.move,
      phase: after.material == null ? after.phase : reportMovePhase(after.ply, after.material),
      lossCp,
      score,
      grade: missedMate ? "漏" : gradeForLoss(lossCp),
      missedMate,
      redScoreCp: afterValue,
    });
  }
  return { red: sideReport(moves, "红方"), black: sideReport(moves, "黑方"), moves };
}

function fullmoveNumber(fen: string) {
  const value = Number(fen.trim().split(/\s+/)[5]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function toRedPerspective(scoreCp: number, sideToMove: Side) {
  return sideToMove === "红方" ? scoreCp : -scoreCp;
}

export function redScoreAfterMove(move: MoveItem) {
  if (move.scoreCp == null) return undefined;
  return move.movedBy === "黑方" ? move.scoreCp : -move.scoreCp;
}

export function moveReports(history: MoveItem[]): MoveReport[] {
  return history.map((move, index) => {
    const redScoreCp = redScoreAfterMove(move);
    const previousScore = index > 0 ? redScoreAfterMove(history[index - 1]) : undefined;
    if (redScoreCp == null || previousScore == null) return { move, index, redScoreCp };

    const deltaCp = redScoreCp - previousScore;
    const moverImprovement = move.movedBy === "红方" ? deltaCp : -deltaCp;
    const moverLossCp = Math.max(0, -moverImprovement);
    return { move, index, redScoreCp, deltaCp, moverLossCp, grade: gradeForLoss(moverLossCp) };
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

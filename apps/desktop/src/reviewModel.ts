import type { BoardState, GameReportPresentationDto, MoveItem, QualityGrade, ReportIssuePresentationDto, Side } from "./platform/types";

export type ReviewMoveRow = {
  index: number;
  move: MoveItem;
  scoreText: string;
  quality?: QualityGrade;
  issue?: ReportIssuePresentationDto;
};

export type ReviewTrendPoint = {
  index: number;
  label: string;
  scoreCp: number;
  nodeId?: string;
  deltaCp?: number;
};

export type ReviewSideSummary = {
  side: Side;
  player: string;
  overall: string;
  issues: number;
  missedMate: number;
  phaseText: string;
};

export type ReviewModel = {
  title: string;
  currentMoveLabel: string;
  moveRows: ReviewMoveRow[];
  trendPoints: ReviewTrendPoint[];
  red: ReviewSideSummary;
  black: ReviewSideSummary;
  redIssues: ReportIssuePresentationDto[];
  blackIssues: ReportIssuePresentationDto[];
  nextIssue?: ReportIssuePresentationDto;
  issueCount: number;
};

function noteField(note: string, label: string) {
  const match = note.match(new RegExp(`(?:^|\\n)${label}：([^\\n]+)`));
  return match?.[1]?.trim();
}

function scoreText(scoreCp?: number, mate?: number) {
  if (mate != null) return mate >= 0 ? `杀${mate}` : `被杀${Math.abs(mate)}`;
  if (scoreCp == null) return "--";
  const score = Math.round(scoreCp);
  return score > 0 ? `+${score}` : `${score}`;
}

function displayScore(score?: number) {
  return score == null ? "--" : `${Math.round(score)}分`;
}

function phaseText(report: GameReportPresentationDto["red"]) {
  return `开 ${displayScore(report.phases.opening)} · 中 ${displayScore(report.phases.middle)} · 残 ${displayScore(report.phases.endgame)}`;
}

function sideSummary(side: Side, player: string, report?: GameReportPresentationDto): ReviewSideSummary {
  const sideReport = side === "红方" ? report?.red : report?.black;
  return {
    side,
    player,
    overall: displayScore(sideReport?.overall),
    issues: (sideReport?.counts.poor ?? 0) + (sideReport?.counts.error ?? 0),
    missedMate: sideReport?.counts.missedMate ?? 0,
    phaseText: sideReport ? phaseText(sideReport) : "等待报告",
  };
}

export function buildReviewModel(board: BoardState, report?: GameReportPresentationDto): ReviewModel {
  const issueByNode = new Map((report?.issues ?? []).map((issue) => [issue.nodeId, issue]));
  const currentMove = board.history.at(-1);
  const redIssues = (report?.issues ?? []).filter((issue) => issue.movedBy === "红方");
  const blackIssues = (report?.issues ?? []).filter((issue) => issue.movedBy === "黑方");
  const nextIssue = (report?.issues ?? []).find((issue) => {
    const moveIndex = board.history.findIndex((move) => move.id === issue.nodeId);
    return moveIndex >= Math.max(0, board.history.length - 1);
  }) ?? report?.issues[0];
  return {
    title: board.title || "未命名棋局",
    currentMoveLabel: currentMove ? `${board.history.length}. ${currentMove.notation}` : "开始局面",
    moveRows: board.history.map((move, index) => {
      const issue = issueByNode.get(move.id);
      return {
        index: index + 1,
        move,
        scoreText: scoreText(move.scoreCp, move.mate),
        quality: issue?.grade,
        issue,
      };
    }),
    trendPoints: (report?.trend ?? []).map((point, index) => ({ ...point, index })),
    red: sideSummary("红方", noteField(board.note, "红方") || "红方", report),
    black: sideSummary("黑方", noteField(board.note, "黑方") || "黑方", report),
    redIssues,
    blackIssues,
    nextIssue,
    issueCount: report?.issues.length ?? 0,
  };
}

export function signedCp(scoreCp?: number) {
  if (scoreCp == null) return "--";
  const score = Math.round(scoreCp);
  return score > 0 ? `+${score}` : `${score}`;
}

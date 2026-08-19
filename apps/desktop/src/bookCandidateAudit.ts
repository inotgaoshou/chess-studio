import type { AnalysisLine } from "./platform";

export type BookCandidateAuditStatus = "support" | "acceptable" | "dubious" | "notRecommended";

export type BookCandidateAuditResult = {
  status: BookCandidateAuditStatus;
  label: string;
  scoreGapCp?: number;
  depth?: number;
  bestMove?: string;
  pv?: string[];
  note: string;
};

const statusLabels: Record<BookCandidateAuditStatus, string> = {
  support: "支持",
  acceptable: "可接受",
  dubious: "存疑",
  notRecommended: "不建议",
};

function firstMove(line?: Pick<AnalysisLine, "pv">) {
  return line?.pv?.[0];
}

export function auditValue(line?: Pick<AnalysisLine, "scoreCp" | "mate">) {
  if (!line) return undefined;
  if (line.mate != null) {
    if (line.mate === 0) return 100_000;
    const distancePenalty = Math.min(Math.abs(line.mate), 999);
    return line.mate > 0 ? 100_000 - distancePenalty : -100_000 + distancePenalty;
  }
  return line.scoreCp;
}

export function classifyBookCandidateAudit(options: {
  candidateMove: string;
  baselineLines: AnalysisLine[];
  candidateLine?: AnalysisLine;
}): BookCandidateAuditResult {
  const bestLine = options.baselineLines.find((line) => line.multipv === 1) ?? options.baselineLines[0];
  const bestMove = firstMove(bestLine);
  const topMoves = new Set(options.baselineLines.map(firstMove).filter((move): move is string => !!move));
  const candidateValue = auditValue(options.candidateLine);
  const bestValue = auditValue(bestLine);
  const scoreGapCp = candidateValue == null || bestValue == null ? undefined : Math.max(0, Math.round(bestValue - candidateValue));
  const candidateMate = options.candidateLine?.mate;

  if (!options.candidateLine) {
    return {
      status: "dubious",
      label: statusLabels.dubious,
      bestMove,
      note: "Pikafish 未返回该候选，需要重新验证。",
    };
  }

  if (candidateMate != null && candidateMate < 0) {
    return {
      status: "notRecommended",
      label: statusLabels.notRecommended,
      scoreGapCp,
      depth: options.candidateLine.depth,
      bestMove,
      pv: options.candidateLine.pv,
      note: "Pikafish 显示该候选存在被杀风险。",
    };
  }

  if (candidateMate != null && candidateMate > 0 && (topMoves.has(options.candidateMove) || (scoreGapCp ?? 999) <= 30)) {
    return {
      status: "support",
      label: statusLabels.support,
      scoreGapCp,
      depth: options.candidateLine.depth,
      bestMove,
      pv: options.candidateLine.pv,
      note: "Pikafish 支持该候选，且存在杀棋信号。",
    };
  }

  const status: BookCandidateAuditStatus = topMoves.has(options.candidateMove) && (scoreGapCp ?? 999) <= 30
    ? "support"
    : (scoreGapCp ?? 999) <= 80
      ? "acceptable"
      : (scoreGapCp ?? 999) <= 150
        ? "dubious"
        : "notRecommended";

  const note = status === "support"
    ? "命中 Pikafish Top N，分差在 30cp 内。"
    : status === "acceptable"
      ? "Pikafish 认为可接受，但不是最稳首选。"
      : status === "dubious"
        ? "分差偏大，可研究但不建议直接背。"
        : "分差过大，不建议作为学习主线。";

  return {
    status,
    label: statusLabels[status],
    scoreGapCp,
    depth: options.candidateLine.depth,
    bestMove,
    pv: options.candidateLine.pv,
    note,
  };
}

export function auditResultText(result?: BookCandidateAuditResult) {
  if (!result) return undefined;
  const gap = result.scoreGapCp == null ? undefined : `差 ${result.scoreGapCp}`;
  return [result.label, gap].filter(Boolean).join(" · ");
}

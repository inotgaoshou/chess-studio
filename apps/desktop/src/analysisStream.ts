import type { AnalysisLine } from "./platform";

export type AnalysisStreamBuffer = {
  fen: string;
  lines: AnalysisLine[];
  published: boolean;
};

export type AnalysisHistoryBuffer = {
  fen: string;
  lines: AnalysisLine[];
};

export type AnalysisSessionSnapshot = {
  revision: number;
  boardRevision: number;
  fen: string;
};

export const ENGINE_ANALYSIS_HISTORY_LIMIT = 10;

export function beginAnalysisStream(fen: string): AnalysisStreamBuffer {
  return { fen, lines: [], published: false };
}

export function beginAnalysisHistory(fen: string): AnalysisHistoryBuffer {
  return { fen, lines: [] };
}

export function isAnalysisSessionCurrent(
  snapshot: AnalysisSessionSnapshot,
  currentRevision: number,
  currentBoardRevision: number,
  currentFen: string,
) {
  return snapshot.revision === currentRevision
    && snapshot.boardRevision === currentBoardRevision
    && snapshot.fen === currentFen;
}

export function completeAnalysisStream(fen: string, lines: AnalysisLine[]): AnalysisStreamBuffer {
  return { fen, lines: orderLines(lines), published: true };
}

export function updateAnalysisStream(
  current: AnalysisStreamBuffer | undefined,
  fen: string,
  line: AnalysisLine,
  expectedLines: number,
): { buffer: AnalysisStreamBuffer; visible?: AnalysisLine[] } {
  const source = current?.fen === fen ? current : beginAnalysisStream(fen);
  const repeatedRank = source.lines.some((candidate) => candidate.multipv === line.multipv);
  const lines = orderLines([
    ...source.lines.filter((candidate) => candidate.multipv !== line.multipv),
    line,
  ]);
  const target = Math.max(1, Math.trunc(expectedLines) || 1);
  const hasEveryRank = Array.from({ length: target }, (_, index) => index + 1)
    .every((rank) => lines.some((candidate) => candidate.multipv === rank));
  // A repeated rank means Pikafish started another depth cycle. This also
  // handles positions with fewer legal moves than the configured MultiPV.
  // Publish the first fresh line immediately as well. After an engine move the
  // previous position's candidates are intentionally hidden; waiting for all
  // MultiPV ranks made the floating panel look stuck at "AI 正在计算…" even
  // though Pikafish had already returned rank 1.
  const published = source.published || lines.length > 0 || hasEveryRank || repeatedRank;
  const buffer = { fen, lines, published };
  return { buffer, visible: published ? lines : undefined };
}

export function updateAnalysisHistory(
  current: AnalysisHistoryBuffer | undefined,
  fen: string,
  line: AnalysisLine,
  limit = ENGINE_ANALYSIS_HISTORY_LIMIT,
): AnalysisHistoryBuffer {
  const source = current?.fen === fen ? current : beginAnalysisHistory(fen);
  const key = historyLineKey(line);
  const boundedLimit = Math.max(1, Math.trunc(limit) || ENGINE_ANALYSIS_HISTORY_LIMIT);
  return {
    fen,
    lines: [
      line,
      ...source.lines.filter((candidate) => historyLineKey(candidate) !== key),
    ].slice(0, boundedLimit),
  };
}

function orderLines(lines: AnalysisLine[]) {
  return lines.slice().sort((left, right) => left.multipv - right.multipv);
}

function historyLineKey(line: AnalysisLine) {
  return [
    line.multipv,
    line.depth ?? "",
    line.scoreCp ?? "",
    line.mate ?? "",
    line.pv.join(" "),
  ].join("|");
}

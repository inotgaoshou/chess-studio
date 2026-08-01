import type { AnalysisLine } from "./platform";

export type AnalysisStreamBuffer = {
  fen: string;
  lines: AnalysisLine[];
  published: boolean;
};

export function beginAnalysisStream(fen: string): AnalysisStreamBuffer {
  return { fen, lines: [], published: false };
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
  const published = source.published || hasEveryRank || repeatedRank;
  const buffer = { fen, lines, published };
  return { buffer, visible: published ? lines : undefined };
}

function orderLines(lines: AnalysisLine[]) {
  return lines.slice().sort((left, right) => left.multipv - right.multipv);
}

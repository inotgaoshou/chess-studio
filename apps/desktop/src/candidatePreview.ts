export const MIN_ENGINE_CANDIDATES = 1;
export const DEFAULT_ENGINE_CANDIDATES = 2;
export const MIN_CANDIDATE_LINE_ROUNDS = 5;
export const DEFAULT_CANDIDATE_LINE_ROUNDS = 8;
export const MAX_CANDIDATE_LINE_ROUNDS = 8;
export const CANDIDATE_PREVIEW_HALF_MOVES = MAX_CANDIDATE_LINE_ROUNDS * 2;
export const MIN_CANDIDATE_LINE_MOVES = MIN_CANDIDATE_LINE_ROUNDS * 2;
export const DEFAULT_CANDIDATE_LINE_MOVES = CANDIDATE_PREVIEW_HALF_MOVES;
export const MAX_CANDIDATE_LINE_MOVES = CANDIDATE_PREVIEW_HALF_MOVES;

export function halfMovesToRoundText(halfMoves: number) {
  if (halfMoves % 2 === 0) return `${halfMoves / 2}`;
  return `${Math.floor(halfMoves / 2)}.5`;
}

export function candidatePreviewLengthText(length: number) {
  return length < CANDIDATE_PREVIEW_HALF_MOVES
    ? `当前深度仅返回 ${halfMovesToRoundText(length)}/${MAX_CANDIDATE_LINE_ROUNDS} 回合`
    : `最多${MAX_CANDIDATE_LINE_ROUNDS}回合（${CANDIDATE_PREVIEW_HALF_MOVES}个半回合）`;
}

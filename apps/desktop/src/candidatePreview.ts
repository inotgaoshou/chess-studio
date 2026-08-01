export const CANDIDATE_PREVIEW_HALF_MOVES = 20;
export const MIN_CANDIDATE_LINE_MOVES = 2;
export const DEFAULT_CANDIDATE_LINE_MOVES = 6;
export const MAX_CANDIDATE_LINE_MOVES = CANDIDATE_PREVIEW_HALF_MOVES;

export function candidatePreviewLengthText(length: number) {
  return length < CANDIDATE_PREVIEW_HALF_MOVES
    ? `当前深度仅返回 ${length}/${CANDIDATE_PREVIEW_HALF_MOVES} 个半回合`
    : `最多 ${CANDIDATE_PREVIEW_HALF_MOVES} 个半回合`;
}

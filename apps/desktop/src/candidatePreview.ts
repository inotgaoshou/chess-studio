export const CANDIDATE_PREVIEW_HALF_MOVES = 20;

export function candidatePreviewLengthText(length: number) {
  return length < CANDIDATE_PREVIEW_HALF_MOVES
    ? `当前深度仅返回 ${length}/${CANDIDATE_PREVIEW_HALF_MOVES} 个半回合`
    : `最多 ${CANDIDATE_PREVIEW_HALF_MOVES} 个半回合`;
}

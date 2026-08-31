export const TTXQ_ANNOTATION_BEGIN = "【天天象棋注解】";
export const TTXQ_ANNOTATION_END = "【天天象棋注解结束】";

export type TtxqCommentParts = { sourceText: string; localText: string };

export function splitTtxqComment(value: string): TtxqCommentParts {
  const start = value.indexOf(TTXQ_ANNOTATION_BEGIN);
  if (start < 0) return { sourceText: "", localText: value.trim() };
  const contentStart = start + TTXQ_ANNOTATION_BEGIN.length;
  const end = value.indexOf(TTXQ_ANNOTATION_END, contentStart);
  if (end < 0) return { sourceText: "", localText: value.trim() };
  const sourceText = value.slice(contentStart, end).trim();
  const localText = `${value.slice(0, start)}\n${value.slice(end + TTXQ_ANNOTATION_END.length)}`.trim();
  return { sourceText, localText };
}

export function mergeTtxqLocalComment(existing: string, localText: string) {
  const { sourceText } = splitTtxqComment(existing);
  const sourceBlock = sourceText ? `${TTXQ_ANNOTATION_BEGIN}\n${sourceText}\n${TTXQ_ANNOTATION_END}` : "";
  return [sourceBlock, localText.trim()].filter(Boolean).join("\n\n");
}

export function hasTtxqAnnotation(value: string) {
  return Boolean(splitTtxqComment(value).sourceText);
}

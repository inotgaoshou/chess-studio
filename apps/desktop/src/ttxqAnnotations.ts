import type { ManualTreeNode, MoveItem } from "./platform/types";

export const TTXQ_ANNOTATION_BEGIN = "【天天象棋注解】";
export const TTXQ_ANNOTATION_END = "【天天象棋注解结束】";

export type TtxqCommentParts = { sourceText: string; localText: string };

// Route labels are importer metadata used to keep Tencent branches identifiable.
// They are not user notes and must not be presented as editable annotations.
export function stripTtxqRouteLabels(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^天天象棋路线\s+\d+$/.test(line.trim()))
    .join("\n")
    .trim();
}

export function splitTtxqComment(value: string): TtxqCommentParts {
  const start = value.indexOf(TTXQ_ANNOTATION_BEGIN);
  if (start < 0) return { sourceText: "", localText: stripTtxqRouteLabels(value) };
  const contentStart = start + TTXQ_ANNOTATION_BEGIN.length;
  const end = value.indexOf(TTXQ_ANNOTATION_END, contentStart);
  if (end < 0) return { sourceText: "", localText: stripTtxqRouteLabels(value) };
  const sourceText = value.slice(contentStart, end).trim();
  const localText = stripTtxqRouteLabels(`${value.slice(0, start)}\n${value.slice(end + TTXQ_ANNOTATION_END.length)}`);
  return { sourceText, localText };
}

export function mergeTtxqLocalComment(existing: string, localText: string) {
  const { sourceText } = splitTtxqComment(existing);
  const sourceBlock = sourceText ? `${TTXQ_ANNOTATION_BEGIN}\n${sourceText}\n${TTXQ_ANNOTATION_END}` : "";
  // Preserve route labels as hidden importer metadata while keeping them out
  // of the local-note editor. This lets branch management continue to match
  // source routes after a local note is edited.
  const routeLabels = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^天天象棋路线\s+\d+$/.test(line));
  const local = stripTtxqRouteLabels(localText);
  return [...new Set([sourceBlock, ...routeLabels, local].filter(Boolean))].join("\n\n");
}

export function hasTtxqAnnotation(value: string) {
  return Boolean(splitTtxqComment(value).sourceText);
}

export function currentTtxqAnnotationValue(note: string, currentNode: string | undefined, currentMoveComment: string) {
  // Root annotations describe the opening position only. Once a move node is
  // selected, an empty node comment must stay empty instead of falling back
  // to the root and making the same source text appear beside every move.
  return currentNode ? currentMoveComment : note;
}

function findMoveInTree(nodes: ManualTreeNode[], nodeId: string): MoveItem | undefined {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.move.id === nodeId) return node.move;
    pending.push(...node.children);
  }
  return undefined;
}

export function currentTtxqAnnotationValueForNode(
  note: string,
  currentNode: string | undefined,
  history: MoveItem[],
  manualTree: ManualTreeNode[] = [],
) {
  if (!currentNode) return note;
  const currentMove = findMoveInTree(manualTree, currentNode)
    ?? history.find((move) => move.id === currentNode);
  return currentMove?.comment ?? "";
}

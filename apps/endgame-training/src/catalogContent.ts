type ContentNode = { kind: string; itemCount?: number | null; materialCount?: number | null; rehearsalCount?: number | null };

export function catalogContentLabels(node: ContentNode, pending = "题数统计中…", exerciseLabel = "可用题", compact = false) {
  const labels: string[] = [];
  if (node.itemCount == null) labels.push(pending);
  else if (node.itemCount > 0) labels.push(`${node.itemCount} ${exerciseLabel}`);
  if ((node.materialCount ?? 0) > 0) labels.push(`${node.materialCount} 条学习棋谱`);
  if (!compact && (node.rehearsalCount ?? 0) > 0 && node.rehearsalCount !== node.materialCount) labels.push(`${node.rehearsalCount} 条可复现线路`);
  const visible = compact ? labels.slice(0, 1) : labels;
  return visible.length ? visible : ["暂无可练内容"];
}

export function catalogVisibleChildren<T extends ContentNode>(nodes: T[], mode: string, entry?: string, showAll = false) {
  if (showAll) return nodes;
  // A compact practice course has direct chapters; the original book hierarchy
  // stays available to management and assignment selection.
  return mode === "training" && entry === "practical_mates" && nodes.some(n => n.kind === "chapter") ? nodes.filter(n => n.kind === "chapter" && (n.itemCount == null || n.itemCount > 0)) : nodes;
}

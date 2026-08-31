import type { ManualTreeNode, MoveItem } from "./platform/types";

export function variationCountByMove(nodes: ManualTreeNode[]) {
  const counts = new Map<string, number>();
  const visit = (items: ManualTreeNode[]) => items.forEach((node) => {
    if (node.children.length > 1) counts.set(node.move.id, node.children.length);
    visit(node.children);
  });
  visit(nodes);
  return counts;
}

export function childrenForCurrentNode(nodes: ManualTreeNode[], currentNode?: string): MoveItem[] {
  if (!currentNode) return nodes.map((node) => node.move);
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.move.id === currentNode) return node.children.map((child) => child.move);
    pending.push(...node.children);
  }
  return [];
}

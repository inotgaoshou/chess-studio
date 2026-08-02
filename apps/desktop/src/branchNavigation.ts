import type { ManualTreeNode } from "./platform";

export function findManualTreeNode(nodes: ManualTreeNode[], nodeId: string): ManualTreeNode | undefined {
  for (const node of nodes) {
    if (node.move.id === nodeId) return node;
    const found = findManualTreeNode(node.children, nodeId);
    if (found) return found;
  }
  return undefined;
}

function preferredTreeChild(nodes: ManualTreeNode[]) {
  return nodes.find((node) => node.move.isMainline) ?? nodes[0];
}

export function hasUpcomingBranchPoint(nodes: ManualTreeNode[], currentNode?: string) {
  const current = currentNode ? findManualTreeNode(nodes, currentNode) : undefined;
  const currentChoices = current ? current.children : nodes;
  if (currentChoices.length > 1) return true;

  let next = preferredTreeChild(currentChoices);
  while (next) {
    const candidates = next.children;
    if (candidates.length > 1) return true;
    next = preferredTreeChild(candidates);
  }
  return false;
}

import type { ManualTreeNode, MoveItem } from "./platform";

export type MobileManualBranchChoice = {
  id: string;
  letter: string;
  notation: string;
};

export type MobileManualRouteCell = {
  move: MoveItem;
  branchChoices: MobileManualBranchChoice[];
  branchLabel?: string;
  continuation: boolean;
};

export type MobileManualRouteRow = {
  turn: number;
  red?: MobileManualRouteCell;
  black?: MobileManualRouteCell;
  active: boolean;
};

function branchLetter(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function orderedSiblings(nodes: ManualTreeNode[]) {
  return nodes.slice().sort((left, right) => Number(right.move.isMainline) - Number(left.move.isMainline));
}

export function buildMobileManualRoute(nodes: ManualTreeNode[], history: MoveItem[], currentNode?: string, continuation: MoveItem[] = []): MobileManualRouteRow[] {
  const siblingsByNode = new Map<string, ManualTreeNode[]>();
  const collect = (siblings: ManualTreeNode[]) => {
    const ordered = orderedSiblings(siblings);
    ordered.forEach((node) => {
      siblingsByNode.set(node.move.id, ordered);
      collect(node.children);
    });
  };
  collect(nodes);

  const historyIds = new Set(history.map((move) => move.id));
  const route = [...history, ...continuation.filter((move) => !historyIds.has(move.id))];
  const cells = route.map((move): MobileManualRouteCell => {
    const siblings = siblingsByNode.get(move.id) ?? [];
    const branchChoices = siblings.map((node, index) => ({
      id: node.move.id,
      letter: branchLetter(index),
      notation: node.move.notation,
    }));
    return {
      move,
      branchChoices,
      // The badge reserves a stable two-character footprint: 2 branches are
      // shown as 2B, 3 as 3C, regardless of which sibling is being viewed.
      branchLabel: branchChoices.length > 1 ? `${branchChoices.length}${branchLetter(branchChoices.length - 1)}` : undefined,
      continuation: !historyIds.has(move.id),
    };
  });

  const rows: MobileManualRouteRow[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    const pair = cells.slice(index, index + 2);
    const row: MobileManualRouteRow = { turn: Math.floor(index / 2) + 1, active: pair.some((cell) => cell.move.id === currentNode) };
    pair.forEach((cell) => {
      if (cell.move.movedBy === "红方") row.red = cell;
      else row.black = cell;
    });
    rows.push(row);
  }
  return rows;
}

import type { ManualTreeNode, MoveItem, QualityGrade, Side } from "./platform";

export type ManualViewMode = "track" | "tree";

export type MoveQuality = { score?: number; grade?: QualityGrade };

export type TrackMoveCell = {
  move: MoveItem;
  label: string;
  score: string;
  quality?: MoveQuality;
  active: boolean;
  onRoute: boolean;
  mainline: boolean;
  branchCount: number;
  branchPreview: BranchPreview[];
  hiddenBranchCount: number;
  engineSource?: string;
};

export type BranchPreview = {
  nodeId: string;
  notation: string;
  score: string;
  mainline: boolean;
};

export type ManualTrackRow = {
  key: string;
  fullmove: number;
  lane: number;
  kind: "mainline" | "variation";
  red?: TrackMoveCell;
  black?: TrackMoveCell;
  active: boolean;
  onRoute: boolean;
  dimmed: boolean;
  forkNodeId?: string;
};

export type ManualTrackModel = {
  breadcrumb: string[];
  rows: ManualTrackRow[];
  current?: TrackMoveCell;
};

export type ManualBranchTreeRow = {
  key: string;
  nodeId: string;
  move: MoveItem;
  label: string;
  fullmove: number;
  ply: number;
  depth: number;
  isLastSibling: boolean;
  ancestorContinues: boolean[];
  active: boolean;
  onRoute: boolean;
  dimmed: boolean;
  mainline: boolean;
  score: string;
  quality?: MoveQuality;
  engineSource?: string;
  branchCount: number;
  branchPreview: BranchPreview[];
  hiddenBranchCount: number;
  expanded: boolean;
  collapsed: boolean;
  expandable: boolean;
};

export type ManualBranchTreeModel = {
  breadcrumb: string[];
  rows: ManualBranchTreeRow[];
  current?: ManualBranchTreeRow;
};

export type BranchComparisonRow = {
  index: number;
  mainline?: BranchPreview;
  variation?: BranchPreview;
};

export type BranchComparisonModel = {
  forkNodeId: string;
  forkLabel: string;
  selectedBranchId: string;
  rows: BranchComparisonRow[];
};

type BuildOptions = {
  collapsed: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  qualityByMoveId: ReadonlyMap<string, MoveQuality>;
  formatScore(move: MoveItem): string;
  previewLimit?: number;
};

const DEFAULT_PREVIEW_LIMIT = 3;

export function engineSource(comment: string) {
  const match = comment.match(/(?:^|\n)引擎来源：([^\n]+)/);
  return match?.[1]?.trim();
}

export function buildManualTrackModel(
  nodes: ManualTreeNode[],
  history: MoveItem[],
  currentNode: string | undefined,
  options: BuildOptions,
): ManualTrackModel {
  const activePath = new Set(history.map((move) => move.id));
  const previewLimit = Math.max(1, options.previewLimit ?? DEFAULT_PREVIEW_LIMIT);
  const rows: ManualTrackRow[] = [];
  function makeCell(node: ManualTreeNode): TrackMoveCell {
    const move = node.move;
    const quality = options.qualityByMoveId.get(move.id);
    const score = quality?.score != null ? `${quality.score}分` : options.formatScore(move);
    const mainChild = pickMainOrFirst(node.children);
    const branchChildren = node.children.filter((child) => child.move.id !== mainChild?.move.id);
    const branchPreview = branchChildren.slice(0, previewLimit).map((node) => ({
      nodeId: node.move.id,
      notation: node.move.notation,
      score: scoreForMove(node.move, options),
      mainline: node.move.isMainline,
    }));
    return {
      move,
      label: move.notation,
      score,
      quality,
      active: move.id === currentNode,
      onRoute: activePath.has(move.id),
      mainline: move.isMainline,
      branchCount: branchChildren.length,
      branchPreview,
      hiddenBranchCount: Math.max(0, branchChildren.length - previewLimit),
      engineSource: engineSource(move.comment),
    };
  }

  function pushCell(cell: TrackMoveCell, lane: number, ply: number, kind: ManualTrackRow["kind"], forkNodeId?: string) {
    const fullmove = Math.floor(ply / 2) + 1;
    const existing = rows.find((row) => row.fullmove === fullmove && row.lane === lane && row.kind === kind);
    const sideKey = cell.move.movedBy === "红方" ? "red" : "black";
    if (existing && !existing[sideKey]) {
      existing[sideKey] = cell;
      existing.active = existing.active || cell.active;
      existing.onRoute = existing.onRoute || cell.onRoute;
      existing.dimmed = !existing.onRoute && activePath.size > 0 && kind === "variation";
      return;
    }
    rows.push({
      key: `${kind}-${lane}-${fullmove}-${cell.move.id}`,
      fullmove,
      lane,
      kind,
      [sideKey]: cell,
      active: cell.active,
      onRoute: cell.onRoute,
      dimmed: !cell.onRoute && activePath.size > 0 && kind === "variation",
      forkNodeId,
    });
  }

  function walk(line: ManualTreeNode[], lane: number, ply: number, kind: ManualTrackRow["kind"], forkNodeId?: string) {
    let siblings = line;
    let current = pickMainOrFirst(siblings);
    while (current) {
      const cell = makeCell(current);
      pushCell(cell, lane, ply, kind, forkNodeId);

      const children = current.children;
      if (children.length > 1 && shouldExpand(current.move.id, activePath, options)) {
        const mainChild = pickMainOrFirst(children);
        let visibleVariationCount = 0;
        children.forEach((child) => {
          if (child.move.id === mainChild?.move.id) return;
          visibleVariationCount += 1;
          if (activePath.has(child.move.id) || options.expanded.has(current!.move.id) || visibleVariationCount <= previewLimit) {
            walk([child], lane + visibleVariationCount, ply + 1, "variation", current!.move.id);
          }
        });
      }

      siblings = children;
      current = pickMainOrFirst(siblings);
      ply += 1;
    }
  }

  walk(nodes, 0, 0, "mainline");
  rows.sort((left, right) => left.fullmove - right.fullmove || left.lane - right.lane || (left.kind === "mainline" ? -1 : 1));

  const current = rows.flatMap((row) => [row.red, row.black]).find((cell) => cell?.active);
  return {
    breadcrumb: history.map((move) => move.notation),
    rows,
    current,
  };
}

export function buildManualBranchTreeModel(
  nodes: ManualTreeNode[],
  history: MoveItem[],
  currentNode: string | undefined,
  options: BuildOptions,
): ManualBranchTreeModel {
  const activePath = new Set(history.map((move) => move.id));
  const previewLimit = Math.max(1, options.previewLimit ?? DEFAULT_PREVIEW_LIMIT);
  const rows: ManualBranchTreeRow[] = [];

  function makeRow(
    node: ManualTreeNode,
    depth: number,
    ply: number,
    siblingIndex: number,
    siblingCount: number,
    ancestorContinues: boolean[],
  ): ManualBranchTreeRow {
    const move = node.move;
    const quality = options.qualityByMoveId.get(move.id);
    const score = quality?.score != null ? `${quality.score}分` : options.formatScore(move);
    const mainChild = pickMainOrFirst(node.children);
    const branchChildren = node.children.filter((child) => child.move.id !== mainChild?.move.id);
    const branchPreview = branchChildren.slice(0, previewLimit).map((child) => ({
      nodeId: child.move.id,
      notation: child.move.notation,
      score: scoreForMove(child.move, options),
      mainline: child.move.isMainline,
    }));
    const expanded = branchChildren.length > 0 && shouldExpand(move.id, activePath, options);
    const collapsed = branchChildren.length > 0 && options.collapsed.has(move.id);
    return {
      key: `branch-tree-${move.id}`,
      nodeId: move.id,
      move,
      label: move.notation,
      fullmove: Math.floor(ply / 2) + 1,
      ply,
      depth,
      isLastSibling: siblingIndex === siblingCount - 1,
      ancestorContinues,
      active: move.id === currentNode,
      onRoute: activePath.has(move.id),
      dimmed: activePath.size > 0 && !activePath.has(move.id),
      mainline: move.isMainline,
      score,
      quality,
      engineSource: engineSource(move.comment),
      branchCount: branchChildren.length,
      branchPreview,
      hiddenBranchCount: Math.max(0, branchChildren.length - previewLimit),
      expanded,
      collapsed,
      expandable: branchChildren.length > 0,
    };
  }

  function walk(node: ManualTreeNode, depth: number, ply: number, siblingIndex: number, siblingCount: number, ancestorContinues: boolean[]) {
    const row = makeRow(node, depth, ply, siblingIndex, siblingCount, ancestorContinues);
    rows.push(row);

    const mainChild = pickMainOrFirst(node.children);
    const branchChildren = node.children.filter((child) => child.move.id !== mainChild?.move.id);
    if (row.expanded) {
      branchChildren.forEach((child, index) => {
        const nextAncestorContinues = ancestorContinues.slice();
        nextAncestorContinues[depth] = index < branchChildren.length - 1;
        walk(child, depth + 1, ply + 1, index, branchChildren.length, nextAncestorContinues);
      });
    }

    if (mainChild) {
      // A line only moves right when it leaves its parent's main continuation.
      // Continuing either the root line or an already-indented variation keeps
      // its lane, so long variations remain readable instead of drifting right.
      walk(mainChild, depth, ply + 1, 0, 1, ancestorContinues.slice());
    }
  }

  const mainRoot = pickMainOrFirst(nodes);
  const rootBranches = nodes.filter((node) => node.move.id !== mainRoot?.move.id);
  if (mainRoot) {
    walk(mainRoot, 0, 0, 0, 1, []);
  }
  const showRootBranches = rootBranches.length > 0 && (options.expanded.has("root") || activePath.size === 0 || rootBranches.some((node) => activePath.has(node.move.id)));
  if (showRootBranches) {
    rootBranches.forEach((node, index) => {
      walk(node, 1, 0, index, rootBranches.length, [index < rootBranches.length - 1]);
    });
  }

  const current = rows.find((row) => row.active);
  return {
    breadcrumb: history.map((move) => move.notation),
    rows,
    current,
  };
}

export function buildBranchComparisonModel(
  forkNodeId: string,
  selectedBranchId: string,
  nodes: ManualTreeNode[],
  options: Pick<BuildOptions, "formatScore" | "qualityByMoveId">,
): BranchComparisonModel | undefined {
  const fork = findNode(nodes, forkNodeId);
  const selected = fork?.children.find((node) => node.move.id === selectedBranchId);
  if (!fork || !selected) return undefined;
  const mainline = pickMainOrFirst(fork.children);
  const mainMoves = flattenLine(mainline).map((move) => previewForMove(move, options));
  const variationMoves = flattenLine(selected).map((move) => previewForMove(move, options));
  const total = Math.max(mainMoves.length, variationMoves.length);
  return {
    forkNodeId,
    forkLabel: fork.move.notation,
    selectedBranchId,
    rows: Array.from({ length: total }, (_, index) => ({
      index: index + 1,
      mainline: mainMoves[index],
      variation: variationMoves[index],
    })),
  };
}

export function sideClass(side: Side) {
  return side === "红方" ? "red" : "black";
}

function shouldExpand(nodeId: string, activePath: ReadonlySet<string>, options: BuildOptions) {
  return !options.collapsed.has(nodeId) && (activePath.has(nodeId) || options.expanded.has(nodeId));
}

function scoreForMove(move: MoveItem, options: Pick<BuildOptions, "formatScore" | "qualityByMoveId">) {
  const quality = options.qualityByMoveId.get(move.id);
  return quality?.score != null ? `${quality.score}分` : options.formatScore(move);
}

function previewForMove(move: MoveItem, options: Pick<BuildOptions, "formatScore" | "qualityByMoveId">): BranchPreview {
  return {
    nodeId: move.id,
    notation: move.notation,
    score: scoreForMove(move, options),
    mainline: move.isMainline,
  };
}

function pickMainOrFirst(nodes: ManualTreeNode[]) {
  return nodes.find((node) => node.move.isMainline) ?? nodes[0];
}

function flattenLine(node: ManualTreeNode | undefined) {
  const moves: MoveItem[] = [];
  let current = node;
  while (current) {
    moves.push(current.move);
    current = pickMainOrFirst(current.children);
  }
  return moves;
}

function findNode(nodes: ManualTreeNode[], nodeId: string): ManualTreeNode | undefined {
  for (const node of nodes) {
    if (node.move.id === nodeId) return node;
    const found = findNode(node.children, nodeId);
    if (found) return found;
  }
  return undefined;
}

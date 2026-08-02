import type { ManualTreeNode, MoveItem } from "./platform";

const NODE_WIDTH = 204;
const NODE_HEIGHT = 68;
const X_GAP = 72;
const Y_GAP = 28;
const HEADER_HEIGHT = 64;
const PADDING = 28;

type PositionedNode = {
  node: ManualTreeNode;
  depth: number;
  x: number;
  y: number;
  children: PositionedNode[];
};

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function scoreText(move: MoveItem) {
  // Engine scores are from the side to move after this move. Normalize them to red.
  if (move.mate != null) {
    const redMate = move.movedBy === "黑方" ? move.mate : -move.mate;
    return `${redMate >= 0 ? "红方" : "黑方"}剩余 ${Math.abs(redMate)} 步杀`;
  }
  if (move.scoreCp == null) return "待分析";
  const redScore = move.movedBy === "黑方" ? move.scoreCp : -move.scoreCp;
  if (redScore === 0) return "均势 0";
  return `${redScore > 0 ? "红优" : "黑优"} ${redScore > 0 ? "+" : ""}${redScore}`;
}

function layoutTree(nodes: ManualTreeNode[], depth: number, nextY: { value: number }): PositionedNode[] {
  return nodes.map((node) => {
    const children = layoutTree(node.children, depth + 1, nextY);
    const y = children.length
      ? (children[0].y + children.at(-1)!.y) / 2
      : (() => { const value = nextY.value; nextY.value += NODE_HEIGHT + Y_GAP; return value; })();
    return { node, depth, x: PADDING + depth * (NODE_WIDTH + X_GAP), y, children };
  });
}

function flatten(nodes: PositionedNode[]): PositionedNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** Produces a self-contained, printable SVG for the complete variation tree. */
export function buildMindMapSvg(title: string, nodes: ManualTreeNode[]) {
  const positioned = layoutTree(nodes, 1, { value: HEADER_HEIGHT + PADDING });
  const all = flatten(positioned);
  const maxDepth = Math.max(0, ...all.map((node) => node.depth));
  const width = Math.max(640, PADDING * 2 + NODE_WIDTH * (maxDepth + 1) + X_GAP * maxDepth);
  const height = Math.max(180, HEADER_HEIGHT + PADDING * 2 + Math.max(1, all.filter((node) => node.children.length === 0).length) * (NODE_HEIGHT + Y_GAP));
  const rootY = HEADER_HEIGHT + (height - HEADER_HEIGHT - NODE_HEIGHT) / 2;
  const rootLines = positioned.map((child) => `<path d="M ${PADDING + NODE_WIDTH} ${rootY + NODE_HEIGHT / 2} C ${PADDING + NODE_WIDTH + X_GAP / 2} ${rootY + NODE_HEIGHT / 2}, ${child.x - X_GAP / 2} ${child.y + NODE_HEIGHT / 2}, ${child.x} ${child.y + NODE_HEIGHT / 2}" class="link ${child.node.move.isMainline ? "mainline" : "variation"}"/>`).join("");
  const lines = rootLines + all.flatMap((parent) => parent.children.map((child) => {
    const mainline = child.node.move.isMainline;
    return `<path d="M ${parent.x + NODE_WIDTH} ${parent.y + NODE_HEIGHT / 2} C ${parent.x + NODE_WIDTH + X_GAP / 2} ${parent.y + NODE_HEIGHT / 2}, ${child.x - X_GAP / 2} ${child.y + NODE_HEIGHT / 2}, ${child.x} ${child.y + NODE_HEIGHT / 2}" class="link ${mainline ? "mainline" : "variation"}"/>`;
  })).join("");
  const cards = all.map(({ node, x, y }) => {
    const { move } = node;
    const side = move.movedBy === "红方" ? "red" : "black";
    const score = scoreText(move);
    const comment = move.comment.trim() ? "注" : "";
    return `<g class="node ${move.isMainline ? "mainline" : "variation"}" transform="translate(${x} ${y})">
      <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8"/>
      <circle class="side ${side}" cx="17" cy="19" r="5"/>
      <text class="move" x="30" y="25">${escapeXml(move.notation)}</text>
      <text class="score" x="14" y="45">局势 · ${escapeXml(score)}</text>
      <text class="meta" x="14" y="60">${escapeXml(move.movedBy)}${comment ? ` · ${comment}` : ""}${node.children.length > 1 ? ` · ${node.children.length} 变` : ""}</text>
    </g>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .canvas { fill: #f5f9fc; } .title { fill: #193b5d; font: 700 20px 'PingFang SC', sans-serif; }
    .subtitle { fill: #63809a; font: 12px 'PingFang SC', sans-serif; } .link { fill: none; stroke-width: 2; }
    .link.mainline { stroke: #36a76f; } .link.variation { stroke: #8daec7; stroke-dasharray: 5 4; }
    .node rect { fill: #fff; stroke: #a8c4d7; stroke-width: 1.5; } .node.mainline rect { fill: #effaf4; stroke: #3eb77b; stroke-width: 2; }
    .move { fill: #183d60; font: 700 16px 'KaiTi', 'STKaiti', serif; } .score { fill: #29965f; font: 700 12px ui-monospace, monospace; }
    .meta { fill: #7290a6; font: 11px 'PingFang SC', sans-serif; } .side.red { fill: #e55b55; } .side.black { fill: #61a8d0; }
  </style>
  <rect class="canvas" width="100%" height="100%"/>
  <text class="title" x="${PADDING}" y="32">${escapeXml(title || "未命名棋谱")} · 变招图</text>
  <text class="subtitle" x="${PADDING}" y="52">绿色实线：主线　灰蓝虚线：变招　共 ${all.length} 个节点</text>
  <g><rect x="${PADDING}" y="${rootY}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="#e7f1f8" stroke="#5a94b9" stroke-width="2"/><text class="move" x="${PADDING + 16}" y="${rootY + 30}">起始局面</text><text class="meta" x="${PADDING + 16}" y="${rootY + 52}">从此处展开全部变招</text></g>
  <g>${lines}</g>
  <g>${cards}</g>
</svg>`;
}

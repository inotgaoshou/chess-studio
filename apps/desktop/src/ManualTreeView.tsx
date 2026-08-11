import { Fragment, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, GitBranch, ListStart, MessageSquare, Trash2 } from "lucide-react";
import { BranchSelector } from "./BranchSelector";
import { flyknifeMarker, hasReviewMarker } from "./reviewMarker";
import type { ManualTreeNode, MoveItem, QualityGrade } from "./platform";

type MoveQuality = { score?: number; grade?: QualityGrade };

type Props = {
  nodes: ManualTreeNode[];
  currentNode?: string;
  activePath: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  editing: boolean;
  qualityByMoveId: ReadonlyMap<string, MoveQuality>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
  onToggle(nodeId: string): void;
  onMakeMainline(nodeId: string): void;
  onReorder(nodeIds: string[], from: number, to: number): void;
  onRemove(nodeId: string): void;
};

function branchLabel(nodes: ManualTreeNode[], index: number) {
  if (nodes.length < 2) return "";
  if (nodes[index].move.isMainline) return "主线";
  return `分支 ${nodes.slice(0, index + 1).filter((node) => !node.move.isMainline).length}`;
}

function engineSource(comment: string) {
  const match = comment.match(/(?:^|\n)引擎来源：([^\n]+)/);
  return match?.[1]?.trim();
}

function preferredChild(nodes: ManualTreeNode[]) {
  return nodes.find((node) => node.move.isMainline) ?? nodes[0];
}

function TreeLine({ node, depth, props, siblings, siblingIndex }: {
  node: ManualTreeNode;
  depth: number;
  props: Props;
  siblings: ManualTreeNode[];
  siblingIndex: number;
}) {
  const move = node.move;
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && (props.activePath.has(move.id) || (!props.collapsed.has(move.id) && move.isMainline));
  const quality = props.qualityByMoveId.get(move.id);
  const label = branchLabel(siblings, siblingIndex);
  const source = engineSource(move.comment);
  const flyknife = flyknifeMarker(move.comment);
  const active = move.id === props.currentNode;
  const mainChild = preferredChild(node.children);
  const variationChildren = node.children.filter((child) => child.move.id !== mainChild?.move.id);
  return <Fragment>
    <li
      className={`manual-tree-node ${active ? "active" : ""} ${props.activePath.has(move.id) ? "on-route" : ""} ${move.isMainline ? "mainline" : "variation"}`}
      data-depth={depth}
      data-node-id={move.id}
      data-current-node={active ? "true" : undefined}
      data-testid={`tree-node-${move.id}`}
    >
      <div className="manual-tree-row">
        <span className="manual-tree-rail" aria-hidden="true" />
        {hasChildren
          ? <button type="button" className="manual-tree-toggle" title={expanded ? "收起后续分支" : "展开后续分支"} onClick={() => props.onToggle(move.id)}>{expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
          : <span className="manual-tree-toggle placeholder" />}
        <button type="button" className="manual-tree-move" onClick={() => props.onNavigate(move.id)} aria-current={active ? "step" : undefined} title={`${label ? `${label} · ` : ""}${move.notation}，点击定位到此分支`}>
          <span className={`manual-tree-number ${label ? "branch" : ""}`}>{label || "·"}</span>
          <i className={move.movedBy === "红方" ? "red" : "black"}/>
          <strong>{move.notation}</strong>
          {quality?.grade && <em className={`move-quality-mini grade-${quality.grade}`}>{quality.grade}</em>}
          {source && <em className="manual-engine-source" title={`这步采用自对比引擎：${source}`}><span>对比</span>{source}</em>}
          {move.comment && <MessageSquare className="comment-marker" size={11}/>} 
          {hasReviewMarker(move.comment) && <em className="manual-review-marker">复盘</em>}
          {flyknife && <em className="manual-flyknife-marker" title={flyknife.intent || `${flyknife.label}飞刀标注`}>飞刀 · {flyknife.label}</em>}
          {active && <em className="manual-current-node-badge">当前局面</em>}
          {hasChildren && <small>{node.children.length} 变</small>}
          <b>{quality?.score != null ? `${quality.score}分` : props.formatScore(move)}</b>
        </button>
        {props.editing && <span className="manual-tree-actions">
          {!move.isMainline && <button type="button" title="设为主线" onClick={() => props.onMakeMainline(move.id)}><ListStart size={12}/></button>}
          <button type="button" disabled={siblingIndex === 0} title="上移分支" onClick={() => props.onReorder(siblings.map((item) => item.move.id), siblingIndex, siblingIndex - 1)}>↑</button>
          <button type="button" disabled={siblingIndex === siblings.length - 1} title="下移分支" onClick={() => props.onReorder(siblings.map((item) => item.move.id), siblingIndex, siblingIndex + 1)}>↓</button>
          <button type="button" className="danger" title="删除分支及其后续" onClick={() => props.onRemove(move.id)}><Trash2 size={12}/></button>
        </span>}
      </div>
    </li>
    {node.children.length > 1 && <li className="manual-tree-branch-selector-slot">
      <BranchSelector
        branches={node.children.map((child) => ({
          id: child.move.id,
          isMainline: child.move.isMainline,
          notation: child.move.notation,
          score: props.qualityByMoveId.get(child.move.id)?.score != null
            ? `${props.qualityByMoveId.get(child.move.id)?.score}分`
            : props.formatScore(child.move),
        }))}
        currentBranchId={node.children.find((child) => props.activePath.has(child.move.id))?.move.id}
        onNavigate={props.onNavigate}
      />
    </li>}
    {expanded && variationChildren.length > 0 && <li className="manual-tree-branch-container">
      <TreeLevel nodes={variationChildren} depth={depth + 1} props={props} actionSiblings={node.children}/>
    </li>}
    {expanded && mainChild && <TreeLine node={mainChild} depth={depth} props={props} siblings={node.children} siblingIndex={node.children.indexOf(mainChild)}/>}
  </Fragment>;
}

function TreeLevel({ nodes, depth, props, actionSiblings = nodes }: { nodes: ManualTreeNode[]; depth: number; props: Props; actionSiblings?: ManualTreeNode[] }) {
  return <ol className={`manual-tree-level depth-${Math.min(depth, 5)}`}>
    {nodes.map((node) => <TreeLine
      key={node.move.id}
      node={node}
      depth={depth}
      props={props}
      siblings={actionSiblings}
      siblingIndex={actionSiblings.indexOf(node)}
    />)}
  </ol>;
}

export function ManualTreeView(props: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = viewRef.current?.querySelector<HTMLElement>('[data-current-node="true"]');
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [props.currentNode, props.nodes, props.collapsed, props.activePath]);
  return <div className="manual-tree-view" aria-label="树状棋谱" ref={viewRef}>
    {props.nodes.length > 1 && <div className="manual-tree-root-selector">
      <BranchSelector
        branches={props.nodes.map((node) => ({
          id: node.move.id,
          isMainline: node.move.isMainline,
          notation: node.move.notation,
          score: props.qualityByMoveId.get(node.move.id)?.score != null
            ? `${props.qualityByMoveId.get(node.move.id)?.score}分`
            : props.formatScore(node.move),
        }))}
        currentBranchId={props.nodes.find((node) => props.activePath.has(node.move.id))?.move.id}
        label="开局变招"
        onNavigate={props.onNavigate}
      />
    </div>}
    <TreeLevel nodes={props.nodes} depth={0} props={props}/>
  </div>;
}

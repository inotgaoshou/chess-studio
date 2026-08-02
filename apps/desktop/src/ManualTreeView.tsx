import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, GitBranch, ListStart, MessageSquare, Trash2 } from "lucide-react";
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

function TreeLevel({ nodes, depth, props }: { nodes: ManualTreeNode[]; depth: number; props: Props }) {
  return <ol className={`manual-tree-level depth-${Math.min(depth, 5)}`}>
    {nodes.map((node, index) => {
      const move = node.move;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && (props.activePath.has(move.id) || (!props.collapsed.has(move.id) && move.isMainline));
      const quality = props.qualityByMoveId.get(move.id);
      const label = branchLabel(nodes, index);
      const source = engineSource(move.comment);
      const active = move.id === props.currentNode;
      return <li
        key={move.id}
        className={`manual-tree-node ${active ? "active" : ""} ${props.activePath.has(move.id) ? "on-route" : ""} ${move.isMainline ? "mainline" : "variation"}`}
        data-node-id={move.id}
        data-current-node={active ? "true" : undefined}
      >
        <div className="manual-tree-row">
          <span className="manual-tree-rail" aria-hidden="true" />
          {hasChildren
            ? <button type="button" className="manual-tree-toggle" title={expanded ? "收起后续分支" : "展开后续分支"} onClick={() => props.onToggle(move.id)}>{expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
            : <span className="manual-tree-toggle placeholder" />}
          <button type="button" className="manual-tree-move" onClick={() => props.onNavigate(move.id)} aria-current={move.id === props.currentNode ? "step" : undefined} title={`${label ? `${label} · ` : ""}${move.notation}，点击定位到此分支`}>
            <span className={`manual-tree-number ${label ? "branch" : ""}`}>{label || "·"}</span>
            <i className={move.movedBy === "红方" ? "red" : "black"}/>
            <strong>{move.notation}</strong>
            {quality?.grade && <em className={`move-quality-mini grade-${quality.grade}`}>{quality.grade}</em>}
            {source && <em className="manual-engine-source" title={`这步采用自对比引擎：${source}`}><span>对比</span>{source}</em>}
            {move.comment && <MessageSquare className="comment-marker" size={11}/>}
            {active && <em className="manual-current-node-badge">当前局面</em>}
            {hasChildren && <small>{node.children.length} 变</small>}
            <b>{quality?.score != null ? `${quality.score}分` : props.formatScore(move)}</b>
          </button>
          {props.editing && <span className="manual-tree-actions">
            {!move.isMainline && <button type="button" title="设为主线" onClick={() => props.onMakeMainline(move.id)}><ListStart size={12}/></button>}
            <button type="button" disabled={index === 0} title="上移分支" onClick={() => props.onReorder(nodes.map((item) => item.move.id), index, index - 1)}>↑</button>
            <button type="button" disabled={index === nodes.length - 1} title="下移分支" onClick={() => props.onReorder(nodes.map((item) => item.move.id), index, index + 1)}>↓</button>
            <button type="button" className="danger" title="删除分支及其后续" onClick={() => props.onRemove(move.id)}><Trash2 size={12}/></button>
          </span>}
        </div>
        {expanded && <TreeLevel nodes={node.children} depth={depth + 1} props={props}/>}
      </li>;
    })}
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
    <TreeLevel nodes={props.nodes} depth={0} props={props}/>
  </div>;
}

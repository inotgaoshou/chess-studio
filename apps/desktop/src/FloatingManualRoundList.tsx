import { useEffect, useMemo, useRef, useState } from "react";
import { buildMoveThought } from "./moveThoughtModel";
import type { ManualTreeNode, MoveItem, ReportIssuePresentationDto } from "./platform/types";
import { MoveThoughtDetails } from "./MoveThoughtDetails";
import { hasTtxqAnnotation } from "./ttxqAnnotations";
import { childrenForCurrentNode, variationCountByMove } from "./manualTreeQueries";

type FloatingManualRoundListProps = {
  branches?: MoveItem[];
  currentNode?: string;
  issues?: ReportIssuePresentationDto[];
  manualTree?: ManualTreeNode[];
  moves: MoveItem[];
  showThoughts?: boolean;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
};

export function FloatingManualRoundList({ branches = [], currentNode, issues = [], manualTree = [], moves, showThoughts = true, formatScore, onNavigate }: FloatingManualRoundListProps) {
  const [expandedThoughtMove, setExpandedThoughtMove] = useState<string>();
  const currentMoveRef = useRef<HTMLDivElement>(null);
  const issueByMoveId = useMemo(() => new Map(issues.map((issue) => [issue.nodeId, issue])), [issues]);
  const variationCounts = useMemo(() => variationCountByMove(manualTree), [manualTree]);
  const currentBranches = useMemo(() => branches.length > 1 ? branches : childrenForCurrentNode(manualTree, currentNode), [branches, currentNode, manualTree]);
  const rounds = Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => ({
    number: index + 1,
    red: moves[index * 2],
    black: moves[index * 2 + 1],
  }));

  useEffect(() => {
    currentMoveRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [currentNode]);

  return <div className="floating-manual-round-list" aria-label="浮动窗口回合列表">
    {rounds.map((round) => <article key={round.number}>
      <span>{round.number}</span>
      {[round.red, round.black].map((move, index) => {
        if (!move) return <i key={`${round.number}-${index}`} aria-hidden="true"/>;
        const moveIndex = (round.number - 1) * 2 + index + 1;
        const issue = issueByMoveId.get(move.id);
        const variationCount = variationCounts.get(move.id);
        const thought = buildMoveThought(move, issue);
        const thoughtExpanded = expandedThoughtMove === move.id;
        return <div key={move.id} ref={currentNode === move.id ? currentMoveRef : undefined} data-current-node={currentNode === move.id || undefined} className={`floating-manual-round-entry ${thoughtExpanded ? "expanded" : ""}`}>
          <button type="button" aria-label={`${move.movedBy} ${move.notation}`} className={`floating-manual-round-move ${move.movedBy === "红方" ? "red" : "black"} ${currentNode === move.id ? "active" : ""}`} onClick={() => onNavigate(move.id)}><span><strong>{move.notation}{hasTtxqAnnotation(move.comment) && <i className="review-route-annotation-marker">注解</i>}</strong><small>{variationCount ? `变招 ${variationCount}` : formatScore(move) || (move.isMainline ? "主线" : "分支")}</small></span><em>{issue?.missedMate ? "漏杀" : issue?.grade ?? "记录"}</em></button>
          {showThoughts && <button type="button" className="floating-manual-thought-toggle" aria-expanded={thoughtExpanded} aria-label={`${thoughtExpanded ? "收起" : "展开"}第 ${moveIndex} 着思路`} title={`${move.notation}：${thought.purpose}`} onClick={() => setExpandedThoughtMove(thoughtExpanded ? undefined : move.id)}>思路</button>}
          {showThoughts && thoughtExpanded && <div className="floating-manual-thought" aria-label={`${move.notation} 的着法思路`}><MoveThoughtDetails thought={thought} compact/></div>}
        </div>;
      })}
    </article>)}
    {currentBranches.length > 1 && <div className="manual-round-branches" role="group" aria-label="当前局面变招">
      <strong>当前变招</strong>
      {currentBranches.map((move, index) => <button key={move.id} type="button" aria-label={`路线 ${index + 1} ${move.notation}`} className={move.isMainline ? "mainline" : ""} onClick={() => onNavigate(move.id)}><b>{index + 1}</b><span>{move.notation}</span></button>)}
    </div>}
  </div>;
}

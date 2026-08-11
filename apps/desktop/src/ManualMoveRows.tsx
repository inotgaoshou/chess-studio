import type { Ref } from "react";
import { MessageSquare } from "lucide-react";
import { flyknifeMarker, hasReviewMarker } from "./reviewMarker";
import type { MoveItem, QualityGrade } from "./platform";

type MoveQuality = { score?: number; grade?: QualityGrade };

type Props = {
  history: MoveItem[];
  continuation: MoveItem[];
  siblingBranches?: MoveItem[];
  currentNode?: string;
  qualityByMoveId: ReadonlyMap<string, MoveQuality>;
  activeMoveRef?: Ref<HTMLButtonElement>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
};

function MoveRow({ move, number, current, continuation, branchLabel, quality, activeMoveRef, formatScore, onNavigate }: {
  move: MoveItem;
  number: number;
  current: boolean;
  continuation: boolean;
  branchLabel?: string;
  quality?: MoveQuality;
  activeMoveRef?: Ref<HTMLButtonElement>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
}) {
  const flyknife = flyknifeMarker(move.comment);
  return <button
    ref={current ? activeMoveRef : undefined}
    className={`move-table-row ${continuation ? "continuation" : ""} ${branchLabel ? "branch" : ""} ${quality?.grade ? `grade-${quality.grade}` : ""} ${current ? "active" : ""}`}
    aria-current={current ? "step" : undefined}
    role="row"
    title={`${continuation ? "后续保留 · " : ""}${move.movedBy} · ICCS ${move.iccs}${quality?.score != null ? ` · 质量 ${quality.score} 分 ${quality.grade}` : ""}`}
    onClick={() => onNavigate(move.id)}
  >
    <span role="cell">{number}</span>
    <span role="cell">
      <i className={move.movedBy === "红方" ? "red" : "black"}/>
      <strong>{move.notation}</strong>
      {!continuation && quality?.grade && <em className={`move-quality-mini grade-${quality.grade}`}>{quality.grade}</em>}
      {move.comment && <MessageSquare className="comment-marker" size={11}/>} 
      {hasReviewMarker(move.comment) && <em className="manual-review-marker">复盘</em>}
      {flyknife && <em className="manual-flyknife-marker" title={flyknife.intent || `${flyknife.label}飞刀标注`}>飞刀 · {flyknife.label}</em>}
      <small className={current ? "current-marker" : undefined}>{branchLabel ? `${branchLabel}${current ? " · 当前" : ""}` : current ? "当前" : continuation ? "后续保留" : move.isMainline ? "主线" : ""}</small>
    </span>
    <span role="cell" className={move.mate != null ? "mate-score" : ""}>{quality?.score != null ? `${quality.score}分` : formatScore(move)}</span>
  </button>;
}

export function ManualMoveRows({ history, continuation, siblingBranches = [], currentNode, qualityByMoveId, activeMoveRef, formatScore, onNavigate }: Props) {
  const currentMove = history.at(-1);
  const hasSiblingBranches = !!currentMove && siblingBranches.length > 1 && siblingBranches.some((move) => move.id === currentMove.id);
  const visibleHistory = hasSiblingBranches ? history.slice(0, -1) : history;
  let variationIndex = 0;
  return <>
    {visibleHistory.map((move, index) => <MoveRow
      activeMoveRef={activeMoveRef}
      continuation={false}
      current={currentNode === move.id}
      formatScore={formatScore}
      key={move.id}
      move={move}
      number={index + 1}
      onNavigate={onNavigate}
      quality={qualityByMoveId.get(move.id)}
    />)}
    {hasSiblingBranches && siblingBranches.map((move) => {
      const branchLabel = move.isMainline ? "主线" : `分支 ${++variationIndex}`;
      return <MoveRow
        activeMoveRef={currentNode === move.id ? activeMoveRef : undefined}
        branchLabel={branchLabel}
        continuation={false}
        current={currentNode === move.id}
        formatScore={formatScore}
        key={`branch-${move.id}`}
        move={move}
        number={history.length}
        onNavigate={onNavigate}
        quality={qualityByMoveId.get(move.id)}
      />;
    })}
    {continuation.map((move, index) => <MoveRow
      continuation
      current={false}
      formatScore={formatScore}
      key={`continuation-${move.id}`}
      move={move}
      number={history.length + index + 1}
      onNavigate={onNavigate}
      quality={qualityByMoveId.get(move.id)}
    />)}
  </>;
}

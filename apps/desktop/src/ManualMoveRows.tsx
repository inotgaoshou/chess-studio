import type { Ref } from "react";
import { MessageSquare } from "lucide-react";
import type { MoveItem, QualityGrade } from "./platform";

type MoveQuality = { score?: number; grade?: QualityGrade };

type Props = {
  history: MoveItem[];
  continuation: MoveItem[];
  currentNode?: string;
  qualityByMoveId: ReadonlyMap<string, MoveQuality>;
  activeMoveRef?: Ref<HTMLButtonElement>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
};

function MoveRow({ move, number, current, continuation, quality, activeMoveRef, formatScore, onNavigate }: {
  move: MoveItem;
  number: number;
  current: boolean;
  continuation: boolean;
  quality?: MoveQuality;
  activeMoveRef?: Ref<HTMLButtonElement>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId: string): void;
}) {
  return <button
    ref={current ? activeMoveRef : undefined}
    className={`move-table-row ${continuation ? "continuation" : ""} ${quality?.grade ? `grade-${quality.grade}` : ""} ${current ? "active" : ""}`}
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
      <small>{continuation ? "后续保留" : move.isMainline ? "主线" : ""}</small>
    </span>
    <span role="cell" className={move.mate != null ? "mate-score" : ""}>{quality?.score != null ? `${quality.score}分` : formatScore(move)}</span>
  </button>;
}

export function ManualMoveRows({ history, continuation, currentNode, qualityByMoveId, activeMoveRef, formatScore, onNavigate }: Props) {
  return <>
    {history.map((move, index) => <MoveRow
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

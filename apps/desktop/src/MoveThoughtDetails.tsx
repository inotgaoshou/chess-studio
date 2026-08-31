import type { MoveThought } from "./moveThoughtModel";

export function MoveThoughtDetails({ thought, compact = false }: { thought: MoveThought; compact?: boolean }) {
  return <div className={compact ? "review-thought-details compact" : "review-thought-details"}>
    <p><strong>目的</strong><span>{thought.purpose}</span></p>
    <p><strong>风险</strong><span>{thought.risk}</span></p>
    <p><strong>建议</strong><span>{thought.nextAction}</span></p>
    {thought.comparison && <p className="review-thought-compare"><strong>比较</strong><span>{thought.comparison}</span></p>}
    {thought.confidenceNote && <small>{thought.confidenceNote}</small>}
  </div>;
}

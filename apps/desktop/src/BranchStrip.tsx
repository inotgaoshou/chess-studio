import "./branchStrip.css";

export type BranchStripChoice = { id: string; move: string; notation: string; selected?: boolean };

/** Direct children of the displayed position; never groups transpositions by FEN. */
export function BranchStrip({ choices, onSelect }: { choices: BranchStripChoice[]; onSelect(id: string): void }) {
  const unique = choices.filter((choice, index) => choices.findIndex(item => item.move === choice.move) === index);
  if (unique.length < 2) return null;
  return <nav className="manual-branch-strip" aria-label="当前局面分支">
    <span>分支</span>
    <div>{unique.map((choice, index) => <button key={choice.id} type="button" aria-label={`分支 ${index + 1} · ${choice.notation}`} aria-current={choice.selected ? "true" : undefined} onClick={() => onSelect(choice.id)}><b>{index + 1}</b><span>{choice.notation}</span></button>)}</div>
  </nav>;
}

import { useEffect, useState } from "react";
import { GitFork, Settings2, X } from "lucide-react";
import "./branchStrip.css";

export type BranchStripChoice = { id: string; move: string; notation: string; selected?: boolean; isMainline?: boolean };

/** Direct children of the displayed position; never groups transpositions by FEN. */
export function BranchStrip({ choices, onSelect, onManage, revealKey }: { choices: BranchStripChoice[]; onSelect(id: string): void; onManage?(): void; revealKey?:number }) {
  const unique = choices.filter((choice, index) => choices.findIndex(item => item.move === choice.move) === index);
  const [open, setOpen] = useState(true);
  const signature = unique.map(item => item.id).join(",");
  useEffect(() => setOpen(true), [signature, revealKey]);
  if (!unique.length) return null;
  if (unique.length===1) return <nav className="manual-branch-strip is-single" aria-label="当前局面分支"><button type="button" aria-label={`继续：${unique[0].notation}`} onClick={()=>onSelect(unique[0].id)}>继续：{unique[0].notation}</button></nav>;
  if (!open) return <nav className="manual-branch-strip" aria-label="当前局面分支"><button type="button" onClick={() => setOpen(true)}><GitFork size={16}/>选择变招 · {unique.length} 条</button></nav>;
  return <nav className="manual-branch-strip" aria-label="当前局面分支">
    <header><strong><GitFork size={15}/>选择变招 · {unique.length} 条</strong><span>{onManage && <button type="button" aria-label="管理变招" onClick={onManage}><Settings2 size={14}/></button>}<button type="button" aria-label="收起变招选择" onClick={() => setOpen(false)}><X size={14}/></button></span></header>
    <div className="manual-branch-choices">{unique.map((choice, index) => <button key={choice.id} type="button" aria-label={`分支 ${index + 1} · ${choice.notation}`} aria-current={choice.selected ? "true" : undefined} onClick={() => onSelect(choice.id)}><b>{index + 1}</b><span><strong>{choice.notation}</strong><small>{choice.isMainline ? "主线" : "分支"} {index + 1}</small></span></button>)}</div>
  </nav>;
}

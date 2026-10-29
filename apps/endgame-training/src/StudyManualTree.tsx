import { ArrowDown, ArrowUp, ChevronDown, Lightbulb, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { manualContinuations, type ManualContinuation } from "./manualContinuation";
import { moveNotationLabel } from "./moveNotation";

export type StudyManualBranch = {
  id: string;
  parentCursor: number;
  parentPath: string[];
  moves: string[];
  notation: string[];
  createdAt: number;
  branchOrder?: number;
};

type Props = {
  moves: string[];
  notation: string[];
  canonicalMoves?: string[];
  canonicalNotation?: string[];
  onSelectContinuation?(choice: ManualContinuation): void;
  cursor: number;
  branches: StudyManualBranch[];
  comments: Record<string, string>;
  onCommentChange(key: string, comment: string): void;
  onNavigate(cursor: number): void;
  onAdopt(branch: StudyManualBranch, focusCursor?: number): void;
  onDelete(id: string): void;
  onDiscardCurrent(parentCursor: number, replacement?: StudyManualBranch): void;
  onMove(id: string, direction: -1 | 1): void;
  readOnly?: boolean;
  onExplain?(index: number): void;
};

const MAINLINE_ID = "__mainline__";
const moveLabel = (notation: string | undefined, iccs: string | undefined) => notation || iccs ? moveNotationLabel(notation) : "--";
const sameLine = (left: string[], right: string[]) => left.join(",") === right.join(",");

type BranchChoice = {
  id: string;
  order: number;
  label: string;
  firstMove?: string;
  branch?: StudyManualBranch;
  mainline: boolean;
  continuation: ManualContinuation;
};

type NumberedBranchChoice = BranchChoice & { number: number };

export function StudyManualTree({ moves, notation, canonicalMoves = moves, canonicalNotation = notation, onSelectContinuation, cursor, branches, comments, onCommentChange, onNavigate, onAdopt, onDelete, onDiscardCurrent, onMove, readOnly = false, onExplain }: Props) {
  const branchesAt = useMemo(() => {
    const result = new Map<number, StudyManualBranch[]>();
    for (const branch of branches) {
      if (moves.slice(0, branch.parentCursor).join(",") !== branch.parentPath.join(",")) continue;
      const items = result.get(branch.parentCursor) ?? [];
      items.push(branch);
      result.set(branch.parentCursor, items);
    }
    return result;
  }, [branches, moves]);
  const forkCursors = useMemo(() => {
    const forks = new Set(branchesAt.keys());
    for (const line of [canonicalMoves, ...branches.map(branch => [...branch.parentPath, ...branch.moves])]) {
      let common = 0;
      while (common < Math.min(line.length, moves.length) && line[common] === moves[common]) common++;
      if (line.length > common) forks.add(common);
    }
    return [...forks].filter(fork => branchesAt.has(fork) || manualContinuations(canonicalMoves,canonicalNotation,branches,moves.slice(0,fork),moves,notation).length > 1).sort((a,b)=>a-b);
  }, [branchesAt,branches,moves,notation,canonicalMoves,canonicalNotation]);
  const [selectedFork, setSelectedFork] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState(MAINLINE_ID);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (!forkCursors.length) return;
    const nearestActive = [...forkCursors].reverse().find((fork) => fork < cursor);
    const currentPositionFork = forkCursors.find((fork) => fork === cursor);
    const nearest = currentPositionFork ?? nearestActive ?? [...forkCursors].reverse().find((fork) => fork <= cursor) ?? forkCursors[0];
    setSelectedFork(nearest);
    setSelectedBranchId(MAINLINE_ID);
    setBranchPickerOpen(false);
  }, [cursor, forkCursors.join(",")]);

  const currentPathKey = moves.slice(0, cursor).join(",");

  function choicesForFork(fork: number): NumberedBranchChoice[] {
    const path = moves.slice(0,fork);
    return manualContinuations(canonicalMoves,canonicalNotation,branches,path,moves,notation).map((choice,index) => {
      const branch = branches.find(item => item.parentCursor === fork && sameLine(item.parentPath,path) && item.id === choice.id)
        ?? branches.find(item => item.parentCursor === fork && sameLine(item.parentPath,path) && item.moves[0] === choice.move);
      return {id:choice.id,order:index,label:choice.notation,firstMove:choice.move,branch,mainline:choice.move === moves[fork],continuation:choice,number:index+1};
    });
  }

  const activeBranches = branchesAt.get(selectedFork) ?? [];
  const mainlineMove = moves[selectedFork];
  const branchChoices = choicesForFork(selectedFork);
  const selectedChoice = branchChoices.find((choice) => choice.id === selectedBranchId) ?? branchChoices.find((choice) => choice.continuation.selected) ?? branchChoices[0];
  const effectiveSelectedId = selectedChoice?.id ?? selectedBranchId;
  const selectedBranch = selectedChoice?.branch;
  const orderedBranchChoices = branchChoices.filter((choice) => choice.branch);
  const selectedBranchIndex = selectedBranch ? orderedBranchChoices.findIndex((choice) => choice.branch?.id === selectedBranch.id) : -1;
  const canDiscardSelectedMainline = Boolean(selectedChoice?.mainline && !selectedBranch && orderedBranchChoices.length);
  const activeRound = cursor > 0 ? Math.floor((cursor - 1) / 2) : -1;

  useEffect(() => {
    if (cursor === 0) {
      rowRefs.current.get(0)?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    rowRefs.current.get(activeRound)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeRound, cursor, moves.length]);

  function branchBadge(index: number) {
    if (!forkCursors.includes(index)) return undefined;
    const localChoices = choicesForFork(index);
    if (localChoices.length <= 1) return undefined;
    const currentMove = moves[index];
    const currentChoice = index === selectedFork
      ? (selectedChoice ?? localChoices.find((choice) => choice.firstMove === currentMove))
      : localChoices.find((choice) => choice.firstMove === currentMove || (choice.branch && sameLine(choice.branch.moves, moves.slice(index))));
    const number = currentChoice?.number ?? localChoices[0]?.number ?? 1;
    return `${number}/${localChoices.length}`;
  }

  function chooseBranch(id: string) {
    setSelectedBranchId(id);
    setBranchPickerOpen(false);
    const choice = branchChoices.find(item => item.id === id);
    if (choice && onSelectContinuation) { onSelectContinuation(choice.continuation); return; }
    if (id === MAINLINE_ID || id === "mainline") {
      onNavigate(mainlineMove ? selectedFork + 1 : selectedFork);
      return;
    }
    const branch = branchChoices.find((choice) => choice.id === id)?.branch ?? activeBranches.find((item) => item.id === id);
    if (branch) onAdopt(branch, Math.min(branch.parentCursor + 1, branch.parentCursor + branch.moves.length));
  }

  function deleteSelectedBranch() {
    if (selectedBranch) {
      onDelete(selectedBranch.id);
      return;
    }
    if (canDiscardSelectedMainline) onDiscardCurrent(selectedFork, orderedBranchChoices[0]?.branch);
  }

  function moveCell(index: number, side: "red" | "black") {
    const move = moves[index];
    if (!move) return <span className="study-move-cell empty" aria-hidden="true"/>;
    const badge = branchBadge(index);
    return <span className="study-move-with-commentary"><button type="button" className={`study-move-cell ${badge ? "has-branch" : ""} ${cursor === index + 1 ? "active" : ""}`} onClick={() => onNavigate(index + 1)}>
      <i className={side}/><span>{moveLabel(notation[index], move)}</span>
      {badge && <em>{badge}</em>}
    </button>{onExplain && <button className="commentary-entry" type="button" aria-label={`讲解这步 ${moveLabel(notation[index], move)}`} onClick={() => onExplain(index)}><Lightbulb aria-hidden="true"/>讲解</button>}</span>;
  }

  return <section className="study-manual-tree" aria-label="棋谱分支树">
    <div className="study-manual-layout">
      <div className="study-mainline-column">
        <button type="button" className={`study-tree-root ${cursor === 0 ? "active" : ""}`} onClick={() => onNavigate(0)}><b>== 开局 ==</b></button>
        {!moves.length ? <p className="study-tree-empty">走棋后生成主线；回退后改走会保留原线路。</p> : <ol>
          {Array.from({ length: Math.ceil(moves.length / 2) }, (_, round) => <li
            key={round}
            ref={(node) => { if (node) rowRefs.current.set(round, node); else rowRefs.current.delete(round); }}
            className={`study-round-row ${activeRound === round ? "active" : ""}`}
          >
            <b>{round + 1}.</b>
            {moveCell(round * 2, "red")}
            {moveCell(round * 2 + 1, "black")}
          </li>)}
        </ol>}
      </div>
      <aside className="study-variation-column">
        {branchChoices.length && forkCursors.length ? <>
          <header>
            <div><span>变着：</span><nav aria-label="变招操作">
              <button type="button" className="danger" disabled={readOnly || (!selectedBranch && !canDiscardSelectedMainline)} aria-label="删除变招" onClick={deleteSelectedBranch}><Trash2/></button>
              <button type="button" disabled={readOnly || !selectedBranch || selectedBranchIndex <= 0} aria-label="上移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, -1)}><ArrowUp/></button>
              <button type="button" disabled={readOnly || !selectedBranch || selectedBranchIndex < 0 || selectedBranchIndex >= orderedBranchChoices.length - 1} aria-label="下移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, 1)}><ArrowDown/></button>
            </nav></div>
            <div className="study-branch-picker" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setBranchPickerOpen(false);
            }}>
              <button type="button" className="study-branch-picker-trigger" aria-label="选择变招" aria-haspopup="listbox" aria-expanded={branchPickerOpen} onClick={() => setBranchPickerOpen((open) => !open)}>
                <span>{selectedChoice ? `${selectedChoice.number}. ${selectedChoice.label}` : "选择变招"}</span>
                <ChevronDown/>
              </button>
              {branchPickerOpen && <div className="study-branch-picker-menu" role="listbox" aria-label="选择变招">
                {branchChoices.map((choice) => <button type="button" role="option" data-move={choice.firstMove} aria-selected={choice.id === effectiveSelectedId} key={choice.id} className={choice.id === effectiveSelectedId ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseBranch(choice.id)}>
                  <b>{choice.id === effectiveSelectedId ? "✓" : ""}</b>
                  <span>{choice.number}. {choice.label}</span>
                </button>)}
              </div>}
            </div>
          </header>
        </> : <p className="study-variation-empty">当前线路没有变招。</p>}
        <textarea value={comments[currentPathKey] ?? ""} disabled={readOnly} onChange={(event) => onCommentChange(currentPathKey, event.target.value)} placeholder={readOnly ? "云镜像注释只读" : "此处编辑注释..."} aria-label="当前棋谱节点注释"/>
      </aside>
    </div>
  </section>;
}

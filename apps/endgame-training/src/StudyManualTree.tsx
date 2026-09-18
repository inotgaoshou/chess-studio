import { ArrowDown, ArrowUp, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  cursor: number;
  branches: StudyManualBranch[];
  comments: Record<string, string>;
  onCommentChange(key: string, comment: string): void;
  onNavigate(cursor: number): void;
  onAdopt(branch: StudyManualBranch, focusCursor?: number): void;
  onDelete(id: string): void;
  onDiscardCurrent(parentCursor: number, replacement?: StudyManualBranch): void;
  onMove(id: string, direction: -1 | 1): void;
};

const MAINLINE_ID = "__mainline__";
const moveLabel = (notation: string | undefined, iccs: string | undefined) => notation || iccs || "--";
const branchLetter = (index: number) => String.fromCharCode(65 + index);
const sameLine = (left: string[], right: string[]) => left.join(",") === right.join(",");
const branchOrder = (branch: StudyManualBranch, fallbackIndex: number) => Number.isFinite(branch.branchOrder) ? Math.max(0, Math.floor(Number(branch.branchOrder))) : fallbackIndex + 1;

type BranchChoice = {
  id: string;
  order: number;
  label: string;
  firstMove?: string;
  branch?: StudyManualBranch;
  mainline: boolean;
};

type BranchChoiceWithLetter = BranchChoice & { letter: string };

export function StudyManualTree({ moves, notation, cursor, branches, comments, onCommentChange, onNavigate, onAdopt, onDelete, onDiscardCurrent, onMove }: Props) {
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
  const forkCursors = useMemo(() => [...branchesAt.keys()].sort((left, right) => left - right), [branchesAt]);
  const [selectedFork, setSelectedFork] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState(MAINLINE_ID);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (!forkCursors.length) return;
    const nearestActive = [...forkCursors].reverse().find((fork) => fork < cursor);
    const currentPositionFork = forkCursors.find((fork) => fork === cursor);
    const nearest = nearestActive ?? currentPositionFork ?? [...forkCursors].reverse().find((fork) => fork <= cursor) ?? forkCursors[0];
    setSelectedFork(nearest);
    setSelectedBranchId(MAINLINE_ID);
    setBranchPickerOpen(false);
  }, [cursor, forkCursors.join(",")]);

  const currentPathKey = moves.slice(0, cursor).join(",");

  function choicesForFork(fork: number): BranchChoiceWithLetter[] {
    const localBranches = branchesAt.get(fork) ?? [];
    const mainlineMove = moves[fork];
    const mainlineNotation = notation[fork];
    const mainlineContinuation = moves.slice(fork);
    const mainlineSource = localBranches.find((branch) => sameLine(branch.moves, mainlineContinuation))
      ?? [...localBranches].filter((branch) => branch.moves[0] === mainlineMove).sort((left, right) => right.moves.length - left.moves.length)[0];
    const localOrders = localBranches.map((branch, index) => branchOrder(branch, index));
    const minLocalOrder = localOrders.length ? Math.min(...localOrders) : 0;
    const normalizedLocalOrder = (branch: StudyManualBranch, index: number) => branchOrder(branch, index) - minLocalOrder;
    const maxLocalOrder = localBranches.reduce((max, branch, index) => Math.max(max, normalizedLocalOrder(branch, index)), -1);
    return [
      ...localBranches.map((branch, index) => ({
        id: branch.id,
        order: normalizedLocalOrder(branch, index),
        label: moveLabel(branch.notation[0], branch.moves[0]),
        firstMove: branch.moves[0],
        branch,
        mainline: false,
      })),
      ...(mainlineMove ? [{
        id: mainlineSource?.id ?? MAINLINE_ID,
        order: mainlineSource ? normalizedLocalOrder(mainlineSource, localBranches.indexOf(mainlineSource)) : maxLocalOrder + 1,
        label: moveLabel(mainlineNotation, mainlineMove),
        firstMove: mainlineMove,
        branch: mainlineSource,
        mainline: true,
      }] : []),
    ]
      .reduce((items, choice) => {
      const duplicated = items.findIndex((item) => item.id === choice.id || Boolean(choice.firstMove && item.firstMove === choice.firstMove));
      if (duplicated < 0) return [...items, choice];
      const existing = items[duplicated];
      if (choice.mainline) {
        const next = [...items];
        next[duplicated] = {
          ...existing,
          id: choice.branch ? choice.id : existing.id,
          order: Math.min(existing.order, choice.order),
          label: choice.label || existing.label,
          firstMove: choice.firstMove ?? existing.firstMove,
          branch: choice.branch ?? existing.branch,
          mainline: true,
        };
        return next;
      }
      if (existing.branch && choice.branch && choice.branch.moves.length > existing.branch.moves.length) {
        const next = [...items];
        next[duplicated] = { ...existing, ...choice, mainline: existing.mainline || choice.mainline };
        return next;
      }
      if (!existing.branch && choice.branch) {
        const next = [...items];
        next[duplicated] = { ...existing, ...choice, mainline: existing.mainline };
        return next;
      }
      return items;
      }, [] as BranchChoice[])
      .sort((left, right) => left.order - right.order)
      .map((choice, index) => ({ ...choice, letter: branchLetter(index) }));
  }

  const activeBranches = branchesAt.get(selectedFork) ?? [];
  const mainlineMove = moves[selectedFork];
  const branchChoices = choicesForFork(selectedFork);
  const selectedChoice = branchChoices.find((choice) => choice.id === selectedBranchId) ?? branchChoices.find((choice) => choice.mainline) ?? branchChoices[0];
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
    if (!(branchesAt.get(index) ?? []).length) return undefined;
    const localChoices = choicesForFork(index);
    if (localChoices.length <= 1) return undefined;
    const currentMove = moves[index];
    const currentChoice = index === selectedFork
      ? (selectedChoice ?? localChoices.find((choice) => choice.firstMove === currentMove))
      : localChoices.find((choice) => choice.firstMove === currentMove || (choice.branch && sameLine(choice.branch.moves, moves.slice(index))));
    const letter = currentChoice?.letter ?? localChoices[0]?.letter ?? "A";
    return `${localChoices.length}${letter}`;
  }

  function chooseBranch(id: string) {
    setSelectedBranchId(id);
    setBranchPickerOpen(false);
    if (id === MAINLINE_ID) {
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
    return <button type="button" className={`study-move-cell ${badge ? "has-branch" : ""} ${cursor === index + 1 ? "active" : ""}`} onClick={() => onNavigate(index + 1)}>
      <i className={side}/><span>{moveLabel(notation[index], move)}</span>
      {badge && <em>{badge}</em>}
    </button>;
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
        {activeBranches.length ? <>
          <header>
            <div><span>变着：</span><nav aria-label="变招操作">
              <button type="button" className="danger" disabled={!selectedBranch && !canDiscardSelectedMainline} aria-label="删除变招" onClick={deleteSelectedBranch}><Trash2/></button>
              <button type="button" disabled={!selectedBranch || selectedBranchIndex <= 0} aria-label="上移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, -1)}><ArrowUp/></button>
              <button type="button" disabled={!selectedBranch || selectedBranchIndex < 0 || selectedBranchIndex >= orderedBranchChoices.length - 1} aria-label="下移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, 1)}><ArrowDown/></button>
            </nav></div>
            <div className="study-branch-picker" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setBranchPickerOpen(false);
            }}>
              <button type="button" className="study-branch-picker-trigger" aria-haspopup="listbox" aria-expanded={branchPickerOpen} onClick={() => setBranchPickerOpen((open) => !open)}>
                <span>{selectedChoice ? `${selectedChoice.letter}. ${selectedChoice.label}` : "选择变招"}</span>
                <ChevronDown/>
              </button>
              {branchPickerOpen && <div className="study-branch-picker-menu" role="listbox" aria-label="选择变招">
                {branchChoices.map((choice) => <button type="button" role="option" aria-selected={choice.id === effectiveSelectedId} key={choice.id} className={choice.id === effectiveSelectedId ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseBranch(choice.id)}>
                  <b>{choice.id === effectiveSelectedId ? "✓" : ""}</b>
                  <span>{choice.letter}. {choice.label}</span>
                </button>)}
              </div>}
            </div>
          </header>
        </> : <p className="study-variation-empty">当前线路没有变招。</p>}
        <textarea value={comments[currentPathKey] ?? ""} onChange={(event) => onCommentChange(currentPathKey, event.target.value)} placeholder="此处编辑注释..." aria-label="当前棋谱节点注释"/>
      </aside>
    </div>
  </section>;
}

import { ArrowDown, ArrowUp, GitBranch, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type StudyManualBranch = {
  id: string;
  parentCursor: number;
  parentPath: string[];
  moves: string[];
  notation: string[];
  createdAt: number;
};

type Props = {
  moves: string[];
  notation: string[];
  cursor: number;
  branches: StudyManualBranch[];
  onNavigate(cursor: number): void;
  onAdopt(branch: StudyManualBranch): void;
  onDelete(id: string): void;
  onMove(id: string, direction: -1 | 1): void;
};

const MAINLINE_ID = "__mainline__";
const moveLabel = (notation: string | undefined, iccs: string | undefined) => notation || iccs || "--";

export function StudyManualTree({ moves, notation, cursor, branches, onNavigate, onAdopt, onDelete, onMove }: Props) {
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

  useEffect(() => {
    if (!forkCursors.length) return;
    const nearest = [...forkCursors].reverse().find((fork) => fork <= cursor) ?? forkCursors[0];
    setSelectedFork(nearest);
    setSelectedBranchId(MAINLINE_ID);
  }, [cursor, forkCursors.join(",")]);

  const activeBranches = branchesAt.get(selectedFork) ?? [];
  const selectedBranch = activeBranches.find((branch) => branch.id === selectedBranchId);
  const mainlineMove = moves[selectedFork];
  const mainlineNotation = notation[selectedFork];

  function chooseBranch(id: string) {
    setSelectedBranchId(id);
    if (id === MAINLINE_ID) {
      onNavigate(mainlineMove ? selectedFork + 1 : selectedFork);
      return;
    }
    const branch = activeBranches.find((item) => item.id === id);
    if (branch) onAdopt(branch);
  }

  return <section className="study-manual-tree" aria-label="棋谱分支树">
    <header><span><GitBranch/><strong>棋谱</strong></span><small>{moves.length} 手 · {branches.length} 条变招</small></header>
    <div className="study-manual-layout">
      <div className="study-mainline-column">
        <button type="button" className={`study-tree-root ${cursor === 0 ? "active" : ""}`} onClick={() => onNavigate(0)}><b>== 开局 ==</b></button>
        {!moves.length ? <p className="study-tree-empty">走棋后生成主线；回退后改走会保留原线路。</p> : <ol>
          {Array.from({ length: Math.ceil(moves.length / 2) }, (_, turnIndex) => {
            const redIndex = turnIndex * 2;
            const blackIndex = redIndex + 1;
            return <li key={turnIndex}>
              <b>{turnIndex + 1}.</b>
              {[redIndex, blackIndex].map((index) => moves[index] ? <button type="button" key={index} className={cursor === index + 1 ? "active" : ""} onClick={() => onNavigate(index + 1)}>
                <i className={index % 2 === 0 ? "red" : "black"}/><span>{moveLabel(notation[index], moves[index])}</span>
                {(branchesAt.get(index) ?? []).length > 0 && <em><GitBranch/>{(branchesAt.get(index) ?? []).length + 1}</em>}
              </button> : <span className="empty" key={index}>--</span>)}
            </li>;
          })}
        </ol>}
      </div>
      <aside className="study-variation-column">
        {activeBranches.length ? <>
          <header>
            <label><span>变招：</span><select value={selectedBranchId} onChange={(event) => chooseBranch(event.target.value)}>
              {mainlineMove && <option value={MAINLINE_ID}>A. {moveLabel(mainlineNotation, mainlineMove)}（主线）</option>}
              {activeBranches.map((branch, index) => <option value={branch.id} key={branch.id}>{String.fromCharCode(66 + index)}. {moveLabel(branch.notation[0], branch.moves[0])}</option>)}
            </select></label>
            <nav aria-label="变招操作">
              <button type="button" className="danger" disabled={!selectedBranch} aria-label="删除变招" onClick={() => selectedBranch && onDelete(selectedBranch.id)}><Trash2/></button>
              <button type="button" disabled={!selectedBranch || activeBranches[0]?.id === selectedBranch.id} aria-label="上移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, -1)}><ArrowUp/></button>
              <button type="button" disabled={!selectedBranch || activeBranches.at(-1)?.id === selectedBranch.id} aria-label="下移变招" onClick={() => selectedBranch && onMove(selectedBranch.id, 1)}><ArrowDown/></button>
            </nav>
          </header>
          <div className="study-variation-options">
            {mainlineMove && <button type="button" className={selectedBranchId === MAINLINE_ID ? "active" : ""} onClick={() => chooseBranch(MAINLINE_ID)}><b>A.</b><span>{moveLabel(mainlineNotation, mainlineMove)}</span><small>主线</small></button>}
            {activeBranches.map((branch, index) => <button type="button" className={selectedBranchId === branch.id ? "active" : ""} key={branch.id} onClick={() => chooseBranch(branch.id)}><b>{String.fromCharCode(66 + index)}.</b><span>{moveLabel(branch.notation[0], branch.moves[0])}</span><small>{branch.moves.length} 手</small></button>)}
          </div>
          <div className="study-variation-line">{selectedBranch ? selectedBranch.notation.map((item, index) => <span key={`${item}-${index}`}><i className={(selectedBranch.parentCursor + index) % 2 === 0 ? "red" : "black"}/>{item}</span>) : <p>当前选择主线。</p>}</div>
        </> : <p className="study-variation-empty">当前线路没有变招。回退到旧节点后改走，即可生成分支。</p>}
      </aside>
    </div>
  </section>;
}

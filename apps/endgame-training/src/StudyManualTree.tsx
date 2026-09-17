import { ArrowDown, ArrowUp, GitBranch, Trash2 } from "lucide-react";

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

function moveLabel(notation: string | undefined, iccs: string | undefined) {
  return notation || iccs || "--";
}

export function StudyManualTree({ moves, notation, cursor, branches, onNavigate, onAdopt, onDelete, onMove }: Props) {
  const branchesAt = new Map<number, StudyManualBranch[]>();
  for (const branch of branches) {
    if (moves.slice(0, branch.parentCursor).join(",") !== branch.parentPath.join(",")) continue;
    const items = branchesAt.get(branch.parentCursor) ?? [];
    items.push(branch);
    branchesAt.set(branch.parentCursor, items);
  }

  return <section className="study-manual-tree" aria-label="棋谱分支树">
    <header>
      <span><GitBranch/><strong>棋谱树</strong></span>
      <small>{moves.length} 手 · {branches.length} 条变招</small>
    </header>
    <button type="button" className={`study-tree-root ${cursor === 0 ? "active" : ""}`} onClick={() => onNavigate(0)}>
      <b>== 开局 ==</b><small>起始局面</small>
    </button>
    {(branchesAt.get(0) ?? []).map((branch, branchIndex, siblings) => <article className="study-tree-branch root-branch" key={branch.id}>
      <div className="study-tree-branch-head">
        <button type="button" className="study-tree-adopt" onClick={() => onAdopt(branch)}><GitBranch/><span><b>变招 {String.fromCharCode(65 + branchIndex)}</b><small>第 1 手起</small></span></button>
        <nav aria-label="变招操作"><button type="button" disabled={branchIndex === 0} aria-label="上移变招" onClick={() => onMove(branch.id, -1)}><ArrowUp/></button><button type="button" disabled={branchIndex === siblings.length - 1} aria-label="下移变招" onClick={() => onMove(branch.id, 1)}><ArrowDown/></button><button type="button" className="danger" aria-label="删除变招" onClick={() => onDelete(branch.id)}><Trash2/></button></nav>
      </div>
      <button type="button" className="study-tree-variation" onClick={() => onAdopt(branch)}>{branch.moves.map((branchMove, moveIndex) => <span key={`${branchMove}-${moveIndex}`}><i className={moveIndex % 2 === 0 ? "red" : "black"}/><b>{moveLabel(branch.notation[moveIndex], branchMove)}</b><small>{branchMove}</small></span>)}</button>
    </article>)}
    {!moves.length && !branches.length ? <p className="study-tree-empty">走棋后将在这里生成主线；回退后改走会自动保留原线路为变招。</p> : <div className="study-tree-lines">
      {moves.map((move, index) => {
        const ply = index + 1;
        const forkBranches = branchesAt.get(ply) ?? [];
        return <div className="study-tree-ply" key={`${move}-${index}`}>
          <button type="button" className={`study-tree-main ${cursor === ply ? "active" : ""}`} onClick={() => onNavigate(ply)}>
            <span className={`study-tree-dot ${index % 2 === 0 ? "red" : "black"}`}/>
            <em>{Math.floor(index / 2) + 1}{index % 2 === 0 ? "." : "…"}</em>
            <strong>{moveLabel(notation[index], move)}</strong>
            <small>{move}</small>
          </button>
          {forkBranches.map((branch, branchIndex) => <article className="study-tree-branch" key={branch.id}>
            <div className="study-tree-branch-head">
              <button type="button" className="study-tree-adopt" onClick={() => onAdopt(branch)}>
                <GitBranch/><span><b>变招 {String.fromCharCode(65 + branchIndex)}</b><small>第 {branch.parentCursor + 1} 手起</small></span>
              </button>
              <nav aria-label="变招操作">
                <button type="button" disabled={branchIndex === 0} aria-label="上移变招" onClick={() => onMove(branch.id, -1)}><ArrowUp/></button>
                <button type="button" disabled={branchIndex === forkBranches.length - 1} aria-label="下移变招" onClick={() => onMove(branch.id, 1)}><ArrowDown/></button>
                <button type="button" className="danger" aria-label="删除变招" onClick={() => onDelete(branch.id)}><Trash2/></button>
              </nav>
            </div>
            <button type="button" className="study-tree-variation" onClick={() => onAdopt(branch)}>
              {branch.moves.map((branchMove, moveIndex) => <span key={`${branchMove}-${moveIndex}`}>
                <i className={(branch.parentCursor + moveIndex) % 2 === 0 ? "red" : "black"}/>
                <b>{moveLabel(branch.notation[moveIndex], branchMove)}</b>
                <small>{branchMove}</small>
              </span>)}
            </button>
          </article>)}
        </div>;
      })}
    </div>}
  </section>;
}

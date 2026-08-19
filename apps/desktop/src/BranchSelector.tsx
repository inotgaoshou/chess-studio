import type { MoveItem } from "./platform";

export type BranchSelectorItem = Pick<MoveItem, "id" | "notation" | "isMainline"> & {
  score?: string;
};

type Props = {
  branches: BranchSelectorItem[];
  currentBranchId?: string;
  onNavigate(nodeId: string): void;
  label?: string;
};

function branchLabel(index: number) {
  return String.fromCharCode(65 + index);
}

export function BranchSelector({ branches, currentBranchId, onNavigate, label = "变招" }: Props) {
  if (branches.length < 2) return null;
  const selected = branches.find((branch) => branch.id === currentBranchId)
    ?? branches.find((branch) => branch.isMainline)
    ?? branches[0];

  return <label className="manual-branch-selector">
    <span>{label}</span>
    <select
      aria-label={`${label}选择`}
      value={selected.id}
      onChange={(event) => onNavigate(event.target.value)}
    >
      {branches.map((branch, index) => {
        const score = branch.score?.trim();
        return <option key={branch.id} value={branch.id}>
          {branchLabel(index)} · {branch.isMainline ? "主线 · " : ""}{branch.notation}{score ? ` · ${score}` : ""}
        </option>;
      })}
    </select>
  </label>;
}

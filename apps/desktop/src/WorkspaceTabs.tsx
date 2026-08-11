import type { KeyboardEvent } from "react";
import { Activity, BarChart3, BookOpen, ClipboardList, RefreshCw } from "lucide-react";

export const workspacePanels = ["moves", "analysis", "trend", "summary", "report", "theory"] as const;
export type WorkspacePanel = typeof workspacePanels[number];

const tabs = [
  ["moves", "棋谱", BookOpen],
  ["analysis", "分析", Activity],
  ["trend", "局势图", BarChart3],
  ["summary", "重试", RefreshCw],
  ["report", "报告", ClipboardList],
  ["theory", "棋理库", BookOpen],
] as const;

type Props = { active: WorkspacePanel; onChange(panel: WorkspacePanel): void };

export function WorkspaceTabs({ active, onChange }: Props) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? workspacePanels.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + workspacePanels.length) % workspacePanels.length;
    const next = workspacePanels[nextIndex];
    onChange(next);
    window.requestAnimationFrame(() => document.getElementById(`workspace-tab-${next}`)?.focus());
  }

  return <div className="workspace-tabs" role="tablist" aria-label="右侧工作区">
    {tabs.map(([panel, label, Icon], index) => <button
      id={`workspace-tab-${panel}`}
      key={panel}
      role="tab"
      aria-controls={`workspace-panel-${panel}`}
      aria-selected={active === panel}
      tabIndex={active === panel ? 0 : -1}
      className={active === panel ? "active" : ""}
      onKeyDown={(event) => handleKeyDown(event, index)}
      onClick={() => onChange(panel)}
    ><Icon size={12}/>{label}</button>)}
  </div>;
}

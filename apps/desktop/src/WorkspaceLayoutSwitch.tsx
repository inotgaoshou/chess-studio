import { Columns3, LayoutDashboard } from "lucide-react";
import type { WorkspaceLayoutMode } from "./platform";

type Props = {
  mode: WorkspaceLayoutMode;
  onChange: (mode: WorkspaceLayoutMode) => void;
};

export function WorkspaceLayoutSwitch({ mode, onChange }: Props) {
  return <div className="workspace-layout-switch" role="group" aria-label="工作台布局">
    <button
      type="button"
      className={mode === "studio" ? "active" : ""}
      aria-pressed={mode === "studio"}
      title="专业工作台：显示棋谱库和完整多页签工作区"
      onClick={() => onChange("studio")}
    ><LayoutDashboard size={15}/><span>专业</span></button>
    <button
      type="button"
      className={mode === "compact" ? "active" : ""}
      aria-pressed={mode === "compact"}
      title="简洁分析：棋盘、引擎候选和棋谱同时可见"
      onClick={() => onChange("compact")}
    ><Columns3 size={15}/><span>简洁</span></button>
  </div>;
}

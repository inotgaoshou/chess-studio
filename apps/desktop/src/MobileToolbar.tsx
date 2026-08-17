import { Activity, FileDown, FolderOpen, List, Pencil, Plus, RotateCcw, Route, Settings2, Share2, Square } from "lucide-react";
import type { ColorTheme } from "./theme";

export type MobileToolbarCommand = "menu" | "newGame" | "open" | "save" | "edit" | "flipBoard" | "candidates" | "analysis" | "export" | "settings";

export function MobileToolbar({
  analysisBusy,
  analysisDisabled,
  colorTheme: _colorTheme,
  onCommand,
}: {
  analysisBusy: boolean;
  analysisDisabled: boolean;
  colorTheme: ColorTheme;
  onCommand(command: MobileToolbarCommand): void;
}) {
  const buttons = [
    ["menu", "打开功能菜单", List],
    ["newGame", "新建棋局", Plus],
    ["open", "导入棋谱", FolderOpen],
    ["save", "保存棋谱", FileDown],
    ["edit", "编辑局面", Pencil],
    ["flipBoard", "翻转棋盘", RotateCcw],
    ["candidates", "显示候选连线", Route],
    ["analysis", analysisBusy ? "停止分析" : "分析当前局面", analysisBusy ? Square : Activity],
    ["export", "复制与导出", Share2],
    ["settings", "打开设置", Settings2],
  ] as const;

  return <nav className="mobile-toolbar" aria-label="手机工具栏">
    {buttons.map(([command, label, Icon]) => <button key={command} type="button" title={label} aria-label={label} disabled={command === "analysis" && !analysisBusy && analysisDisabled} onClick={() => onCommand(command)}><Icon size={20}/></button>)}
  </nav>;
}

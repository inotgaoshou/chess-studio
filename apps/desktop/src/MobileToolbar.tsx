import { Activity, BookOpen, Moon, Plus, RotateCcw, Settings2, Square, Sun } from "lucide-react";
import type { ColorTheme } from "./theme";

export type MobileToolbarCommand = "library" | "newGame" | "flipBoard" | "analysis" | "theme" | "settings";

export function MobileToolbar({
  analysisBusy,
  analysisDisabled,
  colorTheme,
  onCommand,
}: {
  analysisBusy: boolean;
  analysisDisabled: boolean;
  colorTheme: ColorTheme;
  onCommand(command: MobileToolbarCommand): void;
}) {
  const buttons = [
    ["library", "打开棋谱库", BookOpen],
    ["newGame", "新建棋局", Plus],
    ["flipBoard", "翻转棋盘", RotateCcw],
    ["analysis", analysisBusy ? "停止分析" : "分析当前局面", analysisBusy ? Square : Activity],
    ["theme", colorTheme === "light" ? "切换深色主题" : "切换浅色主题", colorTheme === "light" ? Moon : Sun],
    ["settings", "打开设置", Settings2],
  ] as const;

  return <nav className="mobile-toolbar" aria-label="手机工具栏">
    {buttons.map(([command, label, Icon]) => <button key={command} type="button" title={label} aria-label={label} disabled={command === "analysis" && !analysisBusy && analysisDisabled} onClick={() => onCommand(command)}><Icon size={20}/></button>)}
  </nav>;
}

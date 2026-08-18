import { Activity, BarChart3, FileDown, FlipVertical2, FolderOpen, GitFork, List, Pencil, Plus, Route, Settings2, Share2, Square } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { ColorTheme } from "./theme";

export type MobileToolbarCommand = "menu" | "newGame" | "open" | "save" | "edit" | "flipBoard" | "candidates" | "analysis" | "forceVariation" | "evaluation" | "export" | "settings";

export function MobileToolbar({
  analysisBusy,
  analysisDisabled,
  evaluationVisible = true,
  colorTheme: _colorTheme,
  onCommand,
}: {
  analysisBusy: boolean;
  analysisDisabled: boolean;
  evaluationVisible?: boolean;
  colorTheme: ColorTheme;
  onCommand(command: MobileToolbarCommand): void;
}) {
  const [hint, setHint] = useState<{ label: string; left: number; top: number }>();
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressHandled = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const buttons = [
    ["menu", "打开功能菜单", List],
    ["newGame", "新建棋局", Plus],
    ["open", "导入棋谱", FolderOpen],
    ["save", "保存棋谱", FileDown],
    ["edit", "编辑局面", Pencil],
    ["flipBoard", "翻转红黑方视角", FlipVertical2],
    ["candidates", "显示候选连线", Route],
    ["analysis", analysisBusy ? "停止分析" : "分析当前局面", analysisBusy ? Square : Activity],
    ["forceVariation", "强变招：切换到下一候选 PV", GitFork],
    ["evaluation", evaluationVisible ? "收起局势评分条" : "显示局势评分条", BarChart3],
    ["export", "复制与导出", Share2],
    ["settings", "打开设置", Settings2],
  ] as const;

  useEffect(() => () => {
    window.clearTimeout(pressTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);

  function showHint(label: string, target: HTMLButtonElement) {
    window.clearTimeout(hideTimer.current);
    const rect = target.getBoundingClientRect();
    setHint({ label, left: Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70), top: rect.bottom + 6 });
  }

  function hideHint() {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHint(undefined), 100);
  }

  return <nav className="mobile-toolbar" aria-label="手机工具栏">
    {buttons.map(([command, label, Icon]) => <button
      key={command}
      type="button"
      title={label}
      aria-label={label}
      disabled={command === "analysis" && !analysisBusy && analysisDisabled}
      onFocus={(event) => showHint(label, event.currentTarget)}
      onBlur={hideHint}
      onMouseEnter={(event) => showHint(label, event.currentTarget)}
      onMouseLeave={hideHint}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        longPressHandled.current = false;
        window.clearTimeout(pressTimer.current);
        pressTimer.current = window.setTimeout(() => {
          longPressHandled.current = true;
          showHint(label, event.currentTarget);
          hideTimer.current = window.setTimeout(() => setHint(undefined), 1800);
        }, 520);
      }}
      onPointerUp={() => window.clearTimeout(pressTimer.current)}
      onPointerCancel={() => window.clearTimeout(pressTimer.current)}
      onClick={(event) => {
        if (longPressHandled.current) {
          longPressHandled.current = false;
          event.preventDefault();
          return;
        }
        setHint(undefined);
        onCommand(command);
      }}
    ><Icon size={20}/></button>)}
    {hint && createPortal(<output className="mobile-toolbar-hint" role="status" style={{ left: hint.left, top: hint.top }}>{hint.label}</output>, document.body)}
  </nav>;
}

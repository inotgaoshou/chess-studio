import { Activity, BookOpen, FlaskConical, GraduationCap } from "lucide-react";

export const workspaceModes = ["review", "research", "training"] as const;
export type WorkspaceMode = typeof workspaceModes[number];

const modes = [
  ["review", "复盘", "赛后录谱、报告与归档", BookOpen],
  ["research", "研究", "分支、引擎、开局与实验", FlaskConical],
  ["training", "训练", "拆棋、复练与学习档案", GraduationCap],
] as const;

export function WorkspaceModeSwitch({
  active,
  platformKind,
  engineReady,
  syncSignedIn,
  linkSupported,
  onChange,
}: {
  active: WorkspaceMode;
  platformKind: "desktop" | "web";
  engineReady: boolean;
  syncSignedIn: boolean;
  linkSupported: boolean;
  onChange(mode: WorkspaceMode): void;
}) {
  if (platformKind === "web") {
    return <div className="workspace-mode-web-notice" role="status">Web 端仅提供离线棋谱、基础变例与待同步操作</div>;
  }

  const status = active === "research"
    ? engineReady ? "引擎就绪" : "需配置引擎"
    : active === "training"
      ? "本地训练可用"
      : "本地复盘可用";

  return <section className="workspace-mode-switch" aria-label="工作模式">
    <div className="workspace-mode-menu" role="group" aria-label="工作模式">
      {modes.map(([mode, label, description, Icon]) => <button
        key={mode}
        type="button"
        aria-pressed={active === mode}
        className={active === mode ? "active" : ""}
        title={description}
        onClick={() => onChange(mode)}
      ><Icon size={14}/><span>{label}</span></button>)}
    </div>
    <div className="workspace-capability-status" aria-live="polite">
      <span className={active === "research" && !engineReady ? "attention" : "ready"}><Activity size={12}/>{status}</span>
      <span className={syncSignedIn ? "ready" : "muted"}>{syncSignedIn ? "同步已登录" : "同步可选"}</span>
      {active === "research" && <span className={linkSupported ? "experimental" : "attention"}>{linkSupported ? "连线实验 · macOS" : "连线未接入 · 当前平台"}</span>}
    </div>
  </section>;
}

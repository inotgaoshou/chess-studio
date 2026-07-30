import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  BookOpen,
  ClipboardList,
  ClipboardPaste,
  Copy,
  FolderOpen,
  GitFork,
  LayoutGrid,
  Link,
  ListStart,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  UserPlus,
  Zap,
} from "lucide-react";

export type MenuCommand =
  | "newGame"
  | "openDocument"
  | "importXqbOpeningBook"
  | "saveDocument"
  | "saveDocumentAs"
  | "editPosition"
  | "flipBoard"
  | "copyFen"
  | "pasteDocument"
  | "copyFullManual"
  | "copyMainline"
  | "pasteTextManual"
  | "nextBranch"
  | "engineRed"
  | "engineBlack"
  | "moveNow"
  | "analyze"
  | "stopAnalysis"
  | "engineSettings"
  | "coachProfile"
  | "syncRegister"
  | "syncLogin"
  | "syncNow"
  | "syncSettings"
  | "syncLogout";

export type SyncAccountStatus = "unbound" | "signedOut" | "signedIn" | "expired";

export type MenuBarStatus = {
  playable: boolean;
  isPlaying: boolean;
  analysisBusy: boolean;
  engineThinking: boolean;
  engineConfigured: boolean;
  engineSide: "none" | "red" | "black";
  hasContinuation: boolean;
  syncBusy: boolean;
  syncStatus: SyncAccountStatus;
  syncEmail?: string;
  syncLastResult?: string;
};

type DesktopMenu = "game" | "position" | "manual" | "engine" | "sync";

type MenuItemProps = {
  children: ReactNode;
  command: MenuCommand;
  disabled?: boolean;
  title?: string;
  className?: string;
  execute(command: MenuCommand): void | Promise<void>;
  close(): void;
};

function MenuItem({ children, command, disabled, title, className, execute, close }: MenuItemProps) {
  return (
    <button
      className={className}
      disabled={disabled}
      title={title}
      onClick={() => {
        close();
        void execute(command);
      }}
    >
      {children}
    </button>
  );
}

export function DesktopMenuBar({
  status,
  execute,
}: {
  status: MenuBarStatus;
  execute(command: MenuCommand): void | Promise<void>;
}) {
  const [openMenu, setOpenMenu] = useState<DesktopMenu | null>(null);
  const menuItemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeFromOutside(event: PointerEvent) {
      if (!menuItemsRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, []);

  function toggle(menu: DesktopMenu) {
    setOpenMenu((current) => current === menu ? null : menu);
  }

  function summary(menu: DesktopMenu, label: string) {
    return <summary data-menu={menu} onClick={(event) => { event.preventDefault(); toggle(menu); }}>{label}</summary>;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const menus: DesktopMenu[] = ["game", "position", "manual", "engine", "sync"];
    const summaryMenu = target.dataset.menu as DesktopMenu | undefined;
    if (summaryMenu && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = menus[(menus.indexOf(summaryMenu) + direction + menus.length) % menus.length];
      setOpenMenu(next);
      menuItemsRef.current?.querySelector<HTMLElement>(`summary[data-menu="${next}"]`)?.focus();
      return;
    }
    if (summaryMenu && event.key === "ArrowDown") {
      event.preventDefault();
      if (openMenu === summaryMenu) {
        menuItemsRef.current?.querySelector<HTMLElement>(".menu-popup button:not(:disabled)")?.focus();
      } else {
        setOpenMenu(summaryMenu);
        window.requestAnimationFrame(() => menuItemsRef.current?.querySelector<HTMLElement>(".menu-popup button:not(:disabled)")?.focus());
      }
      return;
    }
    if (target.matches(".menu-popup button") && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const buttons = Array.from(target.closest(".menu-popup")?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      buttons[(buttons.indexOf(target as HTMLButtonElement) + direction + buttons.length) % buttons.length]?.focus();
    }
  }

  const close = () => setOpenMenu(null);
  const engineUnavailable = !status.playable || !status.engineConfigured || status.analysisBusy || status.isPlaying;
  const engineUnavailableReason = !status.playable
    ? "当前研究局面不可对弈"
    : !status.engineConfigured
      ? "请先配置并检测引擎"
      : status.analysisBusy
        ? "请先停止当前分析"
        : status.isPlaying
          ? "请先停止棋谱播放"
        : undefined;
  const canAnalyze = status.analysisBusy || (status.playable && !status.isPlaying && status.engineConfigured && status.engineSide === "none");
  const redUnavailable = engineUnavailable || (status.engineThinking && status.engineSide !== "red");
  const blackUnavailable = engineUnavailable || (status.engineThinking && status.engineSide !== "black");
  const syncLabel = status.syncStatus === "signedIn"
    ? status.syncEmail ?? "已登录"
    : status.syncStatus === "expired"
      ? "登录已过期"
      : status.syncStatus === "signedOut"
        ? status.syncEmail ?? "已退出"
        : "未绑定账号";

  return (
    <div className="menu-items" ref={menuItemsRef} onKeyDown={handleKeyDown}>
      <details open={openMenu === "game"}>
        {summary("game", "棋局")}
        {openMenu === "game" && <div className="menu-popup">
          <MenuItem command="newGame" execute={execute} close={close}><Plus size={14}/>新建棋局</MenuItem>
          <MenuItem command="openDocument" execute={execute} close={close}><FolderOpen size={14}/>打开棋谱</MenuItem>
          <MenuItem command="importXqbOpeningBook" execute={execute} close={close}><BookOpen size={14}/>导入 XQB 开局库</MenuItem>
          <MenuItem command="saveDocument" execute={execute} close={close}><Save size={14}/>保存棋谱</MenuItem>
          <MenuItem command="saveDocumentAs" execute={execute} close={close}><Save size={14}/>另存为 PGN</MenuItem>
        </div>}
      </details>
      <details open={openMenu === "position"}>
        {summary("position", "局面")}
        {openMenu === "position" && <div className="menu-popup">
          <MenuItem command="editPosition" execute={execute} close={close}><LayoutGrid size={14}/>编辑局面</MenuItem>
          <MenuItem command="flipBoard" execute={execute} close={close}><RotateCcw size={14}/>翻转棋盘</MenuItem>
          <MenuItem command="copyFen" execute={execute} close={close}><Copy size={14}/>复制局面 FEN</MenuItem>
          <MenuItem command="pasteDocument" execute={execute} close={close}><ClipboardPaste size={14}/>粘贴局面或棋谱</MenuItem>
        </div>}
      </details>
      <details open={openMenu === "manual"}>
        {summary("manual", "棋谱")}
        {openMenu === "manual" && <div className="menu-popup">
          <MenuItem command="copyFullManual" execute={execute} close={close}><Copy size={14}/>复制完整棋谱</MenuItem>
          <MenuItem command="copyMainline" execute={execute} close={close}><ClipboardList size={14}/>复制当前主线</MenuItem>
          <MenuItem command="pasteTextManual" execute={execute} close={close}><ClipboardPaste size={14}/>粘贴文本棋谱</MenuItem>
          <MenuItem command="nextBranch" execute={execute} close={close} disabled={!status.hasContinuation} title={!status.hasContinuation ? "当前节点没有后续着法" : undefined}><GitFork size={14}/>跳到下个分支点</MenuItem>
        </div>}
      </details>
      <details open={openMenu === "engine"}>
        {summary("engine", "人机对弈")}
        {openMenu === "engine" && <div className="menu-popup">
          <MenuItem command="engineRed" execute={execute} close={close} disabled={redUnavailable} title={redUnavailable ? engineUnavailableReason ?? "Pikafish 正在思考，不能切换执方" : undefined} className={status.engineSide === "red" ? "active" : ""}><Bot size={14}/>引擎执红</MenuItem>
          <MenuItem command="engineBlack" execute={execute} close={close} disabled={blackUnavailable} title={blackUnavailable ? engineUnavailableReason ?? "Pikafish 正在思考，不能切换执方" : undefined} className={status.engineSide === "black" ? "active" : ""}><Bot size={14}/>引擎执黑</MenuItem>
          <MenuItem command="moveNow" execute={execute} close={close} disabled={!status.engineThinking} title={!status.engineThinking ? "引擎当前没有正在思考的着法" : undefined}><Zap size={14}/>立即出招</MenuItem>
          <MenuItem command={status.analysisBusy ? "stopAnalysis" : "analyze"} execute={execute} close={close} disabled={!canAnalyze} title={!canAnalyze ? "当前状态不能启动分析" : undefined}>{status.analysisBusy ? <Square size={14}/> : <Zap size={14}/>} {status.analysisBusy ? "停止分析" : "分析当前局面"}</MenuItem>
          <MenuItem command="engineSettings" execute={execute} close={close}><Settings2 size={14}/>引擎设置</MenuItem>
          <MenuItem command="coachProfile" execute={execute} close={close}><BarChart3 size={14}/>AI 私教档案</MenuItem>
        </div>}
      </details>
      <details open={openMenu === "sync"}>
        {summary("sync", "同步")}
        {openMenu === "sync" && <div className="menu-popup sync-menu-popup">
          <div className={`menu-account-status ${status.syncStatus}`}><Link size={13}/><span>{syncLabel}{status.syncLastResult && <small>{status.syncLastResult}</small>}</span></div>
          <MenuItem command="syncRegister" execute={execute} close={close} disabled={status.syncStatus !== "unbound"} title={status.syncStatus !== "unbound" ? "本地棋谱库已经绑定账号" : undefined}><UserPlus size={14}/>注册账号</MenuItem>
          <MenuItem command="syncLogin" execute={execute} close={close} disabled={status.syncStatus === "signedIn"} title={status.syncStatus === "signedIn" ? "当前账号已经登录" : undefined}><LogIn size={14}/>登录账号</MenuItem>
          <MenuItem command="syncNow" execute={execute} close={close} disabled={status.syncStatus !== "signedIn" || status.syncBusy} title={status.syncBusy ? "同步正在进行" : status.syncStatus !== "signedIn" ? "请先登录同步账号" : undefined}>{status.syncBusy ? <RefreshCw className="spin" size={14}/> : <RefreshCw size={14}/>}立即同步</MenuItem>
          <MenuItem command="syncSettings" execute={execute} close={close}><Settings2 size={14}/>同步设置</MenuItem>
          <MenuItem command="syncLogout" execute={execute} close={close} disabled={status.syncStatus === "unbound" || status.syncStatus === "signedOut"} title={status.syncStatus === "unbound" ? "本地棋谱库尚未绑定账号" : status.syncStatus === "signedOut" ? "当前已经退出登录" : undefined}><LogOut size={14}/>退出登录</MenuItem>
        </div>}
      </details>
    </div>
  );
}

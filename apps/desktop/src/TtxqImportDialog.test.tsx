import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryFolder, TtxqDiagnosticSample, TtxqGamePreview, TtxqSyncProgress } from "./platform";
import { TtxqImportDialog } from "./TtxqImportDialog";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const disconnected: TtxqSyncProgress = { state: "disconnected", readTotal: 0, readCompleted: 0, readFailed: 0, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: "未连接天天象棋" };

function renderDialog(progress: TtxqSyncProgress = disconnected, busy = false, preview: TtxqGamePreview[] = [], diagnostics: TtxqDiagnosticSample[] = []) {
  const folders: LibraryFolder[] = [{ name: "天天象棋备份", system: false, gameCount: 16 }, { name: "天天象棋备份/备战世青赛", system: false, gameCount: 3 }];
  const actions = { onClose: vi.fn(), onTargetFolderChange: vi.fn(), onCreateFolder: vi.fn(), onAuthorize: vi.fn(), onCollect: vi.fn(), onImport: vi.fn(), onDisconnect: vi.fn(), onShowDiagnostics: vi.fn(), onClearDiagnostics: vi.fn() };
  function Harness() {
    const [targetFolder, setTargetFolder] = useState("天天象棋备份");
    return <TtxqImportDialog
      progress={progress}
      preview={preview}
      diagnostics={diagnostics}
      folders={folders}
      targetFolder={targetFolder}
      busy={busy}
      {...actions}
      onTargetFolderChange={(folder) => {
        actions.onTargetFolderChange(folder);
        setTargetFolder(folder);
      }}
    />;
  }
  render(<Harness />);
  return actions;
}

describe("TtxqImportDialog", () => {
  it("makes the complete import flow visible from one dialog", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "天天象棋棋谱导入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录天天象棋" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "读取已加载棋谱" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "导入全部" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows loaded totals but keeps import disabled until a valid preview exists", () => {
    renderDialog({ state: "ready", readTotal: 12, readCompleted: 12, readFailed: 0, loaded: 12, completed: 5, imported: 3, skipped: 1, failed: 1, message: "已读取已加载的历史棋谱，可开始导入" });
    expect(document.querySelector(".ttxq-import-count")?.textContent).toContain("已加载 12 盘");
    expect(screen.getByRole("button", { name: "导入全部" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "断开天天象棋" })).toBeTruthy();
  });

  it("lets the user choose or create a nested import folder", async () => {
    const user = userEvent.setup();
    const actions = renderDialog({ ...disconnected, state: "ready", loaded: 1, message: "已读取棋谱" });
    expect(screen.getByText("当前导入目录：天天象棋")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("导入到"), "天天象棋备份/备战世青赛");
    await user.type(screen.getByLabelText("新建子目录"), "第1轮");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(actions.onTargetFolderChange).toHaveBeenLastCalledWith("天天象棋备份/备战世青赛");
    expect(actions.onCreateFolder).toHaveBeenCalledWith("天天象棋备份/备战世青赛/第1轮");
  });

  it("shows live read totals while the bridge is reading", () => {
    renderDialog({ state: "reading", readPhase: "reading", readTotal: 20, readCompleted: 7, readFailed: 1, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: "正在读取已加载的历史棋谱（7/20）" });
    expect(document.querySelector(".ttxq-import-reading-progress")?.textContent).toContain("发现 20 盘 · 已读取 7 / 20 · 失败 1");
    expect(screen.getByRole("progressbar", { name: "读取进度" }).getAttribute("value")).toBe("7");
    expect(screen.getByRole("button", { name: "读取中…" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows discovery status before the H5 page reports a total", () => {
    renderDialog({ state: "reading", readPhase: "discovering", readScanned: 768, readTotal: 3, readCompleted: 0, readFailed: 0, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: "正在扫描天天象棋网页" });
    expect(screen.getByLabelText("正在扫描已加载棋谱")).toBeTruthy();
    expect(document.querySelector(".ttxq-import-reading-progress")?.textContent).toContain("已发现 3 盘");
    expect(document.querySelector(".ttxq-import-reading-progress")?.textContent).toContain("已处理 768 个数据项");
  });

  it("shows target-game loading confirmation before accepting its moves", () => {
    renderDialog({ state: "reading", readPhase: "loading", readTotal: 20, readCurrent: 8, readCompleted: 7, readFailed: 1, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: "正在加载第 8/20 盘棋谱" });
    expect(screen.getByText("等待棋谱加载")).toBeTruthy();
    expect(document.querySelector(".ttxq-import-reading-progress")?.textContent).toContain("正在确认第 8 盘走法已加载");
  });

  it("shows progress inside the current game while metadata and branches are parsed", () => {
    const base = { state: "reading", readTotal: 9, readCurrent: 1, readCompleted: 0, readFailed: 0, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0 };
    const { rerender } = render(<TtxqImportDialog
      progress={{ ...base, readPhase: "metadata", message: "正在解析第 1/9 盘棋谱信息" }}
      preview={[]}
      diagnostics={[]}
      folders={[]}
      targetFolder="天天象棋备份"
      busy={false}
      onClose={vi.fn()}
      onTargetFolderChange={vi.fn()}
      onCreateFolder={vi.fn()}
      onAuthorize={vi.fn()}
      onCollect={vi.fn()}
      onImport={vi.fn()}
      onDisconnect={vi.fn()}
      onShowDiagnostics={vi.fn()}
      onClearDiagnostics={vi.fn()}
    />);

    expect(screen.getByText("解析棋谱信息")).toBeTruthy();
    expect(document.querySelector(".ttxq-import-reading-progress > p")?.textContent).toContain("第 1 / 9 盘 · 正在读取标题、棋手、时间和赛果");
    expect(screen.getByRole("progressbar", { name: "读取进度" }).getAttribute("value")).toBe("0.45");

    rerender(<TtxqImportDialog
      progress={{ ...base, readPhase: "branches", message: "正在读取第 1/9 盘分支变化" }}
      preview={[]}
      diagnostics={[]}
      folders={[]}
      targetFolder="天天象棋备份"
      busy={false}
      onClose={vi.fn()}
      onTargetFolderChange={vi.fn()}
      onCreateFolder={vi.fn()}
      onAuthorize={vi.fn()}
      onCollect={vi.fn()}
      onImport={vi.fn()}
      onDisconnect={vi.fn()}
      onShowDiagnostics={vi.fn()}
      onClearDiagnostics={vi.fn()}
    />);
    expect(screen.getByText("读取分支变化")).toBeTruthy();
    expect(document.querySelector(".ttxq-import-reading-progress > p")?.textContent).toContain("第 1 / 9 盘 · 正在识别主线、路线按钮和变招节点");
    expect(screen.getByRole("progressbar", { name: "读取进度" }).getAttribute("value")).toBe("0.75");
  });

  it("shows elapsed time during a stage and preserves it after a stalled read", () => {
    vi.useFakeTimers();
    const base = { state: "reading", readPhase: "metadata", readTotal: 9, readCurrent: 1, readCompleted: 0, readFailed: 0, loaded: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: "正在解析第 1/9 盘棋谱信息" };
    const props = {
      preview: [], diagnostics: [], folders: [], targetFolder: "天天象棋备份", busy: false,
      onClose: vi.fn(), onTargetFolderChange: vi.fn(), onCreateFolder: vi.fn(), onAuthorize: vi.fn(),
      onCollect: vi.fn(), onImport: vi.fn(), onDisconnect: vi.fn(), onShowDiagnostics: vi.fn(), onClearDiagnostics: vi.fn(),
    };
    const { rerender } = render(<TtxqImportDialog progress={base} {...props}/>);

    act(() => vi.advanceTimersByTime(3_000));
    expect(document.querySelector(".ttxq-import-reading-progress > p")?.textContent).toContain("已等待 3 秒");

    rerender(<TtxqImportDialog progress={{ ...base, state: "error", message: "读取失败：第 1/9 盘长时间没有进度" }} {...props}/>);
    expect(screen.getByText("本次读取用时 3 秒")).toBeTruthy();
  });

  it("shows a bridge timeout and allows the user to retry", () => {
    renderDialog({ ...disconnected, state: "error", message: "读取失败：远程 IPC 未启动或页面已导航（h5login.qqchess.qq.com）" });
    expect(screen.getByText(/远程 IPC 未启动/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "读取已加载棋谱" }).hasAttribute("disabled")).toBe(false);
  });

  it("previews valid games and explains incompatible move formats", () => {
    renderDialog({ ...disconnected, state: "ready", loaded: 2, message: "已读取棋谱" }, false, [
      { qipuId: "a", title: "联赛", red: "红方", black: "黑方", event: "城市赛", date: "2026-08-27", result: "1-0", round: "3", playedAt: "20:00", duration: "10:00", moveCount: 57, variationCount: 2, routeCount: 4, decodedRouteCount: 4, variationNodeCount: 9, branchComplete: true, valid: true },
      { qipuId: "b", title: "", red: "甲", black: "乙", event: "", date: "", result: "", round: "", playedAt: "", duration: "", moveCount: 0, variationCount: 0, routeCount: 1, decodedRouteCount: 0, variationNodeCount: 0, branchComplete: false, valid: false, error: "走法格式不兼容" },
    ]);
    expect(screen.getByLabelText("导入预览").textContent).toContain("导入预览 · 2 盘");
    expect(screen.getByText("联赛")).toBeTruthy();
    expect(screen.getByText("57 半回合 · 路线 4/4 · 9 个变招节点")).toBeTruthy();
    expect(screen.getByText("天天象棋 b")).toBeTruthy();
    expect(screen.getByText("走法格式不兼容")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入全部" }).hasAttribute("disabled")).toBe(false);
  });

  it("previews self-recorded and favourite manuals without fake player fields", () => {
    renderDialog({ ...disconnected, state: "ready", loaded: 1, message: "已读取棋谱" }, false, [
      { qipuId: "self", title: "诗涵第七轮", red: "", black: "", event: "自建棋谱", date: "", result: "", round: "17 回合", playedAt: "2026-08-29 17:23", duration: "", moveCount: 34, variationCount: 0, routeCount: 1, decodedRouteCount: 1, variationNodeCount: 0, branchComplete: true, valid: true },
    ]);
    const preview = screen.getByLabelText("导入预览");
    expect(preview.textContent).toContain("诗涵第七轮");
    expect(preview.textContent).toContain("自建棋谱");
    expect(preview.textContent).toContain("17 回合");
    expect(preview.textContent).not.toContain("第 17 回合 轮");
  });

  it("shows incomplete QQ routes and keeps an all-incomplete batch disabled", () => {
    renderDialog({ ...disconnected, state: "ready", loaded: 1, message: "已读取棋谱" }, false, [
      { qipuId: "branch", title: "牛头滚后手", red: "", black: "", event: "自建棋谱", date: "", result: "", round: "", playedAt: "", duration: "", moveCount: 0, variationCount: 1, routeCount: 4, decodedRouteCount: 2, variationNodeCount: 3, branchComplete: false, valid: false, error: "天天象棋分支路线 3/4 未完整解析；本盘未导入" },
    ]);
    expect(screen.getByText("路线 2/4 · 格式待处理")).toBeTruthy();
    expect(screen.getByText("天天象棋分支路线 3/4 未完整解析；本盘未导入")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入全部" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows concise compatibility diagnostics without the raw webpage snapshot", async () => {
    const user = userEvent.setup();
    const actions = renderDialog(disconnected, false, [], [{ id: 1, qipuId: "qipu-1", fieldPath: "source[0].moveStep", valueType: "array", valueLength: 57, rawSample: "[1,2,3]", error: "走法格式不兼容", capturedAt: "2026-08-27T00:00:00Z" }]);
    await user.click(screen.getByRole("button", { name: "查看原因" }));
    expect(screen.getByText("走法格式不兼容")).toBeTruthy();
    expect(screen.queryByText("[1,2,3]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "清除" }));
    expect(actions.onShowDiagnostics).toHaveBeenCalledOnce();
    expect(actions.onClearDiagnostics).toHaveBeenCalledOnce();
  });

  it("confirms a clean import in the dialog and hides historical diagnostics", () => {
    renderDialog({ ...disconnected, state: "complete", loaded: 16, completed: 16, imported: 16, message: "导入 16 盘，跳过 0 盘，失败 0 盘" }, false, [], [{ id: 1, qipuId: "old", fieldPath: "bridge-snapshot", valueType: "missing", valueLength: 0, rawSample: "debug", error: "走法格式不兼容", capturedAt: "2026-08-27T00:00:00Z" }]);
    expect(screen.getByRole("status").textContent).toContain("已成功导入 16 盘棋谱");
    expect(screen.queryByLabelText("兼容性诊断")).toBeNull();
  });

  it("routes actions and supports Escape close when idle", async () => {
    const user = userEvent.setup();
    const actions = renderDialog({ ...disconnected, state: "authorizing", message: "请在独立窗口内自行登录" });
    await user.click(screen.getByRole("button", { name: "打开授权窗口" }));
    await user.click(screen.getByRole("button", { name: "读取已加载棋谱" }));
    await user.keyboard("{Escape}");
    expect(actions.onAuthorize).toHaveBeenCalledOnce();
    expect(actions.onCollect).toHaveBeenCalledOnce();
    expect(actions.onClose).toHaveBeenCalledOnce();
  });
});

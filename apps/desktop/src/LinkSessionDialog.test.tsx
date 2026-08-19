import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkSessionDialog } from "./LinkSessionDialog";

afterEach(cleanup);

function renderLinkDialog() {
  let resolveStart: ((value: { state: "tracking"; accepted: false }) => void) | undefined;
  const props: Parameters<typeof LinkSessionDialog>[0] = {
    onClose: vi.fn(),
    onStart: vi.fn(async () => await new Promise<{ state: "tracking"; accepted: false }>((resolve) => {
      resolveStart = resolve;
    })),
    onStop: vi.fn(async () => ({ state: "stopped" as const, accepted: false })),
    onSubmit: vi.fn(async () => ({ state: "tracking" as const, accepted: true })),
    onImport: vi.fn(async () => undefined),
    onStartTraining: vi.fn(async () => undefined),
    onRecognizeImage: vi.fn(async () => ({ state: "tracking" as const, accepted: true, reason: "图片局面已识别并同步", board: { fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", pieces: [], sideToMove: "红方", playable: true } as never })),
  };
  return { props, user: userEvent.setup(), resolveStart: () => resolveStart?.({ state: "tracking", accepted: false }), ...render(<LinkSessionDialog {...props}/>) };
}

describe("LinkSessionDialog", () => {
  it("keeps manual FEN import out of the default live-link path", () => {
    renderLinkDialog();

    expect(screen.getByText("实时连线流程")).toBeTruthy();
    expect(screen.queryByText("新棋谱标题")).toBeNull();
    expect(screen.queryByText("局面校正")).toBeNull();
    expect(screen.getByRole("button", { name: "手动校正 FEN / 导入局面" })).toBeTruthy();
  });

  it("shows title import controls for screenshot recognition", async () => {
    const { user } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: /截图\/照片/ }));

    expect(screen.getByText("局面校正与导入")).toBeTruthy();
    expect(screen.getByText("新棋谱标题")).toBeTruthy();
  });

  it("opens directly in screenshot recognition when launched from the import-screenshot entry", () => {
    const { props } = renderLinkDialog();
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    expect(screen.getByRole("button", { name: /截图\/照片/ }).className).toContain("active");
    expect(screen.getByText("局面校正与导入")).toBeTruthy();
    expect(screen.queryByText("实时连线流程")).toBeNull();
  });

  it("cleans up only a file-recognition session when its dialog closes", async () => {
    const { props, user } = renderLinkDialog();
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(screen.getByTitle("关闭"));

    expect(props.onClose).toHaveBeenCalledWith({ cleanupFileSession: true });
  });

  it("does not mark an unopened screenshot dialog as a live session to clean up", async () => {
    const { props, user } = renderLinkDialog();
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByTitle("关闭"));

    expect(props.onClose).toHaveBeenCalledWith({ cleanupFileSession: false });
  });

  it("shows an opening-selection progress label while a live link is starting", async () => {
    const { user, resolveStart } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: "启动连线" }));

    expect(await screen.findByRole("button", { name: /正在打开框选/ })).toBeTruthy();
    resolveStart();
  });

  it("defaults live window linking to spectate without an automatic side", async () => {
    const { props, user } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: "启动连线" }));
    await vi.waitFor(() => expect(props.onStart).toHaveBeenCalled());

    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({
      source: "windowLink",
      mode: "spectate",
      autoSide: undefined,
    }));
  });

  it("requires a selected Chrome or Edge target before starting a Windows window link", async () => {
    const userAgent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { props, user } = renderLinkDialog();
    props.onListTargetWindows = vi.fn(async () => [{
      id: "42",
      title: "天天象棋 - Chrome",
      processName: "chrome.exe",
      clientWidth: 1440,
      clientHeight: 900,
      dpi: 120,
      available: true,
    }]);
    props.onStart = vi.fn(async () => ({ state: "tracking" as const, accepted: false }));
    cleanup();
    render(<LinkSessionDialog {...props}/>);

    expect(await screen.findByText("目标浏览器窗口")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "自动对战" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "连接所选窗口" }));

    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({
      source: "windowLink",
      mode: "spectate",
      targetWindowId: "42",
    }));
    userAgent.mockRestore();
  });

  it("keeps the Windows start action disabled when no target browser window is available", async () => {
    const userAgent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { props } = renderLinkDialog();
    props.onListTargetWindows = vi.fn(async () => []);
    cleanup();
    render(<LinkSessionDialog {...props}/>);

    expect((await screen.findByRole("alert")).textContent).toContain("未找到可用的 Chrome 或 Edge 窗口");
    expect(screen.getByRole("button", { name: "连接所选窗口" }).hasAttribute("disabled")).toBe(true);
    userAgent.mockRestore();
  });

  it("enables desktop auto recognition as a real link source", async () => {
    const { props, user } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: /桌面自动识别/ }));
    await user.click(screen.getByRole("button", { name: "启动连线" }));
    await vi.waitFor(() => expect(props.onStart).toHaveBeenCalled());

    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({
      source: "desktopDetect",
      recognitionMode: "yoloBoard",
    }));
    expect(screen.queryByText("后续阶段")).toBeNull();
  });

  it("uses image recognition for an imported physical-board photo", async () => {
    const { props, user } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: /实体棋盘照片/ }));
    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(props.onRecognizeImage).toHaveBeenCalledWith("cameraBoard", "天天象棋截图拆棋");
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("offers U10 training only after a screenshot position has been recognized", async () => {
    const { props, user } = renderLinkDialog();

    await user.click(screen.getByRole("button", { name: /截图\/照片/ }));
    expect(screen.queryByRole("button", { name: "导入并开始 U10 拆棋" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(await screen.findByRole("button", { name: "导入并开始 U10 拆棋" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "导入并开始 U10 拆棋" }));
    expect(props.onStartTraining).toHaveBeenCalledWith(expect.any(String), "天天象棋截图拆棋", false);
  });

  it("requires a legal marked move before confirming it into the current variation", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rk.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "redAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
    }));
    props.onPreviewMarkedMove = vi.fn(async () => ({ beforeFen: "4k4/9/9/9/9/9/9/9/4K4/9 w - - 0 1", afterFen: "4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1", sideToMove: "黑方" as const, captured: false, fen: "after", notation: "帅五进一", movedBy: "红方" as const, from: { row: 9, col: 4 }, to: { row: 8, col: 4 }, pieces: [], status: "进行中" }));
    props.onConfirmMarkedMove = vi.fn(async () => undefined);
    cleanup();
    const view = render(<LinkSessionDialog {...props}/>);
    await user.click(screen.getByRole("button", { name: /截图\/照片/ }));
    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(await screen.findByLabelText("标记棋盘第 10 行第 5 列"));
    await user.click(screen.getByLabelText("标记棋盘第 9 行第 5 列"));
    expect(await screen.findByText("上一着（待确认）：红方 · 帅五进一")).toBeTruthy();
    expect(screen.getByText("黑方行棋")).toBeTruthy();
    expect(screen.getByText("白圈：上一着起点")).toBeTruthy();
    expect(screen.getByText("白边：上一着终点")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-tiantian-source")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
    expect(view.container.querySelector(".link-mini-corner-target")).toBeNull();
    await user.click(screen.getByRole("button", { name: "确认写入当前棋谱变例" }));
    expect(props.onConfirmMarkedMove).toHaveBeenCalledWith("e0e1");
  });

  it("uses the shared intersection hit targets and a red corner for a manual source", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rk.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "redAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
    }));
    props.onPreviewMarkedMove = vi.fn(async () => ({
      beforeFen: "before",
      afterFen: "after",
      sideToMove: "黑方" as const,
      captured: false,
      fen: "after",
      notation: "帅五进一",
      movedBy: "红方" as const,
      from: { row: 9, col: 4 },
      to: { row: 8, col: 4 },
      pieces: [],
      status: "进行中",
    }));
    cleanup();
    const view = render(<LinkSessionDialog {...props}/>);
    await user.click(screen.getByRole("button", { name: /截图\/照片/ }));
    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(await screen.findByLabelText("标记棋盘第 10 行第 5 列"));

    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();
    expect(screen.getByText("红框：手动起点")).toBeTruthy();
    const target = screen.getByLabelText("标记棋盘第 10 行第 5 列");
    expect(target.getAttribute("style")).toContain("left: 50%");
    expect(target.getAttribute("style")).toContain("top: 93.54838709677419%");
  });

  it("keeps a unique exact YOLO/tree match bound to its resolved candidate", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rk.png";
    props.onPreviewMarkedMove = vi.fn(async () => { throw new Error("unique match must not open manual endpoints"); });
    props.onResolveScreenshotMove = vi.fn(async () => ({ status: "unique" as const, orientation: "redAtBottom" as const, currentPieces: [], currentSideToMove: "红方" as const, candidates: [{ beforeFen: "before", afterFen: "after", sideToMove: "黑方" as const, captured: false, fen: "after", notation: "马八进七", movedBy: "红方" as const, from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, pieces: [], status: "进行中" }] }));
    cleanup();
    const view = render(<LinkSessionDialog {...props}/>);

    await user.click(screen.getByRole("button", { name: /截图\/照片/ }));
    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(await screen.findByText("上一着（待确认）：红方 · 马八进七")).toBeTruthy();
    expect(screen.getByText("白圈：上一着起点")).toBeTruthy();
    expect(screen.getByText("白边：上一着终点")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-tiantian-source")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-tiantian-target")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-corner-target")).toBeNull();
    expect(screen.queryByLabelText("标记棋盘第 10 行第 2 列")).toBeNull();
    expect(props.onPreviewMarkedMove).not.toHaveBeenCalled();
    expect(props.onConfirmMarkedMove).toBeUndefined();
  });

  it("uses the exact YOLO/tree match when white markers conflict", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({ status: "unique" as const, orientation: "redAtBottom" as const, currentPieces: [], currentSideToMove: "红方" as const, candidates: [{ beforeFen: "tree-before", afterFen: "after", sideToMove: "黑方" as const, captured: false, fen: "after", notation: "马八进七", movedBy: "红方" as const, from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, pieces: [], status: "进行中", recognitionSource: "YOLO完整局面与当前棋谱合法一步匹配", recognitionConfidence: 100 }] }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(await screen.findByText("上一着（待确认）：红方 · 马八进七")).toBeTruthy();
    expect(screen.queryByText("上一着（待确认）：红方 · 炮八退二")).toBeNull();
    expect(props.onResolveScreenshotMove).toHaveBeenCalledWith();
  });

  it("clears an old screenshot proposal when reselecting an image is cancelled", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onRecognizeImage = vi.fn()
      .mockResolvedValueOnce({
        state: "tracking" as const,
        accepted: true,
        board: {
          fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
          pieces: [],
          sideToMove: "红方",
          playable: true,
        } as never,
      })
      .mockResolvedValueOnce(undefined);
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "unique" as const,
      orientation: "redAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [{
        beforeFen: "before",
        afterFen: "after",
        sideToMove: "黑方" as const,
        captured: false,
        fen: "after",
        notation: "马八进七",
        movedBy: "红方" as const,
        from: { row: 9, col: 1 },
        to: { row: 7, col: 2 },
        pieces: [],
        status: "进行中",
      }],
    }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    expect(await screen.findByText("上一着（待确认）：红方 · 马八进七")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "重新选择图片" }));

    expect(screen.queryByText("上一着（待确认）：红方 · 马八进七")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认写入当前棋谱变例" })).toBeNull();
    expect(props.onResolveScreenshotMove).toHaveBeenCalledTimes(1);
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("uses the recognized black-side orientation and lets the user flip the preview", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({ status: "unique" as const, orientation: "blackAtBottom" as const, currentPieces: [], currentSideToMove: "红方" as const, candidates: [{ beforeFen: "before", afterFen: "after", sideToMove: "黑方" as const, captured: false, markerKind: "lastMove" as const, fen: "after", notation: "马八进七", movedBy: "红方" as const, from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, pieces: [], status: "进行中" }] }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    expect(await screen.findByText("上一着（待确认）：红方 · 马八进七")).toBeTruthy();
    expect(screen.getByRole("button", { name: "黑方在下" }).className).toContain("active");
    await user.click(screen.getByRole("button", { name: "黑方在下" }));
    expect(screen.getByRole("button", { name: "黑方在下" }).className).toContain("active");
  });

  it("passes the selected screenshot view into U10 training", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({ status: "unique" as const, orientation: "blackAtBottom" as const, currentPieces: [], currentSideToMove: "红方" as const, candidates: [{ beforeFen: "before", afterFen: "after", sideToMove: "黑方" as const, captured: false, fen: "after", notation: "马八进七", movedBy: "红方" as const, from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, pieces: [], status: "进行中" }] }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(await screen.findByRole("button", { name: "导入并开始 U10 拆棋" }));

    expect(props.onStartTraining).toHaveBeenCalledWith(expect.any(String), "天天象棋截图拆棋", true);
  });

  it("requires the user to choose when screenshot evidence yields multiple legal moves", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onPreviewMarkedMove = vi.fn(async () => { throw new Error("ambiguous match must not open manual endpoints"); });
    props.onResolveScreenshotMove = vi.fn(async () => ({ status: "ambiguous" as const, orientation: "redAtBottom" as const, currentPieces: [], currentSideToMove: "红方" as const, candidates: [
      { fen: "after-a", beforeFen: "before-a", afterFen: "after-a", sideToMove: "黑方" as const, captured: false, notation: "马八进七", movedBy: "红方" as const, from: { row: 9, col: 1 }, to: { row: 7, col: 2 }, pieces: [], status: "进行中" },
      { fen: "after-b", beforeFen: "before-b", afterFen: "after-b", sideToMove: "黑方" as const, captured: false, notation: "炮二平五", movedBy: "红方" as const, from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, pieces: [], status: "进行中" },
    ], reason: "完整局面存在多个合法一步匹配，请选择后再确认写入变例。" }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    expect(await screen.findByText("未能唯一确定，请选择上一着")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认写入当前棋谱变例" })).toBeNull();
    expect(screen.queryByLabelText("标记棋盘第 10 行第 2 列")).toBeNull();
    expect(props.onPreviewMarkedMove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /红方 · 马八进七/ }));
    expect(screen.getByText("上一着（待确认）：红方 · 马八进七")).toBeTruthy();
    expect(screen.queryByLabelText("标记棋盘第 10 行第 2 列")).toBeNull();
  });

  it("does not offer a white-marker-only move when YOLO has no exact one-ply match", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "redAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
      reason: "识别到的完整局面与当前棋谱没有合法的一步衔接。白色圈和底光只作排序证据，不能单独推断走法；请手工点起点和终点。",
    }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(await screen.findByText(/白色圈和底光只作排序证据/)).toBeTruthy();
    expect(screen.queryByText(/上一着（待确认）/)).toBeNull();
    expect(screen.queryByRole("button", { name: "确认写入当前棋谱变例" })).toBeNull();
    expect(screen.getByLabelText("标记棋盘第 10 行第 2 列")).toBeTruthy();
  });

  it("keeps current-document manual endpoints available when the YOLO board is not playable", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onRecognizeImage = vi.fn(async () => ({
      state: "tracking" as const,
      accepted: false,
      board: {
        fen: "9/9/9/9/9/9/9/9/9/9 w - - 0 1",
        pieces: [],
        sideToMove: "红方",
        playable: false,
      } as never,
    }));
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "redAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
    }));
    props.onPreviewMarkedMove = vi.fn(async () => ({
      beforeFen: "before",
      afterFen: "after",
      sideToMove: "黑方" as const,
      captured: false,
      fen: "after",
      notation: "车九平八",
      movedBy: "红方" as const,
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      pieces: [],
      status: "进行中",
    }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(await screen.findByLabelText("标记棋盘第 1 行第 1 列"));
    await user.click(screen.getByLabelText("标记棋盘第 1 行第 2 列"));

    expect(props.onPreviewMarkedMove).toHaveBeenCalledWith("a9b9");
    expect(await screen.findByText("上一着（待确认）：红方 · 车九平八")).toBeTruthy();
  });

  it("offers current-document manual endpoints when YOLO cannot reconstruct a board", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rn.png";
    props.onRecognizeImage = vi.fn(async () => ({
      state: "needsManualCorrection" as const,
      accepted: false,
      reason: "图片未识别到可同步棋盘",
    }));
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "blackAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
      reason: "未能可靠识别完整棋盘局面；请手工点起点和终点。",
    }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));

    expect(props.onResolveScreenshotMove).toHaveBeenCalledWith();
    expect(await screen.findByText(/未能可靠识别完整棋盘局面/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "黑方在下" }).className).toContain("active");
    expect(screen.getByLabelText("标记棋盘第 1 行第 1 列")).toBeTruthy();
  });

  it("keeps manual point selection usable when YOLO cannot reconstruct a board", async () => {
    const { props, user } = renderLinkDialog();
    props.pieceAsset = () => "/skins/default/rk.png";
    props.onRecognizeImage = vi.fn(async () => ({
      state: "needsManualCorrection" as const,
      accepted: false,
      reason: "图片未识别到可同步棋盘",
    }));
    props.onResolveScreenshotMove = vi.fn(async () => ({
      status: "noExactMatch" as const,
      orientation: "blackAtBottom" as const,
      currentPieces: [],
      currentSideToMove: "红方" as const,
      candidates: [],
    }));
    props.onPreviewMarkedMove = vi.fn(async () => ({
      beforeFen: "before",
      afterFen: "after",
      sideToMove: "黑方" as const,
      captured: false,
      fen: "after",
      notation: "帅五进一",
      movedBy: "红方" as const,
      from: { row: 9, col: 4 },
      to: { row: 8, col: 4 },
      pieces: [],
      status: "进行中",
    }));
    cleanup();
    render(<LinkSessionDialog {...props} initialSource="imageImport"/>);

    await user.click(screen.getByRole("button", { name: "选择图片识别" }));
    await user.click(await screen.findByLabelText("标记棋盘第 1 行第 5 列"));
    await user.click(screen.getByLabelText("标记棋盘第 2 行第 5 列"));

    expect(props.onPreviewMarkedMove).toHaveBeenCalledWith("e0e1");
    expect(await screen.findByText("上一着（待确认）：红方 · 帅五进一")).toBeTruthy();
  });
});

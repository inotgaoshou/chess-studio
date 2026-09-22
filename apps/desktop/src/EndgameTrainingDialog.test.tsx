import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndgameTrainingDialog } from "./EndgameTrainingDialog";

const firstBook = {
  id: "book-chen", title: "中国象棋实用残局增订本-陈松顺", sourcePath: "/tmp/chen.cbl",
  fingerprint: "chen", parserVersion: 2, problemCount: 2, attemptedCount: 0, completedCount: 0, importedAt: "2026-09-03T00:00:00Z",
};
const secondBook = {
  id: "book-next", title: "第二本残局集", sourcePath: "/tmp/next.cbl",
  fingerprint: "next", parserVersion: 2, problemCount: 1, attemptedCount: 0, completedCount: 0, importedAt: "2026-09-02T00:00:00Z",
};
const problems = {
  "book-chen": [{
    id: "horse", libraryId: "book-chen", sourceIndex: 48, title: "（一）马取单士--着法1，红先胜", category: "马类",
    startingFen: "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "单马必胜单士", solutionJson: "[{\"iccs\":\"f8e6\",\"comment\":\"\",\"children\":[]}]", attemptCount: 0, completedAttempts: 0, totalElapsedMs: 0,
  }, {
    id: "auto-reply", libraryId: "book-chen", sourceIndex: 49, title: "自动应手演示", category: "马类",
    startingFen: "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "", solutionJson: "[{\"iccs\":\"f8e6\",\"comment\":\"\",\"children\":[{\"iccs\":\"d8d7\",\"comment\":\"\",\"children\":[]}]}]", attemptCount: 0, completedAttempts: 0, totalElapsedMs: 0,
  }, {
    id: "horse-capture", libraryId: "book-chen", sourceIndex: 50, title: "马吃卒", category: "马类",
    startingFen: "9/3k1N3/3p5/9/9/9/9/9/9/4K4 w - - 0 1", note: "", solutionJson: "[{\"iccs\":\"f8d7\",\"comment\":\"\",\"children\":[]}]", attemptCount: 0, completedAttempts: 0, totalElapsedMs: 0,
  }],
  "book-next": [{
    id: "next", libraryId: "book-next", sourceIndex: 0, title: "车兵残局", category: "车类",
    startingFen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "", solutionJson: "[]", attemptCount: 0, completedAttempts: 0, totalElapsedMs: 0,
  }],
  "book-terminal": [{
    id: "terminal", libraryId: "book-terminal", sourceIndex: 0, title: "将死应立即结束", category: "杀法",
    startingFen: "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "", solutionJson: "[{\"iccs\":\"f8e6\",\"comment\":\"\",\"children\":[{\"iccs\":\"d8d7\",\"comment\":\"\",\"children\":[]}]}]", attemptCount: 0, completedAttempts: 0, totalElapsedMs: 0,
  }],
};

const platform = vi.hoisted(() => ({
  refreshEndgameLibraries: vi.fn(),
  listEndgameLibraries: vi.fn(),
  listEndgameFolders: vi.fn(),
  listEndgameProblems: vi.fn(),
  importEndgameCbl: vi.fn(),
  importEndgameCblBatch: vi.fn(),
  importEndgameCblFromPath: vi.fn(),
  createEndgameFolder: vi.fn(),
  renameEndgameFolder: vi.fn(),
  moveEndgameFolder: vi.fn(),
  deleteEndgameFolder: vi.fn(),
  reorderEndgameFolder: vi.fn(),
  moveEndgameLibraries: vi.fn(),
  reorderEndgameLibrary: vi.fn(),
  saveEndgameAttempt: vi.fn(),
  endgameChineseMainline: vi.fn(),
  deleteEndgameLibrary: vi.fn(),
  deleteEndgameProblem: vi.fn(),
  listEndgameAttempts: vi.fn(),
  endgameMoveFeedback: vi.fn(),
  endgameFreePracticeMove: vi.fn(),
  queryCloudOpeningBook: vi.fn(),
}));
const playMoveFeedbackSound = vi.hoisted(() => vi.fn());

vi.mock("./platform", () => ({ chessPlatform: platform }));
vi.mock("./MainBoardMoveFeedback", () => ({ playMoveFeedbackSound }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => {
  vi.clearAllMocks();
  platform.refreshEndgameLibraries.mockResolvedValue({ warnings: [] });
  platform.listEndgameLibraries.mockResolvedValue([firstBook, secondBook]);
  platform.listEndgameFolders.mockResolvedValue([]);
  platform.listEndgameProblems.mockImplementation(async (id: keyof typeof problems) => problems[id]);
  platform.importEndgameCbl.mockResolvedValue(undefined);
  platform.importEndgameCblBatch.mockResolvedValue({ items: [] });
  platform.createEndgameFolder.mockImplementation(async (parentId: string | undefined, name: string) => ({ id: "created-folder", parentId, name, createdAt: "2026-09-04T00:00:00Z" }));
  platform.renameEndgameFolder.mockImplementation(async (folderId: string, name: string) => ({ id: folderId, name, createdAt: "2026-09-04T00:00:00Z" }));
  platform.moveEndgameFolder.mockResolvedValue(undefined);
  platform.deleteEndgameFolder.mockResolvedValue(undefined);
  platform.reorderEndgameFolder.mockResolvedValue(true);
  platform.moveEndgameLibraries.mockResolvedValue(1);
  platform.reorderEndgameLibrary.mockResolvedValue(true);
  platform.saveEndgameAttempt.mockResolvedValue(undefined);
  platform.endgameChineseMainline.mockResolvedValue(["马六进四"]);
  platform.deleteEndgameLibrary.mockResolvedValue(undefined);
  platform.deleteEndgameProblem.mockResolvedValue(undefined);
  platform.listEndgameAttempts.mockResolvedValue([]);
  platform.endgameMoveFeedback.mockResolvedValue({ terminal: false, captured: false, check: false, checkmate: false });
  platform.endgameFreePracticeMove.mockResolvedValue({ fen: "9/3ka4/9/4N4/9/9/9/9/9/4K4 b - - 1 1", notation: "马六进五", terminal: false, captured: false, check: false, checkmate: false });
  platform.queryCloudOpeningBook.mockResolvedValue([]);
});

async function chooseSolverMode() {
  fireEvent.click(await screen.findByLabelText("只走解题方"));
}

describe("EndgameTrainingDialog", () => {
  it("defaults a newly opened problem to cloud sparring and keeps the other training modes available", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));

    expect((screen.getByLabelText("云库对练") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("只走解题方")).toBeTruthy();
    expect(screen.getByLabelText("双方复现（按题解）")).toBeTruthy();
    expect(screen.getByLabelText("自由实战")).toBeTruthy();
    expect(screen.getByRole("button", { name: "结束对练" })).toBeTruthy();
  });

  it("uses the packaged board skin for the endgame board", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));

    expect(screen.getByLabelText("残局训练棋盘").getAttribute("style")).toContain("/skins/qingxin-zhuyun/board.png");
  });

  it("does not select an opponent piece as the solver's move source", async () => {
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    await chooseSolverMode();
    fireEvent.click(await screen.findByLabelText("d8"));

    expect(view.container.querySelector(".link-mini-selected-square")).toBeNull();
  });

  it("does not select an opponent piece as the cloud sparring move source", async () => {
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    fireEvent.click(await screen.findByLabelText("d8"));

    expect(view.container.querySelector(".link-mini-selected-square")).toBeNull();
    expect(screen.getByText("当前轮到红方走棋，请先选择己方棋子。")).toBeTruthy();
  });

  it("keeps a non-terminal cloud sparring position available for offline manual continuation", async () => {
    platform.queryCloudOpeningBook.mockRejectedValue(new Error("网络不可用"));
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    fireEvent.click(await screen.findByLabelText("f8"));
    fireEvent.click(screen.getByLabelText("e6"));

    expect(await screen.findByText("云库对练不可用：网络不可用，已切换至离线双人接手，请由当前行棋方继续走棋。")).toBeTruthy();
    expect((screen.getByLabelText("自由实战") as HTMLInputElement).checked).toBe(true);
    expect(platform.saveEndgameAttempt).not.toHaveBeenCalled();
  });

  it("names a cloud sparring stalemate before ending the attempt", async () => {
    platform.endgameFreePracticeMove.mockResolvedValue({
      fen: "9/9/1N1k5/9/9/9/9/9/4K4/9 b - - 1 1",
      notation: "帅五进一",
      terminal: true,
      captured: false,
      check: false,
      checkmate: false,
    });
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    fireEvent.click(screen.getByLabelText("f8"));
    fireEvent.click(screen.getByLabelText("e6"));

    expect(await screen.findByText("困毙", { selector: ".endgame-terminal-feedback span" })).toBeTruthy();
    expect(view.container.querySelector(".endgame-terminal-feedback.stalemate")).not.toBeNull();
    expect(playMoveFeedbackSound).toHaveBeenCalledWith("stalemate", true, 70);
    await waitFor(() => expect(platform.saveEndgameAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" })));
  });

  it("allows a selected solver piece to capture an occupied opponent target", async () => {
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马吃卒/ }));
    await chooseSolverMode();
    fireEvent.click(await screen.findByLabelText("f8"));
    fireEvent.click(screen.getByLabelText("d7"));

    expect(screen.getByText("正确，继续完成题解。")).toBeTruthy();
    expect([...view.container.querySelectorAll('[data-square="2-3"]')].some((piece) => piece.getAttribute("alt") === "马")).toBe(true);
  });

  it("uses an expandable book parent before showing its problems", async () => {
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    const firstParent = await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    const secondParent = screen.getByRole("button", { name: /第二本残局集/ });
    expect(firstParent.getAttribute("aria-expanded")).toBe("true");
    expect(secondParent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("（一）马取单士--着法1，红先胜")).toBeTruthy();

    fireEvent.click(firstParent);
    expect(firstParent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("（一）马取单士--着法1，红先胜")).toBeTruthy();

    fireEvent.click(secondParent);
    await waitFor(() => expect(screen.getByRole("button", { name: /第二本残局集/ }).getAttribute("aria-expanded")).toBe("true"));
    expect(await screen.findByText("车兵残局")).toBeTruthy();
    expect(view.container.querySelector(".endgame-library-tree")).not.toBeNull();
  });

  it("keeps both import and directory creation available when the library is empty", async () => {
    platform.listEndgameLibraries.mockResolvedValue([]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    expect(await screen.findByRole("button", { name: "导入 CBL" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建目录" }));
    expect(screen.getByRole("dialog", { name: "新建残局目录" })).toBeTruthy();
  });

  it("asks the user to reselect a CBL file that disappeared after selection", async () => {
    platform.listEndgameLibraries.mockResolvedValue([]);
    platform.importEndgameCblBatch.mockRejectedValue(new Error("读取 CBL 失败：No such file or directory (os error 2)"));

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    fireEvent.click(await screen.findByRole("button", { name: "导入 CBL" }));

    expect(await screen.findByText("导入失败：找不到所选 CBL 文件。文件可能已移动或被删除，请重新选择。"))
      .toBeTruthy();
  });

  it("explains missing files returned as per-file batch failures", async () => {
    platform.listEndgameLibraries.mockResolvedValue([]);
    platform.importEndgameCblBatch.mockResolvedValue({ items: [{
      path: "/tmp/missing.cbl", library: null, warnings: [],
      error: "读取 CBL 失败：No such file or directory (os error 2)",
    }] });
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "导入 CBL" }));
    expect(await screen.findByText(/missing.cbl（找不到所选 CBL 文件。文件可能已移动或被删除，请重新选择。/)).toBeTruthy();
  });

  it("shows nested directories and expands their path when a library is selected", async () => {
    const parent = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    const child = { id: "folder-horse", parentId: "folder-main", name: "马类", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([parent, child]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: "folder-horse" }]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    const parentButton = await screen.findByRole("button", { name: "基础残局" });
    expect(parentButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "马类" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ })).toBeTruthy();
  });

  it("renders root folders and libraries returned by Rust as null parent IDs", async () => {
    const folder = { id: "folder-root", parentId: null, name: "残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: null }]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    expect(await screen.findByRole("button", { name: "残局" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ })).toBeTruthy();
  });

  it("opens an existing directory instead of surfacing a duplicate-name database error", async () => {
    const folder = { id: "folder-root", parentId: null, name: "残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: "残局" });
    fireEvent.click(screen.getByTitle("在根目录新建目录"));
    fireEvent.change(screen.getByLabelText("目录名"), { target: { value: "残局" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(platform.createEndgameFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "新建残局目录" })).toBeNull();
  });

  it("batch imports into the selected directory and reports files that failed", async () => {
    const folder = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: "folder-main" }]);
    platform.importEndgameCblBatch.mockResolvedValue({
      items: [
        { path: "/tmp/ok.cbl", library: { ...secondBook, folderId: "folder-main" }, warnings: ["记录 4 损坏"] },
        { path: "/tmp/broken.cbl", warnings: [], error: "不是 CCBridge CBL" },
      ],
    });

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: "基础残局" });
    fireEvent.click(screen.getByRole("button", { name: "批量导入 CBL" }));
    expect(platform.importEndgameCblBatch).toHaveBeenCalledWith("folder-main");
    expect(await screen.findByText(/导入完成：1 本成功，跳过 1 条无效记录；1 本失败：broken\.cbl（不是 CCBridge CBL）/)).toBeTruthy();
  });

  it("creates a root directory even when another directory is selected", async () => {
    const folder = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: "folder-main" }]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: "基础残局" });
    fireEvent.click(screen.getByTitle("在根目录新建目录"));
    fireEvent.change(screen.getByLabelText("目录名"), { target: { value: "车类" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(platform.createEndgameFolder).toHaveBeenCalledWith(undefined, "车类");
  });

  it("renames a user directory and keeps the virtual root immutable", async () => {
    const folder = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.renameEndgameFolder.mockImplementationOnce(async (folderId: string, name: string) => {
      const renamed = { ...folder, id: folderId, name };
      platform.listEndgameFolders.mockResolvedValue([renamed]);
      return renamed;
    });

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    expect(await screen.findByTitle("固定题库根目录：用户目录和题库可移动到这里")).toBeTruthy();
    expect(screen.queryByTitle("更多：题库")).toBeNull();

    fireEvent.click(screen.getByTitle("更多：基础残局"));
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名残局目录" });
    expect((within(dialog).getByLabelText("目录名") as HTMLInputElement).value).toBe("基础残局");
    const save = within(dialog).getByRole("button", { name: "保存名称" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("目录名"), { target: { value: "杀法训练" } });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(platform.renameEndgameFolder).toHaveBeenCalledWith("folder-main", "杀法训练"));
    expect(await screen.findByRole("button", { name: "杀法训练" })).toBeTruthy();
  });

  it("shows a clear rename error when a sibling directory already has that name", async () => {
    const folder = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder, { id: "folder-other", name: "杀法训练", createdAt: folder.createdAt }]);
    platform.renameEndgameFolder.mockRejectedValueOnce(new Error("当前目录中已存在“杀法训练”"));

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: "基础残局" });
    fireEvent.click(screen.getByTitle("更多：基础残局"));
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名残局目录" });
    fireEvent.change(within(dialog).getByLabelText("目录名"), { target: { value: "杀法训练" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(platform.renameEndgameFolder).toHaveBeenCalledWith("folder-main", "杀法训练"));
    expect(await screen.findByText(/当前目录中已存在“杀法训练”/)).toBeTruthy();
  });

  it("moves a nested library back to the virtual root", async () => {
    const folder = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: folder.id }]);
    platform.moveEndgameLibraries.mockImplementationOnce(async () => {
      platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: null }]);
      return 1;
    });

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    fireEvent.click(await screen.findByTitle(/移动题库 中国象棋实用残局增订本-陈松顺/));
    const dialog = screen.getByRole("dialog", { name: "移动残局题库" });
    fireEvent.click(within(dialog).getByRole("button", { name: "根目录" }));
    const confirm = within(dialog).getByRole("button", { name: "确认移动" });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(platform.moveEndgameLibraries).toHaveBeenCalledWith(["book-chen"], undefined));
    expect(await screen.findByTitle("固定题库根目录：用户目录和题库可移动到这里")).toBeTruthy();
  });

  it("moves a library and prevents its directory from being moved below itself", async () => {
    const parent = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    const child = { id: "folder-horse", parentId: "folder-main", name: "马类", createdAt: "2026-09-04T00:00:00Z" };
    const destination = { id: "folder-other", name: "其他", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([parent, child, destination]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: "folder-main" }]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByTitle(/移动题库 中国象棋实用残局增订本-陈松顺/);
    fireEvent.click(screen.getByTitle(/移动题库 中国象棋实用残局增订本-陈松顺/));
    const libraryDialog = screen.getByRole("dialog", { name: "移动残局题库" });
    fireEvent.click(within(libraryDialog).getByRole("button", { name: "其他" }));
    fireEvent.click(within(libraryDialog).getByRole("button", { name: "确认移动" }));
    expect(platform.moveEndgameLibraries).toHaveBeenCalledWith(["book-chen"], "folder-other");

    fireEvent.click(await screen.findByTitle("移动目录 基础残局"));
    const folderDialog = screen.getByRole("dialog", { name: "移动残局目录" });
    expect(within(folderDialog).getByRole("button", { name: "根目录" })).toBeTruthy();
    expect(within(folderDialog).getByRole("button", { name: "其他" })).toBeTruthy();
    expect(within(folderDialog).queryByRole("button", { name: "马类" })).toBeNull();
  });

  it.each(["", "folder-other"])("moves a nested directory to destination %s", async (targetId) => {
    const parent = { id: "folder-main", name: "基础残局", createdAt: "2026-09-04T00:00:00Z" };
    const child = { id: "folder-horse", parentId: parent.id, name: "马类", createdAt: parent.createdAt };
    const destination = { id: "folder-other", name: "其他", createdAt: parent.createdAt };
    platform.listEndgameFolders.mockResolvedValue([parent, child, destination]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: child.id }]);
    platform.moveEndgameFolder.mockImplementationOnce(async () => {
      platform.listEndgameFolders.mockResolvedValue([parent, { ...child, parentId: targetId || undefined }, destination]);
    });
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByTitle("移动目录 马类"));
    const dialog = screen.getByRole("dialog", { name: "移动残局目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: targetId ? "其他" : "根目录" }));
    const confirm = within(dialog).getByRole("button", { name: "确认移动" });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移动残局目录" })).toBeNull());
    expect(platform.moveEndgameFolder).toHaveBeenCalledWith(child.id, targetId || undefined);
    expect(await screen.findByRole("button", { name: "马类" })).toBeTruthy();
    if (targetId) expect(screen.getByRole("button", { name: "其他" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("deletes a selected directory while retaining its direct libraries", async () => {
    const folder = { id: "folder-main", name: "残局", createdAt: "2026-09-04T00:00:00Z" };
    platform.listEndgameFolders.mockResolvedValue([folder]);
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, folderId: "folder-main" }]);

    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: "残局" });
    fireEvent.click(screen.getByTitle("更多：残局"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/其中 1 本题库会移至上级目录/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(platform.deleteEndgameFolder).toHaveBeenCalledWith("folder-main"));
    expect(screen.queryByRole("alertdialog", { name: "确认删除" })).toBeNull();
  });

  it("searches every imported endgame library from the shared catalogue", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.change(screen.getByLabelText("搜索全部残局"), { target: { value: "车兵" } });

    expect(await screen.findByText("第二本残局集 · 车类")).toBeTruthy();
    fireEvent.click(screen.getByText("车兵残局"));
    expect(await screen.findByText("第 1/1 题")).toBeTruthy();
  });

  it("reorders an opened library within its current directory", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    fireEvent.click(await screen.findByTitle(/更多：中国象棋实用残局增订本-陈松顺/));
    fireEvent.click(screen.getByRole("button", { name: "下移" }));

    await waitFor(() => expect(platform.reorderEndgameLibrary).toHaveBeenCalledWith("book-chen", false));
  });

  it("shows the answer as rounds and offers board demonstration", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    await chooseSolverMode();
    fireEvent.click(await screen.findByRole("button", { name: "看答案" }));

    expect(await screen.findByText("题解回合")).toBeTruthy();
    expect(screen.getByText("红方 马六进四")).toBeTruthy();
    expect(screen.getByRole("button", { name: "演示答案" })).toBeTruthy();
  });

  it("confirms deletion inside the training desk before changing local data", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByTitle("删除当前题库"));
    expect(screen.getByRole("alertdialog", { name: "确认删除" })).toBeTruthy();
    expect(screen.getByText(/删除题库《/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(platform.deleteEndgameLibrary).not.toHaveBeenCalled();
  });

  it("keeps the correct move visible before the automatic reply and names that reply in Chinese", async () => {
    platform.endgameChineseMainline.mockResolvedValue(["马六进四", "将5进1"]);
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /自动应手演示/ }));
    await chooseSolverMode();
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText("f8"));
    fireEvent.click(screen.getByLabelText("e6"));
    expect(screen.getByText("正确，正在显示对方应手…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(screen.getByText("正确，对方应手已自动走出：将5进1。")).toBeTruthy();
    expect(platform.saveEndgameAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
  });

  it("finishes a replay immediately when the correct move checkmates or stalemates", async () => {
    platform.listEndgameLibraries.mockResolvedValue([{ ...firstBook, id: "book-terminal", title: "终局题" }]);
    platform.endgameMoveFeedback.mockResolvedValue({ captured: false, check: true, checkmate: true, terminal: true });
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /终局题/ });
    fireEvent.click(screen.getByRole("button", { name: /将死应立即结束/ }));
    fireEvent.click(screen.getByLabelText("双方复现（按题解）"));
    fireEvent.click(screen.getByLabelText("f8"));
    fireEvent.click(screen.getByLabelText("e6"));

    await waitFor(() => expect(platform.saveEndgameAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" })));
  });
});

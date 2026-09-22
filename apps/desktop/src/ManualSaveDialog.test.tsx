import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManualSaveDialog } from "../../endgame-training/src/ManualSaveDialog";
import type { LocalManualGame } from "../../endgame-training/src/types";
const game: LocalManualGame = { id: "one", title: "测试", note: "备注", folderPath: "比赛", startingFen: "9 b",
 currentNodeId: "main:1", currentFen: "fen", moves: ["e6e5"], cursor: 1, branches: [], comments: { root: "注释" },
 createdAt: "2026-09-22T02:00:00.000Z", updatedAt: "2026-09-22T02:00:00.000Z" };
const folders = [{ path: "比赛", createdAt: game.createdAt }];
afterEach(cleanup);
it("saves complete metadata and explicitly supports unclassified", async () => {
 const onSave = vi.fn(async () => {});
 const onClose = vi.fn();
 render(<ManualSaveDialog game={game} folders={folders} onSave={onSave} onClose={onClose} onCreateFolder={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("归属赛事"), { target: { value: "佛山杯" } });
 fireEvent.change(screen.getByLabelText("红方棋手"), { target: { value: "张三" } });
 fireEvent.change(screen.getByLabelText("保存目录"), { target: { value: "" } });
 fireEvent.click(screen.getByRole("button", { name: "保存棋谱" }));
 await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
 expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ folderPath: "", metadata: expect.objectContaining({
  event: "佛山杯", redPlayer: "张三", playedAt: game.createdAt, gameType: "full", result: "unknown"
 }) }));
 expect(game.moves).toEqual(["e6e5"]);
});
it("confirms discarding only edited fields and allows continuing", () => {
 const onClose = vi.fn(), onSave = vi.fn();
 render(<ManualSaveDialog game={game} folders={folders} onSave={onSave} onClose={onClose} onCreateFolder={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("棋谱名称"), { target: { value: "改名" } });
 fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
 expect(screen.getByRole("alertdialog")).toBeTruthy();
 fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
 expect((screen.getByLabelText("棋谱名称") as HTMLInputElement).value).toBe("改名");
 fireEvent.keyDown(document, { key: "Escape" });
 fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
 expect(onClose).toHaveBeenCalledOnce();
 expect(onSave).not.toHaveBeenCalled();
 expect(game.title).toBe("测试");
});
it("preserves input on failure and prevents duplicate submits and closing while saving", async () => {
 let reject!: (error: Error) => void;
 const onSave = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
 const onClose = vi.fn();
 render(<ManualSaveDialog game={game} folders={folders} onSave={onSave} onClose={onClose} onCreateFolder={vi.fn()}/>);
 const save = screen.getByRole("button", { name: "保存棋谱" });
 fireEvent.click(save); fireEvent.click(save);
 fireEvent.click(screen.getByRole("button", { name: "关闭保存棋谱" }));
 expect(onSave).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
 reject(new Error("存储失败"));
 await screen.findByText("存储失败");
 expect((screen.getByLabelText("棋谱名称") as HTMLInputElement).value).toBe("测试");
 onSave.mockResolvedValueOnce();
 fireEvent.click(screen.getByRole("button", { name: "保存棋谱" }));
 await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it("does not submit IME selection Enter or note newlines", async () => {
 const onSave = vi.fn(async () => {});
 render(<ManualSaveDialog game={game} folders={folders} onSave={onSave} onClose={vi.fn()} onCreateFolder={vi.fn()}/>);
 const title = screen.getByLabelText("棋谱名称");
 fireEvent.compositionStart(title);
 fireEvent.keyDown(title, { key: "Enter" });
 fireEvent.compositionEnd(title);
 fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
 fireEvent.keyDown(screen.getByLabelText("备注"), { key: "Enter" });
 expect(onSave).not.toHaveBeenCalled();
 fireEvent.change(title, { target: { value: "佛山" } });
 fireEvent.keyDown(title, { key: "Enter" });
 await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
});
it("creates a child directory without saving or losing the outer form", async () => {
 const onCreateFolder = vi.fn(async () => {}), onSave = vi.fn();
 render(<ManualSaveDialog game={game} folders={folders} onSave={onSave} onClose={vi.fn()} onCreateFolder={onCreateFolder}/>);
 fireEvent.click(screen.getByRole("button", { name: "＋ 新建子目录" }));
 fireEvent.change(screen.getByLabelText("子目录名称"), { target: { value: "第一轮" } });
 fireEvent.click(screen.getByRole("button", { name: "创建目录" }));
 await waitFor(() => expect((screen.getByLabelText("保存目录") as HTMLSelectElement).value).toBe("比赛/第一轮"));
 expect(onCreateFolder).toHaveBeenCalledWith("比赛/第一轮");
 expect(onSave).not.toHaveBeenCalled();
});

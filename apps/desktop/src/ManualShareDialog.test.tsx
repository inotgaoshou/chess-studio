import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManualShareDialog, manualFileName } from "../../endgame-training/src/ManualShareDialog";
const exporter = vi.hoisted(() => vi.fn((_json: string, format: string) => `棋谱-${format}`));
vi.mock("../../endgame-training/src/wasm", () => ({ trainingCore: async () => ({ exportLocalManual: exporter }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const game: any = { title: "测试", moves: ["h2e2"], cursor: 0, branches: [], comments: {} };
it("exports full snapshot, switches formats, and copies without modifying game", async () => {
  const before = JSON.stringify(game); const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  render(<ManualShareDialog game={game} onClose={() => {}}/>);
  await screen.findByDisplayValue("棋谱-chinese");
  fireEvent.click(screen.getByText("复制")); await screen.findByText("棋谱已复制");
  expect(copy).toHaveBeenCalledWith("棋谱-chinese");
  fireEvent.change(screen.getByLabelText("分享格式"), {target:{value:"dhtmlxq"}});
  await screen.findByDisplayValue("棋谱-dhtmlxq"); expect(screen.getByText(/当前仅导出主线/)).toBeTruthy();
  expect(exporter).toHaveBeenCalledWith(before, "dhtmlxq"); expect(JSON.stringify(game)).toBe(before);
});
it("keeps preview for share failure and ignores cancellation", async () => {
  const share=vi.fn().mockRejectedValueOnce(new DOMException("cancel", "AbortError")).mockRejectedValueOnce(new Error("offline"));
  Object.defineProperty(navigator,"share",{configurable:true,value:share});
  render(<ManualShareDialog game={game} onClose={() => {}}/>); await screen.findByDisplayValue("棋谱-chinese");
  fireEvent.click(screen.getByText("系统分享")); await waitFor(()=>expect((screen.getByText("系统分享") as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByText("系统分享")); await screen.findByRole("alert"); expect(screen.getByDisplayValue("棋谱-chinese")).toBeTruthy();
});
it("sanitizes PGN filenames",()=>{expect(manualFileName('a/b:谱')).toBe('a_b_谱.pgn');});

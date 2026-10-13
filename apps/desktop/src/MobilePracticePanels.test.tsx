import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobilePracticeReviewPanel, PracticeFavoriteButton } from "../../endgame-training/src/PracticePanels";
import type { PracticeReviewProblem } from "../../endgame-training/src/teaching";

const client = vi.hoisted(() => ({ practiceMistakes: vi.fn(), practiceFavorites: vi.fn(), setPracticeFavorite: vi.fn() }));
vi.mock("../../endgame-training/src/teaching", () => ({ teachingClient: client }));
const rows = Array.from({ length: 25 }, (_, index) => ({ problem: { id: `p${index}`, title: `题目${index}`, category: index < 22 ? "杀法" : "残局", sourceIndex: index }, reviewState: "mastered", errorAttempts: 2 })) as PracticeReviewProblem[];
beforeEach(() => { vi.resetAllMocks(); client.practiceMistakes.mockResolvedValue(rows); client.practiceFavorites.mockResolvedValue(rows); client.setPracticeFavorite.mockResolvedValue(undefined); });
afterEach(cleanup);

it("keeps mastered accessible with no pending rows and sends the actual selected IDs", async () => {
  client.practiceMistakes.mockImplementation(async (state) => state === "pending" ? [] : rows);
  const start = vi.fn();
  render(<MobilePracticeReviewPanel kind="mistakes" busy={false} message="" onBack={vi.fn()} onStart={start}/>);
  await screen.findByText("暂无待复习题目，可查看已掌握题目");
  fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
  await screen.findByText("题目0");
  fireEvent.click(screen.getByRole("button", { name: /巩固重练/ }));
  expect(start).toHaveBeenCalledWith(rows.slice(0, 20).map((row) => row.problem.id), "mastered");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 题目23" }));
  fireEvent.click(screen.getByRole("button", { name: /巩固重练/ }));
  expect(start).toHaveBeenLastCalledWith(["p23"], "mastered");
});

it("caps selection at 20 and clears it when category or tab changes", async () => {
  render(<MobilePracticeReviewPanel kind="mistakes" busy={false} message="" onBack={vi.fn()} onStart={vi.fn()}/>);
  await screen.findByText("题目0");
  fireEvent.click(screen.getByRole("button", { name: "全选前 20 题" }));
  expect(screen.getAllByRole("checkbox").filter((input) => (input as HTMLInputElement).checked)).toHaveLength(20);
  expect((screen.getByRole("checkbox", { name: "选择 题目24" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "残局" }));
  expect(screen.getByText("已选 0/20 题")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 题目23" }));
  fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
  await screen.findByText("题目0");
  expect(screen.getByText("已选 0/20 题")).toBeTruthy();
});

it("retries failed lists and suppresses stale results", async () => {
  let resolve: (items: PracticeReviewProblem[]) => void = () => {};
  client.practiceMistakes.mockRejectedValueOnce(new Error("网络失败")).mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValueOnce(rows);
  render(<MobilePracticeReviewPanel kind="mistakes" busy={false} message="" onBack={vi.fn()} onStart={vi.fn()}/>);
  await screen.findByText("网络失败");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
  await screen.findByText("题目0");
  resolve([]);
  await waitFor(() => expect(screen.getByText("题目0")).toBeTruthy());
});

it("loads favorite state, reports save failure and retries cancellation", async () => {
  client.setPracticeFavorite.mockRejectedValueOnce(new Error("保存失败")).mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PracticeFavoriteButton problemId="p0" onSaved={saved}/>);
  await screen.findByRole("button", { name: "取消收藏" });
  fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
  await screen.findByText("保存失败");
  fireEvent.click(screen.getByRole("button", { name: "重试收藏" }));
  await screen.findByRole("button", { name: "取消收藏" });
  fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
  await screen.findByRole("button", { name: "收藏题目" });
  expect(client.setPracticeFavorite).toHaveBeenLastCalledWith("p0", false);
  expect(saved).toHaveBeenCalledTimes(1);
});

it("disables creation during processing and removes canceled favorites", async () => {
  const start = vi.fn();
  render(<MobilePracticeReviewPanel kind="favorites" busy={true} message="" onBack={vi.fn()} onStart={start}/>);
  await screen.findByText("题目0");
  fireEvent.click(screen.getByRole("button", { name: "正在创建练习…" }));
  expect(start).not.toHaveBeenCalled();
  cleanup();
  render(<MobilePracticeReviewPanel kind="favorites" busy={false} message="" onBack={vi.fn()} onStart={start}/>);
  await screen.findByText("题目0");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 题目0" }));
  fireEvent.click(screen.getByRole("button", { name: "取消收藏 题目0" }));
  await waitFor(() => expect(screen.queryByText("题目0")).toBeNull());
  expect(screen.getByText("已选 0/20 题")).toBeTruthy();
});

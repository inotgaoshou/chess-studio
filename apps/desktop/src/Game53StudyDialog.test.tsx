import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Game53StudyDialog } from "./Game53StudyDialog";
import { chessPlatform } from "./platform";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const detail = {
  topicId: "book-game-53-hong-zhi-huang-shiqing",
  masterGameId: "dpxq-m-6008",
  source: { bookTitle: "布局飞刀集", page: "82", gameNo: "53", authorization: "已授权", sourceKind: "book" as const },
  redPlayer: "洪智", blackPlayer: "黄仕清", eventName: "1998年全国个人赛", result: "1-0", rawTranscript: "", flyknifeStatus: "bookClaimPendingEngine" as const,
  teaching: { situation: "", lure: "黑方应对", knife: "书载飞刀", defense: "书载防守", practice: "" }, images: [], diagramCheckpoints: [], mainline: ["h2e2", "b9c7"],
  lessonNodes: [
    { id: "diagram", title: "图53：飞刀选择", lessonKind: "flyknife" as const, ply: 1, prompt: "红方怎么走？", expectedMove: "车八平五", answer: "11.车八平五!", explanation: "立中", practiceLine: ["h2e2"], variationNotes: ["立中"] },
    { id: "defense", title: "实战应对：卒7进1", lessonKind: "practicalDefense" as const, ply: 1, prompt: "红方续着？", expectedMove: "兵三进一", answer: "12.兵三进一", explanation: "扩张" },
  ],
};

describe("Game53StudyDialog", () => {
  it("shows the verified master game lessons and reveals the selected book answer", async () => {
    vi.spyOn(chessPlatform, "getBookTopicDetail").mockResolvedValue(detail);
    vi.spyOn(chessPlatform, "previewLine").mockResolvedValue([
      { fen: "fen-1", notation: "炮二平五", movedBy: "红方", from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, pieces: [], status: "进行中" },
      { fen: "fen-2", notation: "马8进7", movedBy: "黑方", from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, pieces: [], status: "进行中" },
    ]);
    const user = userEvent.setup();
    render(<Game53StudyDialog onClose={vi.fn()} onOpenMasterGame={vi.fn(async () => undefined)} onPlanSaved={vi.fn()} onOpenEngineSettings={vi.fn()} enginePath="" threads={2} hashMb={256}/>);

    expect(await screen.findByRole("button", { name: /图53：飞刀选择/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看书载答案" }));
    expect(screen.getByText(/11\.车八平五/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /实战应对：卒7进1/ }));
    await waitFor(() => expect(screen.getByText("红方续着？")).toBeTruthy());
    expect(screen.getByText(/第 1 半回合/)).toBeTruthy();
    expect(screen.queryByLabelText("书页专题参考棋盘")).toBeNull();
    await user.click(screen.getByRole("button", { name: /2\. 马8进7/ }));
    expect(screen.getAllByText(/第 2 半回合/).length).toBeGreaterThan(0);
  });

  it("starts a guided variation from the lesson position", async () => {
    vi.spyOn(chessPlatform, "getBookTopicDetail").mockResolvedValue(detail);
    vi.spyOn(chessPlatform, "previewLine").mockResolvedValue([
      { fen: "fen-1", notation: "炮二平五", movedBy: "红方", from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, pieces: [], status: "进行中" },
    ]);
    const user = userEvent.setup();
    render(<Game53StudyDialog onClose={vi.fn()} onOpenMasterGame={vi.fn(async () => undefined)} onPlanSaved={vi.fn()} onOpenEngineSettings={vi.fn()} enginePath="" threads={2} hashMb={256}/>);

    await user.click(await screen.findByRole("button", { name: "开始推演" }));
    expect(await screen.findByText("书中逐步推演")).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出推演" })).toBeTruthy();
  });
});

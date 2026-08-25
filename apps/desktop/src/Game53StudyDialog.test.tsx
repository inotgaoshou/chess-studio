import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Game53StudyDialog } from "./Game53StudyDialog";
import { chessPlatform } from "./platform";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const detail = {
  topicId: "book-game-53-hong-zhi-huang-shiqing", masterGameId: "dpxq-m-6008",
  source: { bookTitle: "布局飞刀集", page: "82", gameNo: "53", authorization: "已授权", sourceKind: "book" as const },
  redPlayer: "洪智", blackPlayer: "黄仕清", eventName: "1998年全国个人赛", result: "1-0", rawTranscript: "", flyknifeStatus: "bookClaimPendingEngine" as const,
  teaching: { situation: "", lure: "黑方应对", knife: "书载飞刀", defense: "书载防守", practice: "" }, images: [], diagramCheckpoints: [], mainline: ["h2e2"],
  lessonNodes: [
    { id: "diagram", title: "图53：飞刀选择", lessonKind: "flyknife" as const, ply: 1, prompt: "红方怎么走？", expectedMove: "车八平五", answer: "11.车八平五!", explanation: "立中", practiceLine: ["b0b1"], variationNotes: ["立中"] },
    { id: "defense", title: "实战应对：卒7进1", lessonKind: "practicalDefense" as const, ply: 1, prompt: "红方续着？", expectedMove: "兵三进一", answer: "12.兵三进一", explanation: "扩张" },
    { id: "trap", title: "陷阱：马7进6？", lessonKind: "trap" as const, ply: 1, prompt: "怎样反击？", expectedMove: "车二平四", answer: "车二平四", explanation: "多子", variationNotation: ["马7进6"], variationNotes: ["完整陷阱变化"] },
  ],
};
const startingPieces = [{ row: 9, col: 1, color: "red" as const, kind: "rook", label: "车" }, { row: 0, col: 0, color: "black" as const, kind: "rook", label: "车" }];
const firstStep = { fen: "fen w - - 0 1", notation: "炮二平五", movedBy: "红方" as const, from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, pieces: startingPieces, status: "进行中" };

describe("Game53StudyDialog", () => {
  it("presents flyknife, calculation and trap tabs while answers stay hidden", async () => {
    vi.spyOn(chessPlatform, "getBookTopicDetail").mockResolvedValue(detail);
    vi.spyOn(chessPlatform, "previewLine").mockResolvedValue([firstStep]);
    const user = userEvent.setup();
    render(<Game53StudyDialog onClose={vi.fn()} onOpenMasterGame={vi.fn(async () => undefined)} onPlanSaved={vi.fn()} onOpenEngineSettings={vi.fn()} enginePath="" threads={2} hashMb={256}/>);
    expect(await screen.findByRole("button", { name: "飞刀" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拆棋" })).toBeTruthy(); expect(screen.getByRole("button", { name: "陷阱" })).toBeTruthy();
    expect(screen.getByText("先思考后揭示")).toBeTruthy(); expect(screen.queryByText("11.车八平五!")).toBeNull(); expect(screen.queryByText("优化：Pikafish 最佳防守")).toBeNull();
    await user.click(screen.getByRole("button", { name: "陷阱" })); expect(await screen.findByText("怎样反击？")).toBeTruthy();
  });

  it("uses a temporary preview line and reveals the book answer only after submission", async () => {
    vi.spyOn(chessPlatform, "getBookTopicDetail").mockResolvedValue(detail);
    const preview = vi.spyOn(chessPlatform, "previewLine").mockImplementation(async (fen, moves) => {
      if (fen.startsWith("rnbakabnr")) return [firstStep];
      return moves.length === 1
        ? [{ ...firstStep, fen: "fen b - - 0 1", notation: "车八进一" }]
        : [{ ...firstStep, fen: "fen b - - 0 1", notation: "车八进一" }, { ...firstStep, fen: "fen w - - 0 2", notation: "车1进1", movedBy: "黑方", from: { row: 0, col: 0 }, to: { row: 1, col: 0 }, pieces: startingPieces }];
    });
    const user = userEvent.setup();
    render(<Game53StudyDialog onClose={vi.fn()} onOpenMasterGame={vi.fn(async () => undefined)} onPlanSaved={vi.fn()} onOpenEngineSettings={vi.fn()} enginePath="" threads={2} hashMb={256}/>);
    await screen.findByRole("button", { name: "飞刀" });
    await screen.findByRole("button", { name: "推演棋盘第 10 行第 2 列" });
    await user.click(screen.getByRole("button", { name: "推演棋盘第 10 行第 2 列" })); await user.click(screen.getByRole("button", { name: "推演棋盘第 9 行第 2 列" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "推演棋盘第 1 行第 1 列" })); await user.click(screen.getByRole("button", { name: "推演棋盘第 2 行第 1 列" }));
    await waitFor(() => expect(screen.getByText(/已推演 2\/8 手/)).toBeTruthy()); await user.click(screen.getByRole("button", { name: "提交核对" }));
    expect(screen.getByText("书载答案与拆解")).toBeTruthy(); expect(screen.getAllByText("11.车八平五!")).toHaveLength(2); expect(preview.mock.calls.some(([, moves]) => Array.isArray(moves) && moves.length === 2)).toBe(true);
  });
});

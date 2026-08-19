import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { U10TrainingDialog } from "./U10TrainingDialog";
import type { GuidedAnalysisStart, LearningProfile, PreviewLineStep } from "./platform";

const profile: LearningProfile = {
  id: "default", childName: "小棋手", level: "全国少年赛", ageGroup: "U10", sessionMinutes: 40, coachMode: "家长陪练", cycleWeeks: 12, personalRatio: 60, thematicRatio: 40, currentWeek: 3, createdAt: "2026-08-11T00:00:00Z", updatedAt: "2026-08-11T00:00:00Z",
};
const start: GuidedAnalysisStart = {
  session: { id: "session-1", gameId: "game-1", problemNodeId: "move-1", reportSignature: "root:move-1", fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", phase: "middle", status: "thinking", answerHidden: true, startedAt: "2026-08-11T00:00:00Z" },
  board: { fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", rootSideToMove: "红方", sideToMove: "红方", status: "进行中", pieces: [], history: [], continuation: [], branches: [], title: "测试棋局", note: "", playable: true },
};
const positionedStart: GuidedAnalysisStart = {
  ...start,
  board: {
    ...start.board,
    pieces: [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
    ],
  },
};
const preview = (moves: string[]): PreviewLineStep[] => moves.map((_move, index) => ({
  fen: `4k4/9/9/9/9/9/9/9/4K4/9 ${index % 2 === 0 ? "b" : "w"} - - 0 1`,
  notation: index === 0 ? "帅五进一" : "将5进1",
  movedBy: index % 2 === 0 ? "红方" : "黑方",
  from: index % 2 === 0 ? { row: 9, col: 4 } : { row: 0, col: 4 },
  to: index % 2 === 0 ? { row: 8, col: 4 } : { row: 1, col: 4 },
  pieces: index % 2 === 0
    ? [{ row: 8, col: 4, color: "red", kind: "king", label: "帅" }, { row: 0, col: 4, color: "black", kind: "king", label: "将" }]
    : [{ row: 8, col: 4, color: "red", kind: "king", label: "帅" }, { row: 1, col: 4, color: "black", kind: "king", label: "将" }],
  status: "进行中",
}));
const props = () => ({ start: positionedStart, profile, busy: false, onClose: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(), onPreview: vi.fn().mockImplementation(async (moves: string[]) => preview(moves)), onParseChineseLine: vi.fn().mockResolvedValue({ moves: ["e0e1", "e9e8"], steps: preview(["e0e1", "e9e8"]) }), pieceAsset: () => "/skins/default/rk.png", boardAsset: "/skins/default/board.png", onSaveProfile: vi.fn() });

afterEach(cleanup);

describe("U10TrainingDialog", () => {
  it("hides engine answers and makes board play the primary prediction entry", () => {
    const view = render(<U10TrainingDialog {...props()}/>);
    expect(screen.getByText("答案已隐藏")).toBeTruthy();
    expect(screen.queryByText(/引擎候选/)).toBeNull();
    expect(screen.getByText("我的推演")).toBeTruthy();
    expect(screen.queryByLabelText("预测线路")).toBeNull();
    expect(screen.getByRole("button", { name: "手动补充中文线路" })).toBeTruthy();
    expect(screen.getByLabelText("U10 临时推演棋盘")).toBeTruthy();
    expect(screen.getByLabelText("U10 临时推演走子区域")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
    expect(view.container.querySelector(".u10-board-hit-grid")).not.toBeNull();
    expect(view.container.querySelectorAll(".u10-board-hit-target")).toHaveLength(90);
    expect(view.container.querySelector(".u10-board-hit-target")?.getAttribute("style")).toContain("left: 6.696428571428571%");
    expect(view.container.querySelector(".u10-board-hit-target")?.getAttribute("style")).toContain("top: 5.403225806451613%");
  });

  it("keeps the canonical fallback board visible if a skin asset is unavailable", () => {
    const input = props();
    const view = render(<U10TrainingDialog {...input} boardAsset=""/>);

    expect(view.container.querySelector(".link-mini-board.with-board-asset")).toBeNull();
    expect(view.container.querySelector(".link-mini-board-grid")).not.toBeNull();
  });

  it("uses only red corner markers for temporary U10 moves", async () => {
    const view = render(<U10TrainingDialog {...props()}/>);
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();

    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    expect(await screen.findByText("红方 · 帅五进一")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-corner-source")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-corner-target")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-to")).toBeNull();
    expect(view.container.querySelectorAll(".link-mini-piece.move-animate")).toHaveLength(0);
    expect(view.container.querySelectorAll(".link-mini-piece.move-arrive")).toHaveLength(0);
  });

  it("requires an own-side source piece before it creates a temporary move", async () => {
    const input = props();
    render(<U10TrainingDialog {...input} start={positionedStart}/>);

    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 4 列"));
    expect(screen.getByText("请先选择轮到红方走的棋子")).toBeTruthy();
    expect(document.querySelector(".link-mini-selected-square")).toBeNull();
    expect(input.onPreview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    expect(screen.getByText("请先选择轮到红方走的棋子")).toBeTruthy();
    expect(input.onPreview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    expect(document.querySelector(".link-mini-selected-square")).not.toBeNull();
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 1 列"));
    expect(document.querySelector(".link-mini-selected-square")?.innerHTML).toContain("translate(75 1168)");
    expect(input.onPreview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 1 列"));
    expect(input.onPreview).toHaveBeenLastCalledWith(["a0a1"]);
  });

  it("shows only the selected source marker while choosing the next temporary move", async () => {
    const view = render(<U10TrainingDialog {...props()}/>);
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));

    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).not.toBeNull();
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));

    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-arrow")).toBeNull();
  });

  it("keeps prior move markers hidden until an asynchronous next preview resolves", async () => {
    const input = props();
    let resolveSecondPreview: ((steps: PreviewLineStep[]) => void) | undefined;
    input.onPreview.mockImplementation((moves: string[]) => {
      if (moves.length === 2) {
        return new Promise<PreviewLineStep[]>((resolve) => {
          resolveSecondPreview = resolve;
        });
      }
      return Promise.resolve(preview(moves));
    });
    const view = render(<U10TrainingDialog {...input}/>);

    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    await screen.findByText("红方 · 帅五进一");

    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();
    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).toBeNull();

    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));
    expect(input.onPreview).toHaveBeenLastCalledWith(["e0e1", "e9e8"]);
    expect(view.container.querySelector(".link-mini-selected-square")).toBeNull();
    expect(view.container.querySelector(".link-mini-last-move.corner-marker")).toBeNull();
    expect(screen.getByLabelText("推演棋盘第 1 行第 5 列").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "撤回一步" }).getAttribute("disabled")).not.toBeNull();

    resolveSecondPreview?.(preview(["e0e1", "e9e8"]));
    expect(await screen.findByText("黑方 · 将5进1")).toBeTruthy();
    expect(view.container.querySelector(".link-mini-selected-square")).toBeNull();
    expect(view.container.querySelectorAll(".link-mini-last-move.corner-marker")).toHaveLength(1);
  });

  it("clears a pending source selection together with the temporary prediction", async () => {
    const view = render(<U10TrainingDialog {...props()}/>);
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    expect(view.container.querySelector(".link-mini-selected-square")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "清空" }));

    expect(view.container.querySelector(".link-mini-selected-square")).toBeNull();
    expect(screen.getByText("请直接在棋盘上走出你的想法")).toBeTruthy();
  });

  it("uses two board moves as the minimum and renders Chinese step tags", async () => {
    const input = props();
    render(<U10TrainingDialog {...input}/>);
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));
    expect(await screen.findByText("红方 · 帅五进一")).toBeTruthy();
    expect(screen.getByText("已推演 2/8 手，可提交")).toBeTruthy();
    expect(input.onPreview).toHaveBeenLastCalledWith(["e0e1", "e9e8"]);
  });

  it("parses the collapsed Chinese manual supplement into the preview", async () => {
    const input = props();
    render(<U10TrainingDialog {...input}/>);
    await userEvent.click(screen.getByRole("button", { name: "手动补充中文线路" }));
    fireEvent.change(screen.getByLabelText("手动补充中文线路"), { target: { value: "帅五进一 将5进1" } });
    await userEvent.click(screen.getByRole("button", { name: "应用到棋盘" }));
    expect(input.onParseChineseLine).toHaveBeenCalledWith(["帅五进一", "将5进1"]);
    expect(await screen.findByText("黑方 · 将5进1")).toBeTruthy();
  });

  it("reviews an earlier step without deleting the later temporary line", async () => {
    const input = props();
    render(<U10TrainingDialog {...input}/>);
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));
    await userEvent.click(await screen.findByText("红方 · 帅五进一"));
    expect(screen.getByText("已推演 2/8 手，可提交")).toBeTruthy();
    expect(screen.getByRole("button", { name: "从第 1 步继续推演" })).toBeTruthy();
    expect(input.onPreview).toHaveBeenLastCalledWith(["e0e1", "e9e8"]);
  });

  it("flips the board while preserving the canonical move coordinates", async () => {
    const input = props();
    const view = render(<U10TrainingDialog {...input}/>);
    await userEvent.click(screen.getByRole("button", { name: "翻转棋盘" }));
    expect(view.container.querySelector(".u10-board-hit-target")?.getAttribute("data-square")).toBe("9-8");
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));
    expect(input.onPreview).toHaveBeenLastCalledWith(["e0e1"]);
  });

  it("uses the screenshot's black-at-bottom view as the initial U10 board perspective", () => {
    render(<U10TrainingDialog {...props()} initialReversed/>);
    expect(screen.getByRole("button", { name: "黑方在下" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "红方在下" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("cancels an unfinished temporary line before the parent restores research mode", async () => {
    const input = props();
    render(<U10TrainingDialog {...input}/>);

    await userEvent.click(screen.getByRole("button", { name: "关闭 U10 训练" }));

    expect(input.onCancel).toHaveBeenCalledWith("session-1");
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it("shows non-answer thinking guides and counts each guide only once", async () => {
    const input = props();
    input.onSubmit.mockResolvedValue({ result: { resultKind: "direction", resultLabel: "方向正确", score: 80, lines: [], theorySignals: [], trainingAdvice: "继续复练" } });
    input.onParseChineseLine.mockImplementation(async (notation: string[]) => ({ moves: notation[0] === "将5进1" ? ["e9e8"] : ["e0e1"], steps: preview(["e0e1"]) }));
    render(<U10TrainingDialog {...input}/>);
    const guide = screen.getAllByRole("button", { name: "想一想" })[0];
    await userEvent.click(guide);
    expect(screen.getByRole("note", { name: "威胁检查" })).toBeTruthy();
    expect(screen.queryByText("引擎候选")).toBeNull();
    await userEvent.click(guide);
    await userEvent.click(guide);
    fireEvent.change(screen.getByLabelText("对方直接威胁"), { target: { value: "对方可能将军" } });
    fireEvent.change(screen.getByLabelText("强制手段"), { target: { value: "先看将军" } });
    fireEvent.change(screen.getByLabelText("最差子"), { target: { value: "边马" } });
    fireEvent.change(screen.getByLabelText("候选着 1"), { target: { value: "帅五进一" } });
    fireEvent.change(screen.getByLabelText("候选着 2"), { target: { value: "将5进1" } });
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));
    await userEvent.click(screen.getByRole("button", { name: "提交并揭示答案" }));
    expect(input.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hintsUsed: 1 }));
    expect(await screen.findByText("本题使用了 1 次思路提示，不影响得分。")).toBeTruthy();
  });

  it("allows submitting with fewer than three candidates and keeps the shortage visible", async () => {
    const input = props();
    input.onSubmit.mockResolvedValue({ result: { resultKind: "direction", resultLabel: "方向正确", score: 82, lines: [], theorySignals: ["候选不足", "候选着计算"], trainingAdvice: "补足走一思三候选。" } });
    render(<U10TrainingDialog {...input}/>);

    fireEvent.change(screen.getByLabelText("对方直接威胁"), { target: { value: "有将军" } });
    fireEvent.change(screen.getByLabelText("强制手段"), { target: { value: "先看吃子" } });
    fireEvent.change(screen.getByLabelText("最差子"), { target: { value: "边车" } });
    await userEvent.click(screen.getByLabelText("推演棋盘第 10 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 9 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 1 行第 5 列"));
    await userEvent.click(screen.getByLabelText("推演棋盘第 2 行第 5 列"));

    expect(screen.getByText(/当前只有 1 个候选/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "提交并揭示答案" }));

    expect(input.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ candidates: ["e0e1"] }));
    expect(await screen.findByText("候选不足")).toBeTruthy();
    expect(screen.getByText("候选着计算")).toBeTruthy();
  });
});

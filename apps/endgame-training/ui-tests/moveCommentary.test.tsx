import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoveCommentaryPanel } from "../src/MoveCommentaryPanel";
import type { MoveFacts } from "../../../packages/move-commentary";

const mocks = vi.hoisted(() => ({ board: vi.fn(), facts: vi.fn(), analyze: vi.fn(), speak: vi.fn(), stop: vi.fn(), feedback: vi.fn() }));
vi.mock("../src/wasm", () => ({
  boardAt: mocks.board, moveLineFacts: mocks.facts, queryCommentaryAnalysis: mocks.analyze,
  hasLocalPikafish: () => true, localVerificationIdentity: async () => "engine:v1",
}));
vi.mock("../src/commentarySpeech", () => ({ speakCommentary: mocks.speak, stopCommentarySpeech: mocks.stop }));
vi.mock("../src/moveFeedback", () => ({ cancelTrainingFeedback: mocks.feedback }));

const fact: MoveFacts = { beforeFen: "before", afterFen: "after", iccs: "h2e2", notation: "炮二平五",
  mover: { color: "Red", kind: "Cannon" }, from: { row: 7, col: 7 }, to: { row: 7, col: 4 },
  captured: null, wasInCheck: false, resolvesCheck: false, givesCheck: false, status: "Ongoing",
  attacksBefore: [], attacksAfter: [], opponentCapturesAfter: [], materialBefore: [], materialAfter: [] };
const props = { context: "a", startingFen: "start", moves: ["h2e2"], ruleMode: "domestic2020" as const,
  allowed: true, accessScope: "teacher", moveTimeMs: 2000, multiPv: 3, isAllowed: () => true };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.board.mockResolvedValue({ fen: "before" });
  mocks.facts.mockImplementation(async (_: string, moves: string[]) => moves.map((move, i) => ({ ...fact, iccs: move, notation: i ? "马８进７" : fact.notation, mover: { ...fact.mover, color: i % 2 ? "Black" : "Red" } })));
  mocks.analyze.mockResolvedValue({ depth: 18, pv: ["h9g7"] });
  mocks.stop.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("read-only move teaching", () => {
  it("requires manual generation and manual speech and includes all five sections", async () => {
    render(<MoveCommentaryPanel {...props}/>);
    expect(mocks.facts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("讲解这步"));
    await screen.findByText("红方 · 炮二平五");
    for (const title of ["局面问题", "这步作用", "对手应对", "后续计划", "注意事项"]) expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText("后续变化（双方共 2 步）")).toBeTruthy();
    expect(screen.getByText("己方未被将军，暂无直接吃子机会。")).toBeTruthy();
    expect(screen.queryByText(/参考线第|半回合|h2|e2/)).toBeNull();
    expect(mocks.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("朗读讲解"));
    await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith(expect.stringContaining("炮二平五"), 1));
    expect(mocks.speak.mock.calls[0][0]).not.toMatch(/h2|e2|半回合|参考线第/);
    expect(mocks.feedback).toHaveBeenCalled();
  });

  it("does not compute or speak for a restricted exercise, even when given a target", async () => {
    render(<MoveCommentaryPanel {...props} allowed={false} target={{ context: "a", moves: props.moves, id: 1 }}/>);
    await act(async () => {});
    expect(screen.queryByText("讲解这步")).toBeNull();
    expect(mocks.board).not.toHaveBeenCalled(); expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("rejects late results when navigating to a different position", async () => {
    let finish!: (value: { depth: number; pv: string[] }) => void;
    mocks.analyze.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ui = render(<MoveCommentaryPanel {...props}/>);
    fireEvent.click(screen.getByText("讲解这步"));
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalled());
    const signal = mocks.analyze.mock.calls[0][3] as AbortSignal;
    ui.rerender(<MoveCommentaryPanel {...props} context="b" moves={[]}/>);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ depth: 26, pv: ["h9g7"] }); });
    expect(screen.queryByText("红方 · 炮二平五")).toBeNull();
  });

  it("hides cached content immediately on permission loss and stops voice", async () => {
    const ui = render(<MoveCommentaryPanel {...props}/>);
    fireEvent.click(screen.getByText("讲解这步")); await screen.findByText("红方 · 炮二平五");
    mocks.speak.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByText("朗读讲解"));
    ui.rerender(<MoveCommentaryPanel {...props} allowed={false} accessScope="student"/>);
    expect(screen.queryByText("红方 · 炮二平五")).toBeNull(); expect(mocks.stop).toHaveBeenCalled();
    ui.rerender(<MoveCommentaryPanel {...props} context="new-scope"/>);
    expect(screen.queryByText("红方 · 炮二平五")).toBeNull();
  });

  it("binds historical requests to their own complete path without navigating or saving", async () => {
    render(<MoveCommentaryPanel {...props} moves={["h2e2", "h9g7", "b0c2"]} target={{ context: "a", moves: ["h2e2", "h9g7"], id: 1 }}/>);
    await screen.findByText("红方 · 炮二平五");
    expect(mocks.board).toHaveBeenCalledWith("start", ["h2e2"], "domestic2020");
    expect(mocks.facts).toHaveBeenCalledWith("before", ["h9g7"]);
  });

  it("checks current permission again after asynchronous work", async () => {
    let allowed = true, finish!: (value: { fen: string }) => void;
    mocks.board.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MoveCommentaryPanel {...props} isAllowed={() => allowed}/>);
    fireEvent.click(screen.getByText("讲解这步")); allowed = false;
    await act(async () => { finish({ fen: "before" }); });
    expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("does not replay an already consumed request when returning to an earlier node", async () => {
    const target = { context: "a", moves: props.moves, id: 1 }, consumed = vi.fn();
    const ui = render(<MoveCommentaryPanel {...props} target={target} onTargetConsumed={consumed}/>);
    await screen.findByText("红方 · 炮二平五");
    expect(consumed).toHaveBeenCalledWith(target);
    const reads = mocks.board.mock.calls.length;
    ui.rerender(<MoveCommentaryPanel {...props} context="b" target={target}/>);
    ui.rerender(<MoveCommentaryPanel {...props} target={target}/>);
    await act(async () => {});
    expect(mocks.board).toHaveBeenCalledTimes(reads);
    expect(screen.queryByText("红方 · 炮二平五")).toBeNull();
  });

  it("rejects a candidate from an old root before running a new search", async () => {
    render(<MoveCommentaryPanel {...props} target={{ context: "a", moves: props.moves, id: 2,
      reference: { fen: "old-position", line: { depth: 26, pv: props.moves } } }}/>);
    await screen.findByText("候选对应的局面已变化，请重新分析后再讲解。");
    expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("retains text when speech is unavailable and stops on background", async () => {
    mocks.speak.mockRejectedValue(Error("缺少离线中文语音包"));
    render(<MoveCommentaryPanel {...props}/>);
    fireEvent.click(screen.getByText("讲解这步")); await screen.findByText("红方 · 炮二平五");
    fireEvent.click(screen.getByText("朗读讲解")); await screen.findByText("缺少离线中文语音包");
    expect(screen.getByText("这步作用")).toBeTruthy();
    const stops = mocks.stop.mock.calls.length;
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(mocks.stop.mock.calls.length).toBeGreaterThan(stops);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
});

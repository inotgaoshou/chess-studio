import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualMoveSuggestion } from "../../endgame-training/src/ManualMoveSuggestion";
import { chineseLine } from "../../endgame-training/src/wasm";
vi.mock("../../endgame-training/src/wasm", () => ({ chineseLine: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("manual report Chinese suggestions", () => {
  it.each([
    ["red-before", "h0g2", "马二进三"],
    ["black-before", "h9g7", "马8进7"],
    ["custom-before", "a5a6", "前车进一"],
  ])("uses the supplied pre-move FEN (%s)", async (fen, move, notation) => {
    vi.mocked(chineseLine).mockResolvedValueOnce([notation]);
    render(<ManualMoveSuggestion gameId="old-cache" fen={fen} move={move}/>);
    expect(await screen.findByText(`· 建议 ${notation}`)).toBeTruthy();
    expect(chineseLine).toHaveBeenCalledWith(fen, [move]);
    expect(screen.queryByText(new RegExp(move))).toBeNull();
  });
  it("reuses cached notation across reports but not across positions", async () => {
    vi.mocked(chineseLine).mockResolvedValue(["马二进三"]);
    const { rerender } = render(<ManualMoveSuggestion gameId="one" fen="cache-before" move="h0g2"/>);
    await screen.findByText("· 建议 马二进三");
    rerender(<ManualMoveSuggestion gameId="two" fen="cache-before" move="h0g2"/>);
    await screen.findByText("· 建议 马二进三");
    expect(chineseLine).toHaveBeenCalledTimes(1);
    rerender(<ManualMoveSuggestion gameId="two" fen="different-before" move="h0g2"/>);
    await waitFor(() => expect(chineseLine).toHaveBeenCalledTimes(2));
  });
  it.each([true, false])("never exposes a failed/raw translation (reject=%s)", async (reject) => {
    if (reject) vi.mocked(chineseLine).mockRejectedValueOnce(new Error("illegal move"));
    else vi.mocked(chineseLine).mockResolvedValueOnce(["h0g2"]);
    render(<ManualMoveSuggestion gameId="invalid" fen={`invalid-${reject}`} move="h0g2"/>);
    expect(await screen.findByText("· 建议着法暂不可用")).toBeTruthy();
    expect(screen.queryByText(/h0g2/)).toBeNull();
  });
  it("handles a legacy summary without FEN without guessing the current position", () => {
    render(<ManualMoveSuggestion gameId="legacy-missing-fen" fen="" move="h0g2"/>);
    expect(screen.getByText("· 建议着法暂不可用")).toBeTruthy();
    expect(chineseLine).not.toHaveBeenCalled();
  });
  it("omits suggestions when the engine supplied no best move", () => {
    const { container } = render(<ManualMoveSuggestion gameId="no-move" fen="position" move=""/>);
    expect(container.textContent).toBe("");
    expect(chineseLine).not.toHaveBeenCalled();
  });
  it("discards an older report result after switching games", async () => {
    let finish!: (value: string[]) => void;
    vi.mocked(chineseLine).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(["炮二平五"]);
    const { rerender } = render(<ManualMoveSuggestion gameId="old" fen="pending-old" move="h0g2"/>);
    rerender(<ManualMoveSuggestion gameId="new" fen="pending-new" move="h2e2"/>);
    await screen.findByText("· 建议 炮二平五");
    await act(async () => finish(["马二进三"]));
    expect(screen.queryByText(/马二进三/)).toBeNull();
    expect(screen.getByText("· 建议 炮二平五")).toBeTruthy();
  });
});

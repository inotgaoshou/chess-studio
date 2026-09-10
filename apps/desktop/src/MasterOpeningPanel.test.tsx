import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MasterOpeningPanel } from "./MasterOpeningPanel";

const move = { iccs: "h2e2", notation: "炮二平五", samples: 10, redWins: 5, draws: 3, blackWins: 2 };
const game = {
  id: "game-1",
  canonicalFingerprint: "fingerprint-1",
  title: "广东 陈松顺 胜 江苏 惠颂祥",
  redPlayer: "陈松顺",
  blackPlayer: "惠颂祥",
  result: "1-0",
  eventName: "测试赛",
  roundName: "第1轮",
  gameDate: "2026-01-01",
  opening: "中炮",
  moveCount: 72,
};

afterEach(cleanup);

describe("MasterOpeningPanel", () => {
  it("loads matching games for the current position and previews candidate moves", async () => {
    const queryMoves = vi.fn(async () => [move]);
    const queryGames = vi.fn(async () => [game]);
    const resolveMoveFen = vi.fn(async () => "after-h2e2");
    const onPreviewMove = vi.fn();
    const onAddMove = vi.fn();

    render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={queryMoves}
      queryGames={queryGames}
      resolveMoveFen={resolveMoveFen}
      onPreviewMove={onPreviewMove}
      onAddMove={onAddMove}
      onOpenExplorer={() => undefined}
    />);

    expect(await screen.findByText("广东 陈松顺 胜 江苏 惠颂祥")).toBeTruthy();
    expect(queryGames).toHaveBeenCalledWith("start");
    fireEvent.click(await screen.findByText("炮二平五"));

    expect(onPreviewMove).toHaveBeenCalledWith("h2e2", "炮二平五");
    expect(resolveMoveFen).toHaveBeenCalledWith("start", "h2e2");
    expect(await screen.findByText(/走 炮二平五 后/)).toBeTruthy();
    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("after-h2e2"));
    expect(onAddMove).not.toHaveBeenCalled();
  });
});

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
  opening: "2026年全国象棋锦标赛（团体）",
  openingCode: "C01",
  openingName: "中炮对屏风马",
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
    const onOpenGame = vi.fn();

    const { container } = render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={queryMoves}
      queryGames={queryGames}
      resolveMoveFen={resolveMoveFen}
      onPreviewMove={onPreviewMove}
      onAddMove={onAddMove}
      onOpenExplorer={() => undefined}
      onOpenGame={onOpenGame}
    />);

    expect(await screen.findByLabelText("陈松顺 胜 惠颂祥")).toBeTruthy();
    expect(container.querySelector(".reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".reference-player.black mark")).toBeTruthy();
    expect(container.querySelector(".reference-result.win")?.textContent).toBe("胜");
    expect(queryGames).toHaveBeenCalledWith("start");
    fireEvent.click(await screen.findByText("炮二平五"));

    expect(onPreviewMove).toHaveBeenCalledWith("h2e2", "炮二平五");
    expect(resolveMoveFen).toHaveBeenCalledWith("start", "h2e2");
    expect(await screen.findByText(/走 炮二平五 后/)).toBeTruthy();
    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("after-h2e2"));
    expect(onAddMove).not.toHaveBeenCalled();
    expect(screen.queryByText("对局台待命")).toBeNull();
    fireEvent.click(screen.getByLabelText("陈松顺 胜 惠颂祥").closest("button")!);
    expect(onOpenGame).toHaveBeenCalledWith("game-1");
  });

  it("keeps compact mode minimal and detail mode expanded", async () => {
    const { container } = render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
    />);

    expect(await screen.findByLabelText("陈松顺 胜 惠颂祥")).toBeTruthy();
    expect(screen.getByRole("button", { name: "简洁" }).className).toContain("active");
    expect(screen.queryByText("广东 陈松顺 胜 江苏 惠颂祥")).toBeNull();
    expect(screen.queryByText(/测试赛/)).toBeNull();
    expect(screen.queryByText(/72 手/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "详细" }));

    expect(screen.getByRole("button", { name: "详细" }).className).toContain("active");
    expect(screen.getByText("广东 陈松顺 胜 江苏 惠颂祥")).toBeTruthy();
    expect(screen.getByText(/测试赛/)).toBeTruthy();
    expect(screen.getByText(/72 手/)).toBeTruthy();
    expect(screen.getByText("C01 · 中炮对屏风马")).toBeTruthy();
    expect(container.querySelector(".master-opening-player-outcome .reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".master-opening-player-outcome .reference-player.black mark")).toBeTruthy();
    expect(screen.queryByText(/C01 · 2026年全国/)).toBeNull();
  });

  it("uses title text to show compact person-level winner labels", async () => {
    const schoolGame = {
      ...game,
      id: "school-game",
      title: "上海财经大学 沈思凡 胜 安徽财经大学 陈思源",
      redPlayer: "上海财经大学沈?",
      blackPlayer: "安徽财经大学陈?",
      result: "1-0",
    };

    render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={async () => [move]}
      queryGames={async () => [schoolGame]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
    />);

    expect(await screen.findByLabelText("沈思凡 胜 陈思源")).toBeTruthy();
    expect(screen.queryByText(/上海财经大学沈/)).toBeNull();
    expect(screen.queryByText(/安徽财经大学陈/)).toBeNull();
  });

  it("keeps side markers when player names are unknown", async () => {
    const unknownGame = {
      ...game,
      id: "unknown-game",
      title: "",
      redPlayer: "",
      blackPlayer: "",
      result: "",
    };
    const { container } = render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={async () => [move]}
      queryGames={async () => [unknownGame]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
    />);

    expect(await screen.findByLabelText("红方未详 对 黑方未详")).toBeTruthy();
    expect(container.querySelector(".reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".reference-player.black mark")).toBeTruthy();
    expect(container.querySelector(".reference-result.unknown")?.textContent).toBe("对");
  });
});

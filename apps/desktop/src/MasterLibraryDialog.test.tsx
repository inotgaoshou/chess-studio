import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MasterLibraryDialog } from "./MasterLibraryDialog";
import type { MasterGameSummaryDto, MasterPlayerDto, SyncAccountDto } from "./platform";

const signedIn: SyncAccountDto = {
  serverUrl: "http://127.0.0.1:8080",
  userId: "user-1",
  email: "user@example.com",
  status: "signedIn",
};

const players: MasterPlayerDto[] = [
  { id: "zhao", name: "赵鑫鑫", sourceSite: "gdchess.com", sourcePlayerId: "0074", profileUrl: "http://www.gdchess.com/", gameCount: 1740 },
  { id: "wang", name: "王天一", sourceSite: "gdchess.com", sourcePlayerId: "0312", profileUrl: "http://www.gdchess.com/", gameCount: 1568 },
];

const games: MasterGameSummaryDto[] = [
  {
    id: "game-1",
    title: "赵鑫鑫 先胜 王天一",
    redPlayer: "赵鑫鑫",
    blackPlayer: "王天一",
    masterSide: "red",
    eventName: "全国象棋甲级联赛",
    gameDate: "2026-08-05",
    result: "1-0",
    moveCount: 83,
    sourceUrl: "http://www.gdchess.com/gview.asp?id=1",
  },
];
const stats = { totalPlayers: 13_567, matchedPlayers: 13_567 };

afterEach(cleanup);

describe("MasterLibraryDialog", () => {
  it("shows the sign-in requirement before querying the server library", () => {
    const listPlayers = vi.fn(async () => players);
    render(<MasterLibraryDialog
      account={{ serverUrl: signedIn.serverUrl, status: "signedOut" }}
      listPlayers={listPlayers}
      getStats={vi.fn(async () => stats)}
      listGames={vi.fn(async () => games)}
      onOpenGame={vi.fn(async () => undefined)}
      onClose={vi.fn()}
    />);

    expect(screen.getByText("请先登录同步账号")).toBeTruthy();
    expect(listPlayers).not.toHaveBeenCalled();
  });

  it("lists masters, hides raw sources, and opens a selected server game for analysis", async () => {
    const user = userEvent.setup();
    const onOpenGame = vi.fn(async () => undefined);
    const listPlayers = vi.fn(async () => players);
    const listGames = vi.fn(async () => games);
    render(<MasterLibraryDialog
      account={signedIn}
      listPlayers={listPlayers}
      getStats={vi.fn(async () => stats)}
      listGames={listGames}
      onOpenGame={onOpenGame}
      onClose={vi.fn()}
    />);

    const playerList = screen.getByLabelText("大师列表");
    await waitFor(() => expect(within(playerList).getByText("赵鑫鑫")).toBeTruthy());
    expect(listPlayers).toHaveBeenCalledWith("", { limit: 8, offset: 0 });
    expect(await screen.findByText("赵鑫鑫 先胜 王天一")).toBeTruthy();
    expect(listGames).toHaveBeenCalledWith("zhao", "", { limit: 20, offset: 0 });
    const gameCard = screen.getByText("赵鑫鑫 先胜 王天一").closest("article");
    expect(gameCard).toBeTruthy();
    expect(within(gameCard!).getByText(/全国象棋甲级联赛/)).toBeTruthy();
    expect(screen.queryByText(/gdchess\.com/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "分析打分" }));

    await waitFor(() => expect(onOpenGame).toHaveBeenCalledWith("game-1", { analyze: true }));
  });

  it("shows the server-backed player total and updates it for a search", async () => {
    const user = userEvent.setup();
    const getStats = vi.fn(async (query?: string) => query
      ? { totalPlayers: 13_567, matchedPlayers: 48 }
      : stats);
    render(<MasterLibraryDialog
      account={signedIn}
      listPlayers={vi.fn(async () => players)}
      getStats={getStats}
      listGames={vi.fn(async () => games)}
      onOpenGame={vi.fn(async () => undefined)}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("已收录 13,567 位棋手")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("搜索大师，如 赵鑫鑫 / 王天一"), "陈松顺");
    expect(await screen.findByText("匹配 48 位棋手 · 全库 13,567 位")).toBeTruthy();
    expect(getStats).toHaveBeenLastCalledWith("陈松顺");
  });

  it("pages through the selected master's games with limit and offset", async () => {
    const user = userEvent.setup();
    const listGames = vi.fn(async () => games);
    render(<MasterLibraryDialog
      account={signedIn}
      listPlayers={vi.fn(async () => players)}
      getStats={vi.fn(async () => stats)}
      listGames={listGames}
      onOpenGame={vi.fn(async () => undefined)}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("赵鑫鑫 先胜 王天一")).toBeTruthy();
    const gamePagination = screen.getByLabelText("棋谱分页");
    await user.click(within(gamePagination).getByRole("button", { name: "下一页" }));

    await waitFor(() => expect(listGames).toHaveBeenLastCalledWith("zhao", "", { limit: 20, offset: 20 }));
    await user.click(within(gamePagination).getByRole("button", { name: "末页" }));
    await waitFor(() => expect(listGames).toHaveBeenLastCalledWith("zhao", "", { limit: 20, offset: 1720 }));
    await user.click(within(gamePagination).getByRole("button", { name: "首页" }));
    await waitFor(() => expect(listGames).toHaveBeenLastCalledWith("zhao", "", { limit: 20, offset: 0 }));
  });

  it("opens a master game without starting analysis when the user only wants to view it", async () => {
    const user = userEvent.setup();
    const onOpenGame = vi.fn(async () => undefined);
    render(<MasterLibraryDialog
      account={signedIn}
      listPlayers={vi.fn(async () => players)}
      getStats={vi.fn(async () => stats)}
      listGames={vi.fn(async () => games)}
      onOpenGame={onOpenGame}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("赵鑫鑫 先胜 王天一")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "打开棋谱" }));

    await waitFor(() => expect(onOpenGame).toHaveBeenCalledWith("game-1", { analyze: false }));
  });

  it("keeps the selected game button busy while opening the master game", async () => {
    const user = userEvent.setup();
    let resolveOpen: (() => void) | undefined;
    const onOpenGame = vi.fn(() => new Promise<void>((resolve) => {
      resolveOpen = resolve;
    }));
    render(<MasterLibraryDialog
      account={signedIn}
      listPlayers={vi.fn(async () => players)}
      getStats={vi.fn(async () => stats)}
      listGames={vi.fn(async () => games)}
      onOpenGame={onOpenGame}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("赵鑫鑫 先胜 王天一")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "分析打分" }));

    expect((screen.getByRole("button", { name: /分析中/ }) as HTMLButtonElement).disabled).toBe(true);
    resolveOpen?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "分析打分" })).toBeTruthy());
  });
});

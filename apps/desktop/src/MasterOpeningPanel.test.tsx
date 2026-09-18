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
    expect(queryGames).toHaveBeenCalledWith("start", { query: undefined, limit: 10, offset: 0 });
    fireEvent.click(await screen.findByText("炮二平五"));

    expect(onPreviewMove).toHaveBeenCalledWith("h2e2", "炮二平五");
    expect(await screen.findByText(/走 炮二平五 后/)).toBeTruthy();
    await waitFor(() => expect(resolveMoveFen).toHaveBeenCalledWith("start", "h2e2"));
    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("after-h2e2", { query: undefined, limit: 10, offset: 0 }));
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

  it("queries deeper matched games by master title keyword or player name", async () => {
    const titledGame = {
      ...game,
      id: "grandmaster-game",
      title: "特级大师 许银川 胜 象棋大师 柳大华",
      redPlayer: "许银川",
      blackPlayer: "柳大华",
    };
    const queryGames = vi.fn(async () => [game, titledGame]);

    render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={async () => [move]}
      queryGames={queryGames}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
    />);

    expect(await screen.findByLabelText("陈松顺 胜 惠颂祥")).toBeTruthy();
    expect(await screen.findByLabelText("许银川 胜 柳大华")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("按大师或棋手名字筛选命中棋谱"), { target: { value: "许银川" } });

    expect(screen.queryByLabelText("陈松顺 胜 惠颂祥")).toBeNull();
    expect(screen.getByLabelText("许银川 胜 柳大华")).toBeTruthy();
    expect(screen.getByText(/1\/2 条摘要/)).toBeTruthy();
    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("start", { query: "许银川", limit: 50, offset: 0 }));

    fireEvent.click(screen.getByRole("button", { name: "特大" }));

    expect(screen.queryByLabelText("陈松顺 胜 惠颂祥")).toBeNull();
    expect(screen.getByLabelText("许银川 胜 柳大华")).toBeTruthy();
    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("start", { query: "特级", limit: 50, offset: 0 }));

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByLabelText("陈松顺 胜 惠颂祥")).toBeTruthy();
    expect(screen.getByLabelText("许银川 胜 柳大华")).toBeTruthy();
  });

  it("loads more matched game pages from the database", async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({ ...game, id: `game-${index}`, title: `广东 陈松顺 胜 江苏 惠颂祥 ${index}` }));
    const secondPage = [{ ...game, id: "game-extra", title: "广东 许银川 胜 江苏 柳大华", redPlayer: "许银川", blackPlayer: "柳大华" }];
    const queryGames = vi.fn(async (_fen: string, options?: { offset?: number }) => options?.offset === 10 ? secondPage : firstPage);

    render(<MasterOpeningPanel
      fen="start"
      enabled
      queryMoves={async () => [move]}
      queryGames={queryGames}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
    />);

    expect(await screen.findByText("查看更多命中棋谱")).toBeTruthy();
    fireEvent.click(screen.getByText("查看更多命中棋谱"));

    await waitFor(() => expect(queryGames).toHaveBeenLastCalledWith("start", { query: undefined, limit: 10, offset: 10 }));
    expect(await screen.findByLabelText("许银川 胜 柳大华")).toBeTruthy();
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

  it("shows reference sparring controls and fires start/pause/score actions", async () => {
    const onUpdateSparring = vi.fn();
    const onStartSparring = vi.fn();
    const onPauseSparring = vi.fn();
    const onScoreSparring = vi.fn();
    const onRetrySparring = vi.fn();
    const onManualContinueSparring = vi.fn();

    const { rerender } = render(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{ status: "idle", userSide: "red", level: "ye6", delayMs: 600, autoReport: false }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    expect(await screen.findByLabelText("参考库随机对练")).toBeTruthy();
    expect(screen.queryByText("候选着法")).toBeNull();
    expect(screen.queryByText("命中棋谱")).toBeNull();
    expect(screen.queryByLabelText("打开完整布局探索")).toBeNull();
    fireEvent.change(screen.getByDisplayValue("业6"), { target: { value: "pro1" } });
    expect(onUpdateSparring).toHaveBeenCalledWith({ level: "pro1" });
    fireEvent.click(screen.getByLabelText("查看随机对练等级说明"));
    expect(screen.getByRole("dialog", { name: "随机对练等级说明" })).toBeTruthy();
    expect(screen.getByText("样本随机权重大，允许较多冷门招；明显亏分招仍可能出现。")).toBeTruthy();
    expect(screen.getByText("优先高样本、高胜率、低亏分候选；接近强实战训练对手。")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "随机对练等级说明" })).toBeNull();
    fireEvent.click(screen.getByLabelText("查看随机对练等级说明"));
    expect(screen.getByRole("dialog", { name: "随机对练等级说明" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "随机对练等级说明" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /开始/ }));
    expect(onStartSparring).toHaveBeenCalledWith({ userSide: "red", level: "ye6", delayMs: 600, autoReport: false });

    rerender(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{ status: "reference_thinking", userSide: "black", level: "pro1", delayMs: 250, autoReport: true, message: "参考库正在选招…" }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    expect(screen.getByText("参考库正在选招…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /暂停/ }));
    expect(onPauseSparring).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /专1我执黑方快结束打分/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /结束并打分/ }));
    expect(onScoreSparring).toHaveBeenCalled();

    rerender(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{
        status: "user_turn",
        userSide: "black",
        level: "pro1",
        delayMs: 250,
        autoReport: true,
        message: "云库走 炮二平五，轮到你。",
        lastChoice: {
          move: { ...move, samples: 0 },
          level: "pro1",
          source: "cloud",
          sourceLabel: "云库",
          warningMessage: "注意：本地参考实战库无候选，本步使用云库推荐，不代表本地实战统计。",
          fallbackReason: "本地参考实战库无候选",
          candidateCount: 2,
          totalWeight: 1,
          chosenWeight: 1,
          winRate: .56,
        },
      }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    expect(screen.getByText("来源：云库")).toBeTruthy();
    expect(screen.getByText("云库参考胜率 56%")).toBeTruthy();
    expect(screen.getByText("注意：本地参考实战库无候选，本步使用云库推荐，不代表本地实战统计。")).toBeTruthy();

    rerender(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{
        status: "user_turn",
        userSide: "black",
        level: "ye6",
        delayMs: 600,
        autoReport: false,
        lastChoice: {
          move,
          level: "ye6",
          source: "reference",
          sourceLabel: "参考库实战",
          intelligenceNote: "智能校正：已参考当前 Pikafish 候选，不等待引擎、不覆盖实战随机。",
          candidateCount: 3,
          totalWeight: 1,
          chosenWeight: 1,
          winRate: .09,
        },
      }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    expect(screen.getByText("10 样本 · 执方胜率 9%")).toBeTruthy();
    expect(screen.getByText("智能校正")).toBeTruthy();
    expect(screen.getByText("10 样本 · 执方胜率 9%").closest("small")?.getAttribute("title")).toContain("执方胜率按当前走子方统计");

    rerender(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{
        status: "user_turn",
        userSide: "black",
        level: "pro1",
        delayMs: 250,
        autoReport: false,
        lastChoice: {
          move: { ...move, samples: 0 },
          level: "pro1",
          source: "engine",
          sourceLabel: "Pikafish",
          warningMessage: "注意：参考库和云库均无候选，本步使用 Pikafish 引擎招，不是实战随机样本。",
          candidateCount: 1,
          totalWeight: 1,
          chosenWeight: 1,
          winRate: .5,
        },
      }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    expect(screen.getByText("引擎首选着")).toBeTruthy();
    expect(screen.queryByText(/Pikafish.*胜率/)).toBeNull();

    rerender(<MasterOpeningPanel
      fen="start"
      enabled
      panelMode="sparring"
      queryMoves={async () => [move]}
      queryGames={async () => [game]}
      resolveMoveFen={async () => "after-h2e2"}
      onPreviewMove={() => undefined}
      onAddMove={() => undefined}
      onOpenExplorer={() => undefined}
      onOpenGame={() => undefined}
      sparring={{
        status: "paused",
        userSide: "red",
        level: "ye7",
        delayMs: 600,
        autoReport: false,
        pauseReason: "当前局面本地参考库、云库和 Pikafish 都没有可用候选。",
        message: "当前局面本地参考库、云库和 Pikafish 都没有可用候选。可手动继续、重试、切换局面或结束对练。",
      }}
      onUpdateSparring={onUpdateSparring}
      onStartSparring={onStartSparring}
      onPauseSparring={onPauseSparring}
      onScoreSparring={onScoreSparring}
      onRetrySparring={onRetrySparring}
      onManualContinueSparring={onManualContinueSparring}
    />);

    fireEvent.click(screen.getByRole("button", { name: /手动继续/ }));
    expect(onManualContinueSparring).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(onRetrySparring).toHaveBeenCalled();
  });
});

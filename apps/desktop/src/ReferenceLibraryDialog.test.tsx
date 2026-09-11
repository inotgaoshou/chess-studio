import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceLibraryDialog } from "./ReferenceLibraryDialog";
import type { ChessPlatform, OpeningCategoryDto, ReferenceGameSummaryDto, ReferenceImportBatchDto, ReferenceSourceDto } from "./platform/types";

afterEach(cleanup);

const series: OpeningCategoryDto = {
  code: "A", seriesCode: "A", name: "非中炮类", aliases: [], sortOrder: 0,
  gameCount: 1, redWins: 1, draws: 0, blackWins: 0,
};
const child: OpeningCategoryDto = {
  ...series, code: "A01", parentCode: "A", name: "测试布局",
};
const source: ReferenceSourceDto = {
  id: "local-source", displayName: "授权库", rootPath: "/private/library",
  autoScan: true, licenseStatus: "authorized", active: true,
};
const batch: ReferenceImportBatchDto = {
  id: "batch-1", sourceId: source.id, status: "completed", reviewStatus: "approved",
  discoveredFiles: 1, changedFiles: 1, importedRecords: 1, revisedRecords: 0,
  duplicateRecords: 0, invalidRecords: 0, emptyFiles: 0, unclassifiedRecords: 0,
  warnings: [], createdAt: "2026-09-08T00:00:00Z", completedAt: "2026-09-08T00:00:01Z",
};
const game: ReferenceGameSummaryDto = {
  id: "game-1", canonicalFingerprint: "fingerprint-1", title: "王天一 胜 郑惟桐",
  redPlayer: "王天一", blackPlayer: "郑惟桐", result: "1-0", eventName: "全国大赛",
  roundName: "第1轮", gameDate: "2026-09-08", opening: "2026年全国象棋锦标赛（团体）",
  openingCode: "C01", openingName: "中炮对屏风马", moveCount: 60,
};

function platform(games: ReferenceGameSummaryDto[] = [], openingChild: OpeningCategoryDto = child) {
  const publishReferenceBatch = vi.fn(async () => ({ status: "completed", inserted: 1, duplicates: 0 }));
  const listReferenceGames = vi.fn(async () => games);
  const queryReferencePosition = vi.fn(async () => [{
    iccs: "h2e2", notation: "炮二平五", samples: 12, redWins: 6, draws: 3, blackWins: 3,
    firstYear: 2020, lastYear: 2026, representativeGameId: games[0]?.id,
    representativeGameTitle: games[0]?.title,
  }]);
  const getReferenceGameDocument = vi.fn(async (gameId: string) => {
    const found = games.find((item) => item.id === gameId);
    return found ? {
      game: found,
      mainlineNotation: ["炮二平五"],
      documentJson: JSON.stringify({
        startingFen: "startpos",
        note: "本地只读参考文档",
        tree: {
          root_id: "root",
          nodes: {
            n1: { id: "n1", parent_id: "root", mv: { from: { row: 9, col: 7 }, to: { row: 7, col: 7 } }, comment: "首着", is_mainline: true, deleted: false, order_key: 0 },
          },
        },
      }),
    } : undefined;
  });
  const getReferenceOfflinePackageManifest = vi.fn(async () => ({
    version: "2026.09", packageUrl: "https://example.com/reference.sqlite.zst",
    sha256: "a".repeat(64), gameCount: 147_994,
  }));
  const listReferenceBatchIssues = vi.fn(async () => [{
    id: "identity:game-1", kind: "identity", gameId: "game-1", title: "待审核棋局",
    redPlayer: "", blackPlayer: "黑方", gameDate: "2026", opening: "", detail: "棋手或完整日期缺失",
  }]);
  const updateReferenceGameIdentity = vi.fn(async () => undefined);
  const rebuildReferenceOpeningCatalog = vi.fn(async () => ({
    classifierVersion: 2, categoryCount: 13, aliasCount: 8, patternCount: 25,
    classifiedGames: 100, pendingGames: 20,
  }));
  const classifyReferenceLibrary = vi.fn(async () => ({
    classifierVersion: 2, categoryCount: 13, aliasCount: 8, patternCount: 25,
    classifiedGames: 100, pendingGames: 20,
  }));
  const value = {
    kind: "desktop" as const,
    browseReferenceOpenings: vi.fn(async (parentCode?: string) => parentCode === "A" ? [openingChild] : parentCode ? [] : [series]),
    listReferenceSources: vi.fn(async () => [source]),
    listReferenceImportBatches: vi.fn(async () => [batch]),
    listReferenceGames,
    queryReferencePosition,
    getReferenceGameDocument,
    openReferenceGame: vi.fn(async () => ({ fen: "loaded-reference-fen" })),
    getSyncAccount: vi.fn(async () => ({ serverUrl: "http://127.0.0.1:8080", status: "signedIn" as const })),
    getReferenceOfflinePackageManifest,
    publishReferenceBatch,
    listReferenceBatchIssues,
    updateReferenceGameIdentity,
    rebuildReferenceOpeningCatalog,
    classifyReferenceLibrary,
  } as unknown as ChessPlatform;
  return { value, classifyReferenceLibrary, getReferenceGameDocument, getReferenceOfflinePackageManifest, listReferenceBatchIssues, listReferenceGames, publishReferenceBatch, queryReferencePosition, rebuildReferenceOpeningCatalog, updateReferenceGameIdentity };
}

describe("ReferenceLibraryDialog", () => {
  it("renders A-E child categories and publishes an approved authorized batch", async () => {
    const { value, publishReferenceBatch } = platform();
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);

    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    expect(await screen.findByText("测试布局")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /导入批次/ }));
    fireEvent.change(screen.getByLabelText("服务端来源 ID"), { target: { value: "server-source" } });
    fireEvent.click(screen.getByRole("button", { name: /发布/ }));

    await waitFor(() => expect(publishReferenceBatch).toHaveBeenCalledWith(
      "batch-1", "server-source", "http://127.0.0.1:8080",
    ));
    expect(await screen.findByText(/发布完成/)).toBeTruthy();
  });

  it("passes the opening explorer filters through to the reference query", async () => {
    const { value, listReferenceGames } = platform();
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    await screen.findByText("测试布局");

    fireEvent.change(screen.getByLabelText("棋手"), { target: { value: "王天一" } });
    fireEvent.change(screen.getByLabelText("赛事"), { target: { value: "全国象棋甲级联赛" } });
    fireEvent.change(screen.getByLabelText("起始年份"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("结束年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("执方"), { target: { value: "red" } });
    fireEvent.click(screen.getByRole("button", { name: "大师实战" }));

    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A", "", 100, 0,
      { player: "王天一", event: "全国象棋甲级联赛", yearFrom: 2020, yearTo: 2026, side: "red", masterOnly: true },
    ));
  });

  it("shows all reference games and can filter pending classifications", async () => {
    const { value, getReferenceGameDocument, listReferenceGames } = platform([game]);
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));

    expect((await screen.findAllByText("王天一 胜 郑惟桐")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("布局分类筛选")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("布局分类筛选"), { target: { value: "A01" } });
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0,
      expect.objectContaining({}),
    ));
    expect(await screen.findByDisplayValue("本地只读参考文档")).toBeTruthy();
    await waitFor(() => expect(getReferenceGameDocument).toHaveBeenCalledWith("game-1"));
    expect((await screen.findAllByText("C01 · 中炮对屏风马")).length).toBeGreaterThan(0);
    expect(await screen.findByText("原始标注")).toBeTruthy();
    expect(await screen.findByText("2026年全国象棋锦标赛（团体）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "待分类" }));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0,
      expect.objectContaining({ classificationStatus: "pending" }),
    ));
  });

  it("opens directly to a matched reference game when an initial game id is provided", async () => {
    const { value, getReferenceGameDocument } = platform([game]);
    render(<ReferenceLibraryDialog platform={value} initialGameId="game-1" onClose={() => undefined}/>);

    expect(await screen.findByText("全部参考棋局")).toBeTruthy();
    await waitFor(() => expect(getReferenceGameDocument).toHaveBeenCalledWith("game-1"));
    expect(await screen.findByDisplayValue("本地只读参考文档")).toBeTruthy();
    expect(await screen.findByText("中文主线预览")).toBeTruthy();
    expect(await screen.findByText("炮二平五")).toBeTruthy();
    expect(screen.queryByText("h0-h2")).toBeNull();
  });

  it("loads a selected reference game into the board only from the explicit action", async () => {
    const { value } = platform([game]);
    const onOpenReferenceGame = vi.fn(async () => undefined);
    render(<ReferenceLibraryDialog platform={value} initialGameId="game-1" onOpenReferenceGame={onOpenReferenceGame} onClose={() => undefined}/>);

    await screen.findByText("炮二平五");
    fireEvent.click(screen.getByRole("button", { name: /查看棋谱/ }));

    await waitFor(() => expect(onOpenReferenceGame).toHaveBeenCalledWith("game-1"));
  });

  it("queries current-position moves from the game search view", async () => {
    const { value, queryReferencePosition } = platform([game]);
    render(<ReferenceLibraryDialog platform={value} currentFen="fen w - - 0 1" onClose={() => undefined}/>);

    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));
    fireEvent.click(screen.getByRole("button", { name: "局面搜索" }));

    await waitFor(() => expect(queryReferencePosition).toHaveBeenCalledWith(expect.objectContaining({
      fen: "fen w - - 0 1",
      limit: 24,
    })));
    expect(await screen.findByText("炮二平五")).toBeTruthy();
  });

  it("can rebuild the practical opening catalog from the opening portal", async () => {
    const { value, classifyReferenceLibrary, rebuildReferenceOpeningCatalog } = platform([], { ...child, gameCount: 0 });
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);

    fireEvent.click(await screen.findByRole("button", { name: /一键生成本地布局分类/ }));

    await waitFor(() => expect(rebuildReferenceOpeningCatalog).toHaveBeenCalled());
    await waitFor(() => expect(classifyReferenceLibrary).toHaveBeenCalled());
    expect(await screen.findByText(/布局分类已生成/)).toBeTruthy();
  });

  it("loads the versioned offline package manifest from the configured server", async () => {
    const { value, getReferenceOfflinePackageManifest } = platform();
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /资料源/ }));
    await screen.findByText("授权库");
    fireEvent.click(screen.getByRole("button", { name: /获取最新版/ }));

    await waitFor(() => expect(getReferenceOfflinePackageManifest).toHaveBeenCalledWith("http://127.0.0.1:8080"));
    expect(await screen.findByDisplayValue("https://example.com/reference.sqlite.zst")).toBeTruthy();
    expect(screen.getByText(/2026.09/)).toBeTruthy();
  });

  it("opens batch issues and submits an identity correction", async () => {
    const { value, updateReferenceGameIdentity } = platform();
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /导入批次/ }));
    await screen.findByText("新增");
    fireEvent.click(screen.getByRole("button", { name: /审核问题/ }));
    expect(await screen.findByText("待审核棋局")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("红方姓名"), { target: { value: "红方" } });
    fireEvent.change(screen.getByLabelText("完整日期"), { target: { value: "2026-09-09" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(updateReferenceGameIdentity).toHaveBeenCalledWith(
      "game-1", "红方", "黑方", "2026-09-09",
    ));
  });
});

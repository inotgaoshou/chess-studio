import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceLibraryDialog } from "./ReferenceLibraryDialog";
import type { ChessPlatform, OpeningCategoryDto, ReferenceGameSummaryDto, ReferenceImportBatchDto, ReferenceSourceDto } from "./platform/types";

afterEach(cleanup);

const series: OpeningCategoryDto = {
  code: "A", seriesCode: "A", name: "非中炮类", aliases: [], sortOrder: 0,
  gameCount: 7, redWins: 3, draws: 2, blackWins: 2, firstYear: 1990, lastYear: 2026,
};
const child: OpeningCategoryDto = {
  ...series, code: "A01", parentCode: "A", name: "测试布局",
  gameCount: 5, redWins: 2, draws: 1, blackWins: 2, firstYear: 2001, lastYear: 2024,
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

function makeGame(index: number): ReferenceGameSummaryDto {
  return {
    ...game,
    id: `game-${index}`,
    canonicalFingerprint: `fingerprint-${index}`,
    title: `测试棋局 ${index}`,
    redPlayer: `红方${index}`,
    blackPlayer: `黑方${index}`,
  };
}

function platform(games: ReferenceGameSummaryDto[] = [], openingChild: OpeningCategoryDto = child) {
  const publishReferenceBatch = vi.fn(async () => ({ status: "completed", inserted: 1, duplicates: 0 }));
  const listReferenceGames = vi.fn<ChessPlatform["listReferenceGames"]>(async () => games);
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
  const browseReferenceOpenings = vi.fn<ChessPlatform["browseReferenceOpenings"]>(async (parentCode?: string) => parentCode === "A" ? [openingChild] : parentCode ? [] : [series]);
  const value = {
    kind: "desktop" as const,
    browseReferenceOpenings,
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
  return { value, browseReferenceOpenings, classifyReferenceLibrary, getReferenceGameDocument, getReferenceOfflinePackageManifest, listReferenceBatchIssues, listReferenceGames, publishReferenceBatch, queryReferencePosition, rebuildReferenceOpeningCatalog, updateReferenceGameIdentity };
}

describe("ReferenceLibraryDialog", () => {
  it("opens an imported CBL batch in game search with visible destination and scope", async () => {
    const { value, listReferenceGames } = platform([game]);
    render(<ReferenceLibraryDialog
      platform={value}
      launchContext={{
        initialTab: "games",
        sourceId: source.id,
        batchId: batch.id,
        importResult: {
          title: "《布局飞刀陷阱》杨典",
          folder: "参考实战库",
          imported: 25,
          skipped: 1,
          warnings: [],
          sourceId: source.id,
          batchId: batch.id,
          revised: 0,
          duplicates: 1,
          invalid: 0,
          unclassified: 0,
          changedFiles: 1,
          emptyFiles: 0,
          removedRecords: 0,
          totalGames: 25,
          classifiedGames: 25,
          classifications: [
            { code: "B01", name: "中炮类开局", gameCount: 23 },
            { code: "D01", name: "顺炮", gameCount: 2 },
          ],
        },
      }}
      onClose={() => undefined}
    />);

    expect(await screen.findByText("已保存到参考实战库，不在个人本地棋谱库中。" )).toBeTruthy();
    expect(screen.getByText("B01 · 中炮类开局：23 盘")).toBeTruthy();
    expect(screen.getByText("疑似重复待审核：1 盘")).toBeTruthy();
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined,
      "",
      100,
      0,
      expect.objectContaining({ sourceId: source.id, batchId: batch.id }),
    ));
  });

  it("explains an unchanged CBL rescan without implying import failure", async () => {
    const { value } = platform();
    render(<ReferenceLibraryDialog
      platform={value}
      launchContext={{
        initialTab: "games",
        sourceId: source.id,
        batchId: batch.id,
        importResult: {
          title: source.displayName,
          folder: "参考实战库",
          imported: 0,
          skipped: 0,
          warnings: [],
          sourceId: source.id,
          batchId: batch.id,
          revised: 0,
          duplicates: 0,
          invalid: 0,
          unclassified: 0,
          changedFiles: 0,
          emptyFiles: 0,
          removedRecords: 0,
          totalGames: 26,
          classifiedGames: 25,
          classifications: [{ code: "B01", name: "中炮类开局", gameCount: 23 }],
        },
      }}
      onClose={() => undefined}
    />);

    expect(await screen.findByText("扫描完成，文件未变化，无需重复导入；资料源现有 26 盘。")).toBeTruthy();
  });

  it("does not call a changed empty CBL file unchanged", async () => {
    const { value } = platform();
    render(<ReferenceLibraryDialog
      platform={value}
      launchContext={{
        initialTab: "games",
        sourceId: source.id,
        batchId: batch.id,
        importResult: {
          title: source.displayName,
          folder: "参考实战库",
          imported: 0,
          skipped: 0,
          warnings: [],
          sourceId: source.id,
          batchId: batch.id,
          revised: 0,
          duplicates: 0,
          invalid: 0,
          unclassified: 0,
          changedFiles: 1,
          emptyFiles: 1,
          removedRecords: 2,
          totalGames: 0,
          classifiedGames: 0,
          classifications: [],
        },
      }}
      onClose={() => undefined}
    />);

    expect(await screen.findByText(/导入完成：新增 0、修订 0、疑似重复 0、非法 0、待分类 0、空库 1、移除 2/)).toBeTruthy();
    expect(screen.queryByText(/文件未变化/)).toBeNull();
  });

  it("opens games from a source and a batch with visible removable scope", async () => {
    const { value, listReferenceGames } = platform([game]);
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);

    fireEvent.click(screen.getByRole("button", { name: /资料源/ }));
    fireEvent.click(await screen.findByRole("button", { name: /查看棋谱/ }));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0, expect.objectContaining({ sourceId: source.id, batchId: undefined }),
    ));
    expect(screen.getByText(`资料源：${source.displayName}`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /导入批次/ }));
    fireEvent.click(await screen.findByRole("button", { name: /查看本批棋谱/ }));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0, expect.objectContaining({ sourceId: source.id, batchId: batch.id }),
    ));
    fireEvent.click(screen.getByTitle("清除批次筛选"));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0, expect.objectContaining({ sourceId: source.id, batchId: undefined }),
    ));
  });

  it("opens sidebar, hot, and series opening categories in filtered game search", async () => {
    const { value, listReferenceGames } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    await screen.findByText("热门布局");

    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    expect(sidebarChild).toBeTruthy();
    fireEvent.click(sidebarChild!);
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0, expect.objectContaining({ classificationStatus: "classified" }),
    ));
    expect(screen.getByText("布局：A01 · 测试布局")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    const hotOpening = container.querySelector<HTMLButtonElement>(".reference-hot-openings button");
    expect(hotOpening).toBeTruthy();
    fireEvent.click(hotOpening!);
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0, expect.objectContaining({ classificationStatus: "classified" }),
    ));

    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    const seriesCard = container.querySelector<HTMLButtonElement>(".reference-opening-series-cards button");
    expect(seriesCard).toBeTruthy();
    fireEvent.click(seriesCard!);
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A", "", 100, 0, expect.objectContaining({ classificationStatus: "classified" }),
    ));
    expect(screen.getByText("布局：A · 非中炮类")).toBeTruthy();
  });

  it("opens source-scoped classification and preserves the source when clearing an opening", async () => {
    const { value, browseReferenceOpenings, listReferenceGames } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);

    fireEvent.click(screen.getByRole("button", { name: /资料源/ }));
    fireEvent.click(await screen.findByRole("button", { name: /查看分类/ }));
    await waitFor(() => expect(browseReferenceOpenings).toHaveBeenCalledWith(
      undefined, { sourceId: source.id, batchId: undefined },
    ));
    expect(screen.getByText(`资料源：${source.displayName}`)).toBeTruthy();
    expect(screen.getAllByText("5 局 · 2001–2024").length).toBeGreaterThan(0);
    expect(screen.getAllByText("红 2 · 和 1 · 黑 2").length).toBeGreaterThan(0);

    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    expect(sidebarChild).toBeTruthy();
    fireEvent.click(sidebarChild!);
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0,
      expect.objectContaining({ sourceId: source.id, batchId: undefined, classificationStatus: "classified" }),
    ));

    fireEvent.click(screen.getByTitle("清除布局筛选"));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0,
      expect.objectContaining({ sourceId: source.id, batchId: undefined }),
    ));
    const lastFilters = listReferenceGames.mock.calls.at(-1)?.[4];
    expect(lastFilters?.classificationStatus).toBeUndefined();
    expect(screen.getByText(`资料源：${source.displayName}`)).toBeTruthy();
  });

  it("ignores an older source catalog response after the scope is cleared", async () => {
    const globalSeries = { ...series, name: "全库系列" };
    const globalChild = { ...child, name: "全库布局" };
    const sourceSeries = { ...series, name: "来源系列" };
    const sourceChild = { ...child, name: "来源布局" };
    let resolveSourceChildren: ((items: OpeningCategoryDto[]) => void) | undefined;
    const { value, browseReferenceOpenings } = platform();
    browseReferenceOpenings.mockImplementation(async (parentCode, filters) => {
      if (filters?.sourceId === source.id) {
        if (!parentCode) return [sourceSeries];
        return new Promise<OpeningCategoryDto[]>((resolve) => { resolveSourceChildren = resolve; });
      }
      return parentCode === "A" ? [globalChild] : parentCode ? [] : [globalSeries];
    });
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    expect(await screen.findByText("全库布局")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /资料源/ }));
    fireEvent.click(await screen.findByRole("button", { name: /查看分类/ }));
    await waitFor(() => expect(resolveSourceChildren).toBeTruthy());
    fireEvent.click(screen.getByTitle("清除资料源筛选"));
    expect(await screen.findByText("全库系列")).toBeTruthy();

    await act(async () => { resolveSourceChildren?.([sourceChild]); });
    expect(screen.queryByText("来源系列")).toBeNull();
    expect(screen.queryByText("来源布局")).toBeNull();
    expect(screen.getByText("全库布局")).toBeTruthy();
  });

  it("keeps source and opening filters while loading more category games", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => makeGame(index + 1));
    const secondPage = [makeGame(101)];
    const { value, listReferenceGames } = platform(firstPage);
    listReferenceGames.mockImplementation(async (_openingCode, _query, _limit, offset) => offset === 0 ? firstPage : secondPage);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);

    fireEvent.click(screen.getByRole("button", { name: /资料源/ }));
    fireEvent.click(await screen.findByRole("button", { name: /查看分类/ }));
    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    fireEvent.click(sidebarChild!);
    await screen.findByText("测试棋局 1");
    fireEvent.click(screen.getByRole("button", { name: "查看更多" }));

    expect(await screen.findByText("测试棋局 101")).toBeTruthy();
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 100,
      expect.objectContaining({ sourceId: source.id, batchId: undefined, classificationStatus: "classified" }),
    ));
  });

  it("preserves batch scope when opening a category from an imported batch", async () => {
    const { value, listReferenceGames } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog
      platform={value}
      launchContext={{ initialTab: "openings", sourceId: source.id, batchId: batch.id }}
      onClose={() => undefined}
    />);
    await screen.findByText("热门布局");

    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    fireEvent.click(sidebarChild!);

    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0,
      expect.objectContaining({ sourceId: source.id, batchId: batch.id, classificationStatus: "classified" }),
    ));
    expect(screen.getByTitle("清除批次筛选")).toBeTruthy();
  });

  it("shows a category-specific empty state after opening an empty classification", async () => {
    const { value } = platform([]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    await screen.findByText("热门布局");

    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    fireEvent.click(sidebarChild!);

    expect(await screen.findByText("该分类暂无关联棋谱。")).toBeTruthy();
  });

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

  it("preserves player, event, and year filters when opening a category", async () => {
    const { value, listReferenceGames } = platform();
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    await screen.findByText("测试布局");

    fireEvent.change(screen.getByLabelText("棋手"), { target: { value: "王天一" } });
    fireEvent.change(screen.getByLabelText("赛事"), { target: { value: "全国象棋甲级联赛" } });
    fireEvent.change(screen.getByLabelText("起始年份"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("结束年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("执方"), { target: { value: "red" } });
    fireEvent.click(screen.getByRole("button", { name: "大师实战" }));
    const sidebarChild = container.querySelector<HTMLButtonElement>(".reference-opening-body > aside .reference-opening-group .child");
    fireEvent.click(sidebarChild!);

    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0,
      expect.objectContaining({
        player: "王天一", event: "全国象棋甲级联赛", yearFrom: 2020, yearTo: 2026,
        side: "red", masterOnly: true, classificationStatus: "classified",
      }),
    ));
  });

  it("opens a game from the opening-page table with its category and preview selected", async () => {
    const { value, getReferenceGameDocument, listReferenceGames } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    await screen.findByText("热门布局");
    await waitFor(() => expect(container.querySelector(".reference-game-table > button")).toBeTruthy());
    const gameRow = container.querySelector<HTMLButtonElement>(".reference-game-table > button")!;

    fireEvent.click(gameRow);

    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A", "", 100, 0, expect.objectContaining({ classificationStatus: "classified" }),
    ));
    await waitFor(() => expect(getReferenceGameDocument).toHaveBeenCalledWith(game.id));
    expect(await screen.findByDisplayValue("本地只读参考文档")).toBeTruthy();
    expect(screen.getByText("布局：A · 非中炮类")).toBeTruthy();
  });

  it("shows all reference games and can filter pending classifications", async () => {
    const { value, getReferenceGameDocument, listReferenceGames } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));

    expect((await screen.findAllByText("王天一 胜 郑惟桐")).length).toBeGreaterThan(0);
    expect(container.querySelector(".reference-game-search-list .reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".reference-game-search-list .reference-player.black mark")).toBeTruthy();
    expect(await screen.findByLabelText("布局分类筛选")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("布局分类筛选"), { target: { value: "A01" } });
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      "A01", "", 100, 0,
      expect.objectContaining({}),
    ));
    expect(screen.getByText("布局：A01 · 测试布局")).toBeTruthy();
    fireEvent.click(screen.getByTitle("清除布局筛选"));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0,
      expect.objectContaining({}),
    ));
    expect(await screen.findByDisplayValue("本地只读参考文档")).toBeTruthy();
    await waitFor(() => expect(getReferenceGameDocument).toHaveBeenCalledWith("game-1"));
    expect((await screen.findAllByText("C01 · 中炮对屏风马")).length).toBeGreaterThan(0);
    expect(container.querySelector(".reference-game-preview .reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".reference-game-preview .reference-player.black mark")).toBeTruthy();
    expect(await screen.findByText("原始标注")).toBeTruthy();
    expect(await screen.findByText("2026年全国象棋锦标赛（团体）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "待分类" }));
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0,
      expect.objectContaining({ classificationStatus: "pending" }),
    ));
  });

  it("can collapse and reopen the reference game filters to free list width", async () => {
    const { value } = platform([game]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));

    expect(await screen.findByText("实战仓库")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起筛选" }));

    expect(container.querySelector(".reference-game-search-body.filters-collapsed")).toBeTruthy();
    expect(screen.queryByLabelText("实战检索关键词")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开筛选" }));

    expect(container.querySelector(".reference-game-search-body.filters-collapsed")).toBeNull();
    expect(await screen.findByLabelText("实战检索关键词")).toBeTruthy();
  });

  it("loads additional reference game pages without replacing the current list", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => makeGame(index + 1));
    const secondPage = [makeGame(101)];
    const { value, listReferenceGames } = platform(firstPage);
    listReferenceGames.mockImplementation(async (_openingCode, _query, _limit, offset) => offset === 0 ? firstPage : secondPage);
    render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));

    expect(await screen.findByText("测试棋局 1")).toBeTruthy();
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 0, expect.objectContaining({}),
    ));

    fireEvent.click(screen.getByRole("button", { name: "查看更多" }));

    expect(await screen.findByText("测试棋局 101")).toBeTruthy();
    expect(screen.getAllByText("测试棋局 1").length).toBeGreaterThan(0);
    await waitFor(() => expect(listReferenceGames).toHaveBeenLastCalledWith(
      undefined, "", 100, 100, expect.objectContaining({}),
    ));
  });

  it("shows red and black side markers in the opening game table including unknown players", async () => {
    const unknownGame = { ...game, id: "unknown-game", title: "未知对局", redPlayer: "", blackPlayer: "", result: "" };
    const { value } = platform([unknownGame]);
    const { container } = render(<ReferenceLibraryDialog platform={value} onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /布局探索/ }));
    await screen.findByText("测试布局");

    expect(await screen.findByText("未知对局")).toBeTruthy();
    expect(await screen.findByLabelText("红方未知 对 黑方未知")).toBeTruthy();
    expect(container.querySelector(".reference-game-table .reference-player.red mark")).toBeTruthy();
    expect(container.querySelector(".reference-game-table .reference-player.black mark")).toBeTruthy();
  });

  it("pins a representative game when it is not in the current match page", async () => {
    const representative = { ...game, id: "representative-game", title: "局面代表局" };
    const { value, getReferenceGameDocument, listReferenceGames, queryReferencePosition } = platform([]);
    listReferenceGames.mockResolvedValue([]);
    queryReferencePosition.mockResolvedValue([{
      iccs: "h2e2", notation: "炮二平五", samples: 12, redWins: 6, draws: 3, blackWins: 3,
      firstYear: 2020, lastYear: 2026, representativeGameId: representative.id,
      representativeGameTitle: representative.title,
    }]);
    getReferenceGameDocument.mockResolvedValue({
      game: representative,
      mainlineNotation: ["炮二平五"],
      documentJson: JSON.stringify({ startingFen: "startpos", note: "代表局说明", tree: { root_id: "root", nodes: {} } }),
    });
    render(<ReferenceLibraryDialog platform={value} currentFen="fen w - - 0 1" onClose={() => undefined}/>);
    fireEvent.click(screen.getByRole("button", { name: /实战检索/ }));
    fireEvent.click(screen.getByRole("button", { name: "局面搜索" }));

    fireEvent.click(await screen.findByRole("button", { name: /看代表局/ }));

    expect(await screen.findByText("当前预览棋局")).toBeTruthy();
    expect(await screen.findByDisplayValue("代表局说明")).toBeTruthy();
    await waitFor(() => expect(getReferenceGameDocument).toHaveBeenCalledWith(representative.id));
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

  it("can expand the full mainline from the reference preview", async () => {
    const { value, getReferenceGameDocument } = platform([game]);
    getReferenceGameDocument.mockResolvedValue({
      game,
      mainlineNotation: Array.from({ length: 45 }, (_, index) => `着法${index + 1}`),
      documentJson: JSON.stringify({ startingFen: "startpos", note: "本地只读参考文档", tree: { root_id: "root", nodes: {} } }),
    });
    render(<ReferenceLibraryDialog platform={value} initialGameId="game-1" onClose={() => undefined}/>);

    expect(await screen.findByText("着法1")).toBeTruthy();
    expect(screen.queryByText("着法45")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开完整主线" }));

    expect(await screen.findByText("着法45")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("着法45")).toBeNull();
  });

  it("loads a selected reference game into the board only from the explicit action", async () => {
    const { value } = platform([game]);
    const onOpenReferenceGame = vi.fn(async () => undefined);
    render(<ReferenceLibraryDialog platform={value} initialGameId="game-1" onOpenReferenceGame={onOpenReferenceGame} onClose={() => undefined}/>);

    await screen.findByText("炮二平五");
    fireEvent.click(screen.getByRole("button", { name: /查看棋谱/ }));

    await waitFor(() => expect(onOpenReferenceGame).toHaveBeenCalledWith("game-1", "view"));
  });

  it("offers study analysis and AI scoring actions for a reference game", async () => {
    const { value } = platform([game]);
    const onOpenReferenceGame = vi.fn(async () => undefined);
    render(<ReferenceLibraryDialog platform={value} initialGameId="game-1" onOpenReferenceGame={onOpenReferenceGame} onClose={() => undefined}/>);

    await screen.findByText("炮二平五");
    fireEvent.click(screen.getByRole("button", { name: /学习分析/ }));
    await waitFor(() => expect(onOpenReferenceGame).toHaveBeenCalledWith("game-1", "study"));

    fireEvent.click(screen.getByRole("button", { name: /AI打分/ }));
    await waitFor(() => expect(onOpenReferenceGame).toHaveBeenCalledWith("game-1", "score"));
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

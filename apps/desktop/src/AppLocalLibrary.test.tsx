import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardState, DesktopPreferencesDto, GameSummary, LearningProfile } from "./platform";

const startingFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

const board: BoardState = {
  fen: startingFen,
  rootSideToMove: "红方",
  sideToMove: "红方",
  status: "进行中",
  pieces: [],
  history: [],
  continuation: [],
  branches: [],
  title: "测试棋谱",
  note: "",
  playable: true,
};

const preferences: DesktopPreferencesDto = {
  enginePath: "/Applications/Xiangqi Studio.app/Contents/Resources/pikafish/Pikafish",
  threads: 2,
  hashMb: 256,
  multipv: 3,
  candidateLineMoves: 10,
  searchMode: "depth",
  searchValue: 24,
  moveTimeMs: 1000,
  ponder: false,
  autoAnalyze: false,
  libraryCollapsed: true,
  candidateRailCollapsed: false,
  analysisPanelCollapsed: false,
  evaluationCollapsed: true,
  branchArrowColor: "#2f80ed",
  workspacePanel: "moves",
  layoutMode: "compact",
  manualViewMode: "track",
  colorTheme: "light",
  boardSkin: "default",
  pieceSkin: "default",
  reportDepth: 24,
  builtinOpeningBookEnabled: true,
  activeBuiltinOpeningBookId: "builtin-default",
  analysisEngineMode: "single",
  parallelEngineIds: [],
  ruleMode: "domestic2020",
  moveAnimationEnabled: true,
  moveSoundEnabled: true,
  moveSoundVolume: 70,
  serverUrl: "http://127.0.0.1:8080",
};

const games: GameSummary[] = [{
  id: "local-1",
  title: "本地测试棋谱",
  fen: startingFen,
  updatedAt: "2026-09-14T00:00:00Z",
  current: true,
  favorite: false,
  tags: [],
}];

const profile: LearningProfile = {
  id: "default",
  childName: "专1棋手",
  level: "专1",
  ageGroup: "成人",
  sessionMinutes: 40,
  coachMode: "教练陪练",
  cycleWeeks: 12,
  personalRatio: 60,
  thematicRatio: 40,
  currentWeek: 1,
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
};

const platformMock = vi.hoisted(() => {
  const fallback = vi.fn(async () => undefined);
  return new Proxy({ kind: "desktop" as const }, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      return fallback;
    },
  });
});

vi.mock("./platform", async () => {
  const actual = await vi.importActual<typeof import("./platform")>("./platform");
  return { ...actual, chessPlatform: platformMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }));

vi.mock("./DesktopMenuBar", () => ({
  DesktopMenuBar: ({ execute }: { execute(command: "openLocalLibrary" | "referenceLibrary" | "importCblGameLibrary"): void }) => (
    <>
      <button type="button" onClick={() => execute("openLocalLibrary")}>菜单打开本地棋谱库</button>
      <button type="button" onClick={() => execute("referenceLibrary")}>菜单打开参考实战库</button>
      <button type="button" onClick={() => execute("importCblGameLibrary")}>菜单导入 CBL</button>
    </>
  ),
}));
vi.mock("./DesktopDialogs", () => ({ DesktopDialogs: () => null }));
vi.mock("./MobileToolbar", () => ({ MobileToolbar: () => null }));
vi.mock("./GameReportView", () => ({ GameReportDialog: () => null, GameReportView: () => null }));
vi.mock("./CandidateLine", () => ({ CandidateLine: () => null }));
vi.mock("./MultiEngineComparison", () => ({ MultiEngineComparison: () => null, hasEngineDivergence: () => false }));
vi.mock("./CompactWorkspace", () => ({ CompactEngineAnalysisList: () => null, CompactReferencePanels: () => null }));
vi.mock("./CoachProfileView", () => ({ CoachProfileView: () => null }));
vi.mock("./SkinShopDialog", () => ({ SkinShopDialog: () => null }));
vi.mock("./ManualTrackView", () => ({ ManualLineDialog: () => null, ManualTrackView: () => null }));
vi.mock("./ManualTreeView", () => ({ ManualTreeView: () => null }));
vi.mock("./CandidatePreviewSteps", () => ({ CandidatePreviewSteps: () => null }));
vi.mock("./TheoryLibraryView", () => ({ TheoryLibraryView: () => null }));
vi.mock("./LinkSessionDialog", () => ({ LinkSessionDialog: () => null }));
vi.mock("./LinkMiniBoard", () => ({ LinkMiniBoard: () => null }));
vi.mock("./FlyknifeDialog", () => ({ FlyknifeDialog: () => null }));
vi.mock("./MasterLibraryDialog", () => ({ MasterLibraryDialog: () => null }));
vi.mock("./ReferenceLibraryDialog", () => ({
  ReferenceLibraryDialog: ({ launchContext, onClose }: { launchContext?: { initialTab?: string; importResult?: { title: string } }; onClose(): void }) => <section role="dialog" aria-label="参考实战库与布局探索"><strong>参考实战库</strong>{launchContext?.importResult && <span>{launchContext.initialTab} · {launchContext.importResult.title}</span>}<button type="button" onClick={onClose}>关闭参考库</button></section>,
}));
vi.mock("./CoachRadar", () => ({ CoachProfileView: () => null }));
vi.mock("./UserManualDialog", () => ({ UserManualDialog: () => null }));
vi.mock("./MasterOpeningPanel", () => ({
  MasterOpeningPanel: ({ panelMode }: { panelMode: string }) => <aside data-testid={`master-opening-${panelMode}`}/>,
}));
vi.mock("./ReviewWorkspace", () => ({
  ReviewWorkspace: ({ onLibraryOpenChange }: { onLibraryOpenChange?(open: boolean): void }) => (
    <section data-testid="review-workspace">
      <button type="button" onClick={() => onLibraryOpenChange?.(true)}>复盘内打开棋谱库</button>
    </section>
  ),
}));
vi.mock("./ReviewGameLibrary", () => ({
  ReviewGameLibrary: ({ games }: { games: GameSummary[] }) => (
    <section role="dialog" aria-label="本地棋谱库">
      <strong>本地棋谱库</strong>
      <span>{games[0]?.title ?? "暂无棋谱"}</span>
    </section>
  ),
}));

import App from "./App";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function configurePlatform(initialBoard: BoardState = board) {
  const target = platformMock as Record<string, ReturnType<typeof vi.fn> | string>;
  target.initialize = vi.fn(async () => initialBoard);
  target.getAppInfo = vi.fn(async () => ({ version: "1.2.5", buildTimestamp: 0, platform: "macOS" }));
  target.listGames = vi.fn(async () => games);
  target.listLibraryFolders = vi.fn(async () => []);
  target.listFlyknifePlans = vi.fn(async () => []);
  target.getTheoryLibrary = vi.fn(async () => ({ lessons: [], cards: [], downloadingFiles: 0 }));
  target.listStudySessions = vi.fn(async () => []);
  target.listBuiltinOpeningBooks = vi.fn(async () => ({ books: [] }));
  target.getDesktopPreferences = vi.fn(async () => preferences);
  target.getSyncAccount = vi.fn(async () => ({ serverUrl: preferences.serverUrl, status: "unbound" }));
  target.listEngineProfiles = vi.fn(async () => []);
  target.getGameReport = vi.fn(async () => undefined);
  target.loadSavedAnalysis = vi.fn(async () => []);
  target.previewLine = vi.fn(async () => []);
  target.playMove = vi.fn(async () => initialBoard);
  target.queryCloudOpeningBook = vi.fn(async () => []);
  target.subscribeGameReportProgress = vi.fn(async () => () => undefined);
  target.subscribeEngineEvents = vi.fn(async () => () => undefined);
  target.getLearningProfile = vi.fn(async () => profile);
  target.returnCompactFloatingPanel = vi.fn(async () => false);
  target.updateDesktopPreferences = vi.fn(async () => preferences);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App local library", () => {
  it.each([
    ["复盘", undefined],
    ["大师开局", "大师开局"],
    ["随机对练", "随机对练"],
  ] as const)("opens the local game library from the menu in %s mode", async (_label, modeButton) => {
    configurePlatform();
    const user = userEvent.setup();
    render(<App/>);

    expect(await screen.findByTestId("review-workspace")).toBeTruthy();
    if (modeButton) {
      await user.click(screen.getByRole("button", { name: modeButton }));
      await waitFor(() => expect(screen.getByTestId(modeButton === "大师开局" ? "master-opening-opening" : "master-opening-sparring")).toBeTruthy());
    }

    await user.click(screen.getByRole("button", { name: "菜单打开本地棋谱库" }));

    const library = await screen.findByRole("dialog", { name: "本地棋谱库" });
    expect(library).toBeTruthy();
    expect(within(library).getByText("本地测试棋谱")).toBeTruthy();
  });

  it("routes the review workspace library button to the top-level local library", async () => {
    configurePlatform();
    const user = userEvent.setup();
    render(<App/>);

    await user.click(await screen.findByRole("button", { name: "复盘内打开棋谱库" }));

    expect(await screen.findByRole("dialog", { name: "本地棋谱库" })).toBeTruthy();
  });

  it("opens the complete reference library directly from the menu", async () => {
    configurePlatform();
    const user = userEvent.setup();
    render(<App/>);

    await user.click(await screen.findByRole("button", { name: "菜单打开参考实战库" }));

    expect(await screen.findByRole("dialog", { name: "参考实战库与布局探索" })).toBeTruthy();
    expect(screen.queryByTestId("master-opening-opening")).toBeNull();
  });

  it("opens the imported CBL batch in reference game search", async () => {
    configurePlatform();
    const target = platformMock as Record<string, ReturnType<typeof vi.fn> | string>;
    target.importCblGameLibrary = vi.fn(async () => ({
      title: "《布局飞刀陷阱》杨典",
      folder: "参考实战库",
      imported: 25,
      skipped: 1,
      warnings: [],
      sourceId: "source-flyknife",
      batchId: "batch-flyknife",
      revised: 0,
      duplicates: 1,
      invalid: 0,
      unclassified: 0,
      changedFiles: 1,
      emptyFiles: 0,
      removedRecords: 0,
      totalGames: 25,
      classifiedGames: 25,
      classifications: [],
    }));
    const user = userEvent.setup();
    render(<App/>);

    await user.click(await screen.findByRole("button", { name: "菜单导入 CBL" }));

    const dialog = await screen.findByRole("dialog", { name: "参考实战库与布局探索" });
    expect(within(dialog).getByText("games · 《布局飞刀陷阱》杨典")).toBeTruthy();
  });
});

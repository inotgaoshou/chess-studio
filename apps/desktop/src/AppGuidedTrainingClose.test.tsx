import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardState, DailyTrainingPlan, DesktopPreferencesDto, GuidedAnalysisStart, LearningProfile, OpeningRepertoire, WeeklyLearningReport } from "./platform";

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

const guidedStart: GuidedAnalysisStart = {
  session: {
    id: "guided-1",
    gameId: "game-1",
    problemNodeId: "node-1",
    startNodeId: "root",
    reportSignature: "report-1",
    fen: startingFen,
    phase: "middle",
    status: "thinking",
    answerHidden: true,
    startedAt: "2026-08-12T00:00:00Z",
  },
  board,
};

const dailyPlan: DailyTrainingPlan = {
  date: "2026-08-12",
  week: 1,
  phaseTitle: "基线诊断",
  totalMinutes: 40,
  personalRatio: 60,
  thematicRatio: 40,
  segments: [],
};

const weeklyReport: WeeklyLearningReport = {
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  attempts: 0,
  masteredTasks: 0,
  resultCounts: {},
  weakTags: [],
  parentSummary: "暂无作答",
  nextFocus: "专1拆棋",
};

const repertoire: OpeningRepertoire = {
  sampledGames: 0,
  red: [],
  black: [],
  enoughData: false,
  note: "样本不足",
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

vi.mock("./DesktopMenuBar", () => ({ DesktopMenuBar: () => null }));
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
vi.mock("./CoachRadar", () => ({ CoachProfileView: () => null }));
vi.mock("./UserManualDialog", () => ({ UserManualDialog: () => null }));

vi.mock("./ReviewWorkspace", () => ({
  ReviewWorkspace: ({ onStartGuidedTraining, showMoveThoughts = true, onMoveThoughtVisibilityChange }: { onStartGuidedTraining(nodeId?: string): void; showMoveThoughts?: boolean; onMoveThoughtVisibilityChange?(visible: boolean): void }) => (
    <section data-testid="review-workspace">
      <button type="button" onClick={() => onStartGuidedTraining("node-1")}>开始专1拆棋</button>
      <button type="button" onClick={() => onMoveThoughtVisibilityChange?.(!showMoveThoughts)}>{showMoveThoughts ? "隐藏思路" : "显示思路"}</button>
    </section>
  ),
}));

vi.mock("./GuidedTrainingDialog", () => ({
  GuidedTrainingDialog: ({ onCancel, onClose, start }: { onCancel(sessionId: string): void; onClose(): void; start: GuidedAnalysisStart }) => (
    <section role="dialog" aria-label="专1训练替身">
      <button type="button" onClick={() => { onCancel(start.session.id); onClose(); }}>关闭专1训练</button>
    </section>
  ),
}));

import App, { boardMoveErrorMessage } from "./App";

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
  target.listGames = vi.fn(async () => []);
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
  target.stopAnalysis = vi.fn(async () => undefined);
  target.queryCloudOpeningBook = vi.fn(async () => []);
  target.subscribeGameReportProgress = vi.fn(async () => () => undefined);
  target.subscribeEngineEvents = vi.fn(async () => () => undefined);
  target.startGuidedAnalysis = vi.fn(async () => guidedStart);
  target.getLearningProfile = vi.fn(async () => profile);
  target.generateDailyTrainingPlan = vi.fn(async () => dailyPlan);
  target.getWeeklyLearningReport = vi.fn(async () => weeklyReport);
  target.inferOpeningRepertoire = vi.fn(async () => repertoire);
  target.cancelGuidedAnalysis = vi.fn(async () => undefined);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App guided-analysis close", () => {
  it("returns a review-started guided session to training mode when the dialog closes", async () => {
    configurePlatform();
    const user = userEvent.setup();
    const view = render(<App/>);

    expect(await screen.findByTestId("review-workspace")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "开始专1拆棋" }));
    expect(await screen.findByRole("dialog", { name: "专1训练替身" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "关闭专1训练" }));

    await waitFor(() => {
      expect(screen.getByTestId("review-workspace")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "专1训练替身" })).toBeNull();
      expect(screen.getByRole("button", { name: "训练" }).getAttribute("aria-pressed")).toBe("true");
      expect(view.container.querySelector("main.workspace")?.classList.contains("review-mode-active")).toBe(true);
    });
  });

  it("shows selected piece thinking from the explicit action", async () => {
    configurePlatform({
      ...board,
      pieces: [{ row: 9, col: 1, color: "red", kind: "horse", label: "马" }],
    });
    const user = userEvent.setup();
    render(<App/>);

    const horseSquare = await screen.findByRole("button", { name: /b0 红马/ });
    await user.click(horseSquare);
    await user.click(screen.getByRole("button", { name: "查看棋子思路" }));

    const card = await screen.findByLabelText("选中棋子思路");
    expect(card.textContent).toContain("红方马");
    expect(card.textContent).toContain("跳点");
    expect(horseSquare.className).not.toContain("thought-selected");

    await user.click(screen.getByRole("button", { name: "隐藏思路" }));
    expect(screen.queryByLabelText("选中棋子思路")).toBeNull();

    await user.click(screen.getByRole("button", { name: "显示思路" }));
    expect(screen.getByLabelText("选中棋子思路")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByLabelText("选中棋子思路")).toBeNull();
  });

  it("renders selected pieces with a ground shadow and no fixed selection ring", async () => {
    configurePlatform({
      ...board,
      pieces: [{ row: 9, col: 1, color: "red", kind: "horse", label: "马" }],
    });
    render(<App/>);

    const horseSquare = await screen.findByRole("button", { name: /b0 红马/ });
    fireEvent.click(horseSquare);

    expect(horseSquare.className).toContain("selected");
    expect(horseSquare.querySelector(".selection-ring")).toBeNull();
    expect(horseSquare.querySelector(".main-board-ground-shadow")).toBeTruthy();
    expect(horseSquare.querySelector(".selection-mask")).toBeNull();
  });

  it("does not trigger inspection or cancel the move on a destination double-click", async () => {
    configurePlatform({
      ...board,
      pieces: [
        { row: 9, col: 1, color: "red", kind: "horse", label: "马" },
        { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      ],
    });
    render(<App/>);

    const horseSquare = await screen.findByRole("button", { name: /b0 红马/ });
    const emptySquare = screen.getByRole("button", { name: "b1" });
    fireEvent.click(horseSquare);
    fireEvent.click(emptySquare);
    fireEvent.click(emptySquare, { detail: 2 });
    fireEvent.doubleClick(emptySquare);

    await new Promise((resolve) => window.setTimeout(resolve, 240));
    expect((platformMock as { playMove?: ReturnType<typeof vi.fn> }).playMove).toHaveBeenCalledExactlyOnceWith("b0b1");
    expect(screen.queryByLabelText("选中棋子思路")).toBeNull();
  });

  it("shows immediate feedback while stopping analysis", async () => {
    configurePlatform();
    let resolveStop: (() => void) | undefined;
    const target = platformMock as Record<string, ReturnType<typeof vi.fn> | string>;
    target.analyze = vi.fn(() => new Promise(() => undefined));
    target.stopAnalysis = vi.fn(() => new Promise<void>((resolve) => { resolveStop = resolve; }));
    const view = render(<App/>);

    await screen.findByTestId("review-workspace");
    const analysisButton = [...view.container.querySelectorAll<HTMLButtonElement>("button.mode-tool")]
      .find((button) => button.textContent?.trim() === "分析");
    expect(analysisButton).toBeTruthy();

    fireEvent.click(analysisButton!);
    await waitFor(() => expect(analysisButton!.textContent).toContain("停止分析"));

    fireEvent.click(analysisButton!);

    expect(target.stopAnalysis).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(analysisButton!.textContent).toContain("停止中");
      expect(analysisButton!.disabled).toBe(true);
    });

    resolveStop?.();
    await waitFor(() => expect(analysisButton!.textContent).toBe("分析"));
  });
});


describe("desktop picked-up piece interaction", () => {
  it("puts down on single/double click, switches selection, and opens thoughts only from the button", async () => {
    configurePlatform({ ...board, pieces: [
      { row: 6, col: 4, color: "red", kind: "pawn", label: "兵" },
      { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
    ] });
    const user = userEvent.setup();
    const view = render(<App/>);
    const pawn = await screen.findByRole("button", { name: "e3 红兵" });
    const cannon = screen.getByRole("button", { name: "b2 红炮" });
    await user.click(pawn);
    expect(pawn.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "查看棋子思路" }));
    expect(screen.getByLabelText("选中棋子思路")).toBeTruthy();
    expect(view.container.querySelector(".thought-selected")).toBeNull();
    await user.click(cannon);
    expect(pawn.getAttribute("aria-pressed")).toBe("false");
    expect(cannon.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("选中棋子思路")).toBeNull();
    await user.dblClick(cannon);
    expect(cannon.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "查看棋子思路" })).toBeNull();
    await user.click(pawn);
    await user.click(pawn);
    expect(pawn.getAttribute("aria-pressed")).toBe("false");
    expect((platformMock as { playMove?: ReturnType<typeof vi.fn> }).playMove).not.toHaveBeenCalled();
  });
});

describe("desktop capture selection", () => {
  it("captures the opposing pawn directly while lifted", async () => {
    configurePlatform({ ...board, fen: "4k4/9/9/9/4pP3/4P4/9/9/9/4K4 b - - 0 1", sideToMove: "黑方", pieces: [
      { row: 4, col: 4, color: "black", kind: "pawn", label: "卒" },
      { row: 5, col: 4, color: "red", kind: "pawn", label: "兵" },
    ] });
    render(<App/>);
    fireEvent.click(await screen.findByRole("button", { name: "e5 黑卒" }));
    fireEvent.click(screen.getByRole("button", { name: "e4 红兵" }));
    await waitFor(() => expect((platformMock as { playMove?: ReturnType<typeof vi.fn> }).playMove).toHaveBeenCalledExactlyOnceWith("e5e4"));
  });

  it("retains the lifted piece after a rejected capture so another target can be tried", async () => {
    configurePlatform({ ...board, fen: "4k4/9/9/9/4pP3/4P4/9/9/9/4K4 b - - 0 1", sideToMove: "黑方", pieces: [
      { row: 4, col: 4, color: "black", kind: "pawn", label: "卒" },
      { row: 4, col: 5, color: "red", kind: "pawn", label: "兵" },
      { row: 5, col: 4, color: "red", kind: "pawn", label: "兵" },
    ] });
    const playMove = (platformMock as unknown as { playMove: ReturnType<typeof vi.fn> }).playMove;
    const previewLine = (platformMock as unknown as { previewLine: ReturnType<typeof vi.fn> }).previewLine;
    previewLine.mockRejectedValueOnce(new Error("非法走棋"));
    render(<App/>);
    const pawn = await screen.findByRole("button", { name: "e5 黑卒" });
    fireEvent.click(pawn);
    fireEvent.click(screen.getByRole("button", { name: "f5 红兵" }));
    await waitFor(() => expect(previewLine).toHaveBeenCalledWith(expect.any(String), ["e5f5"]));
    await waitFor(() => expect(screen.getAllByText("非法走棋").length).toBeGreaterThan(0));
    expect(pawn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "e4 红兵" }));
    await waitFor(() => expect(playMove).toHaveBeenLastCalledWith("e5e4"));
  });
});

it("explains why capturing a horse cannot ignore a cannon check", () => {
 expect(boardMoveErrorMessage(new Error("候选线路第 1 步无法生成中文记谱：illegal move"), { status: "将军", ruleReason: "当前为将军局面" })).toContain("必须先解将");
 expect(boardMoveErrorMessage(new Error("illegal move"), { status: "进行中" })).toContain("不符合象棋规则");
});

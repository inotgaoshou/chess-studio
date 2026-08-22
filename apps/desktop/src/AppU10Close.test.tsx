import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  serverUrl: "http://127.0.0.1:8080",
};

const profile: LearningProfile = {
  id: "default",
  childName: "小棋手",
  level: "全国少年赛",
  ageGroup: "U10",
  sessionMinutes: 40,
  coachMode: "家长陪练",
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
  nextFocus: "开始拆棋",
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
  ReviewWorkspace: ({ onStartU10 }: { onStartU10(nodeId?: string): void }) => (
    <section data-testid="review-workspace">
      <button type="button" onClick={() => onStartU10("node-1")}>开始 U10</button>
    </section>
  ),
}));

vi.mock("./U10TrainingDialog", () => ({
  U10TrainingDialog: ({ onCancel, onClose, start }: { onCancel(sessionId: string): void; onClose(): void; start: GuidedAnalysisStart }) => (
    <section role="dialog" aria-label="U10 训练替身">
      <button type="button" onClick={() => { onCancel(start.session.id); onClose(); }}>关闭 U10 训练</button>
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

function configurePlatform() {
  const target = platformMock as Record<string, ReturnType<typeof vi.fn> | string>;
  target.initialize = vi.fn(async () => board);
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

describe("App U10 close", () => {
  it("returns a review-started U10 session to training mode when the dialog closes", async () => {
    configurePlatform();
    const user = userEvent.setup();
    const view = render(<App/>);

    expect(await screen.findByTestId("review-workspace")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "开始 U10" }));
    expect(await screen.findByRole("dialog", { name: "U10 训练替身" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "关闭 U10 训练" }));

    await waitFor(() => {
      expect(screen.getByTestId("review-workspace")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "U10 训练替身" })).toBeNull();
      expect(screen.getByRole("button", { name: "训练" }).getAttribute("aria-pressed")).toBe("true");
      expect(view.container.querySelector("main.workspace")?.classList.contains("review-mode-active")).toBe(true);
    });
  });
});

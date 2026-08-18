import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  ClipboardPaste,
  Copy,
  Database,
  Download,
  Eye,
  FlipVertical2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  GripVertical,
  Link,
  LayoutGrid,
  Library,
  Heart,
  Info,
  ListStart,
  LogOut,
  Maximize2,
  Moon,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  Square,
  Sun,
  TrendingUp,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH, DEFAULT_BUILTIN_OPENING_BOOK_ID, FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST, chessPlatform, type AnalysisLine, type BoardState, type CloudBookCandidate, type EngineProbeDto, type EngineProfileDto, type EngineRuntimeState, type ExportFormat, type GameReportDatasetDto, type GameReportProgressDto, type GameSummary, type LibraryFolder, type MasterStyleProfileDto, type MoveItem, type Piece, type PreviewLineStep, type ReplayExportScope, type StudySessionDto, type TheoryLibraryDto, type TrainingGenerationResultDto, type TrainingSummaryDto, type TrainingTaskDto } from "./platform";
import { evaluationRedShare, moveQualityFeedback, moveReports, positionEvaluation, redAnalysisScoreText, trendChart, trendPoints, trendTurningPoints } from "./analysisView";
import { CandidateLine } from "./CandidateLine";
import { hasEngineDivergence, MultiEngineComparison, type EngineComparisonGroup } from "./MultiEngineComparison";
import { DesktopMenuBar, type MenuCommand } from "./DesktopMenuBar";
import { DesktopDialogs, type DesktopDialog } from "./DesktopDialogs";
import { GameReportDialog, GameReportView } from "./GameReportView";
import { buildGameReportPresentation } from "./gameReport";
import { candidateCoachInsights, currentCoachAdvice, moveThoughtHint } from "./coachInsights";
import { MobileToolbar, type MobileToolbarCommand } from "./MobileToolbar";
import { MobileStudyPanel } from "./MobileStudyPanel";
import { MobileManualRoute } from "./MobileManualRoute";
import type { AnalysisOptions, AppInfoDto, BuiltinOpeningBookManifestDto, CloudAnalysisPreferences, DailyTrainingPlan, DesktopPreferencesDto, FlyknifePlan, GuidedAnalysisStart, GuidedAnalysisSubmission, LearningProfile, LinkSessionStatus, OpeningRepertoire, SubscriptionDto, SyncAccountDto, WeeklyLearningReport } from "./platform";
import { applyColorTheme, initialColorTheme, type ColorTheme } from "./theme";
import { WorkspaceTabs, type WorkspacePanel } from "./WorkspaceTabs";
import { WorkspaceModeSwitch, type WorkspaceMode } from "./WorkspaceModeSwitch";
import { WorkspaceLayoutSwitch } from "./WorkspaceLayoutSwitch";
import { CompactEngineAnalysisList, CompactReferencePanels, type CompactBookRow, type CompactEngineAnalysisRow, type CompactEvaluationRow } from "./CompactWorkspace";
import { CoachProfileView } from "./CoachProfileView";
import { SkinShopDialog } from "./SkinShopDialog";
import { CANDIDATE_PREVIEW_HALF_MOVES, DEFAULT_CANDIDATE_LINE_MOVES, DEFAULT_ENGINE_CANDIDATES, MIN_CANDIDATE_LINE_MOVES, MIN_ENGINE_CANDIDATES, halfMovesToRoundText } from "./candidatePreview";
import { AutosaveOperationQueue, autosaveLabel, type AutosaveState } from "./autosave";
import { ManualTreeView } from "./ManualTreeView";
import { ManualLineDialog, ManualTrackView, type BestMoveHint, type ManualPreviewBranch } from "./ManualTrackView";
import { hasReviewMarker, toggleReviewMarker } from "./reviewMarker";
import type { ManualViewMode } from "./manualTrackModel";
import { CandidatePreviewSteps } from "./CandidatePreviewSteps";
import { ENGINE_ANALYSIS_HISTORY_LIMIT, beginAnalysisHistory, beginAnalysisStream, completeAnalysisStream, isAnalysisSessionCurrent, updateAnalysisHistory, updateAnalysisStream, type AnalysisHistoryBuffer, type AnalysisStreamBuffer } from "./analysisStream";
import { auditResultText, classifyBookCandidateAudit, type BookCandidateAuditResult } from "./bookCandidateAudit";
import { ACCOUNT_SKINS, normalizeSkinId, requiresSignInForSkinPatch, skinAssetFolder } from "./skinAccess";
import { hasUpcomingBranchPoint } from "./branchNavigation";
import { buildMindMapSvg } from "./mindMapExport";
import { buildStrategyInsight } from "./strategyInsights";
import { TheoryLibraryView } from "./TheoryLibraryView";
import { LinkSessionDialog } from "./LinkSessionDialog";
import { LinkMiniBoard, type LinkMiniArrow } from "./LinkMiniBoard";
import { FlyknifeDialog } from "./FlyknifeDialog";
import { MasterLibraryDialog } from "./MasterLibraryDialog";
import { bundledTheoryKnowledge } from "./theoryKnowledge.generated";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { U10TrainingDialog } from "./U10TrainingDialog";
import { UserManualDialog } from "./UserManualDialog";
import { boardCellStyle, boardIntersectionPoint } from "./boardGeometry";
import userManualMarkdown from "../../../docs/USER_MANUAL.zh-CN.md?raw";


const COMPACT_PANEL_RETURN_EVENT = "compact-panel-return";
const BOARD_NAVIGATED_EVENT = "board-navigated";
const LINK_SESSION_UPDATED_EVENT = "link-session-updated";
const ENGINE_ANALYSIS_SNAPSHOT_KEY = "xiangqi:engine-analysis-snapshot";
const ENGINE_ANALYSIS_CHANNEL = "xiangqi:engine-analysis";
const COMPACT_ENGINE_LINE_MIN_MOVES = MIN_CANDIDATE_LINE_MOVES;
const COMPACT_ENGINE_LINE_MAX_MOVES = CANDIDATE_PREVIEW_HALF_MOVES;
const DEFAULT_BRANCH_ARROW_COLOR = "#2f80ed";
const DEFAULT_ENGINE_MOVE_TIME_MS = 1000;
const DEFAULT_ANALYSIS_DEPTH = 24;
const MOBILE_DEFAULT_ANALYSIS_DEPTH = 20;
const MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION = 1;
const DEFAULT_REPORT_DEPTH = 24;
const QUICK_ANALYSIS_TIME_MS = 1200;
const COMPACT_ENGINE_MIN_WIDTH = 280;
const COMPACT_ENGINE_DEFAULT_WIDTH = 344;
const COMPACT_ENGINE_MIN_HEIGHT = 220;
const COMPACT_ENGINE_DEFAULT_HEIGHT = 410;
const COMPACT_ENGINE_MAX_HEIGHT = 720;
const COMPACT_ENGINE_DEFAULT_TOP = 48;
const COMPACT_ENGINE_DEFAULT_Y = 150;
const COMPACT_ENGINE_VIEWPORT_GAP = 24;
const LEGACY_ENGINE_DEFAULTS_MIGRATION_KEY = "xiangqi:migrated-engine-defaults-v6";
const ANALYSIS_PANEL_REOPEN_TOP_KEY = "xiangqi:analysis-panel-reopen-top";
const ANALYSIS_PANEL_REOPEN_DEFAULT_TOP = 7;
const ANALYSIS_PANEL_REOPEN_MIN_TOP = 7;
const ANALYSIS_PANEL_REOPEN_HEIGHT = 132;
const ANALYSIS_PANEL_REOPEN_DRAG_THRESHOLD = 6;
const BOOK_CANDIDATE_AUDIT_LIMIT = 12;
const BOOK_CANDIDATE_AUDIT_DEPTH = 18;
const startingFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
type EngineAnalysisGroup = { fen: string; name: string; lines: AnalysisLine[]; error?: string };
type EngineAnalysisSnapshot = { fen: string; primaryEngineId: string; groups: Record<string, EngineAnalysisGroup>; busy?: boolean };
type FloatingPanel = "engine" | "manual" | "cloud" | "link";
type CompactStudyRailSnapshot = {
  engineCollapsed: boolean;
  manualCollapsed: boolean;
  detachedPanels: Record<"engine" | "manual", boolean>;
  poppedOutPanels: Record<"engine" | "manual" | "cloud", boolean>;
  windowPositions: Record<"engine" | "manual", { x: number; y: number }>;
  manualWidth?: number;
  activeWindow: "engine" | "manual";
};
type BookCandidateAuditRunState = {
  status: "idle" | "running" | "done" | "error";
  fen?: string;
  message: string;
  checked?: number;
  total?: number;
};

export const compactEngineDefaultPosition = () => ({ x: 0, y: COMPACT_ENGINE_DEFAULT_Y });
const compactManualDefaultPosition = () => ({ x: 0, y: 0 });
const compactWindowDefaultPositions = () => ({
  engine: compactEngineDefaultPosition(),
  manual: compactManualDefaultPosition(),
});

export function clampAnalysisPanelReopenTop(top: number, viewportHeight: number, panelHeight = ANALYSIS_PANEL_REOPEN_HEIGHT) {
  if (!Number.isFinite(top)) return ANALYSIS_PANEL_REOPEN_DEFAULT_TOP;
  const maxTop = Math.max(ANALYSIS_PANEL_REOPEN_MIN_TOP, viewportHeight - panelHeight - 8);
  return Math.round(Math.max(ANALYSIS_PANEL_REOPEN_MIN_TOP, Math.min(maxTop, top)));
}

function readAnalysisPanelReopenTop() {
  if (typeof window === "undefined") return ANALYSIS_PANEL_REOPEN_DEFAULT_TOP;
  try {
    return clampAnalysisPanelReopenTop(
      Number(localStorage.getItem(ANALYSIS_PANEL_REOPEN_TOP_KEY)),
      window.innerHeight,
    );
  } catch {
    return ANALYSIS_PANEL_REOPEN_DEFAULT_TOP;
  }
}

export function linkMoveDisplayText(iccs?: string, notation?: string) {
  if (!iccs && !notation) return undefined;
  if (notation && iccs && notation !== iccs) return `${notation}（${iccs}）`;
  return notation ?? iccs;
}

export function linkSessionStateLabel(state: LinkSessionStatus["state"], mode?: LinkSessionStatus["mode"], pendingExternalMove?: string, pendingExternalMoveDisplay?: string) {
  if (state === "tracking") {
    if (pendingExternalMove) return `等待网页走子 ${pendingExternalMoveDisplay ?? pendingExternalMove}`;
    if (mode === "confirmPlay") return "确认走子中";
    if (mode === "autoPlay") return "自动对战中";
    return "观战跟盘中";
  }
  return ({ stopped: "已停止", detectingCorners: "检测棋盘", rectifyingBoard: "校正棋盘", classifyingSquares: "识别棋子", calibrating: "等待框选", needsManualCorrection: "需要校正", waitingStableFrames: "等待稳定帧", paused: "已暂停" } as const)[state];
}

export function linkAnalysisStatusText(status: LinkSessionStatus, analysisBusy: boolean, analysisIsStale: boolean, analysisCount: number, sideToMove?: string, firstMove?: string, pendingExternalMoveDisplay?: string) {
  if (status.lastError) return status.lastError;
  if (status.pendingExternalMove) return `已按箭头1点击 ${pendingExternalMoveDisplay ?? status.pendingExternalMove}，等待网页棋盘响应并同步`;
  if (status.state === "tracking") {
    if (status.mode === "autoPlay") {
      const autoSideText = status.autoSide === "red" ? "红方" : status.autoSide === "black" ? "黑方" : undefined;
      if (analysisBusy) return `局面已同步，引擎正在分析；自动方：${autoSideText ?? "未设置"}`;
      if (analysisIsStale) return "局面已同步，候选已过期，等待引擎刷新后再自动走子";
      if (!firstMove || analysisCount <= 0) return "局面已同步，暂无引擎候选，暂不自动走子";
      if (autoSideText && sideToMove && sideToMove !== autoSideText) return `局面已同步，当前${sideToMove}行棋；设置为${autoSideText}自动执棋`;
      return `自动对战就绪：将执行第一候选 ${firstMove}`;
    }
    if (status.mode === "confirmPlay") {
      if (analysisBusy) return "局面已同步，引擎正在分析，稍后可确认走子";
      if (analysisIsStale) return "局面已同步，等待引擎刷新候选后再确认";
      if (analysisCount > 0 && firstMove) return `局面已同步，可确认第一候选 ${firstMove}`;
    }
    if (analysisBusy) return "局面已同步，引擎正在分析…";
    if (analysisIsStale) return "局面已同步，等待引擎刷新候选";
    if (analysisCount > 0) return `局面已同步，${sideToMove ?? "当前方"}候选已更新`;
    return "局面已同步，等待引擎分析";
  }
  if (status.state === "waitingStableFrames") {
    return `识别到局面，等待稳定帧 ${status.stableFrames}/${status.requiredStableFrames}`;
  }
  if (status.state === "needsManualCorrection") {
    return status.lastError ?? status.reason ?? "识别不到完整棋盘，请重新框选当前棋盘";
  }
  if (status.lastDetectionSummary && status.reason) return `${status.reason}（${status.lastDetectionSummary}）`;
  if (status.captureRunning && status.frameRate <= 0) {
    return status.reason ?? "采集线程刚启动，等待第一帧识别结果";
  }
  return status.reason ?? "框选后会自动识别棋盘、同步局面，并触发引擎分析。";
}

export function linkMiniBoardHintText(options: {
  observed: boolean;
  sideToMove?: string;
  arrowCount: number;
  analysisBusy: boolean;
  analysisIsStale: boolean;
  firstMove?: string;
  lastMove?: { movedBy?: string; notation?: string };
  fallback: string;
}) {
  if (!options.observed) return options.fallback;
  const turn = options.sideToMove ? `${options.sideToMove}行棋` : "局面已同步";
  const candidateSide = options.sideToMove ?? "当前方";
  const candidate = options.analysisIsStale
    ? "候选已过期"
    : options.arrowCount > 0
      ? (options.firstMove ? `${candidateSide}首选：${options.firstMove}` : `${candidateSide}候选 ${options.arrowCount} 条`)
      : options.analysisBusy
        ? `${candidateSide}候选计算中`
        : `等待${candidateSide}候选`;
  const last = options.lastMove
    ? `上一着${options.lastMove.movedBy ?? ""}${options.lastMove.notation ? `：${options.lastMove.notation}` : ""}`
    : "暂无上一着";
  return `${turn} · ${candidate} · ${last}`;
}

export function linkPhaseLabel(status: LinkSessionStatus) {
  const phase = status.phase;
  const phaseLabels = {
    starting: "启动中",
    selecting_region: "等待框选",
    region_selection_cancelled: "已取消",
    region_selection_error: "框选异常",
    recalibrating: "重框选",
    preview_ready: "预览就绪",
    load_model: "加载模型",
    preview_inference: "识别预览",
    model_inference: "模型推理",
    image_inference: "识别图片",
    screen_capture: "采集屏幕",
    waiting_recognition: "待识别",
    waiting_stable_frames: "稳定中",
    recognized: "已识别",
    tracking: "跟盘中",
    move_synced: "走子已同步",
    position_jump_synced: "跳转已同步",
    low_confidence: "低置信度",
    invalid_recognition: "识别异常",
    needs_manual_correction: "需校正",
    timeout: "超时",
    error: "异常",
  } as Record<string, string>;
  if (!status.captureRunning) {
    if (status.state === "tracking") return "已同步";
    if (status.state === "needsManualCorrection") return "需校正";
    if (status.source === "desktopDetect") return "等待扫描";
    if (status.source === "imageImport" || status.source === "cameraBoard") return "等待选图";
    return "等待框选";
  }
  if (phase === "move_synced" || phase === "position_jump_synced") {
    return phaseLabels[phase];
  }
  if (status.frameRate > 0) return `${status.frameRate.toFixed(1)} FPS`;
  return phaseLabels[phase ?? ""] ?? "首帧中";
}

export function linkStatusRenderKey(status: LinkSessionStatus) {
  return [
    status.source,
    status.mode,
    status.state,
    status.phase,
    status.frameRate?.toFixed(1) ?? "",
    status.stableFrames,
    status.requiredStableFrames,
    status.captureRunning,
    status.lastError ?? "",
    status.reason ?? "",
    status.lastDetectionSummary ?? "",
    status.turnIndicator ?? "",
    status.manualTurnOverride ?? "",
    status.confidence == null ? "" : status.confidence.toFixed(3),
    status.recognitionAttempts ?? "",
    status.lastMove ?? "",
    status.latestFen ?? "",
    status.initialPositionSeen ? "seen" : "",
    status.boardOrientation ?? "",
    status.autoSide ?? "",
    status.capturePreviewKind ?? "",
  ].join("|");
}

export function effectiveBoardReversedForLink(status: LinkSessionStatus, boardFen: string, fallbackReversed: boolean) {
  const syncedToCurrentBoard = ((status.state === "tracking" || status.state === "paused") || status.initialPositionSeen === true) && status.latestFen === boardFen;
  if (!syncedToCurrentBoard) return fallbackReversed;
  return status.boardOrientation === "blackAtBottom";
}

export function shouldShowLinkMiniBoard(status: LinkSessionStatus, boardFen: string) {
  return ((status.state === "tracking" || status.state === "paused") && status.latestFen === boardFen)
    || status.initialPositionSeen === true;
}

export function engineBranchActionPresentation(active: boolean, disabled: boolean, stale: boolean) {
  return {
    label: active ? "取消" : "分支",
    ariaLabel: active ? "取消引擎分支预览" : "显示引擎分支",
    title: active
      ? "取消当前 AI 虚线分支预览"
      : stale
        ? "当前引擎分支已过期，请重新分析后再显示"
        : disabled
          ? "当前没有可显示的引擎分支，请先完成分析"
          : "在棋谱树当前节点下显示 AI 虚线分支",
  };
}

export function shouldRefreshAnalysisAfterMove(options: {
  playable: boolean;
  isPlaying: boolean;
  reportBusy: boolean;
  engineSide: "none" | "red" | "black";
  engineThinking: boolean;
  autoAnalyze: boolean;
  analysisHintsEnabled: boolean;
  platformKind: "desktop" | "web";
  enginePath: string;
  online: boolean;
  token: string;
}) {
  if (!options.playable || options.isPlaying || options.reportBusy) return false;
  if (options.engineSide !== "none" || options.engineThinking) return false;
  if (!options.autoAnalyze && !options.analysisHintsEnabled) return false;
  if (options.platformKind === "desktop") return options.enginePath.trim().length > 0;
  return options.online;
}

export function shouldRefreshAnalysisAfterEngineSettingsSave(options: {
  analysisConfigChanged: boolean;
  multipvChanged: boolean;
  hadCurrentAnalysis: boolean;
  playable: boolean;
  isPlaying: boolean;
  reportBusy: boolean;
  engineSide: "none" | "red" | "black";
  engineThinking: boolean;
  autoAnalyzeBefore: boolean;
  autoAnalyzeAfter: boolean;
  analysisHintsEnabled: boolean;
  platformKind: "desktop" | "web";
  enginePath: string;
  online: boolean;
  token: string;
}) {
  if (!options.analysisConfigChanged) return false;
  if (!options.playable || options.isPlaying || options.reportBusy) return false;
  if (options.engineSide !== "none" || options.engineThinking) return false;
  if (options.platformKind === "desktop" && !options.enginePath.trim()) return false;
  if (options.platformKind === "web" && !options.online) return false;
  return options.multipvChanged
    || options.hadCurrentAnalysis
    || options.analysisHintsEnabled
    || options.autoAnalyzeBefore
    || options.autoAnalyzeAfter;
}

export function shouldRestartAnalysisWhenNoCandidates(options: {
  analysisBusy: boolean;
  boardFen: string;
  engineAnalyses: Record<string, Pick<EngineAnalysisGroup, "fen" | "lines">>;
}) {
  if (!options.analysisBusy) return false;
  return !Object.values(options.engineAnalyses).some((group) =>
    group.fen === options.boardFen && group.lines.some((line) => !!line.pv[0]),
  );
}

export function shouldAutoGenerateMasterGameReport(options: {
  platformKind: "desktop" | "web";
  enginePath: string;
}) {
  return options.platformKind === "desktop" && options.enginePath.trim().length > 0;
}

export function selectAnalysisArrowLines(options: {
  lines: AnalysisLine[];
  analysisFen?: string;
  analysisArrowFen?: string;
  boardFen: string;
  analysisIsStale?: boolean;
}) {
  if (options.analysisFen !== options.boardFen) return [];
  if (options.analysisArrowFen !== options.boardFen) return [];
  if (options.analysisIsStale) return [];
  return options.lines
    .filter((line) => line.multipv >= 1 && line.pv.length > 0);
}

export function mobileCandidateArrowLines(lines: AnalysisLine[], multipv: number) {
  const limit = Math.max(1, Math.trunc(multipv));
  return lines
    .filter((line) => line.multipv >= 1 && line.pv.length > 0)
    .sort((left, right) => left.multipv - right.multipv)
    .slice(0, limit);
}

export function compactBoardEvaluationRailText(options: {
  sideText: string;
  scoreText?: string;
  mateSide?: string;
  mateIn?: number;
  isCheckmate?: boolean;
  balanced?: boolean;
}) {
  if (options.balanced) return { side: options.sideText, score: options.scoreText ?? "--" };
  if (options.mateSide) {
    const side = `${options.mateSide === "红方" ? "红" : "黑"}${options.isCheckmate ? "胜" : "杀"}`;
    const score = options.isCheckmate ? "将死" : options.mateIn == null ? options.scoreText ?? "--" : `${options.mateIn}步杀`;
    return { side, score };
  }
  return { side: options.sideText, score: options.scoreText ?? "--" };
}

export function canRequestEngineMoveNow(options: {
  platformKind: "desktop" | "web";
  playable: boolean;
  reportBusy: boolean;
  engineSide: "none" | "red" | "black";
  engineStarting: boolean;
  sideToMove: string;
}) {
  if (options.platformKind !== "desktop") return false;
  if (!options.playable || options.reportBusy || options.engineStarting) return false;
  if (options.engineSide === "none") return false;
  return (options.engineSide === "red" && options.sideToMove === "红方")
    || (options.engineSide === "black" && options.sideToMove === "黑方");
}

export function analysisPassPlan(options: {
  automatic: boolean;
  platformKind: "desktop" | "web";
  searchMode: AnalysisOptions["searchMode"];
  searchValue: number;
}) {
  const configuredMode = options.automatic && options.searchMode === "infinite" ? "depth" : options.searchMode;
  const configuredValue = options.automatic && options.searchMode === "infinite" ? DEFAULT_ANALYSIS_DEPTH : options.searchValue;
  const shouldRunQuickPass = options.platformKind === "desktop"
    && (configuredMode !== "time" || configuredValue > QUICK_ANALYSIS_TIME_MS);
  return {
    configuredMode,
    configuredValue,
    quick: shouldRunQuickPass ? { searchMode: "time" as const, searchValue: QUICK_ANALYSIS_TIME_MS } : undefined,
    deep: { searchMode: configuredMode, searchValue: configuredValue },
  };
}

export function analysisFirstCandidateTimeoutMs(platformKind: "desktop" | "web") {
  // The web API returns its completed principal variation in one response.
  // A depth-20/30 request may legitimately take longer than the desktop
  // engine's first streaming info line.
  return platformKind === "web" ? 15_000 : 3_000;
}

export function shouldQueueWebAnalysisReplacement(platformKind: "desktop" | "web", analysisBusy: boolean) {
  return platformKind === "web" && analysisBusy;
}

export function normalizeMobileCloudAnalysisPreferences(preferences: CloudAnalysisPreferences, mobile: boolean) {
  if (!mobile || preferences.mobileDefaultDepthVersion === MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION) return preferences;
  return preferences.searchMode === "depth" && preferences.searchValue === 30
    ? { ...preferences, searchValue: MOBILE_DEFAULT_ANALYSIS_DEPTH, mobileDefaultDepthVersion: MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION }
    : { ...preferences, mobileDefaultDepthVersion: MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION };
}

function analysisLimitText(mode: AnalysisOptions["searchMode"], value: number) {
  if (mode === "depth") return `深度 ${value}`;
  if (mode === "time") return `时间 ${(value / 1000).toFixed(1)}s`;
  if (mode === "nodes") return `${value.toLocaleString()} 节点`;
  return `深度 ${BOOK_CANDIDATE_AUDIT_DEPTH}`;
}

type LinkRegionRect = { x: number; y: number; width: number; height: number };

function LinkRegionSelector() {
  const [start, setStart] = useState<{ x: number; y: number }>();
  const [current, setCurrent] = useState<{ x: number; y: number }>();
  const [background, setBackground] = useState<string>();
  const [error, setError] = useState<string>();
  const rect = useMemo<LinkRegionRect | undefined>(() => {
    if (!start || !current) return undefined;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    return {
      x,
      y,
      width: Math.abs(start.x - current.x),
      height: Math.abs(start.y - current.y),
    };
  }, [current, start]);

  const cancel = () => {
    void invoke("cancel_link_region_selection").catch(() => undefined);
  };
  const complete = (selection: LinkRegionRect) => {
    if (selection.width < 80 || selection.height < 80) {
      setError("区域太小了，请拖出完整棋盘。");
      return;
    }
    void invoke("complete_link_region_selection", { selection }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  useEffect(() => {
    void invoke<string | undefined>("get_link_region_selection_background")
      .then(setBackground)
      .catch(() => setBackground(undefined));
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function point(event: PointerEvent<HTMLDivElement>) {
    return { x: event.clientX, y: event.clientY };
  }

  return (
    <div
      className="link-region-selector"
      role="application"
      aria-label="框选第三方棋盘区域"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const next = point(event);
        setError(undefined);
        setStart(next);
        setCurrent(next);
      }}
      onPointerMove={(event) => {
        if (!start || event.buttons === 0) return;
        setCurrent(point(event));
      }}
      onPointerUp={(event) => {
        if (!start) return;
        const end = point(event);
        const selection = {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(start.x - end.x),
          height: Math.abs(start.y - end.y),
        };
        setStart(undefined);
        setCurrent(undefined);
        complete(selection);
      }}
    >
      {background && <img className="link-region-background" src={background} alt="当前桌面快照" draggable={false}/>}
      <div className="link-region-toolbar">
        <strong>拖动框选网页棋盘</strong>
        <span>只选棋盘主体，别把本应用浮窗/主棋盘框进去；Esc 取消。</span>
        {error && <em>{error}</em>}
        <button type="button" onClick={(event) => { event.stopPropagation(); cancel(); }}>取消</button>
      </div>
      {rect && <div className="link-region-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />}
    </div>
  );
}

function readEngineAnalysisSnapshot(): EngineAnalysisSnapshot | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(ENGINE_ANALYSIS_SNAPSHOT_KEY) ?? "null") as Partial<EngineAnalysisSnapshot> | null;
    if (!value || typeof value.fen !== "string" || typeof value.primaryEngineId !== "string" || !value.groups || typeof value.groups !== "object") return undefined;
    const groups = Object.fromEntries(Object.entries(value.groups).flatMap(([id, group]) => {
      if (!group || typeof group.fen !== "string" || typeof group.name !== "string" || !Array.isArray(group.lines)) return [];
      return [[id, { fen: group.fen, name: group.name, lines: group.lines, error: group.error }]];
    }));
    return { fen: value.fen, primaryEngineId: value.primaryEngineId, groups, busy: value.busy === true };
  } catch {
    return undefined;
  }
}
const backRankKinds = ["rook", "horse", "elephant", "advisor", "king", "advisor", "elephant", "horse", "rook"];
const initialPieces: Piece[] = [
  ..."车马象士将士象马车".split("").map((label, col) => ({ row: 0, col, color: "black" as const, kind: backRankKinds[col], label })),
  { row: 2, col: 1, color: "black", kind: "cannon", label: "炮" },
  { row: 2, col: 7, color: "black", kind: "cannon", label: "炮" },
  ...[0, 2, 4, 6, 8].map((col) => ({ row: 3, col, color: "black" as const, kind: "pawn", label: "卒" })),
  ...[0, 2, 4, 6, 8].map((col) => ({ row: 6, col, color: "red" as const, kind: "pawn", label: "兵" })),
  { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
  { row: 7, col: 7, color: "red", kind: "cannon", label: "炮" },
  ..."车马相仕帅仕相马车".split("").map((label, col) => ({ row: 9, col, color: "red" as const, kind: backRankKinds[col], label })),
];
const fallback: BoardState = {
  fen: startingFen,
  rootSideToMove: "红方",
  sideToMove: "红方",
  status: "进行中",
  ruleName: "国内中国象棋规则（2020版导向）",
  ruleVerdict: "ongoing",
  ruleReason: "国内中国象棋规则（2020版导向）：对局进行中",
  pieces: initialPieces,
  history: [],
  continuation: [],
  branches: [],
  title: "新建棋谱",
  note: "",
  playable: true,
};

const ruleModeLabels: Record<DesktopPreferencesDto["ruleMode"], string> = {
  domestic2020: "国内中国象棋规则（2020版导向）",
  asianAxf: "亚洲象棋规则（AXF导向）",
};
const defaultRuleMode: DesktopPreferencesDto["ruleMode"] = "domestic2020";
const engineBlockingRuleVerdicts = new Set([
  "checkmate",
  "stalemate",
  "drawByNaturalLimit",
  "pendingRepetition",
  "pendingAsianRepetition",
  "lossByPerpetualCheck",
  "lossByPerpetualChase",
  "drawByRepetitionMvp",
]);
const pieceCode: Record<string, string> = {
  rook: "r",
  horse: "n",
  elephant: "b",
  advisor: "a",
  king: "k",
  cannon: "c",
  pawn: "p",
};
const analysisArrowColors = [
  "#53b848",
  "#c5438c",
  "#d0b52d",
  "#3fa7d6",
  "#e77d35",
  "#7e68c9",
  "#d65b52",
  "#2ca58d",
  "#88b04b",
  "#db7093",
];
const defaultDesktopPreferences: DesktopPreferencesDto = {
  enginePath: "",
  threads: 2,
  hashMb: 256,
  multipv: DEFAULT_ENGINE_CANDIDATES,
  candidateLineMoves: DEFAULT_CANDIDATE_LINE_MOVES,
  searchMode: "depth",
  searchValue: DEFAULT_ANALYSIS_DEPTH,
  moveTimeMs: DEFAULT_ENGINE_MOVE_TIME_MS,
  ponder: false,
  autoAnalyze: false,
  libraryCollapsed: true,
  candidateRailCollapsed: false,
  analysisPanelCollapsed: false,
  evaluationCollapsed: true,
  branchArrowColor: DEFAULT_BRANCH_ARROW_COLOR,
  workspacePanel: "moves",
  layoutMode: "compact",
  manualViewMode: "track",
  colorTheme: "dark",
  boardSkin: "default",
  pieceSkin: "default",
  reportDepth: DEFAULT_REPORT_DEPTH,
  builtinOpeningBookEnabled: true,
  activeBuiltinOpeningBookId: DEFAULT_BUILTIN_OPENING_BOOK_ID,
  cloudBookEnabled: true,
  cloudBookUrl: "https://www.chessdb.cn/chessdb.php",
  analysisEngineMode: "single",
  parallelEngineIds: [],
  parallelEnginePaths: [],
  ruleMode: defaultRuleMode,
  linkCaptureSource: "windowLink",
  linkRecognitionMode: "yoloBoard",
  linkMode: "spectate",
  linkStableFrames: 2,
  linkConfidenceThreshold: 55,
  linkAnimationConfirmation: true,
  gameMirrorEnabled: true,
  gameMirrorRoot: "",
  serverUrl: "http://127.0.0.1:8080",
};
const defaultSyncAccount: SyncAccountDto = {
  serverUrl: defaultDesktopPreferences.serverUrl,
  status: "unbound",
};

function migrateDesktopPreferences(preferences: DesktopPreferencesDto): DesktopPreferencesDto {
  const legacyAnalysisDefaults = ((preferences.searchMode === "time" || preferences.searchMode === "infinite") && preferences.searchValue === 1500)
    || (preferences.searchMode === "depth" && (preferences.searchValue === 30 || preferences.searchValue === 26));
  const migratedSearchDefaults = (preferences.searchMode === "time" || preferences.searchMode === "infinite") && preferences.searchValue === 1500
    ? { searchMode: "depth" as const, searchValue: DEFAULT_ANALYSIS_DEPTH }
    : preferences.searchMode === "depth" && (preferences.searchValue === 30 || preferences.searchValue === 26)
      ? { searchMode: "depth" as const, searchValue: DEFAULT_ANALYSIS_DEPTH }
      : {};
  const enginePath = preferences.enginePath === BUILTIN_FAIRY_ENGINE_PATH ? BUILTIN_ENGINE_PATH : preferences.enginePath;
  const linkConfidenceThreshold = preferences.linkConfidenceThreshold === 70 ? 55 : preferences.linkConfidenceThreshold;
  const multipv = preferences.multipv < MIN_ENGINE_CANDIDATES
    ? DEFAULT_ENGINE_CANDIDATES
    : preferences.multipv;
  const candidateLineMoves = preferences.candidateLineMoves === 6 || preferences.candidateLineMoves < MIN_CANDIDATE_LINE_MOVES || preferences.candidateLineMoves > DEFAULT_CANDIDATE_LINE_MOVES
    ? DEFAULT_CANDIDATE_LINE_MOVES
    : preferences.candidateLineMoves;
  return {
    ...preferences,
    ...migratedSearchDefaults,
    enginePath,
    autoAnalyze: legacyAnalysisDefaults && preferences.autoAnalyze ? false : preferences.autoAnalyze,
    multipv,
    parallelEnginePaths: (preferences.parallelEnginePaths ?? []).filter((path) => path !== BUILTIN_FAIRY_ENGINE_PATH),
    linkConfidenceThreshold,
    candidateLineMoves,
    reportDepth: preferences.reportDepth === 30 || preferences.reportDepth === 26 ? DEFAULT_REPORT_DEPTH : preferences.reportDepth,
    builtinOpeningBookEnabled: preferences.builtinOpeningBookEnabled ?? true,
    activeBuiltinOpeningBookId: preferences.activeBuiltinOpeningBookId || DEFAULT_BUILTIN_OPENING_BOOK_ID,
    ruleMode: preferences.ruleMode === "asianAxf" ? "asianAxf" : defaultRuleMode,
  };
}

function ruleModeLabel(ruleMode?: DesktopPreferencesDto["ruleMode"]) {
  return ruleModeLabels[ruleMode ?? defaultRuleMode] ?? ruleModeLabels[defaultRuleMode];
}

function engineDisplayName(path: string) {
  if (path === BUILTIN_ENGINE_PATH) return "内置 Pikafish";
  if (path === BUILTIN_FAIRY_ENGINE_PATH) return "内置 Fairy-Stockfish 已移除";
  return path ? path.split(/[\\/]/).at(-1) ?? path : "选择引擎";
}

function shortHash(hash?: string) {
  return hash ? hash.replace(/^sha256:/, "").slice(0, 12) : undefined;
}

function engineProbeDisplayName(fallbackName: string, probe?: EngineProbeDto) {
  return probe?.engineVersion ?? fallbackName;
}

function nnueProbeLabel(probe?: EngineProbeDto) {
  if (!probe?.nnueFile) return undefined;
  return `NNUE ${probe.nnueFile}${probe.nnueVersion ? ` ${probe.nnueVersion}` : ""}`;
}

function engineProbeTitle(fallbackName: string, path: string, probe?: EngineProbeDto) {
  const lines = [`当前主引擎：${engineProbeDisplayName(fallbackName, probe)}`];
  if (path) lines.push(`路径：${path}`);
  if (probe?.engineSha256) lines.push(`引擎 SHA256：${probe.engineSha256}`);
  const nnue = nnueProbeLabel(probe);
  if (nnue) lines.push(nnue);
  if (probe?.nnueSha256) lines.push(`NNUE SHA256：${probe.nnueSha256}`);
  if (probe?.fingerprint) lines.push(`资源指纹：${probe.fingerprint}`);
  return lines.join("\n");
}

function externalEngineProfiles(profiles: EngineProfileDto[]) {
  return profiles.filter((profile) => profile.executablePath !== BUILTIN_ENGINE_PATH && profile.executablePath !== BUILTIN_FAIRY_ENGINE_PATH);
}

const editorPalette: Piece[] = [
  ...["rook", "horse", "elephant", "advisor", "king", "cannon", "pawn"].map((kind, index) => ({ row: 0, col: index, color: "red" as const, kind, label: ["车", "马", "相", "仕", "帅", "炮", "兵"][index] })),
  ...["rook", "horse", "elephant", "advisor", "king", "cannon", "pawn"].map((kind, index) => ({ row: 1, col: index, color: "black" as const, kind, label: ["车", "马", "象", "士", "将", "炮", "卒"][index] })),
];

function initialAutoAnalysis() {
  try {
    return localStorage.getItem("xiangqi:auto-analysis") === "true";
  } catch {
    return false;
  }
}

function initialWorkspaceLayout(): DesktopPreferencesDto["layoutMode"] {
  try {
    return localStorage.getItem("xiangqi:workspace-layout") === "studio" ? "studio" : "compact";
  } catch {
    return "compact";
  }
}

function initialManualViewMode(): ManualViewMode {
  try {
    return localStorage.getItem("xiangqi:manual-view-mode") === "tree" ? "tree" : "track";
  } catch {
    return "track";
  }
}

function normalizeBoardState(value?: Partial<BoardState> | null): BoardState {
  return {
    ...fallback,
    ...value,
    pieces: Array.isArray(value?.pieces) ? value.pieces : fallback.pieces,
    history: Array.isArray(value?.history) ? value.history : [],
    continuation: Array.isArray(value?.continuation) ? value.continuation : [],
    branches: Array.isArray(value?.branches) ? value.branches : [],
    siblingBranches: Array.isArray(value?.siblingBranches) ? value.siblingBranches : [],
    manualTree: Array.isArray(value?.manualTree) ? value.manualTree : [],
  };
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("__TAURI") || message.includes("invoke")) return "此操作需要在桌面应用中执行";
  return message.replace(/^TypeError:\s*/i, "").slice(0, 140) || "操作失败";
}

function squareToIccs(row: number, col: number) {
  return `${String.fromCharCode(97 + col)}${9 - row}`;
}

function squareFromIccs(value: string) {
  if (!/^[a-i][0-9]$/.test(value)) return null;
  return { row: 9 - Number(value[1]), col: value.charCodeAt(0) - 97 };
}

function pieceAsset(piece: Piece, skin: DesktopPreferencesDto["pieceSkin"]) {
  const folder = skinAssetFolder(skin);
  return `/skins/${folder}/${piece.color === "red" ? "r" : "b"}${pieceCode[piece.kind] ?? "p"}.png`;
}

function piecesToFen(pieces: Piece[], side: "red" | "black") {
  const map = new Map(pieces.map((piece) => [`${piece.row}-${piece.col}`, piece]));
  const ranks = Array.from({ length: 10 }, (_, row) => {
    let rank = "";
    let empty = 0;
    for (let col = 0; col < 9; col += 1) {
      const piece = map.get(`${row}-${col}`);
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) rank += String(empty);
      empty = 0;
      const code = pieceCode[piece.kind] ?? "p";
      rank += piece.color === "red" ? code.toUpperCase() : code;
    }
    if (empty) rank += String(empty);
    return rank;
  });
  return `${ranks.join("/")} ${side === "red" ? "w" : "b"} - - 0 1`;
}

const linkMiniPieceKey = (piece: Pick<Piece, "row" | "col">) => `${piece.row}-${piece.col}`;
const linkMiniPieceTypeKey = (piece: Pick<Piece, "color" | "kind">) => `${piece.color}-${piece.kind}`;
const linkMiniPieceKindKey = (piece: Pick<Piece, "kind">) => piece.kind;
const linkMiniSamePieceType = (left: Pick<Piece, "color" | "kind">, right: Pick<Piece, "color" | "kind">) => (
  left.color === right.color && left.kind === right.kind
);
const linkMiniPieceTypeCounts = (pieces: Piece[]) => pieces.reduce((counts, piece) => {
  const key = linkMiniPieceTypeKey(piece);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map<string, number>());
const linkMiniPieceKindCounts = (pieces: Piece[]) => pieces.reduce((counts, piece) => {
  const key = linkMiniPieceKindKey(piece);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map<string, number>());

function recoverStableLinkMiniStaticPieces(
  stablePieces: Piece[],
  currentPieces: Piece[],
  move: Pick<MoveItem, "from" | "to">,
) {
  const fromKey = linkMiniPieceKey(move.from);
  const toKey = linkMiniPieceKey(move.to);
  const occupiedSquares = new Set(stablePieces.map(linkMiniPieceKey));
  const stableCounts = linkMiniPieceTypeCounts(stablePieces);
  const currentCounts = linkMiniPieceTypeCounts(currentPieces);
  const stableKindCounts = linkMiniPieceKindCounts(stablePieces);
  const currentKindCounts = linkMiniPieceKindCounts(currentPieces);
  const recoveredPieces: Piece[] = [];

  for (const piece of currentPieces) {
    const square = linkMiniPieceKey(piece);
    if (square === fromKey || square === toKey || occupiedSquares.has(square)) continue;
    const type = linkMiniPieceTypeKey(piece);
    const kind = linkMiniPieceKindKey(piece);
    if ((stableCounts.get(type) ?? 0) >= (currentCounts.get(type) ?? 0)) continue;
    if ((stableKindCounts.get(kind) ?? 0) >= (currentKindCounts.get(kind) ?? 0)) continue;
    recoveredPieces.push(piece);
    occupiedSquares.add(square);
    stableCounts.set(type, (stableCounts.get(type) ?? 0) + 1);
    stableKindCounts.set(kind, (stableKindCounts.get(kind) ?? 0) + 1);
  }

  return recoveredPieces.length ? [...stablePieces, ...recoveredPieces] : stablePieces;
}

export function stableLinkMiniPiecesForMove(
  previousPieces: Piece[],
  currentPieces: Piece[],
  move?: Pick<MoveItem, "from" | "to">,
) {
  if (!move || previousPieces.length === 0) return currentPieces;
  const fromKey = linkMiniPieceKey(move.from);
  const toKey = linkMiniPieceKey(move.to);
  if (fromKey === toKey) return currentPieces;
  const mover = previousPieces.find((piece) => linkMiniPieceKey(piece) === fromKey);
  if (!mover) return currentPieces;
  const previousTarget = previousPieces.find((piece) => linkMiniPieceKey(piece) === toKey);
  if (previousTarget && previousTarget.color === mover.color) return currentPieces;
  const recognizedMover = currentPieces.find((piece) => linkMiniPieceKey(piece) === toKey && linkMiniSamePieceType(piece, mover));
  const movedPiece = recognizedMover ?? { ...mover, row: move.to.row, col: move.to.col };
  const stablePieces = previousPieces.flatMap((piece) => {
    const key = linkMiniPieceKey(piece);
    if (key === fromKey) return [{ ...movedPiece, row: move.to.row, col: move.to.col }];
    if (key === toKey) return [];
    return [piece];
  });
  return recoverStableLinkMiniStaticPieces(stablePieces, currentPieces, move);
}

type LinkMiniPieceRenderState = { active: boolean; fen?: string; moveKey?: string; pieces: Piece[] };

export function nextStableLinkMiniPieceState(
  state: LinkMiniPieceRenderState,
  options: {
    boardFen: string;
    boardPieces: Piece[];
    linkDisplayedLastMove?: Pick<MoveItem, "from" | "to">;
    linkDisplayedLastMoveKey?: string;
    linkShouldShowMiniBoard: boolean;
    allowFullRefreshWithoutMove?: boolean;
  },
): LinkMiniPieceRenderState {
  if (!options.linkShouldShowMiniBoard) {
    return {
      ...state,
      active: false,
      pieces: state.pieces.length ? state.pieces : options.boardPieces,
    };
  }

  if (!state.active || !state.pieces.length) {
    return {
      active: true,
      fen: options.boardFen,
      moveKey: options.linkDisplayedLastMoveKey,
      pieces: options.boardPieces,
    };
  }

  if (!options.linkDisplayedLastMove) {
    if (options.allowFullRefreshWithoutMove) {
      return {
        active: true,
        fen: options.boardFen,
        moveKey: options.linkDisplayedLastMoveKey,
        pieces: options.boardPieces,
      };
    }
    return { ...state, active: true };
  }

  if (state.fen === options.boardFen && state.moveKey === options.linkDisplayedLastMoveKey) {
    return { ...state, active: true };
  }

  return {
    active: true,
    fen: options.boardFen,
    moveKey: options.linkDisplayedLastMoveKey,
    pieces: stableLinkMiniPiecesForMove(state.pieces, options.boardPieces, options.linkDisplayedLastMove),
  };
}

type LinkDisplayedMove = Pick<MoveItem, "from" | "to" | "notation" | "movedBy">;

/**
 * Keeps the research-board move overlay on the same canonical intersections
 * as pieces, click cells, analysis arrows, and flipped-board presentation.
 */
export function mainBoardLastMoveOverlayPoints(
  move: Pick<MoveItem, "from" | "to"> | undefined,
  reversed = false,
  boardSkin?: string,
) {
  if (!move) return undefined;
  return {
    from: boardIntersectionPoint(move.from, reversed, boardSkin),
    to: boardIntersectionPoint(move.to, reversed, boardSkin),
  };
}

function MainBoardLastMoveOverlay({
  move,
  reversed,
  boardSkin,
}: {
  move: Pick<MoveItem, "from" | "to"> | undefined;
  reversed: boolean;
  boardSkin?: string;
}) {
  const points = mainBoardLastMoveOverlayPoints(move, reversed, boardSkin);
  if (!points) return null;

  return (
    <svg
      className="main-board-last-move-flow"
      data-testid="main-board-last-move-flow"
      data-from={`${points.from.x},${points.from.y}`}
      data-to={`${points.to.x},${points.to.y}`}
      viewBox="0 0 1120 1240"
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 8,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <g className="main-board-last-move-source">
        {/* The source only identifies where the piece left. Keep it compact and
            static so the blue destination remains the visual destination. */}
        <circle className="main-board-last-move-source-ring" cx={points.from.x} cy={points.from.y} r="19" fill="none" stroke="rgba(38, 135, 242, .98)" strokeWidth="3.4" vectorEffect="non-scaling-stroke" filter="drop-shadow(0 0 2px rgba(38, 135, 242, .78))" />
        <circle className="main-board-last-move-source-center" cx={points.from.x} cy={points.from.y} r="7.6" fill="rgba(255, 255, 255, .98)" filter="drop-shadow(0 0 1px rgba(255, 255, 255, .75))" />
      </g>
      <g className="main-board-last-move-target">
        <circle cx={points.to.x} cy={points.to.y} r="54" fill="rgba(40, 132, 255, .05)" stroke="rgba(68, 151, 255, .38)" strokeWidth="8" />
        <circle cx={points.to.x} cy={points.to.y} r="49" fill="none" stroke="#2788f5" strokeWidth="4.5" />
        <circle cx={points.to.x} cy={points.to.y} r="43" fill="none" stroke="rgba(255, 255, 255, .96)" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="17 33" opacity=".98" vectorEffect="non-scaling-stroke" filter="drop-shadow(0 0 2px rgba(255, 255, 255, .92))">
          <animate attributeName="stroke-dashoffset" values="102;0" dur="4.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={points.to.x} cy={points.to.y} r="50" fill="none" stroke="#197de2" strokeWidth="2.3" strokeLinecap="round" strokeDasharray="14 36" opacity=".9" vectorEffect="non-scaling-stroke" filter="drop-shadow(0 0 2px rgba(25, 125, 226, .78))">
          <animate attributeName="stroke-dashoffset" values="0;104" dur="5.2s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}

export function selectLinkDisplayedLastMove(options: {
  linkShouldShowMiniBoard: boolean;
  statusLatestFen?: string;
  boardFen: string;
  statusLastMove?: LinkDisplayedMove;
  boardLastMove?: LinkDisplayedMove;
}) {
  if (!options.linkShouldShowMiniBoard) return undefined;
  if (options.statusLatestFen === options.boardFen && options.statusLastMove) {
    return options.statusLastMove;
  }
  return options.boardLastMove;
}

function formatNps(nps?: number) {
  if (!nps) return "-";
  return nps >= 1_000_000 ? `${(nps / 1_000_000).toFixed(1)}M` : `${Math.round(nps / 1000)}K`;
}

function formatHashfull(hashfull?: number) {
  if (hashfull == null) return "--";
  const percent = Math.max(0, Math.min(100, hashfull / 10));
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatAnalysisScore(line: AnalysisLine) {
  if (line.mate != null) return line.mate >= 0 ? `杀 ${line.mate}` : `被杀 ${Math.abs(line.mate)}`;
  const score = Math.round(line.scoreCp ?? 0);
  return score > 0 ? `+${score}` : `${score}`;
}

function formatMoveScore(move: MoveItem) {
  if (move.mate != null) return move.mate >= 0 ? `杀${move.mate}` : `被杀${Math.abs(move.mate)}`;
  if (move.scoreCp == null) return "";
  const score = Math.round(move.scoreCp);
  return score > 0 ? `+${score}` : `${score}`;
}

function formatRedScore(scoreCp?: number) {
  if (scoreCp == null) return "待分析";
  const score = Math.round(scoreCp);
  return score > 0 ? `+${score}` : `${score}`;
}

function formatScoreDelta(scoreCp?: number) {
  if (scoreCp == null) return "缺少相邻局面分数";
  const score = Math.round(scoreCp);
  return `红方视角 ${score >= 0 ? "+" : ""}${score}`;
}

function formatOpeningBookScore(score: number) {
  if (!Number.isFinite(score)) return "--";
  const rounded = Math.round(score);
  if (rounded > 0) return `红优 +${rounded}`;
  if (rounded < 0) return `黑优 ${rounded}`;
  return "均势 0";
}

function formatOpeningBookGap(gap: number) {
  if (!Number.isFinite(gap)) return undefined;
  const rounded = Math.max(0, Math.round(gap));
  return rounded === 0 ? "首选" : `差 ${rounded}`;
}

function formatReportScore(move: MoveItem, redScoreCp?: number) {
  if (move.mate != null) {
    const redMate = move.movedBy === "黑方" ? move.mate : -move.mate;
    return `${redMate >= 0 ? "红" : "黑"}杀${Math.abs(redMate)}`;
  }
  return formatRedScore(redScoreCp);
}
function noteField(note: string, label: string) {
  const match = note.match(new RegExp(`(?:^|\\n)${label}：([^\\n]+)`));
  return match?.[1]?.trim();
}
function scoreDisplay(score?: number) {
  return score == null ? "--" : `${Math.round(score)}分`;
}
function sideResultText(result?: string) {
  if (result === "1-0") return "红胜";
  if (result === "0-1") return "黑胜";
  if (result === "1/2-1/2") return "和棋";
  return result?.trim() || "*";
}

type CandidatePreviewState = {
  rank: number;
  color: string;
  sourceEngineId: string;
  sourceEngineName: string;
  sourceFen: string;
  firstMove: string;
  intent: string;
  possibility: string;
  risk: string;
  steps: PreviewLineStep[];
  step: number;
};

type BestMovePractice = BestMoveHint & {
  fen: string;
  ply: number;
};

type FlyknifePractice = {
  plan: FlyknifePlan;
  fen: string;
  ply: number;
  step: number;
};

export function evaluateBestMovePractice(practice: BestMovePractice | undefined, playedMove: string, playedMoveText?: string) {
  if (!practice) return undefined;
  const normalizedPlayedMove = playedMove.trim();
  const matched = practice.topMoves.find((move) => move.iccs === normalizedPlayedMove);
  const bestLabel = practice.bestMoveText || practice.bestMove || "暂无首选";
  const playedLabel = playedMoveText && playedMoveText !== normalizedPlayedMove ? `${playedMoveText}（${normalizedPlayedMove}）` : playedMoveText || normalizedPlayedMove;
  if (practice.bestMove && normalizedPlayedMove === practice.bestMove) {
    return { kind: "best" as const, message: `正着：命中 Pikafish 首选 ${bestLabel}` };
  }
  if (matched) {
    const moveLabel = matched.text && matched.text !== matched.iccs ? `${matched.text}（${matched.iccs}）` : matched.text || matched.iccs;
    return { kind: "topn" as const, message: `可接受：${playedLabel} 命中第 ${matched.rank} 候选 ${moveLabel}；首选是 ${bestLabel}` };
  }
  return { kind: "miss" as const, message: `未命中：你走 ${playedLabel}，首选是 ${bestLabel}，可回到思路查看依据` };
}

function previewStepAdvice(preview: CandidatePreviewState, step: PreviewLineStep) {
  if (preview.step === 0) return preview.intent;
  if (step.status === "将军") return `${step.movedBy}通过「${step.notation}」形成将军，下一步要重点看对方是否只能应将。`;
  if (step.status === "将死") return `${step.movedBy}通过「${step.notation}」进入将死局面，这条线已经出现强制结果。`;
  if (preview.step % 2 === 1) return `对方用「${step.notation}」回应，主要观察它是否化解首选威胁，或制造反先手。`;
  return `${step.movedBy}继续「${step.notation}」，看这条线能否延续首着计划并保持局面分。`;
}

export default function App() {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("linkRegionSelector")) {
    return <LinkRegionSelector/>;
  }

  const [board, setBoard] = useState<BoardState>(fallback);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [reversed, setReversed] = useState(false);
  const [fenInput, setFenInput] = useState(startingFen);
  const [enginePath, setEnginePath] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisLine[]>([]);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisLine[]>([]);
  const [engineAnalyses, setEngineAnalyses] = useState<Record<string, EngineAnalysisGroup>>({});
  const [analysisFen, setAnalysisFen] = useState<string>();
  const [analysisSideToMove, setAnalysisSideToMove] = useState<BoardState["sideToMove"]>();
  const [analysisArrowFen, setAnalysisArrowFen] = useState<string>();
  const [analysisHintsEnabled, setAnalysisHintsEnabled] = useState(false);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [flyknifePlans, setFlyknifePlans] = useState<FlyknifePlan[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<string>("all");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryTagsInput, setLibraryTagsInput] = useState("");
  const [searchMode, setSearchMode] = useState<"time" | "depth" | "nodes" | "infinite">(() => window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches ? "depth" : "infinite");
  const [searchValue, setSearchValue] = useState(() => window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches ? MOBILE_DEFAULT_ANALYSIS_DEPTH : 1500);
  const [threads, setThreads] = useState(2);
  const [hashMb, setHashMb] = useState(256);
  const [multipv, setMultipv] = useState(1);
  const [autoAnalyze, setAutoAnalyze] = useState(initialAutoAnalysis);
  const [autoRetry, setAutoRetry] = useState(0);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string>();
  const [syncBusy, setSyncBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8080");
  const [token, setToken] = useState("");
  const [cloudConnection, setCloudConnection] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [cloudPreferencesReady, setCloudPreferencesReady] = useState(false);
  const [notice, setNotice] = useState("本地数据已保存");
  const [autosave, setAutosave] = useState<AutosaveState>({ status: "draft" });
  const [mobilePanel, setMobilePanel] = useState<"board" | "library" | "analysis" | "settings">("board");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileExportOpen, setMobileExportOpen] = useState(false);
  const [mobileArrowsEnabled, setMobileArrowsEnabled] = useState(true);
  const [mobileArrowFocus, setMobileArrowFocus] = useState<string>();
  const [isMobileWorkbench, setIsMobileWorkbench] = useState(() => window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches);
  const mobileDefaultDepthVersionRef = useRef(isMobileWorkbench);
  const mobileDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>("moves");
  // Review is the default entry. Research and training reuse this same board and
  // local game state, so switching modes never creates a second document copy.
  const [reviewModeOpen, setReviewModeOpen] = useState(chessPlatform.kind === "desktop");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("review");
  const [candidateRailCollapsed, setCandidateRailCollapsed] = useState(false);
  const [analysisPanelCollapsed, setAnalysisPanelCollapsed] = useState(false);
  const [analysisPanelReopenTop, setAnalysisPanelReopenTop] = useState(readAnalysisPanelReopenTop);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [linkSessionOpen, setLinkSessionOpen] = useState(false);
  const [linkSessionSource, setLinkSessionSource] = useState<"windowLink" | "imageImport">("windowLink");
  const [flyknifeOpen, setFlyknifeOpen] = useState(false);
  const [flyknifePractice, setFlyknifePractice] = useState<FlyknifePractice>();
  const [editorPieces, setEditorPieces] = useState<Piece[]>(initialPieces);
  const [editorPiece, setEditorPiece] = useState<Piece | null>(editorPalette[0]);
  const [editorSide, setEditorSide] = useState<"red" | "black">("red");
  const [gameTitle, setGameTitle] = useState("新建棋谱");
  const [gameNote, setGameNote] = useState("");
  const [engineSide, setEngineSide] = useState<"none" | "red" | "black">("none");
  const [engineStarting, setEngineStarting] = useState(false);
  const [engineThinking, setEngineThinking] = useState(false);
  const [moveTimeMs, setMoveTimeMs] = useState(2000);
  const [ponderEnabled, setPonderEnabled] = useState(false);
  const [ponderMove, setPonderMove] = useState<string | undefined>();
  const [engineRuntimeState, setEngineRuntimeState] = useState<EngineRuntimeState>("idle");
  const [desktopPreferences, setDesktopPreferences] = useState(defaultDesktopPreferences);
  const [builtinOpeningBookManifest, setBuiltinOpeningBookManifest] = useState<BuiltinOpeningBookManifestDto>(FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST);
  const [libraryCollapsed, setLibraryCollapsed] = useState(true);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => initialColorTheme(chessPlatform.kind));
  const effectiveColorTheme: ColorTheme = desktopPreferences.layoutMode === "compact" ? "light" : "dark";
  const [gameReport, setGameReport] = useState<GameReportDatasetDto>();
  const [reportProgress, setReportProgress] = useState<GameReportProgressDto>();
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [masterAnalysisDialogOpen, setMasterAnalysisDialogOpen] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [skinMenuOpen, setSkinMenuOpen] = useState(false);
  const [skinShopOpen, setSkinShopOpen] = useState(false);
  const [skinHoverPreview, setSkinHoverPreview] = useState<Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">>();
  const [manualExporting, setManualExporting] = useState(false);
  const [analysisHelpOpen, setAnalysisHelpOpen] = useState(false);
  const [trendCursorIndex, setTrendCursorIndex] = useState<number | undefined>();
  const [candidatePreview, setCandidatePreview] = useState<CandidatePreviewState>();
  const [candidatePreviewBranches, setCandidatePreviewBranches] = useState<ManualPreviewBranch[]>([]);
  const [syncAccount, setSyncAccount] = useState(defaultSyncAccount);
  const [subscription, setSubscription] = useState<SubscriptionDto>();
  const [theoryLibrary, setTheoryLibrary] = useState<TheoryLibraryDto>();
  const [theoryLibraryBusy, setTheoryLibraryBusy] = useState(false);
  const [theoryLibraryError, setTheoryLibraryError] = useState<string>();
  const [desktopDialog, setDesktopDialog] = useState<DesktopDialog>(null);
  const [userManualOpen, setUserManualOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfoDto>();
  const modeSelectionRef = useRef(0);
  const linkPlatformSupported = chessPlatform.kind === "desktop" && (
    appInfo?.platform.toLowerCase().includes("mac")
    ?? (typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent))
  );
  const [masterLibraryOpen, setMasterLibraryOpen] = useState(false);
  const [engineProbe, setEngineProbe] = useState<EngineProbeDto>();
  const [engineProfiles, setEngineProfiles] = useState<EngineProfileDto[]>([]);
  const [cloudCandidates, setCloudCandidates] = useState<CloudBookCandidate[]>([]);
  const [bookCandidateAuditByMove, setBookCandidateAuditByMove] = useState<Record<string, BookCandidateAuditResult>>({});
  const [bookCandidateAuditState, setBookCandidateAuditState] = useState<BookCandidateAuditRunState>({ status: "idle", message: "Pikafish 未验证" });
  const [cloudBookError, setCloudBookError] = useState<string>();
  const [cloudBookLoading, setCloudBookLoading] = useState(false);
  const [cloudBookVisible, setCloudBookVisible] = useState(false);
  const [mobileEvaluationVisible, setMobileEvaluationVisible] = useState(true);
  const [cloudBookCollapsed, setCloudBookCollapsed] = useState(false);
  const [floatingEvaluationCollapsed, setFloatingEvaluationCollapsed] = useState(false);
  const [cloudBookPosition, setCloudBookPosition] = useState<{ left: number; top: number }>();
  const [cloudBookHeight, setCloudBookHeight] = useState<number>();
  const [compactEngineCollapsed, setCompactEngineCollapsed] = useState(false);
  const [compactManualCollapsed, setCompactManualCollapsed] = useState(false);
  const [multiEngineComparisonCollapsed, setMultiEngineComparisonCollapsed] = useState(false);
  const [engineDivergenceOpen, setEngineDivergenceOpen] = useState(false);
  const [engineDivergencePosition, setEngineDivergencePosition] = useState<{ left: number; top: number }>();
  const [branchEditing, setBranchEditing] = useState(false);
  const [manualLineDialogOpen, setManualLineDialogOpen] = useState(false);
  const [bestMovePractice, setBestMovePractice] = useState<BestMovePractice>();
  const [collapsedTreeNodes, setCollapsedTreeNodes] = useState<Set<string>>(() => new Set());
  const [floatingPanelInteracting, setFloatingPanelInteracting] = useState(false);
  const [compactDetachedPanels, setCompactDetachedPanels] = useState<Record<"engine" | "manual", boolean>>({
    engine: false,
    manual: false,
  });
  const [compactPoppedOutPanels, setCompactPoppedOutPanels] = useState<Record<"engine" | "manual" | "cloud", boolean>>({
    engine: false,
    manual: false,
    cloud: false,
  });
  const [compactWindowPositions, setCompactWindowPositions] = useState<Record<"engine" | "manual", { x: number; y: number }>>({
    engine: compactEngineDefaultPosition(),
    manual: compactManualDefaultPosition(),
  });
  const [compactEngineSize, setCompactEngineSize] = useState<{ width: number; height: number }>({
    width: COMPACT_ENGINE_DEFAULT_WIDTH,
    height: COMPACT_ENGINE_DEFAULT_HEIGHT,
  });
  const [compactManualWidth, setCompactManualWidth] = useState<number>();
  const [compactActiveWindow, setCompactActiveWindow] = useState<"engine" | "manual">("engine");
  const screenshotCompactRailSnapshotRef = useRef<CompactStudyRailSnapshot | undefined>(undefined);
  const [linkSessionStatus, setLinkSessionStatus] = useState<LinkSessionStatus>({ source: "windowLink", mode: "spectate", state: "stopped", frameRate: 0, stableFrames: 0, requiredStableFrames: 2, captureRunning: false });
  const [linkCapturePreview, setLinkCapturePreview] = useState<string>();
  const [linkMiniBoardSize, setLinkMiniBoardSize] = useState<"off" | "small" | "large">("large");
  const floatingPanel = useMemo<FloatingPanel | null>(() => {
    if (typeof window === "undefined") return null;
    const panel = new URLSearchParams(window.location.search).get("floatingPanel");
    return panel === "engine" || panel === "manual" || panel === "cloud" || panel === "link" ? panel : null;
  }, []);
  const [coachReports, setCoachReports] = useState<GameReportDatasetDto[]>([]);
  const [masterStyleProfiles, setMasterStyleProfiles] = useState<MasterStyleProfileDto[]>([]);
  const [masterStyleImporting, setMasterStyleImporting] = useState(false);
  const [coachProfileOpen, setCoachProfileOpen] = useState(false);
  const [trainingTasks, setTrainingTasks] = useState<TrainingTaskDto[]>([]);
  const [trainingGeneration, setTrainingGeneration] = useState<TrainingGenerationResultDto>();
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummaryDto>();
  const [studySessions, setStudySessions] = useState<StudySessionDto[]>([]);
  const [u10Start, setU10Start] = useState<GuidedAnalysisStart>();
  const [u10InitialReversed, setU10InitialReversed] = useState(false);
  const [u10Profile, setU10Profile] = useState<LearningProfile>();
  const [u10DailyPlan, setU10DailyPlan] = useState<DailyTrainingPlan>();
  const [u10WeeklyReport, setU10WeeklyReport] = useState<WeeklyLearningReport>();
  const [u10Repertoire, setU10Repertoire] = useState<OpeningRepertoire>();
  const [u10Busy, setU10Busy] = useState(false);
  const [u10Error, setU10Error] = useState<string>();
  const [engineArenaBusy, setEngineArenaBusy] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const normalizedBoardSkin = normalizeSkinId(desktopPreferences.boardSkin);
  const normalizedPieceSkin = normalizeSkinId(desktopPreferences.pieceSkin);
  const activeBoardSkin = syncAccount.status === "signedIn" || !ACCOUNT_SKINS.includes(normalizedBoardSkin)
    ? normalizedBoardSkin
    : "default";
  const activePieceSkin = syncAccount.status === "signedIn" || !ACCOUNT_SKINS.includes(normalizedPieceSkin)
    ? normalizedPieceSkin
    : "default";
  // The phone workbench keeps the board visually dominant. Its default maps to
  // the bundled bamboo set, while any explicit skin selection still wins.
  const mobileDefaultSkin = isMobileWorkbench && activeBoardSkin === "default" && activePieceSkin === "default";
  const displayedBoardSkin = skinHoverPreview?.boardSkin ?? (mobileDefaultSkin ? "qingxin-zhuyun" : activeBoardSkin);
  const displayedPieceSkin = skinHoverPreview?.pieceSkin ?? (mobileDefaultSkin ? "qingxin-zhuyun" : activePieceSkin);
  const boardRevision = useRef(0);
  const reportExportingRef = useRef(false);
  const analysisLoadRevision = useRef(0);
  const analysisSessionRevision = useRef(0);
  const reportLoadRevision = useRef(0);
  const boardRef = useRef<BoardState>(fallback);
  const analysisFenRef = useRef<string | undefined>(undefined);
  const analysisStreamRef = useRef<AnalysisStreamBuffer | undefined>(undefined);
  const analysisHistoryRef = useRef<AnalysisHistoryBuffer | undefined>(undefined);
  const engineAnalysesRef = useRef<Record<string, EngineAnalysisGroup>>({});
  const analysisFirstCandidateWatchdogRef = useRef<string | undefined>(undefined);
  const linkAutoMoveRef = useRef<string | undefined>(undefined);
  const linkConfirmSelectRef = useRef<string | undefined>(undefined);
  const linkStatusRefreshRef = useRef<{ inFlight: boolean; queued: boolean; lastRun: number; timer?: number }>({ inFlight: false, queued: false, lastRun: 0 });
  const primaryAnalysisEngineRef = useRef<string>("primary");
  const bestMovePracticeRef = useRef<BestMovePractice | undefined>(undefined);
  const flyknifePracticeRef = useRef<FlyknifePractice | undefined>(undefined);
  const multipvRef = useRef(multipv);
  const analysisBusyRef = useRef(false);
  const analysisHintsEnabledRef = useRef(false);
  const pendingAutoAnalysis = useRef(false);
  const playbackRevision = useRef(0);
  const navigationRevision = useRef(0);
  const autosaveQueue = useRef<AutosaveOperationQueue | undefined>(undefined);
  const desktopPreferencesRef = useRef(defaultDesktopPreferences);
  const persistedPreferencesRef = useRef(defaultDesktopPreferences);
  const preferenceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const compactWindowDragRef = useRef<{ key: "engine" | "manual"; startX: number; startY: number; startPosition: { x: number; y: number }; bounds: { minX: number; maxX: number; minY: number; maxY: number }; moved: boolean } | undefined>(undefined);
  const compactWindowSuppressClickRef = useRef<Record<"engine" | "manual", boolean>>({ engine: false, manual: false });
  const bookCandidateAuditRevisionRef = useRef(0);
  const analysisPanelReopenDragRef = useRef<{ startY: number; startTop: number; latestTop: number; moved: boolean } | undefined>(undefined);
  const analysisPanelReopenSuppressClickRef = useRef(false);
  const compactManualResizeRef = useRef<{ startX: number; startWidth: number; maxWidth: number; detached: boolean; startPosition: { x: number; y: number } } | undefined>(undefined);
  const compactEngineResizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number; maxWidth: number; maxHeight: number } | undefined>(undefined);
  const engineDivergenceDragRef = useRef<{ offsetX: number; offsetY: number } | undefined>(undefined);
  const floatingPanelInteractionTimerRef = useRef<number | undefined>(undefined);
  const wasCompactLayoutRef = useRef(false);
  const cloudBookDragRef = useRef<{ offsetX: number; offsetY: number } | undefined>(undefined);
  const cloudBookResizeRef = useRef<{ startY: number; startHeight: number; top: number } | undefined>(undefined);
  if (!autosaveQueue.current) {
    autosaveQueue.current = new AutosaveOperationQueue(setAutosave, friendlyError);
  }
  multipvRef.current = multipv;
  bestMovePracticeRef.current = bestMovePractice;
  flyknifePracticeRef.current = flyknifePractice;
  const compactEngineMaxHeight = typeof window === "undefined"
    ? COMPACT_ENGINE_MAX_HEIGHT
    : Math.min(
      COMPACT_ENGINE_MAX_HEIGHT,
      Math.max(
        COMPACT_ENGINE_MIN_HEIGHT,
        window.innerHeight - COMPACT_ENGINE_DEFAULT_TOP - COMPACT_ENGINE_DEFAULT_Y - COMPACT_ENGINE_VIEWPORT_GAP,
      ),
    );

  function compactEnginePanelSize(size?: { width: number; height: number }) {
    if (!size || compactEngineCollapsed) return undefined;
    return {
      width: Math.max(COMPACT_ENGINE_MIN_WIDTH, Math.min(COMPACT_ENGINE_DEFAULT_WIDTH, size.width)),
      height: Math.max(COMPACT_ENGINE_MIN_HEIGHT, Math.min(compactEngineMaxHeight, size.height)),
    };
  }

  useEffect(() => {
    engineAnalysesRef.current = engineAnalyses;
  }, [engineAnalyses]);

  useEffect(() => {
    setCompactEngineSize((size) => {
      const clamped = compactEnginePanelSize(size);
      if (!size || !clamped) return size;
      return size.width === clamped.width && size.height === clamped.height ? size : clamped;
    });
  }, [compactEngineMaxHeight]);

  useEffect(() => {
    const compactLayout = desktopPreferences.layoutMode === "compact";
    if (compactLayout && !wasCompactLayoutRef.current) {
      // A docked panel must start inside its rail. This also recovers panels
      // positioned by the old viewport-wide drag bounds.
      setCompactWindowPositions(compactWindowDefaultPositions());
      setCompactDetachedPanels({ engine: false, manual: false });
    }
    wasCompactLayoutRef.current = compactLayout;
  }, [desktopPreferences.layoutMode]);

  useEffect(() => () => {
    if (floatingPanelInteractionTimerRef.current != null) {
      window.clearTimeout(floatingPanelInteractionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (chessPlatform.kind === "web") {
      const layoutMode = initialWorkspaceLayout();
      const manualViewMode = initialManualViewMode();
      const preferences = { ...desktopPreferencesRef.current, layoutMode, manualViewMode };
      desktopPreferencesRef.current = preferences;
      persistedPreferencesRef.current = preferences;
      setDesktopPreferences(preferences);
      void chessPlatform.getCloudAnalysisPreferences().then(async (preferences) => {
        if (preferences) {
          const restored = normalizeMobileCloudAnalysisPreferences(preferences, window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches);
          mobileDefaultDepthVersionRef.current = restored.mobileDefaultDepthVersion === MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION;
          setServerUrl(restored.serverUrl);
          setToken(restored.token);
          setMultipv(Math.min(5, Math.max(1, restored.multipv)));
          setSearchMode(restored.searchMode);
          setSearchValue(restored.searchValue);
          setAutoAnalyze(restored.autoAnalyze);
          if (restored !== preferences) await chessPlatform.saveCloudAnalysisPreferences(restored);
          if (restored.token) {
            try {
              setSubscription(await chessPlatform.getCloudSubscription(restored.serverUrl, restored.token));
              setCloudConnection("online");
            } catch { setCloudConnection("offline"); }
          }
        }
      }).finally(() => setCloudPreferencesReady(true));
    }
    void chessPlatform.initialize()
      .then((state) => {
        applyBoard(state);
        setAutosave({ status: "saved" });
        void loadSavedAnalysis(state.fen ?? startingFen);
        if (chessPlatform.kind === "desktop") void loadGameReport();
        if (chessPlatform.kind === "desktop") void chessPlatform.listFlyknifePlans().then(setFlyknifePlans).catch(() => undefined);
        if (chessPlatform.kind === "desktop") void chessPlatform.getTheoryLibrary().then(setTheoryLibrary).catch(() => undefined);
        if (chessPlatform.kind === "desktop") void chessPlatform.listStudySessions().then(setStudySessions).catch(() => undefined);
        void refreshGames();
        if (chessPlatform.kind === "web") setNotice("离线棋谱已就绪");
      })
      .catch((error) => setNotice(friendlyError(error)));
    if (chessPlatform.kind === "desktop") {
      void chessPlatform.getAppInfo().then(setAppInfo).catch(() => undefined);
      void chessPlatform.listBuiltinOpeningBooks().then(setBuiltinOpeningBookManifest).catch(() => setBuiltinOpeningBookManifest(FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST));
      void chessPlatform.getDesktopPreferences().then((preferences) => {
        applyDesktopPreferences(preferences);
        void migrateLegacyEngineDefaultsOnce(preferences);
        if (!preferences.enginePath) {
          void chessPlatform.detectEngine().then((path) => {
            if (path) {
              setEnginePath(path);
              const detected = { ...desktopPreferencesRef.current, enginePath: path };
              desktopPreferencesRef.current = detected;
              setDesktopPreferences(detected);
              setNotice(path === BUILTIN_ENGINE_PATH ? "已识别安装包内置 Pikafish，请在引擎设置中保存" : "已自动识别本机引擎，请在引擎设置中保存");
            }
          }).catch(() => undefined);
        }
      }).catch((error) => setNotice(friendlyError(error)));
      void chessPlatform.getSyncAccount().then((account) => {
        setSyncAccount(account);
        if (account.status === "signedIn") void chessPlatform.getSubscription().then(setSubscription).catch(() => undefined);
      }).catch((error) => setNotice(friendlyError(error)));
      void chessPlatform.listEngineProfiles().then((profiles) => setEngineProfiles(externalEngineProfiles(profiles))).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (chessPlatform.kind !== "web" || !cloudPreferencesReady) return;
    const validMode = searchMode === "time" ? "time" : "depth";
    void chessPlatform.saveCloudAnalysisPreferences({
      serverUrl,
      token,
      multipv: Math.min(5, Math.max(1, multipv)),
      searchMode: validMode,
      searchValue: validMode === "time" ? Math.min(5000, Math.max(100, searchValue)) : Math.min(30, Math.max(1, searchValue)),
      autoAnalyze,
      mobileDefaultDepthVersion: mobileDefaultDepthVersionRef.current ? MOBILE_DEFAULT_DEPTH_PREFERENCE_VERSION : undefined,
    }).catch(() => undefined);
  }, [autoAnalyze, cloudPreferencesReady, multipv, searchMode, searchValue, serverUrl, token]);

  async function scanTheoryLibrary() {
    if (chessPlatform.kind !== "desktop" || theoryLibraryBusy) return;
    setTheoryLibraryBusy(true);
    setTheoryLibraryError(undefined);
    try {
      const library = await chessPlatform.scanTheoryLibrary();
      setTheoryLibrary(library);
      setNotice(`已索引 ${library.lessons.length} 节课程；${library.downloadingFiles} 个文件仍在下载中`);
    } catch (error) {
      const message = friendlyError(error);
      setTheoryLibraryError(message);
      setNotice(message);
    } finally {
      setTheoryLibraryBusy(false);
    }
  }

  async function createTheoryCard(card: Parameters<typeof chessPlatform.createTheoryCard>[0]) {
    if (chessPlatform.kind !== "desktop") return;
    try {
      await chessPlatform.createTheoryCard(card);
      setTheoryLibrary(await chessPlatform.getTheoryLibrary());
      setNotice("候选原则卡已加入待审核列表");
    } catch (error) {
      setTheoryLibraryError(friendlyError(error));
    }
  }

  async function reviewTheoryCard(card: Parameters<typeof chessPlatform.reviewTheoryCard>[0]) {
    if (chessPlatform.kind !== "desktop") return;
    try {
      await chessPlatform.reviewTheoryCard(card);
      setTheoryLibrary(await chessPlatform.getTheoryLibrary());
      setNotice(card.reviewStatus === "approved" ? "原则卡已确认，后续棋谱分析会使用它" : "原则卡已拒绝");
    } catch (error) {
      setTheoryLibraryError(friendlyError(error));
    }
  }

  async function saveTheoryFeedback(card: NonNullable<TheoryLibraryDto["cards"][number]>, verdict: "correct" | "incorrect" | "needs_revision") {
    if (chessPlatform.kind !== "desktop") return;
    try {
      await chessPlatform.saveTheoryFeedback({
        cardId: card.id,
        cardVersion: card.version,
        verdict,
        note: verdict === "correct" ? "人工确认匹配准确" : verdict === "incorrect" ? "人工标记匹配不准" : "人工标记需要修订",
      });
      setTheoryLibrary(await chessPlatform.getTheoryLibrary());
      setNotice(verdict === "correct" ? "已记录：这张原则卡匹配准确" : "已记录反馈；这张卡后续会降低推荐优先级并标记复核");
    } catch (error) {
      setTheoryLibraryError(friendlyError(error));
    }
  }

  useEffect(() => {
    if (!floatingPanel || chessPlatform.kind !== "desktop") return;
    const timer = window.setInterval(() => {
      void chessPlatform.initialize()
        .then((state) => {
          const next = normalizeBoardState(state);
          if (next.fen !== boardRef.current.fen || next.currentNode !== boardRef.current.currentNode || next.history.length !== boardRef.current.history.length) {
            applyBoard(next);
          }
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [floatingPanel]);

  useEffect(() => {
    if (floatingPanel !== "link" || chessPlatform.kind !== "desktop") return;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const refresh = (force = false) => {
      const gate = linkStatusRefreshRef.current;
      const run = () => {
        if (disposed) return;
        gate.timer = undefined;
        if (gate.inFlight) {
          gate.queued = true;
          return;
        }
        gate.inFlight = true;
        gate.lastRun = Date.now();
        void chessPlatform.getLinkSessionStatus().then((status) => {
          if (disposed) return;
          setLinkSessionStatus((current) => linkStatusRenderKey(current) === linkStatusRenderKey(status) ? current : status);
        }).catch(() => undefined).finally(() => {
          gate.inFlight = false;
          if (gate.queued && !disposed) {
            gate.queued = false;
            refresh();
          }
        });
      };
      if (force) {
        if (gate.timer != null) {
          window.clearTimeout(gate.timer);
          gate.timer = undefined;
        }
        run();
        return;
      }
      const delay = Math.max(0, 350 - (Date.now() - gate.lastRun));
      if (gate.timer != null) {
        gate.queued = true;
        return;
      }
      if (delay > 0) gate.timer = window.setTimeout(run, delay);
      else run();
    };
    refresh(true);
    void listen(LINK_SESSION_UPDATED_EVENT, () => refresh()).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    }).catch(() => undefined);
    void listen(BOARD_NAVIGATED_EVENT, () => refresh()).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    }).catch(() => undefined);
    const timer = window.setInterval(refresh, 1000);
    return () => {
      disposed = true;
      const gate = linkStatusRefreshRef.current;
      if (gate.timer != null) {
        window.clearTimeout(gate.timer);
        gate.timer = undefined;
      }
      gate.queued = false;
      cleanups.forEach((cleanup) => cleanup());
      window.clearInterval(timer);
    };
  }, [floatingPanel]);
  useEffect(() => {
    if (floatingPanel !== "link" || chessPlatform.kind !== "desktop") return;
    if (linkSessionStatus.initialPositionSeen) return;
    void chessPlatform.getLinkCapturePreview().then(setLinkCapturePreview).catch(() => setLinkCapturePreview(undefined));
  }, [floatingPanel, linkSessionStatus.capturePreviewKind, linkSessionStatus.initialPositionSeen, linkSessionStatus.state]);

  useEffect(() => {
    if (!floatingPanel || chessPlatform.kind !== "desktop") return;
    const applySnapshot = (snapshot?: EngineAnalysisSnapshot) => {
      if (!snapshot || snapshot.fen !== boardRef.current.fen) {
        primaryAnalysisEngineRef.current = "primary";
        setEngineAnalyses({});
        analysisFenRef.current = undefined;
        setAnalysisFen(undefined);
        setAnalysisArrowFen(undefined);
        setAnalysis([]);
        analysisHistoryRef.current = undefined;
        setAnalysisHistory([]);
        analysisBusyRef.current = false;
        setAnalysisBusy(false);
        return;
      }
      primaryAnalysisEngineRef.current = snapshot.primaryEngineId;
      setEngineAnalyses(snapshot.groups);
      const primaryLines = snapshot.groups[snapshot.primaryEngineId]?.lines
        ?? Object.values(snapshot.groups)[0]?.lines
        ?? [];
      analysisFenRef.current = snapshot.fen;
      setAnalysisFen(snapshot.fen);
      setAnalysisSideToMove(boardRef.current.sideToMove);
      setAnalysisArrowFen(analysisHintsEnabledRef.current ? snapshot.fen : undefined);
      setAnalysis(primaryLines);
      analysisHistoryRef.current = primaryLines.length
        ? { fen: snapshot.fen, lines: primaryLines.slice(0, ENGINE_ANALYSIS_HISTORY_LIMIT) }
        : undefined;
      setAnalysisHistory(primaryLines.slice(0, ENGINE_ANALYSIS_HISTORY_LIMIT));
      analysisBusyRef.current = snapshot.busy === true;
      setAnalysisBusy(snapshot.busy === true);
    };
    const syncFromStorage = () => applySnapshot(readEngineAnalysisSnapshot());
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(ENGINE_ANALYSIS_CHANNEL);
    channel?.addEventListener("message", (event: MessageEvent<EngineAnalysisSnapshot>) => applySnapshot(event.data));
    const onStorage = (event: StorageEvent) => {
      if (event.key === ENGINE_ANALYSIS_SNAPSHOT_KEY) syncFromStorage();
    };
    syncFromStorage();
    window.addEventListener("storage", onStorage);
    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [floatingPanel, board.fen]);

  useEffect(() => {
    if (floatingPanel || chessPlatform.kind !== "desktop") return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<{ panel?: "engine" | "manual" | "cloud" }>(COMPACT_PANEL_RETURN_EVENT, (event) => {
      const panel = event.payload?.panel;
      if (panel === "engine") {
        setCompactEngineCollapsed(false);
        setCompactPoppedOutPanels((panels) => ({ ...panels, engine: false }));
        setCompactDetachedPanels((panels) => ({ ...panels, engine: false }));
        setCompactWindowPositions((positions) => ({ ...positions, engine: compactEngineDefaultPosition() }));
        setCompactActiveWindow("engine");
      } else if (panel === "manual") {
        setCompactManualCollapsed(false);
        setCompactPoppedOutPanels((panels) => ({ ...panels, manual: false }));
        setCompactDetachedPanels((panels) => ({ ...panels, manual: false }));
        setCompactWindowPositions((positions) => ({ ...positions, manual: compactManualDefaultPosition() }));
        setCompactManualWidth(undefined);
        setCompactActiveWindow("manual");
      } else if (panel === "cloud") {
        setCompactPoppedOutPanels((panels) => ({ ...panels, cloud: false }));
        setCloudBookCollapsed(false);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [floatingPanel]);

  useEffect(() => {
    if (chessPlatform.kind !== "desktop") return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<Partial<BoardState>>(BOARD_NAVIGATED_EVENT, (event) => {
      if (disposed) return;
      applyBoard(normalizeBoardState(event.payload));
      setSelected(null);
      setTrendCursorIndex(undefined);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (chessPlatform.kind !== "desktop" || !enginePath) {
      setEngineProbe(undefined);
      return;
    }
    let cancelled = false;
    void chessPlatform.probeEngine(enginePath)
      .then((probe) => {
        if (!cancelled) setEngineProbe(probe);
      })
      .catch(() => {
        if (!cancelled) setEngineProbe(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath]);

  useEffect(() => {
    if (!desktopPreferences.cloudBookEnabled) {
      setCloudCandidates([]); setCloudBookError(undefined); setCloudBookLoading(false); return;
    }
    let cancelled = false;
    setCloudBookLoading(true);
    void chessPlatform.queryCloudOpeningBook(board.fen).then((candidates) => {
      if (!cancelled) { setCloudCandidates(candidates); setCloudBookError(undefined); }
    }).catch((error) => { if (!cancelled) { setCloudCandidates([]); setCloudBookError(friendlyError(error)); } }).finally(() => {
      if (!cancelled) setCloudBookLoading(false);
    });
    return () => { cancelled = true; };
  }, [board.fen, desktopPreferences.cloudBookEnabled, desktopPreferences.cloudBookUrl]);

  useEffect(() => {
    if (chessPlatform.kind !== "desktop") return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void chessPlatform.subscribeGameReportProgress((progress) => {
      if (disposed) return;
      setReportProgress(progress);
      setReportBusy(progress.state === "running");
    }).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => () => stopCompactWindowDragWindow(), []);

  useEffect(() => {
    const current = board.history.find((move) => move.id === board.currentNode);
    setComment(current?.comment ?? "");
  }, [board.currentNode, board.history]);

  useEffect(() => {
    setGameTitle(board.title);
    setGameNote(board.note);
  }, [board.note, board.title]);

  useEffect(() => {
    if (chessPlatform.kind === "web") {
      try {
        localStorage.setItem("xiangqi:auto-analysis", String(autoAnalyze));
      } catch {
        // Preference persistence is optional in restricted browser contexts.
      }
    }
  }, [autoAnalyze]);

  useEffect(() => {
    // Layouts own their visual identity: compact stays light, studio stays dark.
    // This prevents a persisted professional theme from bleeding into compact, or vice versa.
    applyColorTheme(effectiveColorTheme);
    if (chessPlatform.kind === "web") {
      try {
        localStorage.setItem("xiangqi:color-theme", colorTheme);
      } catch {
        // Theme persistence is optional in restricted browser contexts.
      }
    }
  }, [chessPlatform.kind, colorTheme, effectiveColorTheme]);

  useEffect(() => {
    if (!analysisHelpOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setAnalysisHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [analysisHelpOpen]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void chessPlatform.subscribeEngineEvents((event) => {
      if (disposed) return;
      if (event.type === "state") {
        setEngineRuntimeState(event.state);
        setEngineThinking(event.state === "thinking");
      } else if (event.type === "info" || event.type === "analysisInfo") {
        if (!analysisBusyRef.current || event.fen !== boardRef.current.fen) return;
        if (event.type === "analysisInfo" && event.analysisSessionId != null && event.analysisSessionId !== analysisSessionRevision.current) return;
        const engineId = event.type === "analysisInfo" ? event.engineId ?? event.engineName ?? "primary" : "primary";
        const engineName = event.type === "analysisInfo" ? event.engineName ?? engineId : currentEngineLabel;
        setEngineAnalyses((current) => {
          const previous = current[engineId]?.lines ?? [];
          const lines = [...previous.filter((line) => line.multipv !== event.line.multipv), event.line].sort((left, right) => left.multipv - right.multipv);
          return { ...current, [engineId]: { fen: event.fen, name: engineName, lines } };
        });
        if (engineId !== primaryAnalysisEngineRef.current) return;
        const history = updateAnalysisHistory(analysisHistoryRef.current, event.fen, event.line);
        analysisHistoryRef.current = history;
        setAnalysisHistory(history.lines);
        const stream = updateAnalysisStream(analysisStreamRef.current, event.fen, event.line, multipvRef.current);
        analysisStreamRef.current = stream.buffer;
        if (!stream.visible) return;
        analysisFenRef.current = event.fen;
        setAnalysisFen(event.fen);
        setAnalysisSideToMove(boardRef.current.sideToMove);
        setAnalysisArrowFen(event.fen);
        setAnalysis(stream.visible);
      } else if (event.type === "bestmove") {
        if (event.fen !== boardRef.current.fen) return;
        setPonderMove(event.ponder);
      } else {
        setNotice(event.message);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);


  useEffect(() => {
    if (!autoAnalyze && !analysisHintsEnabledRef.current) return;
    if (isPlaying || reportBusy) return;
    if (engineSide !== "none" || engineThinking) return;
    if (!board.playable) return;
    if (chessPlatform.kind === "desktop" && !enginePath.trim()) return;
    if (chessPlatform.kind === "web" && !online) return;
    if (analysisBusyRef.current) {
      if (shouldQueueWebAnalysisReplacement(chessPlatform.kind, true)) {
        pendingAutoAnalysis.current = true;
        return;
      }
      void cancelRunningAnalysis("局面已更新，正在切换自动分析…", { keepHints: true })
        .finally(() => window.setTimeout(() => setAutoRetry((value) => value + 1), 80));
      return;
    }
    const timer = window.setTimeout(() => void runAnalysis(true), 180);
    return () => window.clearTimeout(timer);
  }, [autoAnalyze, autoRetry, board.currentNode, board.fen, board.playable, enginePath, engineSide, engineThinking, hashMb, isPlaying, multipv, online, reportBusy, searchMode, searchValue, serverUrl, threads, token]);

  const previewStep = candidatePreview?.steps[candidatePreview.step];
  const displayedPieces = previewStep?.pieces ?? board.pieces;
  const displayedLastMove = previewStep ? {
    from: previewStep.from,
    to: previewStep.to,
    notation: previewStep.notation,
    movedBy: previewStep.movedBy,
  } : undefined;
  const pieceMap = useMemo(() => new Map(displayedPieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [displayedPieces]);
  const editorPieceMap = useMemo(() => new Map(editorPieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [editorPieces]);
  const cells = useMemo(() => Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), []);
  const lastMove = board.history.at(-1);
  const analysisIsStale = analysis.length > 0 && analysisFen !== board.fen;
  const currentAnalysis = useMemo(() => analysisIsStale ? [] : analysis, [analysis, analysisIsStale]);
  const evaluation = useMemo(() => positionEvaluation(board, currentAnalysis), [board, currentAnalysis]);
  const boardRailEvaluation = useMemo(() => positionEvaluation(board, currentAnalysis), [board, currentAnalysis]);
  const evaluationTrend = useMemo(() => trendPoints(evaluation?.samples ?? [], board.history.length), [board.history.length, evaluation]);
  const trendSegments = useMemo(() => evaluationTrend.slice(1).flatMap((point, index) => {
    const previous = evaluationTrend[index];
    if ((previous.scoreCp >= 0 && point.scoreCp >= 0) || (previous.scoreCp <= 0 && point.scoreCp <= 0)) {
      return [{ from: previous, to: point, side: previous.scoreCp >= 0 || point.scoreCp >= 0 ? "red" : "black" }];
    }
    const ratio = Math.abs(previous.scoreCp) / (Math.abs(previous.scoreCp) + Math.abs(point.scoreCp));
    const zero = {
      ...point,
      x: previous.x + (point.x - previous.x) * ratio,
      y: trendChart.middle,
      scoreCp: 0,
    };
    return [
      { from: previous, to: zero, side: previous.scoreCp > 0 ? "red" : "black" },
      { from: zero, to: point, side: point.scoreCp > 0 ? "red" : "black" },
    ];
  }), [evaluationTrend]);
  const activeTrendPoint = trendCursorIndex == null ? undefined : evaluationTrend[trendCursorIndex];
  const activeTrendDelta = trendCursorIndex == null || trendCursorIndex <= 0 ? undefined : evaluationTrend[trendCursorIndex].scoreCp - evaluationTrend[trendCursorIndex - 1].scoreCp;
  const currentTrendPoint = useMemo(() => {
    if (evaluationTrend.length === 0) return undefined;
    return evaluationTrend.find((point) => point.nodeId === board.currentNode) ?? evaluationTrend.at(-1);
  }, [board.currentNode, evaluationTrend]);
  const visibleTrendPoint = activeTrendPoint ?? currentTrendPoint;
  const visibleTrendDelta = activeTrendPoint ? activeTrendDelta : undefined;
  const trendMarkerOnLeft = (visibleTrendPoint?.x ?? 0) > trendChart.width / 2;
  const trendMarkerX = visibleTrendPoint ? visibleTrendPoint.x + (trendMarkerOnLeft ? -88 : 4) : 0;
  const trendMarkerY = visibleTrendPoint ? Math.max(12, visibleTrendPoint.y - 16) : 0;
  const trendMarkerText = visibleTrendPoint ? `${visibleTrendPoint.label.replace("第 ", "")} · ${formatRedScore(visibleTrendPoint.scoreCp)}` : "";
  const trendTurns = useMemo(() => trendTurningPoints(evaluation?.samples ?? []), [evaluation]);
  const trendTurnsByNode = useMemo(() => new Map(trendTurns.map((turn) => [turn.nodeId, turn])), [trendTurns]);
  const reportPositionByNode = useMemo(() => new Map((gameReport?.positions ?? []).flatMap((position, index, positions) => {
    if (!position.move?.nodeId) return [];
    return [[position.move.nodeId, { position, before: positions[index - 1] }]] as const;
  })), [gameReport]);
  const reports = useMemo(() => {
    const reportRoot = gameReport?.positions[0];
    return moveReports(board.history, {
      sideToMove: reportRoot?.sideToMove ?? board.rootSideToMove,
      scoreCp: board.rootScoreCp ?? reportRoot?.scoreCp,
      mate: board.rootMate ?? reportRoot?.mate,
    });
  }, [board.history, board.rootMate, board.rootScoreCp, board.rootSideToMove, gameReport]);
  const overviewReport = useMemo(() => reports.find((report) => report.move.id === board.currentNode), [board.currentNode, reports]);
  const reportByMoveId = useMemo(() => new Map(reports.map((report) => [report.move.id, report])), [reports]);
  const boardEvaluationScore = boardRailEvaluation?.samples.at(-1)?.scoreCp;
  const professionalEvaluationScore = evaluation?.samples.at(-1)?.scoreCp;
  const professionalEvaluationTone = professionalEvaluationScore == null
    ? "pending"
    : professionalEvaluationScore < -50 ? "black" : professionalEvaluationScore > 50 ? "red" : "balanced";
  const boardEvaluationSide = boardRailEvaluation?.mateSide
    ? `${boardRailEvaluation.mateSide}${boardRailEvaluation.isCheckmate ? "绝杀胜" : "绝杀"}`
    : boardEvaluationScore == null || Math.abs(boardEvaluationScore) <= 50
      ? "均势"
      : boardEvaluationScore > 0 ? "红优" : "黑优";
  const boardEvaluationBalanced = boardRailEvaluation?.mateSide == null
    && boardEvaluationScore != null
    && Math.abs(boardEvaluationScore) <= 50;
  const boardEvaluationRedShare = boardEvaluationScore == null
    ? 50
    : boardRailEvaluation?.mateSide === "红方"
      ? 95
      : boardRailEvaluation?.mateSide === "黑方"
        ? 5
        : evaluationRedShare(boardEvaluationScore);
  const boardEvaluationRailText = compactBoardEvaluationRailText({
    sideText: boardEvaluationSide,
    scoreText: boardRailEvaluation?.scoreText,
    mateSide: boardRailEvaluation?.mateSide,
    mateIn: boardRailEvaluation?.mateIn,
    isCheckmate: boardRailEvaluation?.isCheckmate,
    balanced: boardEvaluationBalanced,
  });
  const boardEvaluationRailTitle = `${boardEvaluationSide} · ${boardRailEvaluation?.scoreText ?? "--"}`;
  const reportPresentation = useMemo(() => gameReport ? buildGameReportPresentation(board.title, gameReport) : undefined, [board.title, gameReport]);
  const manualMeta = useMemo(() => ({
    red: noteField(board.note, "红方") || "红方",
    black: noteField(board.note, "黑方") || "黑方",
    event: noteField(board.note, "比赛") || "赛事未知",
    date: noteField(board.note, "日期") || "日期未知",
    result: noteField(board.note, "结果") || "*",
    moveCount: noteField(board.note, "手数") || `${board.history.length}`,
  }), [board.history.length, board.note]);
  const isMasterLibraryGame = board.sourceFormat === "server-master-pgn"
    || board.note.includes("用途：本地学习、拆棋和 Pikafish 分析。");
  const retryReports = useMemo(() => reports
    .filter((report) => report.missedMate || report.grade === "差" || report.grade === "错" || (report.score != null && report.score < 40))
    .sort((left, right) => {
      const leftPriority = (left.missedMate ? 1000 : 0) + Math.abs(left.moverLossCp ?? left.deltaCp ?? 0);
      const rightPriority = (right.missedMate ? 1000 : 0) + Math.abs(right.moverLossCp ?? right.deltaCp ?? 0);
      return rightPriority - leftPriority;
    }), [reports]);
  const retryReportsBySide = useMemo(() => ({
    red: retryReports.filter((report) => report.move.movedBy === "红方"),
    black: retryReports.filter((report) => report.move.movedBy === "黑方"),
  }), [retryReports]);
  const orderedAnalysis = useMemo(() => currentAnalysis.slice().sort((left, right) => left.multipv - right.multipv), [currentAnalysis]);
  const primaryAnalysis = orderedAnalysis[0];
  const candidateSideToMove = analysisSideToMove ?? board.sideToMove;
  const bestMoveHint = useMemo<BestMoveHint | undefined>(() => {
    if (analysisFen !== board.fen || analysisIsStale || orderedAnalysis.length === 0) return undefined;
    const seen = new Set<string>();
    const topMoves = orderedAnalysis.flatMap((line) => {
      const iccs = line.pv[0];
      if (!iccs || seen.has(iccs)) return [];
      seen.add(iccs);
      return [{ iccs, text: line.notation?.[0], rank: line.multipv }];
    });
    const bestMove = primaryAnalysis?.pv[0] ?? topMoves[0]?.iccs;
    if (!bestMove) return undefined;
    return { bestMove, bestMoveText: primaryAnalysis?.notation?.[0] ?? bestMove, topMoves };
  }, [analysisFen, analysisIsStale, board.fen, orderedAnalysis, primaryAnalysis]);
  const currentEngineAnalyses = useMemo(() => Object.fromEntries(Object.entries(engineAnalyses)
    .filter(([, group]) => group.fen === board.fen)), [board.fen, engineAnalyses]);
  useEffect(() => {
    if (floatingPanel || chessPlatform.kind !== "desktop") return;
    const snapshot: EngineAnalysisSnapshot = {
      fen: board.fen,
      primaryEngineId: primaryAnalysisEngineRef.current,
      groups: currentEngineAnalyses,
      busy: analysisBusy,
    };
    try {
      localStorage.setItem(ENGINE_ANALYSIS_SNAPSHOT_KEY, JSON.stringify(snapshot));
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(ENGINE_ANALYSIS_CHANNEL);
        channel.postMessage(snapshot);
        channel.close();
      }
    } catch {
      // The primary window still works when storage is unavailable.
    }
  }, [analysisBusy, board.fen, chessPlatform.kind, currentEngineAnalyses, floatingPanel]);
  const engineComparisonGroups = useMemo<EngineComparisonGroup[]>(() => Object.entries(currentEngineAnalyses)
    .map(([id, group]) => ({ id, ...group, primary: id === primaryAnalysisEngineRef.current }))
    .sort((left, right) => Number(right.primary) - Number(left.primary) || left.name.localeCompare(right.name)), [currentEngineAnalyses]);
  const engineDivergenceAvailable = useMemo(
    () => hasEngineDivergence(engineComparisonGroups, candidateSideToMove),
    [candidateSideToMove, engineComparisonGroups],
  );
  const primaryEngineDisplayName = chessPlatform.kind === "web" ? "云端 Pikafish" : engineDisplayName(enginePath);
  const compactEngineRows: CompactEngineAnalysisRow[] = useMemo(() => {
    const primaryEngineId = primaryAnalysisEngineRef.current;
    const analyzedFen = analysisFen ?? board.fen;
    const lineItems = [
      ...(analysisIsStale ? [] : orderedAnalysis.map((line) => ({ line, sourceId: primaryEngineId, sourceName: primaryEngineDisplayName, sourceText: "主引擎", primary: true }))),
      ...Object.entries(currentEngineAnalyses).flatMap(([sourceId, group]) => group.lines.map((line) => ({
        line,
        sourceId,
        sourceName: group.name,
        sourceText: sourceId === primaryEngineId ? "主引擎" : group.name,
        primary: sourceId === primaryEngineId,
      }))),
      ...(analysisIsStale ? [] : analysisHistory.map((line) => ({ line, sourceId: primaryEngineId, sourceName: primaryEngineDisplayName, sourceText: "主引擎", primary: true }))),
    ];
    const seen = new Set<string>();
    const displayItems = lineItems.filter(({ line, sourceId }) => {
      const key = [sourceId, line.multipv].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lineMoveLimit = Math.max(
      COMPACT_ENGINE_LINE_MIN_MOVES,
      Math.min(COMPACT_ENGINE_LINE_MAX_MOVES, Math.trunc(desktopPreferences.candidateLineMoves) || DEFAULT_CANDIDATE_LINE_MOVES),
    );
    const visibleCandidateLimit = Math.max(MIN_ENGINE_CANDIDATES, Math.trunc(desktopPreferences.multipv) || DEFAULT_ENGINE_CANDIDATES);
    return displayItems
      .filter(({ line }) => line.multipv >= 1 && line.multipv <= visibleCandidateLimit)
      .slice(0, visibleCandidateLimit)
      .map(({ line, sourceId, sourceName, sourceText, primary }, index) => {
      const lineMoves = (line.notation?.length ? line.notation : line.pv).slice(0, lineMoveLimit);
      return {
        id: `engine-${sourceId}-${line.multipv}-${line.depth ?? "d"}-${line.timeMs ?? index}-${line.pv.join("-")}`,
        iccs: line.pv[0],
        analyzedFen,
        line,
        source: { id: sourceId, name: sourceName, primary },
        rank: index + 1,
        sourceText,
        depthText: `${line.depth ?? "--"}`,
        scoreText: redAnalysisScoreText(line, candidateSideToMove),
        timeText: line.timeMs != null ? `${(line.timeMs / 1000).toFixed(1)}s` : "--",
        npsText: formatNps(line.nps),
        hfText: formatHashfull(line.hashfull),
        lineLengthText: `${halfMovesToRoundText(lineMoves.length)}/${halfMovesToRoundText(lineMoveLimit)}回合`,
        lineText: lineMoves.length ? lineMoves.join(" ") : "暂无推荐着法",
        previewActive: candidatePreview?.sourceFen === analyzedFen && candidatePreview.sourceEngineId === sourceId && candidatePreview.rank === line.multipv,
        disabled: analysisIsStale,
        stale: analysisIsStale,
      };
      });
  }, [analysisFen, analysisHistory, analysisIsStale, board.fen, candidatePreview, candidateSideToMove, currentEngineAnalyses, desktopPreferences.candidateLineMoves, desktopPreferences.multipv, orderedAnalysis, primaryEngineDisplayName]);
  useEffect(() => {
    if (chessPlatform.kind !== "desktop" || linkSessionStatus.mode !== "autoPlay" || linkSessionStatus.state !== "tracking") return;
    const expectedSide = linkSessionStatus.autoSide === "red" ? "红方" : "黑方";
    const move = compactEngineRows[0]?.iccs;
    const key = `${board.fen}:${move ?? ""}`;
    if (!move || board.sideToMove !== expectedSide || linkAutoMoveRef.current === key) return;
    linkAutoMoveRef.current = key;
    void chessPlatform.confirmLinkEngineMove(move).then(() => setNotice(`自动对战已执行候选着法 ${move}，等待外部局面确认`)).catch((error) => setNotice(friendlyError(error)));
  }, [board.fen, board.sideToMove, chessPlatform, compactEngineRows, linkSessionStatus.autoSide, linkSessionStatus.mode, linkSessionStatus.state]);

  useEffect(() => {
    if (chessPlatform.kind !== "desktop" || linkSessionStatus.mode !== "confirmPlay" || linkSessionStatus.state !== "tracking") return;
    if (linkSessionStatus.pendingExternalMove || linkSessionStatus.latestFen !== board.fen || analysisFen !== board.fen || analysisIsStale) return;
    const row = compactEngineRows[0];
    const move = row?.iccs;
    if (!move) return;
    const key = `${board.fen}:${move}`;
    if (linkConfirmSelectRef.current === key) return;
    linkConfirmSelectRef.current = key;
    const displayMove = linkMoveDisplayText(move, row?.line?.notation?.[0]) ?? move;
    void chessPlatform.confirmLinkEngineMove(move)
      .then(async () => {
        setNotice(`已按箭头1选中 ${displayMove} 的起始棋子，请在网页棋盘确认落点`);
        setLinkSessionStatus(await chessPlatform.getLinkSessionStatus());
      })
      .catch((error) => setNotice(friendlyError(error)));
  }, [analysisFen, analysisIsStale, board.fen, chessPlatform, compactEngineRows, linkSessionStatus.latestFen, linkSessionStatus.mode, linkSessionStatus.pendingExternalMove, linkSessionStatus.state]);

  useEffect(() => {
    if (chessPlatform.kind !== "desktop" || linkSessionStatus.state !== "tracking") return;
    if (!enginePath.trim() || !board.playable || reportBusy || engineSide !== "none" || engineThinking) return;
    if (analysisBusyRef.current) return;
    if (analysisFen === board.fen && analysis.length > 0) return;
    const timer = window.setTimeout(() => void runAnalysis(true), 120);
    return () => window.clearTimeout(timer);
  }, [analysis.length, analysisFen, board.fen, board.playable, chessPlatform, enginePath, engineSide, engineThinking, linkSessionStatus.state, reportBusy]);

  useEffect(() => {
    if (!analysisBusy || !board.playable) return;
    const watchedFen = board.fen;
    const watchedRevision = analysisSessionRevision.current;
    const timer = window.setTimeout(() => {
      if (boardRef.current.fen !== watchedFen) return;
      if (!shouldRestartAnalysisWhenNoCandidates({
        analysisBusy: analysisBusyRef.current,
        boardFen: watchedFen,
        engineAnalyses: engineAnalysesRef.current,
      })) return;
      const key = `${watchedRevision}:${watchedFen}`;
      if (analysisFirstCandidateWatchdogRef.current === key) {
        setNotice("引擎仍未返回候选，请手动停止后重新分析或检查引擎路径");
        return;
      }
      analysisFirstCandidateWatchdogRef.current = key;
      pendingAutoAnalysis.current = false;
      analysisSessionRevision.current += 1;
      analysisLoadRevision.current += 1;
      analysisBusyRef.current = false;
      setAnalysisBusy(false);
      setNotice("引擎首条候选超时，正在自动重启分析…");
      void chessPlatform.stopAnalysis(true)
        .catch(() => undefined)
        .finally(() => {
          window.setTimeout(() => {
            if (boardRef.current.fen === watchedFen && !analysisBusyRef.current) void runAnalysis(true);
          }, 250);
        });
    }, analysisFirstCandidateTimeoutMs(chessPlatform.kind));
    return () => window.clearTimeout(timer);
  }, [analysisBusy, board.fen, board.playable, chessPlatform]);
  const compactBookRows: CompactBookRow[] = useMemo(() => [
    ...(board.xqbCandidates ?? []).map((candidate) => {
      const sampleCount = candidate.win + candidate.draw + candidate.loss;
      const percent = (value: number) => sampleCount > 0 ? Math.round(value * 100 / sampleCount) : 0;
      return {
        id: `xqb-${candidate.source}-${candidate.iccs}`,
        iccs: candidate.iccs,
        notation: candidate.notation,
        scoreText: formatOpeningBookScore(candidate.score),
        winRateText: candidate.winRate == null ? "--" : `${candidate.winRate.toFixed(1)}%`,
        source: candidate.source,
        detail: candidate.memo,
        sampleCount,
        distribution: sampleCount > 0 ? { redWin: percent(candidate.win), draw: percent(candidate.draw), blackWin: percent(candidate.loss) } : undefined,
      };
    }),
    ...cloudCandidates.map((candidate, _index, candidates) => {
      const bestScore = Math.max(...candidates.map((item) => item.score));
      const gap = bestScore - candidate.score;
      return {
      id: `cloud-${candidate.iccs}`,
      iccs: candidate.iccs,
      notation: candidate.notation,
      scoreText: formatOpeningBookScore(candidate.score),
      winRateText: candidate.winRate == null ? "--" : `${candidate.winRate.toFixed(0)}%`,
      source: "ChessDB 云库",
      detail: candidate.memo,
      advantageText: formatOpeningBookGap(gap),
    }; }),
  ], [board.xqbCandidates, cloudCandidates]);
  const activeBuiltinOpeningBook = useMemo(() => {
    const books = builtinOpeningBookManifest.books;
    return books.find((book) => book.id === desktopPreferences.activeBuiltinOpeningBookId)
      ?? books.find((book) => book.id === builtinOpeningBookManifest.defaultBookId)
      ?? books[0];
  }, [builtinOpeningBookManifest, desktopPreferences.activeBuiltinOpeningBookId]);
  const builtinOpeningBookReferenceStatus = activeBuiltinOpeningBook ? {
    enabled: desktopPreferences.builtinOpeningBookEnabled ?? true,
    verified: builtinOpeningBookManifest.vkeyVerification.status === "verified",
    name: activeBuiltinOpeningBook.name,
    shortName: activeBuiltinOpeningBook.shortName,
    maxCandidatesPerPosition: activeBuiltinOpeningBook.maxCandidatesPerPosition,
    note: builtinOpeningBookManifest.vkeyVerification.note,
  } : undefined;
  const activeBookCandidateAuditByMove = bookCandidateAuditState.fen === board.fen
    ? bookCandidateAuditByMove
    : {};
  const activeBookCandidateAuditState = bookCandidateAuditState.fen === board.fen || bookCandidateAuditState.status === "running"
    ? bookCandidateAuditState
    : { status: "idle" as const, message: "Pikafish 未验证" };
  const compactEvaluationRows: CompactEvaluationRow[] = useMemo(() => orderedAnalysis.map((line) => ({
    id: `pv-${line.multipv}`,
    iccs: line.pv[0],
    notation: line.notation?.[0] ?? line.pv[0] ?? `候选 ${line.multipv}`,
    scoreText: redAnalysisScoreText(line, candidateSideToMove),
    depthText: `${line.depth ?? "--"}`,
    role: line.multipv === 1 ? "首选" : `候选 ${line.multipv}`,
    disabled: analysisIsStale,
  })), [analysisIsStale, candidateSideToMove, orderedAnalysis]);
  const candidateInsights = useMemo(() => candidateCoachInsights(orderedAnalysis, { sideToMove: candidateSideToMove }), [candidateSideToMove, orderedAnalysis]);
  const liveCoachAdvice = useMemo(() => currentCoachAdvice({
    board,
    primaryAnalysis,
    analysisLines: orderedAnalysis,
    report: reportPresentation,
    analysisBusy,
  }), [analysisBusy, board, orderedAnalysis, primaryAnalysis, reportPresentation]);
  const primaryMove = primaryAnalysis?.notation?.[0] ?? primaryAnalysis?.pv[0];
  const searchLimitLabel = searchMode === "infinite"
    ? "持续分析"
    : searchMode === "depth"
      ? `固定深度 ${searchValue}`
      : searchMode === "nodes"
        ? `固定节点 ${searchValue.toLocaleString()}`
      : `固定时间 ${(searchValue / 1000).toFixed(1)}s`;
  const mobileCloudHint = chessPlatform.kind !== "web"
    ? undefined
    : !online
      ? "当前离线，联网后可使用云端 Pikafish。"
    : cloudConnection !== "online"
      ? "点击分析会自动连接云端 Pikafish。"
      : undefined;
  const engineRuntimeLabel: Record<EngineRuntimeState, string> = {
    idle: "待分析",
    analyzing: "分析中",
    thinking: "思考中",
    pondering: "后台思考",
    stopping: "停止中",
    faulted: "故障",
  };
  const currentEngineLabel = chessPlatform.kind === "web" ? "云端 Pikafish" : engineDisplayName(enginePath);
  const currentEngineVersionLabel = chessPlatform.kind === "web" ? currentEngineLabel : engineProbeDisplayName(currentEngineLabel, engineProbe);
  const currentNnueLabel = chessPlatform.kind === "web" ? undefined : nnueProbeLabel(engineProbe);
  const currentEngineTitle = chessPlatform.kind === "web" ? "云端 Pikafish" : engineProbeTitle(currentEngineLabel, enginePath || "未配置引擎", engineProbe);
  const currentEngineHashLabel = shortHash(engineProbe?.engineSha256);
  const currentNnueHashLabel = shortHash(engineProbe?.nnueSha256);
  const strategyInsight = useMemo(() => {
    const reportPosition = board.currentNode ? reportPositionByNode.get(board.currentNode)?.position : gameReport?.positions.at(-1);
    const studyTags = (studySessions.find((session) => session.nodeId === board.currentNode) ?? studySessions[0])?.tags;
    return buildStrategyInsight({
      sideToMove: board.sideToMove,
      ply: board.history.length,
      pieces: board.pieces,
      history: board.history.map((move) => move.notation),
      phase: reportPosition?.phase,
      currentBranchCount: board.branches.length || board.siblingBranches?.length,
      openingName: reportPosition?.opening?.name,
      analysis: analysisIsStale ? undefined : primaryAnalysis,
      analysisBusy,
      analysisStale: analysisIsStale,
      engineName: currentEngineLabel,
      studyTags,
      masterStyleHints: reportPosition?.masterStyleHints,
      courseCards: [
        ...bundledTheoryKnowledge.cards.map((card) => ({
          id: `bundled-${card.id}`,
          phase: card.phase,
          title: card.title,
          summary: card.summary,
          appliesWhen: card.appliesWhen,
          risk: card.risk,
          source: card.courseName === "特级大师训练法"
            ? { label: "方法论参考" as const, course: card.courseName, episode: card.lessonTitle, timecode: card.timecode, review: "已确认" as const }
            : { label: "赵鑫鑫课程" as const, course: card.courseName, episode: card.lessonTitle, timecode: card.timecode, review: "已确认" as const },
        })),
        ...(theoryLibrary?.cards ?? []).filter((card) => card.reviewStatus === "approved").map((card) => ({
        id: `course-${card.id}`,
        phase: card.phase,
        title: card.title,
        summary: card.summary,
        appliesWhen: card.appliesWhen,
        risk: card.risk,
        tags: card.tags,
        engineCorrelations: card.engineCorrelations,
        matchPenalty: card.matchPenalty,
        needsRecheck: card.needsRecheck,
        source: card.courseName === "特级大师训练法" ? {
          label: "方法论参考" as const,
          course: card.courseName,
          episode: card.lessonTitle,
          review: "已确认" as const,
        } : card.sourceBook ? {
          label: "赵鑫鑫棋理三部曲" as const,
          book: card.sourceBook,
          pageStart: card.sourcePageStart,
          pageEnd: card.sourcePageEnd,
          review: "已确认" as const,
        } : {
          label: "赵鑫鑫课程" as const,
          course: card.courseName,
          episode: card.lessonTitle,
          timecode: card.timecode,
          review: "已确认" as const,
        },
        })),
      ],
    });
  }, [analysisBusy, analysisIsStale, board.branches.length, board.currentNode, board.fen, board.history, board.pieces, board.sideToMove, board.siblingBranches?.length, currentEngineLabel, gameReport?.positions, primaryAnalysis, reportPositionByNode, studySessions, theoryLibrary?.cards]);

  function startBestMovePractice() {
    if (!bestMoveHint?.bestMove || analysisFen !== boardRef.current.fen || analysisIsStale) {
      setNotice("请先完成当前局面分析，再尝试正着");
      return;
    }
    setBestMovePractice({
      ...bestMoveHint,
      fen: boardRef.current.fen,
      ply: boardRef.current.history.length,
    });
    setManualLineDialogOpen(false);
    setNotice(`已进入尝试正着：请在棋盘上走出你认为的正着，本次按 Top-${Math.max(1, bestMoveHint.topMoves.length)} 判断`);
  }

  const selectedAnalysisEngines = useMemo(() => {
    const activeProfile = engineProfiles.find((profile) => profile.id === desktopPreferences.activeEngineId || profile.executablePath === enginePath);
    const primary = {
      id: activeProfile?.id ?? "primary",
      name: activeProfile?.name ?? currentEngineLabel,
      displayName: currentEngineVersionLabel,
      path: enginePath,
      primary: true,
      title: currentEngineTitle,
      nnueLabel: currentNnueLabel ?? (currentNnueHashLabel ? `NNUE ${currentNnueHashLabel}` : undefined),
    };
    const selected = desktopPreferences.analysisEngineMode === "parallel"
      ? [
        ...engineProfiles.filter((profile) => desktopPreferences.parallelEngineIds.includes(profile.id))
          .map((profile) => ({ id: profile.id, name: profile.name, displayName: profile.name, path: profile.executablePath, primary: false, title: `${profile.name}\n路径：${profile.executablePath}`, nnueLabel: undefined })),
        ...(desktopPreferences.parallelEnginePaths ?? []).map((path) => {
          const name = engineDisplayName(path);
          return { id: `builtin:${path}`, name, displayName: name, path, primary: false, title: `${name}\n路径：${path}`, nnueLabel: undefined };
        }),
      ]
      : [];
    return [primary, ...selected.filter((engine) => engine.id !== primary.id && engine.path !== primary.path)];
  }, [currentEngineLabel, currentEngineTitle, currentEngineVersionLabel, currentNnueHashLabel, currentNnueLabel, desktopPreferences.activeEngineId, desktopPreferences.analysisEngineMode, desktopPreferences.parallelEngineIds, desktopPreferences.parallelEnginePaths, enginePath, engineProfiles]);
  const engineChipTitle = selectedAnalysisEngines.map((engine, index) => {
    const role = engine.primary ? "主引擎" : `对比引擎 ${index}`;
    return [engine.primary ? currentEngineTitle : `${role}：${engine.displayName}`, !engine.primary && engine.path ? `路径：${engine.path}` : "", engine.nnueLabel ?? ""].filter(Boolean).join("\n");
  }).join("\n\n");

  async function runEngineArena() {
    if (chessPlatform.kind !== "desktop") {
      setNotice("Web 版不运行本地引擎擂台");
      return;
    }
    if (engineArenaBusy) {
      setNotice("引擎擂台正在运行中，请稍候");
      return;
    }
    if (analysisBusy || engineThinking || reportBusy) {
      setNotice("请先停止当前分析、报告或人机对弈，再启动擂台");
      return;
    }
    const primary = selectedAnalysisEngines.find((engine) => engine.primary);
    const comparison = selectedAnalysisEngines.find((engine) => !engine.primary && engine.path);
    if (!comparison?.path) {
      setNotice("擂台需要两个不同引擎，请先在引擎设置里添加外部对比引擎");
      return;
    }
    const playerAPath = primary?.path || enginePath || BUILTIN_ENGINE_PATH;
    const playerBPath = comparison.path;
    if (playerAPath === playerBPath) {
      setNotice("擂台需要两个不同引擎，请先在引擎设置里添加对比引擎");
      return;
    }
    setEngineArenaBusy(true);
    setNotice(`引擎擂台开始：2盘快测，红黑互换，采用${ruleModeLabel(desktopPreferencesRef.current.ruleMode)}`);
    try {
      const result = await chessPlatform.runEngineArena({
        playerA: { name: primary?.displayName ?? currentEngineVersionLabel, enginePath: playerAPath },
        playerB: { name: comparison.displayName ?? comparison.name, enginePath: playerBPath },
        games: 2,
        moveTimeMs: 300,
        threads,
        hashMb,
        maxPlies: 80,
      });
      setNotice(`引擎擂台完成：${result.summary}`);
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setEngineArenaBusy(false);
    }
  }

  const linkHasObservedPosition = ((linkSessionStatus.state === "tracking" || linkSessionStatus.state === "paused") || linkSessionStatus.initialPositionSeen === true)
    && linkSessionStatus.latestFen === board.fen;
  const linkShouldShowMiniBoard = shouldShowLinkMiniBoard(linkSessionStatus, board.fen);
  const boardDisplayReversed = effectiveBoardReversedForLink(linkSessionStatus, board.fen, reversed);
  const boardPerspectiveLabel = boardDisplayReversed ? "黑方视角" : "红方视角";

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px) and (orientation: portrait)");
    const sync = () => setIsMobileWorkbench(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    mobileDrawerCloseRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMobileDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileDrawerOpen]);

  useEffect(() => {
    if (!mobileExportOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMobileExportOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileExportOpen]);

  const analysisArrows = useMemo(() => {
    return selectAnalysisArrowLines({
      lines: orderedAnalysis,
      analysisFen,
      analysisArrowFen,
      boardFen: board.fen,
      analysisIsStale,
    })
    .flatMap((line) => {
      const from = squareFromIccs(line.pv[0].slice(0, 2));
      const to = squareFromIccs(line.pv[0].slice(2, 4));
      if (!from || !to) return [];
      return [{
        rank: line.multipv,
        color: analysisArrowColors[(line.multipv - 1) % analysisArrowColors.length] ?? analysisArrowColors[0],
        from: boardIntersectionPoint(from, boardDisplayReversed, displayedBoardSkin),
        to: boardIntersectionPoint(to, boardDisplayReversed, displayedBoardSkin),
      }];
    });
  }, [analysisArrowFen, analysisFen, analysisIsStale, board.fen, boardDisplayReversed, displayedBoardSkin, orderedAnalysis]);
  useEffect(() => setMobileArrowFocus(undefined), [board.fen, analysisFen]);
  const mobileFocusedArrow = useMemo(() => {
    if (analysisIsStale) return [];
    // A mobile candidate is an explicit request to display its route. Unlike
    // desktop's persistent MultiPV overlay, it does not depend on that overlay
    // being globally enabled when an automatic response arrives.
    // Mobile candidate rows can be restored from the per-engine result group
    // before the aggregate analysis array catches up. Use that same current-
    // position source so a visible recommendation always has its route arrow.
    const groupedLines = Object.values(currentEngineAnalyses)
      .filter((group) => group.fen === board.fen)
      .flatMap((group) => group.lines);
    const selectableLines = (groupedLines.length > 0
      ? groupedLines
      : analysisFen === board.fen ? orderedAnalysis : [])
      .filter((line) => line.multipv >= 1 && line.pv.length > 0);
    const fallbackMove = compactBookRows.some((row) => row.iccs === mobileArrowFocus) ? mobileArrowFocus : undefined;
    const candidateMoves = mobileCandidateArrowLines(selectableLines, multipv)
      .map((line) => ({ iccs: line.pv[0], rank: line.multipv }));
    if (candidateMoves.length === 0 && fallbackMove) candidateMoves.push({ iccs: fallbackMove, rank: 1 });
    return candidateMoves.flatMap(({ iccs, rank }) => {
      const from = squareFromIccs(iccs.slice(0, 2));
      const to = squareFromIccs(iccs.slice(2, 4));
      if (!from || !to) return [];
      return [{
        rank,
        color: analysisArrowColors[(rank - 1) % analysisArrowColors.length] ?? analysisArrowColors[0],
        from: boardIntersectionPoint(from, boardDisplayReversed, displayedBoardSkin),
        to: boardIntersectionPoint(to, boardDisplayReversed, displayedBoardSkin),
      }];
    });
  }, [analysisFen, analysisIsStale, board.fen, boardDisplayReversed, compactBookRows, currentEngineAnalyses, displayedBoardSkin, mobileArrowFocus, multipv, orderedAnalysis]);
  const linkMiniArrows = useMemo<LinkMiniArrow[]>(() => (
    linkHasObservedPosition && analysisFen === board.fen && !analysisIsStale
      ? orderedAnalysis.flatMap((line) => {
        const firstMove = line.pv[0];
        const from = firstMove ? squareFromIccs(firstMove.slice(0, 2)) : null;
        const to = firstMove ? squareFromIccs(firstMove.slice(2, 4)) : null;
        return from && to ? [{ rank: line.multipv, color: analysisArrowColors[(line.multipv - 1) % analysisArrowColors.length] ?? analysisArrowColors[0], iccs: firstMove, notation: line.notation?.[0], from, to }] : [];
      })
      : []
  ), [analysisFen, analysisIsStale, board.fen, linkHasObservedPosition, orderedAnalysis]);
  const linkMiniBoardReversed = boardDisplayReversed;
  const linkPrimaryCandidateRow = compactEngineRows.at(0);
  const linkArrowOne = linkMiniArrows.find((arrow) => arrow.rank === 1) ?? linkMiniArrows[0];
  const linkConfirmMove = linkArrowOne?.iccs ?? linkPrimaryCandidateRow?.iccs;
  const linkConfirmMoveLabel = linkArrowOne?.notation ?? linkPrimaryCandidateRow?.line?.notation?.[0] ?? linkConfirmMove;
  const linkConfirmMoveDisplay = linkMoveDisplayText(linkConfirmMove, linkConfirmMoveLabel);
  const linkPendingMoveDisplay = linkMoveDisplayText(
    linkSessionStatus.pendingExternalMove,
    linkSessionStatus.pendingExternalMove === linkConfirmMove ? linkConfirmMoveLabel : undefined,
  );
  const linkDisplayedLastMove = selectLinkDisplayedLastMove({
    linkShouldShowMiniBoard,
    statusLatestFen: linkSessionStatus.latestFen,
    boardFen: board.fen,
    statusLastMove: linkSessionStatus.lastMoveDetail,
    boardLastMove: lastMove,
  });
  const linkDisplayedLastMoveKey = linkDisplayedLastMove
    ? `${linkDisplayedLastMove.from.row}-${linkDisplayedLastMove.from.col}:${linkDisplayedLastMove.to.row}-${linkDisplayedLastMove.to.col}:${board.fen}`
    : undefined;
  const linkMiniPieceState = useRef<LinkMiniPieceRenderState>({ active: false, pieces: [] });
  const linkMiniPieces = useMemo(() => {
    const next = nextStableLinkMiniPieceState(linkMiniPieceState.current, {
      boardFen: board.fen,
      boardPieces: board.pieces,
      linkDisplayedLastMove,
      linkDisplayedLastMoveKey,
      linkShouldShowMiniBoard,
      allowFullRefreshWithoutMove: linkSessionStatus.phase === "position_jump_synced" && linkSessionStatus.latestFen === board.fen,
    });
    linkMiniPieceState.current = next;
    return next.pieces;
  }, [board.fen, board.pieces, linkDisplayedLastMove, linkDisplayedLastMoveKey, linkSessionStatus.phase, linkShouldShowMiniBoard]);
  const linkMiniBoardHint = linkMiniBoardHintText({
    observed: linkShouldShowMiniBoard,
    sideToMove: board.sideToMove,
    arrowCount: linkMiniArrows.length,
    analysisBusy,
    analysisIsStale,
    firstMove: linkMoveDisplayText(linkPrimaryCandidateRow?.iccs, linkPrimaryCandidateRow?.line?.notation?.[0]),
    lastMove: linkDisplayedLastMove,
    fallback: linkCapturePreview
      ? `识别未通过，主棋盘未更新：${linkSessionStatus.lastError ?? linkSessionStatus.reason ?? "等待模型返回合法局面"}`
      : "当前不使用主窗口棋盘作为连线识别结果",
  });
  const activeTreePath = useMemo(() => new Set(board.history.map((move) => move.id)), [board.history]);
  const directBranchChoices = board.branches.length > 1 ? board.branches : [];
  const branchChoices = directBranchChoices;
  const hasVisibleBranchChoices = branchChoices.length > 1;
  const hasUpcomingBranch = hasUpcomingBranchPoint(board.manualTree ?? [], board.currentNode);
  const branchArrowColor = desktopPreferences.branchArrowColor || DEFAULT_BRANCH_ARROW_COLOR;
  const branchArrows = useMemo(() => hasVisibleBranchChoices && directBranchChoices.length > 1 ? directBranchChoices.map((move, index) => ({
    rank: index + 1,
    color: branchArrowColor,
    label: move.notation,
    from: boardIntersectionPoint(move.from, boardDisplayReversed, displayedBoardSkin),
    to: boardIntersectionPoint(move.to, boardDisplayReversed, displayedBoardSkin),
  })) : [], [boardDisplayReversed, branchArrowColor, directBranchChoices, displayedBoardSkin, hasVisibleBranchChoices]);
  const boardArrows = useMemo(() => {
    // Preview already marks the simulated from/to squares. Hide route arrows
    // so old analysis lines never look like they are attached to the preview.
    if (candidatePreview && previewStep) return [];
    if (isMobileWorkbench) return mobileArrowsEnabled ? mobileFocusedArrow : [];
    if (branchArrows.length > 0) return branchArrows;
    return analysisArrows;
  }, [analysisArrows, branchArrows, candidatePreview, isMobileWorkbench, mobileArrowsEnabled, mobileFocusedArrow, previewStep]);
  const mainBoardMarkerMove = displayedLastMove ?? lastMove;
  const mainBoardMoveGradeStyle = mainBoardMarkerMove && !candidatePreview && board.currentNode === lastMove?.id && overviewReport?.grade && overviewReport.score != null
    ? (() => {
        const cellStyle = boardCellStyle(mainBoardMarkerMove.to, boardDisplayReversed, displayedBoardSkin);
        return {
          "--piece-left": cellStyle.left,
          "--piece-top": cellStyle.top,
        } as CSSProperties;
      })()
    : undefined;

  function resetAnalysisHistory(fen?: string, lines: AnalysisLine[] = []) {
    analysisHistoryRef.current = fen ? { fen, lines: lines.slice(0, ENGINE_ANALYSIS_HISTORY_LIMIT) } : undefined;
    setAnalysisHistory(analysisHistoryRef.current?.lines ?? []);
  }

  function applyDesktopPreferences(preferences: DesktopPreferencesDto) {
    const migrated = migrateDesktopPreferences(preferences);
    const normalized = {
      ...migrated,
      manualViewMode: migrated.manualViewMode === "tree" ? "tree" as ManualViewMode : "track" as ManualViewMode,
      boardSkin: normalizeSkinId(migrated.boardSkin),
      pieceSkin: normalizeSkinId(migrated.pieceSkin),
    };
    desktopPreferencesRef.current = normalized;
    persistedPreferencesRef.current = normalized;
    multipvRef.current = normalized.multipv;
    setDesktopPreferences(normalized);
    setEnginePath(normalized.enginePath);
    setThreads(normalized.threads);
    setHashMb(normalized.hashMb);
    setMultipv(normalized.multipv);
    setSearchMode(normalized.searchMode);
    setSearchValue(normalized.searchValue);
    setMoveTimeMs(normalized.moveTimeMs);
    setPonderEnabled(normalized.ponder);
    setAutoAnalyze(normalized.autoAnalyze);
    setLibraryCollapsed(normalized.libraryCollapsed);
    setCandidateRailCollapsed(normalized.candidateRailCollapsed);
    setAnalysisPanelCollapsed(normalized.analysisPanelCollapsed);
    setFloatingEvaluationCollapsed(normalized.evaluationCollapsed);
    setWorkspacePanel(normalized.workspacePanel);
    setColorTheme(normalized.colorTheme);
    setServerUrl(normalized.serverUrl);
  }

  async function migrateLegacyEngineDefaultsOnce(preferences: DesktopPreferencesDto) {
    if (chessPlatform.kind !== "desktop") return;
    try {
      if (localStorage.getItem(LEGACY_ENGINE_DEFAULTS_MIGRATION_KEY) === "done") return;
      localStorage.setItem(LEGACY_ENGINE_DEFAULTS_MIGRATION_KEY, "done");
    } catch {
      return;
    }
    const patch: Partial<DesktopPreferencesDto> = {};
    if (preferences.multipv === 5) patch.multipv = DEFAULT_ENGINE_CANDIDATES;
    if (preferences.moveTimeMs === 2000 || preferences.moveTimeMs === 3000) patch.moveTimeMs = DEFAULT_ENGINE_MOVE_TIME_MS;
    const legacyAnalysisDefaults = ((preferences.searchMode === "time" || preferences.searchMode === "infinite") && preferences.searchValue === 1500)
      || (preferences.searchMode === "depth" && (preferences.searchValue === 30 || preferences.searchValue === 26));
    if (legacyAnalysisDefaults) {
      patch.searchMode = "depth";
      patch.searchValue = DEFAULT_ANALYSIS_DEPTH;
      if (preferences.autoAnalyze) patch.autoAnalyze = false;
    }
    if (preferences.reportDepth === 30 || preferences.reportDepth === 26) patch.reportDepth = DEFAULT_REPORT_DEPTH;
    if (Object.keys(patch).length === 0) return;
    try {
      const saved = await saveDesktopPreferencePatch(patch);
      applyDesktopPreferences(saved);
    } catch {
      // Non-critical: the settings dialog can still save these values manually.
    }
  }

  function saveDesktopPreferencePatch(patch: Partial<DesktopPreferencesDto>) {
    const normalizedPatch = {
      ...patch,
      ...(patch.boardSkin ? { boardSkin: normalizeSkinId(patch.boardSkin) } : {}),
      ...(patch.pieceSkin ? { pieceSkin: normalizeSkinId(patch.pieceSkin) } : {}),
    };
    const optimistic = { ...desktopPreferencesRef.current, ...normalizedPatch };
    desktopPreferencesRef.current = optimistic;
    setDesktopPreferences(optimistic);
    const keys = Object.keys(normalizedPatch) as Array<keyof DesktopPreferencesDto>;
    const operation = preferenceSaveQueue.current.then(async () => {
      const snapshot = { ...persistedPreferencesRef.current, ...normalizedPatch };
      try {
        const saved = await chessPlatform.saveDesktopPreferences(snapshot);
        persistedPreferencesRef.current = saved;
        const current = desktopPreferencesRef.current;
        const confirmed = Object.fromEntries(keys
          .filter((key) => Object.is(current[key], optimistic[key]))
          .map((key) => [key, saved[key]])) as Partial<DesktopPreferencesDto>;
        const reconciled = { ...current, ...confirmed };
        desktopPreferencesRef.current = reconciled;
        setDesktopPreferences(reconciled);
        return reconciled;
      } catch (error) {
        const current = desktopPreferencesRef.current;
        const rolledBack = Object.fromEntries(keys
          .filter((key) => Object.is(current[key], optimistic[key]))
          .map((key) => [key, persistedPreferencesRef.current[key]])) as Partial<DesktopPreferencesDto>;
        const reconciled = { ...current, ...rolledBack };
        desktopPreferencesRef.current = reconciled;
        setDesktopPreferences(reconciled);
        throw error;
      }
    });
    preferenceSaveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function toggleColorTheme() {
    if (chessPlatform.kind === "desktop") {
      setNotice(desktopPreferencesRef.current.layoutMode === "compact" ? "简洁模式固定浅色主题" : "专业模式固定暗黑主题");
      return;
    }
    const next = colorTheme === "dark" ? "light" : "dark";
    setColorTheme(next);
  }

  async function setWorkspaceLayout(layoutMode: DesktopPreferencesDto["layoutMode"]) {
    if (desktopPreferencesRef.current.layoutMode === layoutMode) return;
    if (chessPlatform.kind === "web") {
      const preferences = { ...desktopPreferencesRef.current, layoutMode };
      desktopPreferencesRef.current = preferences;
      persistedPreferencesRef.current = preferences;
      setDesktopPreferences(preferences);
      try { localStorage.setItem("xiangqi:workspace-layout", layoutMode); } catch { /* Browser storage may be unavailable. */ }
      setNotice(layoutMode === "compact" ? "已切换到简洁分析布局" : "已切换到专业工作台布局");
      return;
    }
    try {
      await saveDesktopPreferencePatch({ layoutMode });
      setNotice(layoutMode === "compact" ? "已切换到简洁分析布局" : "已切换到专业工作台布局");
    } catch (error) {
      setNotice(`布局切换失败：${friendlyError(error)}`);
    }
  }

  async function updateBoardSkin(patch: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">) {
    if (syncAccount.status !== "signedIn" && requiresSignInForSkinPatch(desktopPreferences, patch)) {
      setNotice("登录同步账号后才能使用登录专享皮肤");
      return;
    }
    try {
      await saveDesktopPreferencePatch(patch);
      setSkinHoverPreview(undefined);
      setNotice("棋盘皮肤已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function setLibraryVisibility(collapsed: boolean) {
    setLibraryCollapsed(collapsed);
    if (chessPlatform.kind !== "desktop") return;
    try {
      await saveDesktopPreferencePatch({ libraryCollapsed: collapsed });
    } catch (error) {
      setLibraryCollapsed(desktopPreferencesRef.current.libraryCollapsed);
      setNotice(friendlyError(error));
    }
  }

  async function setCandidateRailVisibility(collapsed: boolean) {
    setCandidateRailCollapsed(collapsed);
    if (chessPlatform.kind !== "desktop") return;
    try {
      await saveDesktopPreferencePatch({ candidateRailCollapsed: collapsed });
    } catch (error) {
      setCandidateRailCollapsed(desktopPreferencesRef.current.candidateRailCollapsed);
      setNotice(friendlyError(error));
    }
  }

  async function setAnalysisPanelVisibility(collapsed: boolean) {
    setAnalysisPanelCollapsed(collapsed);
    if (chessPlatform.kind !== "desktop") return;
    try {
      await saveDesktopPreferencePatch({ analysisPanelCollapsed: collapsed });
    } catch (error) {
      setAnalysisPanelCollapsed(desktopPreferencesRef.current.analysisPanelCollapsed);
      setNotice(friendlyError(error));
    }
  }

  async function setEvaluationVisibility(collapsed: boolean) {
    setFloatingEvaluationCollapsed(collapsed);
    if (chessPlatform.kind !== "desktop") return;
    try {
      await saveDesktopPreferencePatch({ evaluationCollapsed: collapsed });
    } catch (error) {
      setFloatingEvaluationCollapsed(desktopPreferencesRef.current.evaluationCollapsed);
      setNotice(friendlyError(error));
    }
  }

  function selectWorkspacePanel(panel: WorkspacePanel) {
    setWorkspacePanel(panel);
    if (chessPlatform.kind !== "desktop") return;
    void saveDesktopPreferencePatch({ workspacePanel: panel }).catch((error) => {
      setWorkspacePanel(desktopPreferencesRef.current.workspacePanel);
      setNotice(friendlyError(error));
    });
  }

  async function loadGameReport() {
    if (chessPlatform.kind !== "desktop") return;
    const loadRevision = ++reportLoadRevision.current;
    const expectedBoardRevision = boardRevision.current;
    try {
      const loaded = await chessPlatform.getGameReport();
      if (loadRevision === reportLoadRevision.current && expectedBoardRevision === boardRevision.current) {
        setGameReport(loaded);
      }
    } catch (error) {
      if (loadRevision === reportLoadRevision.current && expectedBoardRevision === boardRevision.current) {
        setGameReport(undefined);
        setNotice(friendlyError(error));
      }
    }
  }

  async function generateGameReport(): Promise<GameReportDatasetDto | undefined> {
    if (chessPlatform.kind !== "desktop") {
      setNotice("整局分析报告仅支持桌面版");
      return;
    }
    if (!enginePath.trim()) {
      setNotice("请先在引擎设置中选择可用引擎");
      return;
    }
    stopPlayback();
    setEngineSide("none");
    setPonderMove(undefined);
    if (engineThinking) await chessPlatform.moveNow().catch(() => false);
    await chessPlatform.stopEnginePlay().catch(() => false);
    await cancelAnalysisForDocumentChange();
    selectWorkspacePanel("report");
    setReportBusy(true);
    setReportProgress({
      completed: 0,
      total: Math.max(1, boardRef.current.history.length + 1),
      elapsedMs: 0,
      targetDepth: desktopPreferencesRef.current.reportDepth,
      currentDepth: undefined,
      cached: 0,
      state: "running",
    });
    setNotice("正在生成整局分析报告…");
    const reportBoardRevision = boardRevision.current;
    try {
      const dataset = await chessPlatform.generateGameReport({ enginePath, reportDepth: desktopPreferencesRef.current.reportDepth, threads, hashMb });
      if (reportBoardRevision === boardRevision.current) setGameReport(dataset);
      else await loadGameReport();
      setReportProgress((current) => ({
        completed: dataset.positions.length,
        total: dataset.positions.length,
        elapsedMs: current?.elapsedMs ?? 0,
        state: "complete",
      }));
      setNotice("整局分析报告已生成并保存");
      return dataset;
    } catch (error) {
      const message = friendlyError(error);
      if (!message.includes("取消")) setNotice(message);
    } finally {
      setReportBusy(false);
    }
  }

  async function openMasterManualPanel() {
    selectWorkspacePanel("moves");
    if (desktopPreferencesRef.current.layoutMode === "compact" && chessPlatform.kind === "desktop") {
      await openCompactFloatingPanel("manual");
      return;
    }
    setNotice("已切到棋谱页，可直接点着法回看");
  }

  async function openMasterAnalysisPanel() {
    selectWorkspacePanel("report");
    if (gameReport) {
      setMasterAnalysisDialogOpen(true);
      return;
    }
    if (reportBusy) {
      setNotice("整局复盘分析正在生成中，完成后可查看开局/中局/残局评分");
      return;
    }
    if (!enginePath.trim()) {
      setNotice("请先在引擎设置中选择可用引擎，再生成整局评分分析");
      return;
    }
    const dataset = await generateGameReport();
    if (dataset) setMasterAnalysisDialogOpen(true);
  }

  async function openAnalysisReportPanel() {
    selectWorkspacePanel("report");
    if (gameReport) {
      setReportDialogOpen(true);
      return;
    }
    if (reportBusy) {
      setNotice("整局报告正在生成中，完成后可点报告放大查看");
      return;
    }
    if (!enginePath.trim()) {
      setNotice("请先在引擎设置中选择可用引擎，再生成大师棋谱分析报告");
      return;
    }
    const dataset = await generateGameReport();
    if (dataset) setReportDialogOpen(true);
  }

  async function cancelGameReport(showNotice = true) {
    if (!reportBusy || chessPlatform.kind !== "desktop") return;
    try {
      await chessPlatform.cancelGameReport();
      if (showNotice) setNotice("正在取消整局分析，已完成的节点缓存会保留");
    } catch (error) {
      if (showNotice) setNotice(friendlyError(error));
    }
  }

  async function exportGameReport() {
    if (!reportPresentation || reportBusy || reportExportingRef.current) return;
    if (chessPlatform.kind !== "desktop") {
      setNotice("PDF 报告导出仅支持桌面版");
      return;
    }
    reportExportingRef.current = true;
    setReportExporting(true);
    try {
      const path = await chessPlatform.exportGameReportPdf(reportPresentation);
      setNotice(path ? `PDF 报告已导出：${path.split(/[\\/]/).at(-1)}` : "已取消导出报告");
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
    } finally {
      reportExportingRef.current = false;
      setReportExporting(false);
    }
  }

  async function cancelGameReportForStructureChange() {
    reportLoadRevision.current += 1;
    if (reportBusy) await cancelGameReport(false);
  }

  function ensureAnalysisHintsEnabled() {
    analysisHintsEnabledRef.current = true;
    setAnalysisHintsEnabled(true);
  }

  function scheduleAnalysisAfterMove(next: BoardState) {
    if (!shouldRefreshAnalysisAfterMove({
      playable: next.playable,
      isPlaying,
      reportBusy,
      engineSide,
      engineThinking,
      autoAnalyze,
      analysisHintsEnabled: analysisHintsEnabledRef.current,
      platformKind: chessPlatform.kind,
      enginePath,
      online,
      token,
    })) return;
    window.setTimeout(() => {
      if (boardRef.current.fen !== next.fen) return;
      if (analysisBusyRef.current) {
        if (shouldQueueWebAnalysisReplacement(chessPlatform.kind, true)) pendingAutoAnalysis.current = true;
        return;
      }
      void runAnalysis(true);
    }, 260);
  }

  async function cancelRunningAnalysis(reason?: string, options: { keepHints?: boolean; forceBackendStop?: boolean } = {}) {
    const wasBusy = analysisBusyRef.current;
    if (!wasBusy && !options.forceBackendStop) return;
    pendingAutoAnalysis.current = false;
    analysisSessionRevision.current += 1;
    analysisLoadRevision.current += 1;
    analysisFirstCandidateWatchdogRef.current = undefined;
    analysisBusyRef.current = false;
    setAnalysisBusy(false);
    if (!options.keepHints) {
      analysisHintsEnabledRef.current = false;
      setAnalysisHintsEnabled(false);
      setAnalysisArrowFen(undefined);
    }
    if (reason) setNotice(reason);
    await chessPlatform.stopAnalysis(true).catch(() => undefined);
  }

  async function stopRunningAnalysisBeforeMove() {
    await cancelRunningAnalysis("正在停止旧局面分析，准备切换到新局面…", { keepHints: true, forceBackendStop: true });
  }

  async function playIccsMove(iccs: string, expectedFen?: string, sourceEngineName?: string, options: { stopEngineFirst?: boolean } = {}) {
    stopPlayback();
    if (!ensureBoardChangeAllowed()) return;
    const practiceAtMoveStart = bestMovePracticeRef.current;
    const flyknifeAtMoveStart = flyknifePracticeRef.current;
    const moveStartFen = boardRef.current.fen;
    const moveStartPly = boardRef.current.history.length;
    if (expectedFen && boardRef.current.fen !== expectedFen) {
      setNotice("候选线路已过期，请等待当前局面重新分析");
      return;
    }
    if (!board.playable) {
      setNotice("当前研究局面不可对弈，请先修正局面");
      return;
    }
    const stoppedEngineForManualMove = options.stopEngineFirst && (engineSide !== "none" || engineThinking || engineStarting);
    if (engineThinking || engineStarting || isEngineTurn(board) || stoppedEngineForManualMove) {
      if (!options.stopEngineFirst) {
        setNotice(engineStarting ? `${currentEngineLabel} 正在启动` : engineThinking ? `${currentEngineLabel} 正在思考` : `当前轮到 ${currentEngineLabel} 行棋`);
        return;
      }
      await stopEnginePlay();
      setNotice("已停止人机对弈，正在采用当前候选着…");
    }
    setAnalysisArrowFen(undefined);
    clearCandidatePreviews();
    try {
      await stopRunningAnalysisBeforeMove();
      await cancelGameReportForStructureChange();
      if (chessPlatform.kind === "desktop") {
        await chessPlatform.previewLine(boardRef.current.fen, [iccs]);
      }
      let next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.playMove(iccs)));
      if (sourceEngineName && next.currentNode) {
        next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.updateComment(next.currentNode!, `引擎来源：${sourceEngineName}`)));
      }
      applyBoard(next);
      await loadGameReport();
      const ruleBlocked = next.ruleVerdict && engineBlockingRuleVerdicts.has(next.ruleVerdict);
      const practiceResult = practiceAtMoveStart && practiceAtMoveStart.fen === moveStartFen && practiceAtMoveStart.ply === moveStartPly
        ? evaluateBestMovePractice(practiceAtMoveStart, iccs, next.history.at(-1)?.notation)
        : undefined;
      let flyknifeResult: string | undefined;
      if (flyknifeAtMoveStart && flyknifeAtMoveStart.fen === moveStartFen && next.history.length === flyknifeAtMoveStart.ply + flyknifeAtMoveStart.step + 1) {
        const expected = flyknifeAtMoveStart.plan.mainline[flyknifeAtMoveStart.step];
        if (expected !== iccs) {
          setFlyknifePractice(undefined);
          flyknifeResult = `已偏离飞刀主线：本步应走 ${expected}，你走了 ${iccs}。可在飞刀库重新打开练习。`;
        } else if (flyknifeAtMoveStart.step + 1 >= flyknifeAtMoveStart.plan.mainline.length) {
          setFlyknifePractice(undefined);
          flyknifeResult = `飞刀主线完成。最佳防守：${flyknifeAtMoveStart.plan.bestDefense.join(" ") || "请复核引擎主变"}；${flyknifeAtMoveStart.plan.risk}`;
        } else {
          setFlyknifePractice({ ...flyknifeAtMoveStart, step: flyknifeAtMoveStart.step + 1 });
          flyknifeResult = `命中飞刀主线第 ${flyknifeAtMoveStart.step + 1} 步，下一步继续按方案走。`;
        }
      }
      if (practiceAtMoveStart) setBestMovePractice(undefined);
      setNotice(ruleBlocked
        ? `${next.ruleReason ?? next.status} · 人机对弈已暂停`
        : flyknifeResult ?? practiceResult?.message ?? `已记录 ${next.history.at(-1)?.notation ?? iccs}${sourceEngineName ? ` · ${sourceEngineName} 建议` : ""}`);
      if (ruleBlocked) {
        setEngineSide("none");
        await chessPlatform.stopEnginePlay().catch(() => undefined);
      } else if (engineSide === "none" || stoppedEngineForManualMove) {
        scheduleAnalysisAfterMove(next);
      } else {
        await requestEngineMove(next);
      }
    } catch (error) {
      setNotice(friendlyError(error));
    }
    setSelected(null);
  }

  async function previewCandidateLine(line: AnalysisLine, expectedFen: string, source?: Pick<EngineComparisonGroup, "id" | "name">) {
    stopPlayback();
    if (boardRef.current.fen !== expectedFen) {
      setNotice("候选线路已过期，请重新分析后再预览");
      return;
    }
    const sourceEngineId = source?.id ?? primaryAnalysisEngineRef.current;
    const sourceEngineName = source?.name ?? currentEngineLabel;
    if (candidatePreview?.sourceFen === expectedFen && candidatePreview.sourceEngineId === sourceEngineId && candidatePreview.rank === line.multipv) {
      clearCandidatePreviews();
      setNotice(`已取消 ${sourceEngineName} 候选 ${line.multipv} 推演预览`);
      return;
    }
    const pv = line.pv.slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
    if (pv.length === 0) {
      setNotice("当前候选没有可预览的 PV 线路");
      return;
    }
    const coach = candidateInsights.find((candidate) => candidate.rank === line.multipv);
    try {
      const steps = await chessPlatform.previewLine(expectedFen, pv);
      if (boardRef.current.fen !== expectedFen) {
        setNotice("预览生成后局面已变化，请重新分析");
        return;
      }
      if (steps.length === 0) {
        setNotice("当前候选没有可播放的合法步骤");
        return;
      }
      setSelected(null);
      setCandidatePreviewBranches([]);
      setCandidatePreview({
        rank: line.multipv,
        color: analysisArrowColors[(line.multipv - 1) % analysisArrowColors.length] ?? analysisArrowColors[0],
        sourceEngineId,
        sourceEngineName,
        sourceFen: expectedFen,
        firstMove: line.notation?.[0] ?? line.pv[0] ?? `候选 ${line.multipv}`,
        intent: coach?.intent ?? `候选 ${line.multipv}：观察这条线能否解决当前局面的主要矛盾。`,
        possibility: coach?.possibility ?? "可能性：作为当前 MultiPV 返回的可选线路进行比较。",
        risk: coach?.risk ?? "风险：预览时重点看对方回应后是否有直接反击。",
        steps,
        step: 0,
      });
      setNotice(`已载入 ${sourceEngineName} 候选 ${line.multipv} 推演：从第 1 步开始，手动点击“下一步”查看后续`);
    } catch (error) {
      clearCandidatePreviews();
      setNotice(friendlyError(error));
    }
  }

  async function previewEngineBranches(expectedFen: string) {
    stopPlayback();
    if (boardRef.current.fen !== expectedFen) {
      setNotice("引擎分支已过期，请重新分析后再查看");
      return;
    }
    const candidates = engineComparisonGroups
      .map((engine) => ({ engine, line: engine.lines.find((candidate) => candidate.multipv === 1) }))
      .filter((item): item is { engine: EngineComparisonGroup; line: AnalysisLine } => !!item.line?.pv[0]);
    if (candidates.length === 0) {
      setNotice("当前没有可显示的引擎分支，请先完成分析");
      return;
    }
    const grouped = new Map<string, Array<{ engine: EngineComparisonGroup; line: AnalysisLine }>>();
    for (const candidate of candidates) {
      const firstMove = candidate.line.pv[0];
      grouped.set(firstMove, [...(grouped.get(firstMove) ?? []), candidate]);
    }
    const branches: ManualPreviewBranch[] = [];
    let skipped = 0;
    for (const [firstIccs, members] of grouped) {
      const primaryMember = members.find((member) => member.engine.primary) ?? members[0];
      const pv = primaryMember.line.pv.slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
      try {
        const steps = await chessPlatform.previewLine(expectedFen, pv);
        if (boardRef.current.fen !== expectedFen) {
          setNotice("引擎分支生成后局面已变化，请重新分析");
          return;
        }
        if (steps.length === 0) {
          skipped += members.length;
          continue;
        }
        const engineNames = members.map((member) => member.engine.name);
        const scoreTexts = members.map((member) => {
          const depth = member.line.depth != null ? `深${member.line.depth}` : "深--";
          return `${member.engine.name} ${redAnalysisScoreText(member.line, candidateSideToMove)} ${depth}`;
        });
        branches.push({
          activeStep: 0,
          engineNames,
          firstMove: primaryMember.line.notation?.[0] ?? firstIccs,
          label: members.length > 1
            ? `AI推荐 · ${members.length}个引擎一致${members.some((member) => member.engine.primary) ? `（主 + ${members.length - 1}对比）` : ""}`
            : `AI推荐 · ${primaryMember.engine.name}`,
          merged: members.length > 1,
          rank: branches.length + 1,
          scoreTexts,
          sourceEngineName: primaryMember.engine.name,
          steps,
        });
      } catch {
        skipped += members.length;
      }
    }
    if (branches.length === 0) {
      setNotice(skipped > 0 ? "所有引擎分支都无法合法预览，请重新分析或检查引擎线路" : "当前没有可显示的引擎分支");
      return;
    }
    setSelected(null);
    setCandidatePreview(undefined);
    setCandidatePreviewBranches(branches);
    setNotice(`已显示 ${branches.length} 条 AI 虚线分支${skipped ? `，跳过 ${skipped} 条不可用线路` : ""}；只预览，不保存`);
  }

  function stepCandidatePreview(delta: number) {
    setCandidatePreview((current) => {
      if (!current) return current;
      const step = Math.max(0, Math.min(current.steps.length - 1, current.step + delta));
      return { ...current, step };
    });
  }

  function jumpCandidatePreview(step: number) {
    setCandidatePreview((current) => {
      if (!current) return current;
      return { ...current, step: Math.max(0, Math.min(current.steps.length - 1, step)) };
    });
  }

  function exitCandidatePreview() {
    clearCandidatePreviews();
    setNotice("已退出候选推演预览，棋盘回到真实当前局面");
  }

  function cancelEnginePreviewBranches() {
    setCandidatePreviewBranches([]);
    setNotice("已取消引擎虚线分支预览");
  }

  function clearCandidatePreviews() {
    setCandidatePreview(undefined);
    setCandidatePreviewBranches([]);
  }

  async function selectSquare(row: number, col: number) {
    if (!board.playable) {
      setNotice("当前研究局面不可对弈，请先修正局面");
      return;
    }
    if (engineThinking || isEngineTurn(board)) {
      setNotice(engineThinking ? `${currentEngineLabel} 正在思考` : `当前轮到 ${currentEngineLabel} 行棋`);
      return;
    }
    const piece = pieceMap.get(`${row}-${col}`);
    if (!selected) {
      if (piece) setSelected({ row, col });
      return;
    }
    const selectedPiece = pieceMap.get(`${selected.row}-${selected.col}`);
    if (piece && piece.color === selectedPiece?.color) {
      setSelected({ row, col });
      return;
    }
    const iccs = `${squareToIccs(selected.row, selected.col)}${squareToIccs(row, col)}`;
    await playIccsMove(iccs);
  }

  async function createGame(fen = fenInput) {
    if (!ensureBoardChangeAllowed()) return;
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      applyBoard(await chessPlatform.newGame(fen));
      setAutosave({ status: "saved" });
      await refreshGames();
      setSelected(null);
      clearAnalysisState();
      setGameReport(undefined);
      setNotice("已创建新棋谱");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function openDocument() {
    if (!ensureBoardChangeAllowed()) return;
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      const next = await chessPlatform.openDocument();
      if (!next) {
        setNotice("已取消打开棋谱");
        return;
      }
      applyBoard(next);
      setAutosave({ status: "saved" });
      clearAnalysisState();
      await loadGameReport();
      await refreshGames();
      setNotice("棋谱已导入并自动保存到本地库");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function openMasterLibraryGame(gameId: string, options: { analyze: boolean } = { analyze: true }) {
    if (!ensureBoardChangeAllowed()) return;
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    const next = await chessPlatform.openMasterGame(gameId);
    applyBoard(next);
    setAutosave({ status: "saved" });
    clearAnalysisState();
    await loadGameReport();
    await refreshGames();
    setMasterLibraryOpen(false);
    if (!options.analyze) {
      selectWorkspacePanel("moves");
      setNotice("大师棋谱已打开，可先查看棋谱；需要评分时再生成整局报告");
      return;
    }
    selectWorkspacePanel("report");
    if (!shouldAutoGenerateMasterGameReport({ platformKind: chessPlatform.kind, enginePath })) {
      setNotice("大师棋谱已打开；请先在引擎设置中配置 Pikafish，再生成整局报告");
      return;
    }
    setNotice("大师棋谱已打开，正在启动整局 Pikafish 分析…");
    window.setTimeout(() => void generateGameReport(), 0);
  }

  async function importXqbOpeningBook() {
    try {
      const next = await chessPlatform.importXqbOpeningBook();
      if (!next) return;
      applyBoard(next);
      setNotice("XQB 开局库已导入，候选着法显示在棋盘候选区");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function importEleeyeOpeningBook() {
    try {
      const next = await chessPlatform.importEleeyeOpeningBook();
      if (!next) return;
      applyBoard(next);
      setNotice("ElephantEye 本地开局库已导入，候选着法显示在棋盘候选区");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function saveDocument(saveAs = false) {
    try {
      const path = await chessPlatform.saveDocument(saveAs || !board.sourcePath || board.sourceFormat !== "pgn");
      if (path) {
        applyBoard({ ...boardRef.current, sourcePath: path, sourceFormat: "pgn" });
        setNotice(`棋谱已保存：${path.split(/[\\/]/).at(-1)}`);
      } else {
        setNotice("已取消保存棋谱");
      }
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function copyPosition() {
    try {
      await chessPlatform.copyPosition(board.fen);
      setNotice("当前局面 FEN 已复制");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function copyGame(mainlineOnly = false) {
    try {
      await chessPlatform.copyGame(mainlineOnly);
      setNotice(mainlineOnly ? "当前主线棋谱已复制" : "完整棋谱、变例和注释已复制");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function copyExport(format: Exclude<ExportFormat, "pgn">, label: string) {
    try {
      await chessPlatform.copyExport(format);
      setNotice(`${label}已复制到剪贴板`);
      setExportMenuOpen(false);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function exportManualFile(format: ExportFormat, label: string) {
    if (manualExporting) return;
    setManualExporting(true);
    try {
      const path = await chessPlatform.exportManualFile(format, gameTitle);
      if (path) {
        setNotice(`${label}已导出：${path.split(/[\\/]/).at(-1)}`);
        setExportMenuOpen(false);
      } else {
        setNotice("已取消导出");
      }
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
    } finally {
      setManualExporting(false);
    }
  }

  async function exportManualPdf() {
    if (manualExporting) return;
    setManualExporting(true);
    try {
      const path = await chessPlatform.exportManualPdf(gameTitle);
      if (path) {
        setNotice(`PDF 棋谱已导出：${path.split(/[\\/]/).at(-1)}`);
        setExportMenuOpen(false);
      } else {
        setNotice("已取消导出");
      }
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setManualExporting(false);
    }
  }

  async function exportReplayGif(scope: ReplayExportScope) {
    if (manualExporting) return;
    setManualExporting(true);
    try {
      const path = await chessPlatform.exportReplayGif(gameTitle, scope);
      if (path) {
        setNotice(`${scope === "currentSelection" ? "当前分支" : "完整主线"}动态图已导出：${path.split(/[\\/]/).at(-1)}`);
        setExportMenuOpen(false);
      } else {
        setNotice("已取消导出");
      }
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
    } finally {
      setManualExporting(false);
    }
  }

  async function exportMindMap() {
    if (manualExporting) return;
    setManualExporting(true);
    try {
      const path = await chessPlatform.exportMindMapSvg(gameTitle, buildMindMapSvg(gameTitle, board.manualTree ?? []));
      if (path) {
        setNotice(`变招图已导出：${path.split(/[\\/]/).at(-1)}`);
        setExportMenuOpen(false);
      } else {
        setNotice("已取消导出");
      }
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setManualExporting(false);
    }
  }

  async function exportCurrentLineText(contents: string) {
    if (manualExporting) return undefined;
    setManualExporting(true);
    try {
      const path = await chessPlatform.exportTextFile(`${gameTitle}-当前局面棋谱`, contents);
      if (path) {
        setNotice(`当前局面棋谱已导出：${path.split(/[\\/]/).at(-1)}`);
      } else {
        setNotice("已取消导出");
      }
      return path;
    } catch (error) {
      setNotice(friendlyError(error));
      return undefined;
    } finally {
      setManualExporting(false);
    }
  }

  async function pasteDocument() {
    if (!ensureBoardChangeAllowed()) return;
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      applyBoard(await chessPlatform.pasteDocument());
      setAutosave({ status: "saved" });
      clearAnalysisState();
      await loadGameReport();
      await refreshGames();
      setNotice("剪贴板内容已识别并导入");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function saveGameMetadata() {
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.updateGameMetadata(gameTitle.trim() || "未命名棋谱", gameNote)));
      await refreshGames();
      setNotice("棋谱名称和局面备注已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  function openPositionEditor() {
    stopPlayback();
    stopEnginePlay();
    void cancelAnalysisForDocumentChange();
    if (chessPlatform.kind === "web") {
      setNotice("Web 端暂不支持局面编辑，请使用桌面版");
      return;
    }
    setEditorPieces(board.pieces.map((piece) => ({ ...piece })));
    setEditorSide(board.sideToMove === "红方" ? "red" : "black");
    setGameTitle(board.title);
    setGameNote(board.note);
    setEditorPiece(editorPalette[0]);
    setPositionEditorOpen(true);
  }

  function editSquare(row: number, col: number) {
    setEditorPieces((pieces) => {
      const remaining = pieces.filter((piece) => piece.row !== row || piece.col !== col);
      return editorPiece ? [...remaining, { ...editorPiece, row, col }] : remaining;
    });
  }

  async function confirmPositionEditor() {
    if (!ensureBoardChangeAllowed()) return;
    const fen = piecesToFen(editorPieces, editorSide);
    try {
      await cancelAnalysisForDocumentChange();
      await cancelGameReportForStructureChange();
      applyBoard(await chessPlatform.newGame(fen, gameTitle.trim() || "研究局面", gameNote));
      setAutosave({ status: "saved" });
      clearAnalysisState();
      setGameReport(undefined);
      setPositionEditorOpen(false);
      await refreshGames();
      setNotice("研究局面已创建；异常局面会禁用走棋和引擎");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function reorderBranchNodes(nodeIds: string[], from: number, to: number) {
    if (from === to || to < 0 || to >= nodeIds.length) return;
    const ordered = nodeIds.slice();
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    try {
      await cancelGameReportForStructureChange();
      applyBoard(await enqueueBoardOperation(() => chessPlatform.reorderBranches(ordered)));
      await loadGameReport();
      setNotice("变招顺序已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  function isEngineTurn(state: BoardState, side = engineSide) {
    return (side === "red" && state.sideToMove === "红方") || (side === "black" && state.sideToMove === "黑方");
  }

  async function stopEnginePlay() {
    setEngineSide("none");
    setEngineStarting(false);
    setEngineThinking(false);
    setPonderMove(undefined);
    if (engineThinking) await chessPlatform.moveNow().catch(() => false);
    await chessPlatform.stopEnginePlay().catch(() => false);
  }

  async function cancelAnalysisForDocumentChange() {
    analysisHintsEnabledRef.current = false;
    setAnalysisHintsEnabled(false);
    setAnalysisArrowFen(undefined);
    if (!analysisBusyRef.current) return;
    pendingAutoAnalysis.current = false;
    analysisBusyRef.current = false;
    setAnalysisBusy(false);
    await chessPlatform.stopAnalysis(true).catch(() => undefined);
  }

  async function requestEngineMove(state = boardRef.current, side = engineSide) {
    if (chessPlatform.kind !== "desktop") {
      setNotice("Web 版不运行本地引擎对弈");
      return;
    }
    if (side === "none") {
      setNotice("请先选择引擎执红或执黑");
      return;
    }
    if (!isEngineTurn(state, side)) {
      setNotice(`当前轮到${state.sideToMove}行棋，引擎设置为执${side === "red" ? "红" : "黑"}`);
      return;
    }
    if (engineStarting || engineThinking) {
      setNotice(engineStarting ? `${currentEngineLabel} 正在启动…` : `${currentEngineLabel} 正在思考…`);
      return;
    }
    if (reportBusy) {
      setNotice("整局报告生成期间不能开始人机对弈");
      return;
    }
    if (state.ruleVerdict && engineBlockingRuleVerdicts.has(state.ruleVerdict)) {
      setNotice(`${state.ruleReason ?? state.status} · 人机对弈已暂停`);
      setEngineSide("none");
      await chessPlatform.stopEnginePlay().catch(() => undefined);
      return;
    }
    if (!ensureBoardChangeAllowed()) return;
    if (!enginePath.trim()) {
      setNotice("未找到可用引擎，无法开始人机对弈");
      setEngineSide("none");
      return;
    }
    if (!state.playable) {
      setNotice("当前研究局面不可对弈");
      setEngineSide("none");
      return;
    }
    await stopRunningAnalysisBeforeMove();
    setEngineStarting(true);
    setNotice(`正在启动 ${currentEngineLabel}（执${side === "red" ? "红" : "黑"}）…`);
    try {
      const result = await enqueueBoardOperation(() => chessPlatform.playEngineMove({ enginePath, moveTimeMs, threads, hashMb, ponder: ponderEnabled }));
      applyBoard(result.board);
      await loadGameReport();
      setPonderMove(result.ponder);
      if (result.board.ruleVerdict && engineBlockingRuleVerdicts.has(result.board.ruleVerdict)) {
        setEngineSide("none");
        setPonderMove(undefined);
        setNotice(`${currentEngineLabel} 已走 ${result.board.history.at(-1)?.notation ?? "一着"} · ${result.board.ruleReason ?? result.board.status}`);
      } else {
        setNotice(`${currentEngineLabel} 已走 ${result.board.history.at(-1)?.notation ?? "一着"}${result.ponder ? ` · 预测 ${result.ponder}` : ""}`);
      }
    } catch (error) {
      setNotice(friendlyError(error));
      setEngineSide("none");
    } finally {
      setEngineStarting(false);
      setEngineThinking(false);
    }
  }

  function toggleEngineSide(side: "red" | "black") {
    if (reportBusy) {
      setNotice("整局报告生成期间不能开始人机对弈");
      return;
    }
    if (engineThinking && engineSide !== side) {
      setNotice(`${currentEngineLabel} 正在思考，请先停止当前对弈再切换执方`);
      return;
    }
    const next = engineSide === side ? "none" : side;
    setEngineSide(next);
    setPonderMove(undefined);
    if (next === "none") {
      void stopEnginePlay();
      setNotice("人机对弈已停止");
    } else {
      if (analysisBusyRef.current) void cancelRunningAnalysis(undefined, { keepHints: true });
      window.setTimeout(() => void requestEngineMove(boardRef.current, next), 0);
    }
  }

  async function moveNow() {
    if (engineStarting) {
      setNotice(`${currentEngineLabel} 正在启动，请在显示“思考中”后立即出招`);
      return;
    }
    if (!engineThinking) {
      if (!canRequestEngineMoveNow({
        platformKind: chessPlatform.kind,
        playable: boardRef.current.playable,
        reportBusy,
        engineSide,
        engineStarting,
        sideToMove: boardRef.current.sideToMove,
      })) {
        if (engineSide === "none") {
          setNotice("请先在局面分析中选择引擎执红或执黑");
        } else if (!boardRef.current.playable) {
          setNotice("当前研究局面不可对弈");
        } else if (reportBusy) {
          setNotice("整局报告生成期间不能开始人机对弈");
        } else if (!isEngineTurn(boardRef.current)) {
          setNotice(`当前轮到你行棋，${currentEngineLabel} 会在轮到它时自动思考`);
        } else {
          setNotice("当前状态不能立即出招");
        }
        return;
      }
      setNotice(`正在启动 ${currentEngineLabel} 思考…`);
      await requestEngineMove(boardRef.current, engineSide);
      return;
    }
    try {
      const stopped = await chessPlatform.moveNow();
      setNotice(stopped ? `已要求 ${currentEngineLabel} 立即出招` : "引擎当前没有正在计算的着法");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function playPrimaryAnalysisMove() {
    const firstMove = primaryAnalysis?.pv[0];
    const analyzedFen = analysisFen ?? boardRef.current.fen;
    if (!firstMove || analysisIsStale || analyzedFen !== boardRef.current.fen) {
      setNotice("当前没有可采用的第一候选，请完成当前局面分析");
      return;
    }
    ensureAnalysisHintsEnabled();
    await playIccsMove(firstMove, analyzedFen, undefined, { stopEngineFirst: true });
  }

  async function playCompactEngineRow(row: CompactEngineAnalysisRow) {
    if (!row.iccs) {
      setNotice("当前候选没有可采用的首着");
      return;
    }
    ensureAnalysisHintsEnabled();
    await playIccsMove(row.iccs, row.analyzedFen ?? analysisFen ?? boardRef.current.fen, row.source?.primary ? undefined : row.source?.name, { stopEngineFirst: true });
  }

  async function previewCompactEngineRow(row: CompactEngineAnalysisRow) {
    if (!row.line) {
      setNotice("当前候选没有可预览的 PV 线路");
      return;
    }
    await previewCandidateLine(row.line, row.analyzedFen ?? analysisFen ?? boardRef.current.fen, row.source);
  }

  async function advanceMobileForcedVariation() {
    const rows = compactEngineRows.filter((row) => !!row.line?.pv.length && !row.disabled);
    if (rows.length === 0) {
      setNotice("当前没有可切换的候选 PV，请先完成分析");
      return;
    }
    const currentIndex = candidatePreview
      ? rows.findIndex((row) => row.source?.id === candidatePreview.sourceEngineId && row.line?.multipv === candidatePreview.rank)
      : -1;
    const next = rows[currentIndex + 1];
    if (!next) {
      setNotice(currentIndex >= 0 ? "当前已是最后一条候选 PV" : "当前没有可预览的候选 PV");
      return;
    }
    await previewCompactEngineRow(next);
  }

  async function auditBookCandidatesWithPikafish() {
    const uniqueRows = compactBookRows.filter((row, index, rows) => rows.findIndex((item) => item.iccs === row.iccs) === index);
    const rows = uniqueRows.slice(0, BOOK_CANDIDATE_AUDIT_LIMIT);
    const fen = boardRef.current.fen;
    const setAuditError = (message: string) => {
      setBookCandidateAuditState({ status: "error", fen, message });
      setNotice(message);
    };
    if (!boardRef.current.playable) {
      setAuditError("当前局面不可分析，无法用 Pikafish 验证开局库候选");
      return;
    }
    if (rows.length === 0) {
      setAuditError("当前局面没有可验证的开局库候选");
      return;
    }
    if (chessPlatform.kind !== "desktop") {
      setAuditError("Pikafish 开局库验证仅支持桌面版");
      return;
    }
    if (!enginePath.trim()) {
      setAuditError("未配置 Pikafish，请先在引擎设置中选择可用引擎");
      return;
    }
    if (analysisBusyRef.current) {
      setAuditError("请先停止当前引擎分析，再验证开局库候选");
      return;
    }
    if (reportBusy || engineSide !== "none" || engineThinking || isPlaying) {
      setAuditError("当前引擎正被其他功能占用，暂不能验证开局库候选");
      return;
    }

    const latestPreferences = desktopPreferencesRef.current;
    const auditMode = latestPreferences.searchMode === "infinite" ? "depth" : latestPreferences.searchMode;
    const auditValue = latestPreferences.searchMode === "infinite"
      ? BOOK_CANDIDATE_AUDIT_DEPTH
      : Math.max(1, latestPreferences.searchValue || searchValue || BOOK_CANDIDATE_AUDIT_DEPTH);
    const auditLimit = analysisLimitText(auditMode, auditValue);
    const effectiveThreads = Math.min(64, Math.max(1, latestPreferences.threads || threads));
    const effectiveHashMb = Math.min(4096, Math.max(16, latestPreferences.hashMb || hashMb));
    const moves = rows.map((row) => row.iccs);
    const activeProfile = engineProfiles.find((profile) => profile.id === latestPreferences.activeEngineId || profile.executablePath === enginePath);
    const engineName = activeProfile?.name ?? engineDisplayName(enginePath);
    const revision = ++bookCandidateAuditRevisionRef.current;
    const baseOptions = {
      enginePath,
      engineName: `${engineName} · 开局库验证`,
      fen,
      searchMode: auditMode,
      searchValue: auditValue,
      threads: effectiveThreads,
      hashMb: effectiveHashMb,
      serverUrl,
      token,
    };
    setBookCandidateAuditByMove({});
    setBookCandidateAuditState({
      status: "running",
      fen,
      total: uniqueRows.length,
      checked: rows.length,
      message: `Pikafish 正在验证 ${rows.length}/${uniqueRows.length} 条 · ${auditLimit}`,
    });
    setNotice(`Pikafish 正在验证开局库候选：${rows.length}/${uniqueRows.length} 条`);
    try {
      const baselineLines = await chessPlatform.analyze({
        ...baseOptions,
        engineId: `book-audit-baseline-${revision}`,
        analysisSessionId: 900_000_000 + revision * 2,
        multipv: Math.min(BOOK_CANDIDATE_AUDIT_LIMIT, Math.max(3, rows.length)),
      });
      if (bookCandidateAuditRevisionRef.current !== revision || boardRef.current.fen !== fen) return;
      const candidateLines = await chessPlatform.analyze({
        ...baseOptions,
        engineId: `book-audit-candidates-${revision}`,
        analysisSessionId: 900_000_001 + revision * 2,
        multipv: rows.length,
        searchMoves: moves,
      });
      if (bookCandidateAuditRevisionRef.current !== revision || boardRef.current.fen !== fen) return;
      const candidateLineByMove = new Map(candidateLines.map((line) => [line.pv[0], line]).filter((entry): entry is [string, AnalysisLine] => !!entry[0]));
      const results = Object.fromEntries(rows.map((row) => [
        row.iccs,
        classifyBookCandidateAudit({
          candidateMove: row.iccs,
          baselineLines,
          candidateLine: candidateLineByMove.get(row.iccs),
        }),
      ]));
      const maxDepth = candidateLines.reduce((max, line) => Math.max(max, line.depth ?? 0), 0);
      const doneMessage = `Pikafish 已验证 ${rows.length}/${uniqueRows.length} 条 · ${maxDepth ? `深度 ${maxDepth}` : auditLimit}`;
      setBookCandidateAuditByMove(results);
      setBookCandidateAuditState({ status: "done", fen, total: uniqueRows.length, checked: rows.length, message: doneMessage });
      setNotice(doneMessage);
    } catch (error) {
      if (bookCandidateAuditRevisionRef.current !== revision) return;
      setAuditError(`Pikafish 验证失败：${friendlyError(error)}`);
    }
  }

  async function runAnalysis(automatic = false, excludeMove?: string) {
    if (!boardRef.current.playable) {
      if (!automatic) setNotice("当前研究局面不可对弈，请先在局面编辑器中修正");
      return;
    }
    if (isPlaying) {
      if (!automatic) setNotice("请先停止棋谱播放再分析当前局面");
      return;
    }
    if (reportBusy) {
      if (!automatic) setNotice("整局报告生成期间不能分析当前局面");
      return;
    }
    if (engineSide !== "none" || engineThinking) {
      if (!automatic) setNotice("请先停止人机对弈再进入分析模式");
      return;
    }
    if (analysisBusyRef.current) {
      if (automatic) {
        if (shouldQueueWebAnalysisReplacement(chessPlatform.kind, true)) {
          pendingAutoAnalysis.current = true;
          return;
        }
        await cancelRunningAnalysis("局面已更新，正在切换自动分析…", { keepHints: true });
        window.setTimeout(() => setAutoRetry((value) => value + 1), 80);
      }
      return;
    }
    if (chessPlatform.kind === "desktop" && !enginePath.trim()) {
      if (!automatic) setNotice("未找到可用引擎，请填写引擎路径");
      return;
    }
    if (chessPlatform.kind === "web" && !online) {
      if (!automatic) setNotice("当前离线，无法启动云端分析");
      return;
    }
    if (chessPlatform.kind === "web" && cloudConnection !== "online") {
      setCloudConnection("checking");
      try {
        await chessPlatform.checkCloudHealth(serverUrl);
        setCloudConnection("online");
      } catch (error) {
        setCloudConnection("offline");
        if (!automatic) setNotice(`云端 Pikafish 不可达：${friendlyError(error)}`);
        return;
      }
    }
    const currentBoard = boardRef.current;
    const analyzedFen = currentBoard.fen;
    const analyzedRevision = boardRevision.current;
    const analysisSession = {
      revision: ++analysisSessionRevision.current,
      boardRevision: analyzedRevision,
      fen: analyzedFen,
    };
    const latestPreferences = desktopPreferencesRef.current;
    const effectiveThreads = Math.min(64, Math.max(1, latestPreferences.threads || threads));
    const effectiveHashMb = Math.min(4096, Math.max(16, latestPreferences.hashMb || hashMb));
    const effectiveMultipv = Math.max(MIN_ENGINE_CANDIDATES, Math.trunc(latestPreferences.multipv || multipvRef.current || DEFAULT_ENGINE_CANDIDATES));
    const activeProfile = engineProfiles.find((profile) => profile.id === latestPreferences.activeEngineId || profile.executablePath === enginePath);
    const primaryTarget = { id: activeProfile?.id ?? "primary", name: activeProfile?.name ?? engineDisplayName(enginePath), path: enginePath };
    const parallelTargets = latestPreferences.analysisEngineMode === "parallel"
      ? [
        ...engineProfiles.filter((profile) => latestPreferences.parallelEngineIds.includes(profile.id)).map((profile) => ({ id: profile.id, name: profile.name, path: profile.executablePath })),
        ...(latestPreferences.parallelEnginePaths ?? []).map((path) => ({ id: `builtin:${path}`, name: engineDisplayName(path), path })),
      ]
      : [];
    const analysisTargets = [primaryTarget, ...parallelTargets.filter((target) => target.id !== primaryTarget.id && target.path !== primaryTarget.path)];
    primaryAnalysisEngineRef.current = primaryTarget.id;
    analysisFirstCandidateWatchdogRef.current = undefined;
    analysisStreamRef.current = beginAnalysisStream(analyzedFen);
    analysisHistoryRef.current = beginAnalysisHistory(analyzedFen);
    setAnalysisHistory([]);
    analysisFenRef.current = analyzedFen;
    setAnalysisFen(analyzedFen);
    setAnalysisSideToMove(currentBoard.sideToMove);
    setAnalysis([]);
    setAnalysisError(undefined);
    setEngineAnalyses(Object.fromEntries(analysisTargets.map((target) => [target.id, { fen: analyzedFen, name: target.name, lines: [] }])));
    clearCandidatePreviews();
    if (!automatic) {
      analysisHintsEnabledRef.current = true;
      setAnalysisHintsEnabled(true);
    }
    analysisBusyRef.current = true;
    analysisLoadRevision.current += 1;
    if (analysisFen !== analyzedFen) {
      setAnalysisArrowFen(undefined);
    }
    setAnalysisArrowFen(analysisHintsEnabledRef.current ? analyzedFen : undefined);
    setAnalysisBusy(true);
    if (!automatic && searchMode === "infinite") await collapseCompactStudyPanels();
    if (!automatic) selectWorkspacePanel("analysis");
    const passPlan = analysisPassPlan({ automatic, platformKind: chessPlatform.kind, searchMode, searchValue });
    const configuredMode = passPlan.configuredMode;
    const configuredValue = passPlan.configuredValue;
    const runAnalysisPass = (mode: AnalysisOptions["searchMode"], value: number) => Promise.allSettled(analysisTargets.map((target) => chessPlatform.analyze({
      enginePath: target.path,
      engineId: target.id,
      engineName: target.name,
      analysisSessionId: analysisSession.revision,
      fen: analyzedFen,
      searchMode: mode,
      searchValue: value,
      threads: effectiveThreads,
      hashMb: effectiveHashMb,
      multipv: effectiveMultipv,
      serverUrl,
      token,
      guest: chessPlatform.kind === "web" && isMobileWorkbench,
      excludeMove,
    })));
    const applyAnalysisPass = (completed: Awaited<ReturnType<typeof runAnalysisPass>>) => {
      const result = completed[0]?.status === "fulfilled" ? completed[0].value : [];
      if (!isAnalysisSessionCurrent(analysisSession, analysisSessionRevision.current, boardRevision.current, boardRef.current.fen)) {
        return { current: false, failures: 0 };
      }
      setEngineAnalyses(Object.fromEntries(completed.map((outcome, index) => {
        const target = analysisTargets[index];
        return [target.id, outcome.status === "fulfilled"
          ? { fen: analyzedFen, name: target.name, lines: outcome.value }
          : { fen: analyzedFen, name: target.name, lines: [], error: friendlyError(outcome.reason) }];
      })));
      analysisFenRef.current = analyzedFen;
      analysisStreamRef.current = completeAnalysisStream(analyzedFen, result);
      setAnalysisFen(analyzedFen);
      setAnalysisSideToMove(currentBoard.sideToMove);
      setAnalysis(analysisStreamRef.current.lines);
      setAnalysisArrowFen(analysisHintsEnabledRef.current ? analyzedFen : undefined);
      const failures = completed.filter((outcome) => outcome.status === "rejected");
      if (failures.length === completed.length) {
        const reason = friendlyError((failures[0] as PromiseRejectedResult).reason);
        setAnalysisError(reason);
        if (chessPlatform.kind === "web" && reason.includes("登录已失效")) {
          setToken("");
          setSubscription(undefined);
          setCloudConnection("idle");
          setMobileDrawerOpen(true);
        }
      }
      return { current: true, failures: failures.length };
    };
    setNotice(automatic
      ? passPlan.quick
        ? `${analysisTargets.length} 个引擎正在快速分析…`
        : `${analysisTargets.length} 个引擎正在自动分析…`
      : passPlan.quick
        ? `${analysisTargets.length} 个引擎先快速出候选…`
        : `${analysisTargets.length} 个引擎正在计算…`);
    try {
      if (passPlan.quick) {
        const quickCompleted = await runAnalysisPass(passPlan.quick.searchMode, passPlan.quick.searchValue);
        const quick = applyAnalysisPass(quickCompleted);
        if (!quick.current) return;
        if (!passPlan.deep) {
          const failures = quick.failures;
          setNotice(failures ? `${analysisTargets.length - failures} 个引擎快速候选完成，${failures} 个失败` : `${analysisTargets.length} 个引擎快速候选已返回`);
          return;
        }
        setNotice(quick.failures
          ? `${analysisTargets.length - quick.failures} 个引擎已有快速候选，${quick.failures} 个失败；继续深算…`
          : `${analysisTargets.length} 个引擎已有快速候选，继续深算到 ${configuredMode === "depth" ? `深度 ${configuredValue}` : configuredMode === "nodes" ? `${configuredValue.toLocaleString()} 节点` : configuredMode === "time" ? `${(configuredValue / 1000).toFixed(1)} 秒` : "持续分析"}…`);
      }
      if (!passPlan.deep) return;
      const completed = await runAnalysisPass(passPlan.deep.searchMode, passPlan.deep.searchValue);
      const finalPass = applyAnalysisPass(completed);
      if (!finalPass.current) return;
      applyBoard(await chessPlatform.initialize());
      if (boardRef.current.fen === analyzedFen) {
        analysisFenRef.current = analyzedFen;
        setAnalysisFen(analyzedFen);
        setAnalysisArrowFen(analysisHintsEnabledRef.current ? analyzedFen : undefined);
      }
      const failures = finalPass.failures;
      setNotice(failures ? `${analysisTargets.length - failures} 个引擎完成，${failures} 个引擎失败` : `${analysisTargets.length} 个引擎分析完成并已保存`);
    } catch (error) {
      if (analysisSession.revision === analysisSessionRevision.current) setNotice(friendlyError(error));
    } finally {
      if (analysisSession.revision !== analysisSessionRevision.current) {
        if (chessPlatform.kind === "web") {
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
          if (pendingAutoAnalysis.current) {
            pendingAutoAnalysis.current = false;
            setAutoRetry((value) => value + 1);
          }
        }
        return;
      }
      analysisBusyRef.current = false;
      setAnalysisBusy(false);
      if (pendingAutoAnalysis.current) {
        pendingAutoAnalysis.current = false;
        setAutoRetry((value) => value + 1);
      }
    }
  }

  async function stopAnalysis() {
    pendingAutoAnalysis.current = false;
    analysisHintsEnabledRef.current = false;
    setAnalysisHintsEnabled(false);
    setAnalysisArrowFen(undefined);
    try {
      await cancelRunningAnalysis(`正在停止 ${currentEngineLabel}`, { keepHints: false, forceBackendStop: true });
      setNotice(`正在停止 ${currentEngineLabel}`);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  function applyBoard(value?: Partial<BoardState> | null) {
    const next = normalizeBoardState(value);
    const fenChanged = boardRef.current.fen !== next.fen;
    const positionChanged = fenChanged || boardRef.current.currentNode !== next.currentNode;
    boardRevision.current += 1;
    boardRef.current = next;
    if (positionChanged) {
      analysisSessionRevision.current += 1;
      analysisLoadRevision.current += 1;
      if (analysisBusyRef.current) {
        if (shouldQueueWebAnalysisReplacement(chessPlatform.kind, true)) {
          pendingAutoAnalysis.current = true;
        } else {
          pendingAutoAnalysis.current = false;
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
          void chessPlatform.stopAnalysis(true).catch(() => undefined);
        }
      } else {
        pendingAutoAnalysis.current = false;
      }
      setAnalysisArrowFen(undefined);
    }
    clearCandidatePreviews();
    setBoard(next);
    setFenInput(next.fen);
  }

  function clearAnalysisState() {
    analysisSessionRevision.current += 1;
    analysisLoadRevision.current += 1;
    pendingAutoAnalysis.current = false;
    if (analysisBusyRef.current) {
      analysisBusyRef.current = false;
      setAnalysisBusy(false);
      void chessPlatform.stopAnalysis(true).catch(() => undefined);
    }
    analysisFenRef.current = undefined;
    analysisStreamRef.current = undefined;
    resetAnalysisHistory();
    setEngineAnalyses({});
    setAnalysis([]);
    setAnalysisFen(undefined);
    setAnalysisSideToMove(undefined);
    setAnalysisArrowFen(undefined);
    clearCandidatePreviews();
    setPonderMove(undefined);
  }

  async function loadSavedAnalysis(fen = board.fen, options: { keepPreviousOnMiss?: boolean } = {}) {
    const loadRevision = ++analysisLoadRevision.current;
    const expectedBoardRevision = boardRevision.current;
    const analysisSession = {
      revision: analysisSessionRevision.current,
      boardRevision: expectedBoardRevision,
      fen,
    };
    try {
      const saved = await chessPlatform.loadSavedAnalysis(fen);
      if (isAnalysisSessionCurrent(analysisSession, analysisSessionRevision.current, boardRevision.current, boardRef.current.fen) && loadRevision === analysisLoadRevision.current) {
        if (saved.length === 0 && options.keepPreviousOnMiss) return;
        analysisFenRef.current = fen;
        analysisStreamRef.current = completeAnalysisStream(fen, saved);
        resetAnalysisHistory(fen, saved);
        setAnalysisFen(fen);
        setAnalysisSideToMove(boardRef.current.sideToMove);
        setAnalysis(saved);
      }
    } catch {
      if (isAnalysisSessionCurrent(analysisSession, analysisSessionRevision.current, boardRevision.current, boardRef.current.fen) && loadRevision === analysisLoadRevision.current && !options.keepPreviousOnMiss) {
        analysisFenRef.current = undefined;
        resetAnalysisHistory();
        setAnalysisFen(undefined);
        setAnalysisSideToMove(undefined);
        setAnalysis([]);
      }
    }
  }

  async function refreshGames() {
    try {
      setGames(await chessPlatform.listGames());
      if (chessPlatform.kind === "desktop") setLibraryFolders(await chessPlatform.listLibraryFolders());
    } catch {
      setGames([]);
    }
  }

  const currentLibraryGame = games.find((game) => game.id === games.find((item) => item.current)?.id);
  const visibleLibraryGames = games.filter((game) => {
    const query = librarySearch.trim().toLocaleLowerCase();
    const matchesQuery = !query || `${game.title} ${game.tags.join(" ")}`.toLocaleLowerCase().includes(query);
    const matchesFilter = libraryFilter === "all" || (libraryFilter === "favorites" ? game.favorite : libraryFilter === "uncategorized" ? !game.libraryFolder : game.libraryFolder === libraryFilter);
    return matchesQuery && matchesFilter;
  });

  async function saveCurrentLibrary(folder: string | undefined, favorite = currentLibraryGame?.favorite ?? false, tags = currentLibraryGame?.tags ?? []) {
    try {
      applyBoard(await chessPlatform.updateGameLibrary(folder, favorite, tags));
      setLibraryTagsInput(tags.join(", "));
      await refreshGames();
      setNotice("棋谱归档已保存");
      return true;
    } catch (error) {
      setNotice(friendlyError(error));
      return false;
    }
  }

  async function saveMirrorPreferences(enabled: boolean, root: string) {
    try {
      await saveDesktopPreferencePatch({ gameMirrorEnabled: enabled, gameMirrorRoot: root });
      setNotice(enabled ? "棋谱镜像设置已保存" : "已暂停 Finder 自动镜像，应用内棋谱仍会自动保存");
    } catch (error) { setNotice(friendlyError(error)); }
  }

  async function rebuildGameMirrors() {
    try {
      setDialogBusy(true);
      const statuses = await chessPlatform.rebuildGameMirrors();
      await refreshGames();
      const failed = statuses.filter((status) => status.state === "failed").length;
      setNotice(failed ? `镜像重建完成，${failed} 盘写入失败，请检查目录权限` : `已更新 ${statuses.filter((status) => status.state === "synced").length} 盘 Finder 镜像`);
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setDialogBusy(false); }
  }

  async function updateCurrentMirror() {
    try {
      const status = await chessPlatform.updateGameMirror();
      await refreshGames();
      setNotice(status.state === "synced" ? "Finder 镜像已更新" : status.error ?? "当前棋谱暂不满足镜像条件");
    } catch (error) { setNotice(friendlyError(error)); }
  }

  async function revealCurrentMirror() {
    try { await chessPlatform.revealGameMirror(); }
    catch (error) { setNotice(friendlyError(error)); }
  }

  async function createLibraryFolder() {
    const name = window.prompt("文件夹名称")?.trim();
    if (!name) return;
    try {
      await chessPlatform.createLibraryFolder(name);
      setLibraryFilter(name);
      await refreshGames();
      setNotice("文件夹已创建");
    } catch (error) { setNotice(friendlyError(error)); }
  }

  async function renameLibraryFolder(folder: LibraryFolder) {
    const name = window.prompt("新的文件夹名称", folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      await chessPlatform.renameLibraryFolder(folder.name, name);
      if (libraryFilter === folder.name) setLibraryFilter(name);
      await refreshGames();
      setNotice("文件夹已重命名");
    } catch (error) { setNotice(friendlyError(error)); }
  }

  async function deleteLibraryFolder(folder: LibraryFolder) {
    if (!window.confirm(`删除文件夹“${folder.name}”？其中的棋谱会移到“未分类”。`)) return;
    try {
      await chessPlatform.deleteLibraryFolder(folder.name);
      if (libraryFilter === folder.name) setLibraryFilter("uncategorized");
      await refreshGames();
      setNotice("文件夹已删除，棋谱已移至未分类");
    } catch (error) { setNotice(friendlyError(error)); }
  }

  useEffect(() => {
    setLibraryTagsInput(currentLibraryGame?.tags.join(", ") ?? "");
  }, [currentLibraryGame?.id, currentLibraryGame?.tags.join("\u0000")]);

  useEffect(() => {
    setTrainingGeneration(undefined);
  }, [currentLibraryGame?.id]);

  async function openGame(gameId: string) {
    if (!ensureBoardChangeAllowed()) return;
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      const next = await chessPlatform.openGame(gameId);
      applyBoard(next);
      setAutosave({ status: "saved" });
      setSelected(null);
      clearAnalysisState();
      await loadSavedAnalysis(next.fen ?? startingFen);
      await loadGameReport();
      await refreshGames();
      setNotice("已打开棋谱");
      setMobilePanel("board");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  function stopPlayback(keepBusy = false) {
    playbackRevision.current += 1;
    navigationRevision.current += 1;
    if (!keepBusy) setIsPlaying(false);
  }

  function startPlayback() {
    const token = ++playbackRevision.current;
    setIsPlaying(true);
    if (analysisBusyRef.current) {
      pendingAutoAnalysis.current = false;
      void chessPlatform.stopAnalysis(true).catch(() => undefined);
    }
    return token;
  }

  function enqueueBoardOperation<T>(run: () => Promise<T>) {
    return autosaveQueue.current!.enqueue(run);
  }

  function ensureBoardChangeAllowed() {
    if (!autosaveQueue.current!.hasFailure()) return true;
    setNotice("上一次本地保存失败，请先点击“保存失败”重试，避免棋谱写入错误分支");
    return false;
  }

  async function retryLastSave() {
    const retry = autosaveQueue.current!.retry();
    if (!retry) return;
    try {
      const result = await retry;
      if (result && typeof result === "object") {
        if ("fen" in result) {
          applyBoard(result as Partial<BoardState>);
        } else if ("board" in result && result.board && typeof result.board === "object") {
          applyBoard(result.board as Partial<BoardState>);
          if ("ponder" in result && typeof result.ponder === "string") setPonderMove(result.ponder);
        }
      }
      setNotice("本地草稿已重新保存");
    } catch (error) {
      setNotice(`本地保存失败：${friendlyError(error)}`);
    }
  }

  async function navigateTo(nodeId?: string, playbackToken?: number): Promise<BoardState | null> {
    if (!ensureBoardChangeAllowed()) return null;
    if (playbackToken == null) {
      stopPlayback();
      await stopEnginePlay();
    }
    if (playbackToken != null && playbackToken !== playbackRevision.current) return null;
    const requestRevision = ++navigationRevision.current;
    try {
      const next = normalizeBoardState(await chessPlatform.navigateTo(nodeId));
      if (requestRevision !== navigationRevision.current) return null;
      if (playbackToken != null && playbackToken !== playbackRevision.current) return null;
      applyBoard(next);
      setSelected(null);
      setTrendCursorIndex(undefined);
      await loadSavedAnalysis(next.fen ?? board.fen, { keepPreviousOnMiss: true });
      await loadGameReport();
      setNotice(playbackToken == null ? nodeId ? "已切换棋谱节点" : "已回到根局面" : "正在播放主线棋谱");
      return next;
    } catch (error) {
      setNotice(friendlyError(error));
      stopPlayback();
      return null;
    }
  }

  function preferredContinuation(state: BoardState) {
    return state.branches.find((move) => move.isMainline) ?? state.branches[0];
  }

  async function goPrevious() {
    const previous = board.history.at(-2);
    const next = await navigateTo(previous?.id);
    if (next) {
      setNotice(previous ? "已浏览上一着，棋谱未删除" : "已回到开局，棋谱未删除");
    }
  }

  async function startCoachStudy(nodeId: string) {
    // A report recommendation is text-only until the user deliberately starts
    // a fresh analysis from the position before the mistake.
    analysisHintsEnabledRef.current = false;
    setAnalysisHintsEnabled(false);
    setAnalysisArrowFen(undefined);
    clearCandidatePreviews();
    const moveIndex = board.history.findIndex((move) => move.id === nodeId);
    const previousNode = moveIndex > 0 ? board.history[moveIndex - 1].id : undefined;
    const cached = reportPositionByNode.get(nodeId)?.before;
    const next = await navigateTo(previousNode);
    if (!next) return;
    selectWorkspacePanel("analysis");
    if (cached?.bestIccs) {
      analysisFenRef.current = next.fen;
      setAnalysisFen(next.fen);
      setAnalysisSideToMove(next.sideToMove);
      setAnalysis([{
        depth: cached.depth,
        scoreCp: cached.scoreCp,
        mate: cached.mate,
        timeMs: cached.elapsedMs,
        multipv: 1,
        notation: cached.pvNotation ?? [],
        pv: cached.bestIccs ? [cached.bestIccs] : [],
      }]);
      resetAnalysisHistory(next.fen, [{
        depth: cached.depth,
        scoreCp: cached.scoreCp,
        mate: cached.mate,
        timeMs: cached.elapsedMs,
        multipv: 1,
        notation: cached.pvNotation ?? [],
        pv: cached.bestIccs ? [cached.bestIccs] : [],
      }]);
      setNotice(`已载入报告缓存推荐：${cached.bestNotation ?? cached.bestIccs}`);
      return;
    }
    setNotice("已回到问题着法之前，可按候选线路建立变招推演");
    if (!autoAnalyze && next.playable && !analysisBusyRef.current) {
      window.setTimeout(() => void runAnalysis(), 0);
    }
  }

  function trendIndexFromPointer(event: PointerEvent<SVGSVGElement>) {
    if (evaluationTrend.length === 0) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * trendChart.width;
    let nearest = 0;
    for (let index = 1; index < evaluationTrend.length; index += 1) {
      if (Math.abs(evaluationTrend[index].x - x) < Math.abs(evaluationTrend[nearest].x - x)) nearest = index;
    }
    return nearest;
  }

  function updateTrendCursor(event: PointerEvent<SVGSVGElement>) {
    const index = trendIndexFromPointer(event);
    if (index != null) setTrendCursorIndex(index);
  }

  function releaseTrendCursor() {
    if (activeTrendPoint?.nodeId) void navigateTo(activeTrendPoint.nodeId);
  }

  function trendKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (evaluationTrend.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = trendCursorIndex ?? Math.max(0, evaluationTrend.findIndex((point) => point.nodeId === board.currentNode));
      const next = event.key === "ArrowLeft" ? Math.max(0, current - 1) : Math.min(evaluationTrend.length - 1, current + 1);
      setTrendCursorIndex(next);
    }
    if (event.key === "Enter" && activeTrendPoint?.nodeId) {
      event.preventDefault();
      void navigateTo(activeTrendPoint.nodeId);
    }
  }

  async function goNext() {
    const next = preferredContinuation(board);
    if (next) await navigateTo(next.id);
  }

  async function selectBranchChoice(nodeId: string) {
    setBranchEditing(false);
    await navigateTo(nodeId);
  }

  async function goToEnd() {
    const token = startPlayback();
    let state = boardRef.current;
    let next = preferredContinuation(state);
    while (next) {
      const navigated = await navigateTo(next.id, token);
      if (!navigated) return;
      state = navigated;
      next = preferredContinuation(state);
    }
    if (token === playbackRevision.current) {
      setIsPlaying(false);
      setNotice("已到主线终局");
    }
  }

  async function togglePlayback() {
    if (isPlaying) {
      const visibleNode = boardRef.current.currentNode;
      stopPlayback(true);
      await navigateTo(visibleNode, playbackRevision.current);
      setIsPlaying(false);
      setNotice("已暂停棋谱播放");
      return;
    }

    const token = startPlayback();
    let state = boardRef.current;
    if (!preferredContinuation(state)) {
      const root = await navigateTo(undefined, token);
      if (!root) return;
      state = root;
    }

    while (token === playbackRevision.current) {
      const next = preferredContinuation(state);
      if (!next) break;
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if (token !== playbackRevision.current) return;
      const navigated = await navigateTo(next.id, token);
      if (!navigated) return;
      state = navigated;
    }
    if (token === playbackRevision.current) {
      setIsPlaying(false);
      setNotice("主线棋谱播放完成");
    }
  }

  async function goToNextBranchPoint() {
    const originalNode = boardRef.current.currentNode;
    const token = startPlayback();
    let state = boardRef.current;
    if (state.branches.length > 1) {
      setIsPlaying(false);
      selectWorkspacePanel("moves");
      setNotice(`当前已到分支点，共 ${state.branches.length} 个变招可选`);
      return;
    }
    let next = preferredContinuation(state);
    while (next) {
      const navigated = await navigateTo(next.id, token);
      if (!navigated) return;
      state = navigated;
      if (state.branches.length > 1) {
        setIsPlaying(false);
        selectWorkspacePanel("moves");
        setNotice(`已到下一分支点，共 ${state.branches.length} 个变招`);
        return;
      }
      next = preferredContinuation(state);
    }

    const restored = await navigateTo(originalNode, token);
    if (restored && token === playbackRevision.current) {
      setIsPlaying(false);
      setNotice("后续主线没有新的分支点");
    }
  }

  async function saveCommentForNode(nodeId: string, nextComment: string) {
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.updateComment(nodeId, nextComment)));
      setComment(nextComment);
      setNotice("注释已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function saveComment() {
    if (!board.currentNode) return;
    await saveCommentForNode(board.currentNode, comment);
  }

  async function toggleCurrentReviewMarker() {
    const nodeId = board.currentNode;
    const currentMove = board.history.find((move) => move.id === nodeId);
    if (!nodeId || !currentMove) return;
    try {
      const nextComment = toggleReviewMarker(currentMove.comment);
      applyBoard(await enqueueBoardOperation(() => chessPlatform.updateComment(nodeId, nextComment)));
      setNotice(hasReviewMarker(nextComment) ? "已标记当前着法，复盘时会在棋谱树中显示" : "已取消当前着法的复盘标记");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function makeMainline(nodeId: string) {
    stopPlayback();
    try {
      await cancelGameReportForStructureChange();
      applyBoard(await enqueueBoardOperation(() => chessPlatform.setMainline(nodeId)));
      await loadGameReport();
      setNotice("已设为主线");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function removeNode(nodeId: string, confirmed = false): Promise<boolean> {
    if (!confirmed && !window.confirm("确认删除分支？该着法及其后续所有子分支都会从棋谱中删除。回到上一步不需要删除，直接使用“上一着”即可。")) return false;
    stopPlayback();
    try {
      await cancelGameReportForStructureChange();
      applyBoard(await enqueueBoardOperation(() => chessPlatform.deleteNode(nodeId)));
      clearAnalysisState();
      await loadGameReport();
      setNotice("分支及其后续着法已删除");
      return true;
    } catch (error) {
      setNotice(friendlyError(error));
      return false;
    }
  }

  async function synchronize() {
    if (chessPlatform.kind === "desktop" && syncAccount.status !== "signedIn") {
      setNotice(syncAccount.status === "expired" ? "登录已过期，请重新登录" : "请先登录同步账号");
      setDesktopDialog("login");
      return;
    }
    if (chessPlatform.kind === "web" && !token.trim()) {
      setNotice("请先填写登录令牌");
      return;
    }
    await cancelGameReportForStructureChange();
    setSyncBusy(true);
    try {
      const result = await chessPlatform.synchronize(serverUrl, token);
      applyBoard(await chessPlatform.initialize());
      await loadGameReport();
      await refreshGames();
      if (chessPlatform.kind === "desktop") setSyncAccount(await chessPlatform.getSyncAccount());
      setNotice(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}`);
    } catch (error) {
      setNotice(friendlyError(error));
      if (chessPlatform.kind === "desktop") void chessPlatform.getSyncAccount().then(setSyncAccount).catch(() => undefined);
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveEnginePreferences(preferences: DesktopPreferencesDto, profileName?: string) {
    setDialogBusy(true);
    const previousPreferences = desktopPreferencesRef.current;
    const wasAnalysisHintsEnabled = analysisHintsEnabledRef.current;
    const parallelEngineSelectionChanged = preferences.analysisEngineMode !== previousPreferences.analysisEngineMode
      || [...preferences.parallelEngineIds].sort().join(",") !== [...previousPreferences.parallelEngineIds].sort().join(",")
      || [...(preferences.parallelEnginePaths ?? [])].sort().join(",") !== [...(previousPreferences.parallelEnginePaths ?? [])].sort().join(",");
    const localOpeningBookSettingsChanged = preferences.builtinOpeningBookEnabled !== previousPreferences.builtinOpeningBookEnabled
      || preferences.activeBuiltinOpeningBookId !== previousPreferences.activeBuiltinOpeningBookId
      || [...(preferences.disabledXqbBookPaths ?? [])].sort().join(",") !== [...(previousPreferences.disabledXqbBookPaths ?? [])].sort().join(",")
      || [...(preferences.disabledEleeyeBookPaths ?? [])].sort().join(",") !== [...(previousPreferences.disabledEleeyeBookPaths ?? [])].sort().join(",");
    const analysisConfigChanged =
      preferences.enginePath.trim() !== previousPreferences.enginePath.trim()
      || preferences.threads !== previousPreferences.threads
      || preferences.hashMb !== previousPreferences.hashMb
      || preferences.multipv !== previousPreferences.multipv
      || preferences.searchMode !== previousPreferences.searchMode
      || preferences.searchValue !== previousPreferences.searchValue
      || parallelEngineSelectionChanged;
    const multipvChanged = preferences.multipv !== previousPreferences.multipv;
    const hadCurrentAnalysis = analysisFenRef.current === boardRef.current.fen
      && (analysis.length > 0 || Object.values(engineAnalysesRef.current).some((group) => group.fen === boardRef.current.fen && group.lines.length > 0));
    try {
      let boardSkin = normalizeSkinId(preferences.boardSkin);
      let pieceSkin = normalizeSkinId(preferences.pieceSkin);
      if (syncAccount.status !== "signedIn" && (ACCOUNT_SKINS.includes(boardSkin) || ACCOUNT_SKINS.includes(pieceSkin))) {
        const persisted = await chessPlatform.getDesktopPreferences().catch(() => persistedPreferencesRef.current);
        persistedPreferencesRef.current = persisted;
        const persistedBoardSkin = normalizeSkinId(persisted.boardSkin);
        const persistedPieceSkin = normalizeSkinId(persisted.pieceSkin);
        if (ACCOUNT_SKINS.includes(boardSkin) && boardSkin !== persistedBoardSkin) boardSkin = persistedBoardSkin;
        if (ACCOUNT_SKINS.includes(pieceSkin) && pieceSkin !== persistedPieceSkin) pieceSkin = persistedPieceSkin;
      }
      const engineChanged = preferences.enginePath.trim() !== desktopPreferences.enginePath.trim();
      let activeEngineId = desktopPreferences.activeEngineId;
      let enginePath = desktopPreferences.enginePath;
      let handshakeMessage = "开局库与分析参数已保存";

      if (engineChanged) {
        await stopEnginePlay();
      }
      if (analysisConfigChanged && analysisBusyRef.current) {
        pendingAutoAnalysis.current = false;
        await chessPlatform.stopAnalysis(true).catch(() => undefined);
        analysisBusyRef.current = false;
        setAnalysisBusy(false);
      }

      if (engineChanged) {
        const builtInEngine = preferences.enginePath === BUILTIN_ENGINE_PATH;
        if (builtInEngine) {
          const probe = await chessPlatform.probeEngine(preferences.enginePath);
          setEngineProbe(probe);
          activeEngineId = undefined;
          enginePath = probe.path;
          handshakeMessage = `${probe.protocol.toUpperCase()} ${probe.engineVersion ?? "内置引擎"} 握手成功`;
        } else {
          const profile = await chessPlatform.registerEngineProfile(profileName?.trim() || engineDisplayName(preferences.enginePath), preferences.enginePath);
          setEngineProbe(undefined);
          activeEngineId = profile.id;
          enginePath = profile.executablePath;
          handshakeMessage = `${profile.protocol.toUpperCase()} 引擎握手成功`;
        }
      } else {
        const probe = await chessPlatform.probeEngine(preferences.enginePath);
        setEngineProbe(probe);
        enginePath = probe.path;
        handshakeMessage = `${probe.protocol.toUpperCase()} ${probe.engineVersion ?? "引擎"} 握手成功`;
      }
      const saved = await saveDesktopPreferencePatch({
        enginePath,
        activeEngineId,
        analysisEngineMode: preferences.analysisEngineMode,
        parallelEngineIds: preferences.parallelEngineIds,
        parallelEnginePaths: (preferences.parallelEnginePaths ?? []).filter((path) => path !== BUILTIN_FAIRY_ENGINE_PATH),
        threads: preferences.threads,
        hashMb: preferences.hashMb,
        multipv: preferences.multipv,
        candidateLineMoves: preferences.candidateLineMoves,
        searchMode: preferences.searchMode,
        searchValue: preferences.searchValue,
        moveTimeMs: preferences.moveTimeMs,
        ponder: preferences.ponder,
        autoAnalyze: preferences.autoAnalyze,
        reportDepth: preferences.reportDepth,
        branchArrowColor: preferences.branchArrowColor,
        boardSkin,
        pieceSkin,
        cloudBookEnabled: preferences.cloudBookEnabled,
        cloudBookUrl: preferences.cloudBookUrl,
        builtinOpeningBookEnabled: preferences.builtinOpeningBookEnabled,
        activeBuiltinOpeningBookId: preferences.activeBuiltinOpeningBookId,
        disabledXqbBookPaths: preferences.disabledXqbBookPaths,
        disabledEleeyeBookPaths: preferences.disabledEleeyeBookPaths,
      });
      applyDesktopPreferences(saved);
      if (localOpeningBookSettingsChanged) {
        await chessPlatform.initialize().then(applyBoard).catch(() => undefined);
      }
      const shouldRefreshAnalysis = shouldRefreshAnalysisAfterEngineSettingsSave({
        analysisConfigChanged,
        multipvChanged,
        hadCurrentAnalysis,
        playable: boardRef.current.playable,
        isPlaying,
        reportBusy,
        engineSide,
        engineThinking,
        autoAnalyzeBefore: previousPreferences.autoAnalyze,
        autoAnalyzeAfter: saved.autoAnalyze,
        analysisHintsEnabled: wasAnalysisHintsEnabled,
        platformKind: chessPlatform.kind,
        enginePath: saved.enginePath,
        online,
        token,
      });
      if (analysisConfigChanged) {
        clearAnalysisState();
        if (shouldRefreshAnalysis) {
          analysisHintsEnabledRef.current = true;
          setAnalysisHintsEnabled(true);
          window.setTimeout(() => setAutoRetry((value) => value + 1), analysisBusyRef.current ? 300 : 80);
        }
      }
      void chessPlatform.listEngineProfiles().then((profiles) => setEngineProfiles(externalEngineProfiles(profiles))).catch(() => undefined);
      setNotice(analysisConfigChanged
        ? shouldRefreshAnalysis
          ? `引擎设置已保存，${handshakeMessage}，正在按 MultiPV ${saved.multipv} 刷新当前局面`
          : `引擎设置已保存，${handshakeMessage}，旧分析已清空，可手动点击“分析”重新计算`
        : `引擎设置已保存，${handshakeMessage}`);
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    } finally {
      setDialogBusy(false);
    }
  }

  async function selectEngineProfile(id: string) {
    if (id === desktopPreferences.activeEngineId) return desktopPreferencesRef.current;
    try {
      await stopAnalysis();
      await stopEnginePlay();
      const saved = await chessPlatform.setActiveEngineProfile(id);
      applyDesktopPreferences(saved);
      clearAnalysisState();
      setEngineProfiles(externalEngineProfiles(await chessPlatform.listEngineProfiles()));
      setNotice("已切换引擎，后续分析和人机对弈将使用新引擎");
      return saved;
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    }
  }

  async function removeEngineProfile(id = desktopPreferences.activeEngineId) {
    if (!id) return desktopPreferencesRef.current;
    try {
      await stopAnalysis();
      await stopEnginePlay();
      const saved = await chessPlatform.deleteEngineProfile(id);
      applyDesktopPreferences(saved);
      clearAnalysisState();
      setEngineProfiles(externalEngineProfiles(await chessPlatform.listEngineProfiles()));
      setNotice("引擎档案已删除");
      return saved;
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    }
  }

  async function openCoachProfile() {
    try {
      setCoachReports(await chessPlatform.listCoachReports());
      setMasterStyleProfiles(await chessPlatform.listMasterStyleProfiles());
      setCoachProfileOpen(true);
    } catch (error) { setNotice(friendlyError(error)); }
  }

  async function importDefaultMasterStyleProfile() {
    setMasterStyleImporting(true);
    try {
      const result = await chessPlatform.importMasterStyleProfile();
      setMasterStyleProfiles(await chessPlatform.listMasterStyleProfiles());
      setNotice(`已导入 ${result.profiles.map((profile) => profile.playerName).join("、") || "大师"} 风格画像，样本 ${result.importedSamples} 条`);
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setMasterStyleImporting(false);
    }
  }

  async function saveSyncPreferences(nextServerUrl: string) {
    setDialogBusy(true);
    try {
      const saved = await saveDesktopPreferencePatch({ serverUrl: nextServerUrl });
      applyDesktopPreferences(saved);
      setSyncAccount(await chessPlatform.getSyncAccount());
      setDesktopDialog(null);
      setNotice("同步服务地址已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setDialogBusy(false);
    }
  }

  async function authenticateSync(mode: "register" | "login", email: string, password: string) {
    setDialogBusy(true);
    try {
      if (mode === "register") {
        await chessPlatform.registerSyncAccount(email, password);
      } else {
        await chessPlatform.loginSyncAccount(email, password);
      }
      const account = await chessPlatform.getSyncAccount();
      if (account.status !== "signedIn") {
        throw new Error("登录信息未能保存，请检查系统钥匙串权限后重试");
      }
      setSyncAccount(account);
      setDesktopDialog(null);
      setNotice(mode === "register" ? "账号已注册并绑定本地棋谱库" : "同步账号已登录");
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    } finally {
      setDialogBusy(false);
    }

    try {
      setSubscription(await chessPlatform.getSubscription());
    } catch (error) {
      setNotice(`账号已登录，但权益信息读取失败：${friendlyError(error)}`);
    }
  }

  async function logoutSync() {
    try {
      setSyncAccount(await chessPlatform.logoutSyncAccount());
      setSubscription(undefined);
      setNotice("已退出登录，本地棋谱和待同步改动保留");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function unbindSync() {
    setDialogBusy(true);
    try {
      setSyncAccount(await chessPlatform.unbindSyncAccount());
      applyBoard(await chessPlatform.initialize());
      await refreshGames();
      setSubscription(undefined);
      setTrainingTasks([]);
      setNotice("已解除绑定并清空本机棋谱库，可注册或登录其他账号");
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    } finally {
      setDialogBusy(false);
    }
  }

  async function redeemSubscriptionCode(code: string) {
    setDialogBusy(true);
    try {
      const next = await chessPlatform.redeemSubscriptionCode(code);
      setSubscription(next);
      setNotice(`Pro 权益已开通，至 ${new Date(next.expiresAt).toLocaleDateString()}`);
    } finally {
      setDialogBusy(false);
    }
  }

  async function loadTrainingTasks() {
    if (chessPlatform.kind !== "desktop") return;
    setTrainingTasks(await chessPlatform.listTrainingTasks());
    setTrainingSummary(await chessPlatform.getTrainingSummary());
  }

  async function generateTrainingTasks() {
    setDialogBusy(true);
    try {
      const result = await chessPlatform.generateTrainingTasks();
      setTrainingTasks(result.tasks);
      setTrainingGeneration(result);
      setTrainingSummary(await chessPlatform.getTrainingSummary());
      setNotice(result.criticalCount > 0
        ? `已生成 ${result.criticalCount} 个关键复练任务`
        : result.reinforcementCount > 0
          ? `本局没有严重失误，已生成 ${result.reinforcementCount} 个巩固训练`
          : "当前报告没有可训练节点");
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setDialogBusy(false);
    }
  }

  async function startU10Analysis(nodeId?: string, initialReversed = reversed) {
    if (chessPlatform.kind !== "desktop") {
      setNotice("U10 引导拆棋需要在桌面版使用");
      return;
    }
    if (!enginePath.trim()) {
      setNotice("请先配置 Pikafish，再开始 U10 拆棋");
      return;
    }
    setU10Busy(true);
    setU10Error(undefined);
    try {
      const [start, profile, dailyPlan, weeklyReport, repertoire] = await Promise.all([
        chessPlatform.startGuidedAnalysis(nodeId),
        chessPlatform.getLearningProfile(),
        chessPlatform.generateDailyTrainingPlan(),
        chessPlatform.getWeeklyLearningReport(),
        chessPlatform.inferOpeningRepertoire(),
      ]);
      setU10Start(start);
      setU10InitialReversed(initialReversed);
      setU10Profile(profile);
      setU10DailyPlan(dailyPlan);
      setU10WeeklyReport(weeklyReport);
      setU10Repertoire(repertoire);
      setNotice("U10 拆棋已开始：提交前引擎答案保持隐藏");
    } catch (error) {
      setU10Error(friendlyError(error));
      setNotice(friendlyError(error));
    } finally {
      setU10Busy(false);
    }
  }

  async function submitU10Analysis(submission: GuidedAnalysisSubmission) {
    if (!u10Start) throw new Error("拆棋会话尚未开始");
    setU10Busy(true);
    setU10Error(undefined);
    try {
      const lines = await chessPlatform.analyze({
        enginePath,
        fen: u10Start.session.fen,
        searchMode: "depth",
        searchValue: Math.min(22, Math.max(16, desktopPreferences.reportDepth)),
        threads,
        hashMb,
        multipv: 3,
        serverUrl,
        token,
      });
      if (lines.length === 0) throw new Error("Pikafish 没有返回候选线路，请重试");
      const task = trainingTasks.find((item) => item.gameId === u10Start.session.gameId && item.nodeId === u10Start.session.problemNodeId);
      const submitted = await chessPlatform.submitGuidedAnalysis({
        sessionId: u10Start.session.id,
        submission,
        lines,
        taskId: task?.id,
      });
      setU10WeeklyReport(await chessPlatform.getWeeklyLearningReport());
      setU10DailyPlan(await chessPlatform.generateDailyTrainingPlan());
      return submitted;
    } catch (error) {
      const message = friendlyError(error);
      setU10Error(message);
      throw new Error(message);
    } finally {
      setU10Busy(false);
    }
  }

  async function saveU10Profile(profile: LearningProfile) {
    setU10Busy(true);
    setU10Error(undefined);
    try {
      const saved = await chessPlatform.saveLearningProfile(profile);
      setU10Profile(saved);
      const [dailyPlan, repertoire] = await Promise.all([
        chessPlatform.generateDailyTrainingPlan(),
        chessPlatform.inferOpeningRepertoire(),
      ]);
      setU10DailyPlan(dailyPlan);
      setU10Repertoire(repertoire);
      setNotice("U10 学习档案已保存");
    } catch (error) {
      setU10Error(friendlyError(error));
    } finally {
      setU10Busy(false);
    }
  }

  async function saveU10Variation(moves: string[]) {
    if (!u10Start || moves.length === 0) return;
    setU10Busy(true);
    setU10Error(undefined);
    try {
      await stopEnginePlay();
      await cancelRunningAnalysis(undefined, { forceBackendStop: true });
      await cancelGameReportForStructureChange();
      let next = normalizeBoardState(await chessPlatform.navigateTo(u10Start.session.startNodeId));
      applyBoard(next);
      for (const move of moves) {
        await chessPlatform.previewLine(next.fen, [move]);
        next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.playMove(move)));
        applyBoard(next);
      }
      if (next.currentNode) {
        next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.updateComment(next.currentNode!, "U10 拆棋变例：孩子独立预测线路")));
        applyBoard(next);
      }
      setNotice("U10 临时线路已保存为普通变例；原主线未改变");
    } catch (error) {
      const message = friendlyError(error);
      setU10Error(message);
      throw new Error(message);
    } finally {
      setU10Busy(false);
    }
  }

  function closeU10Analysis() {
    setU10Start(undefined);
    setU10Error(undefined);
    // U10 belongs to training. Returning to the review workbench keeps the
    // current report and its task progress visible after the overlay closes.
    setReviewModeOpen(true);
    setWorkspaceMode("training");
    setMobilePanel("board");
    setAnalysisPanelCollapsed(false);
    if (analysisHintsEnabledRef.current && !analysisBusyRef.current) {
      void runAnalysis().catch(() => undefined);
    }
  }

  async function completeTrainingTask(taskId: string, completed: boolean) {
    try {
      await chessPlatform.completeTrainingTask(taskId, completed);
      setTrainingTasks((tasks) => tasks.map((task) => task.id === taskId ? { ...task, completedAt: completed ? new Date().toISOString() : undefined } : task));
      setTrainingSummary(await chessPlatform.getTrainingSummary());
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function saveStudySession(reflection: string, tags: string[]) {
    if (chessPlatform.kind !== "desktop") return;
    setDialogBusy(true);
    try {
      const session = await chessPlatform.saveStudySession(reflection, tags);
      setStudySessions((sessions) => [session, ...sessions]);
      setTrainingSummary(await chessPlatform.getTrainingSummary());
      setNotice("训练总结已保存；现在可用 Pikafish 核验当前节点");
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      throw new Error(message);
    } finally {
      setDialogBusy(false);
    }
  }

  async function analyzeStudySession() {
    setDesktopDialog(null);
    await runAnalysis();
  }

  async function executeMenuCommand(command: MenuCommand) {
    switch (command) {
      case "newGame": await createGame(startingFen); break;
      case "openDocument": await openDocument(); break;
      case "importXqbOpeningBook": await importXqbOpeningBook(); break;
      case "importEleeyeOpeningBook": await importEleeyeOpeningBook(); break;
      case "saveDocument": await saveDocument(); break;
      case "saveDocumentAs": await saveDocument(true); break;
      case "editPosition": openPositionEditor(); break;
      case "flipBoard": setReversed((value) => !value); break;
      case "copyFen": await copyPosition(); break;
      case "pasteDocument":
      case "pasteTextManual": await pasteDocument(); break;
      case "copyFullManual": await copyGame(); break;
      case "copyMainline": await copyGame(true); break;
      case "masterLibrary":
        if (syncAccount.status !== "signedIn") {
          setDesktopDialog(syncAccount.status === "unbound" ? "register" : "login");
          setNotice("请先登录同步账号后查看大师棋谱");
          break;
        }
        setMasterLibraryOpen(true);
        break;
      case "flyknifeLab": setFlyknifeOpen(true); break;
      case "nextBranch": await goToNextBranchPoint(); break;
      case "linkSession": await openLinkSessionDialog(); break;
      case "engineRed": toggleEngineSide("red"); break;
      case "engineBlack": toggleEngineSide("black"); break;
      case "moveNow": await moveNow(); break;
      case "analyze": analysisHintsEnabled ? await stopAnalysis() : await runAnalysis(); break;
      case "stopAnalysis": await stopAnalysis(); break;
      case "engineArena": await runEngineArena(); break;
      case "engineSettings": setDesktopDialog("engine"); break;
      case "coachProfile": await openCoachProfile(); break;
      case "trainingTasks":
        if (subscription?.plan !== "pro" || subscription.status !== "active") {
          setDesktopDialog("subscription");
          setNotice("训练任务属于 Pro 内测权益，请先兑换 Pro");
          break;
        }
        await loadTrainingTasks();
        setDesktopDialog("training");
        break;
      case "syncRegister": setDesktopDialog("register"); break;
      case "syncLogin": setDesktopDialog("login"); break;
      case "syncNow": await synchronize(); break;
      case "subscription": setDesktopDialog("subscription"); break;
      case "syncSettings": setDesktopDialog("syncSettings"); break;
      case "syncLogout": await logoutSync(); break;
      case "userManual": setUserManualOpen(true); break;
      case "about":
        setAboutOpen(true);
        if (chessPlatform.kind === "desktop") {
          void chessPlatform.getAppInfo().then(setAppInfo).catch((error) => setNotice(friendlyError(error)));
        }
        break;
    }
  }

  async function executeMobileToolbar(command: MobileToolbarCommand) {
    switch (command) {
      case "menu": setMobileDrawerOpen((open) => !open); break;
      case "newGame": await createGame(startingFen); break;
      case "open": await openDocument(); break;
      case "save": await saveDocument(); break;
      case "edit": setPositionEditorOpen(true); break;
      case "flipBoard": setReversed((value) => !value); break;
      case "candidates":
        setMobileArrowsEnabled((enabled) => {
          const next = !enabled;
          if (!next) setMobileArrowFocus(undefined);
          return next;
        });
        break;
      case "analysis":
        analysisBusy ? await stopAnalysis() : await runAnalysis();
        break;
      case "forceVariation": await advanceMobileForcedVariation(); break;
      case "evaluation": setMobileEvaluationVisible((visible) => !visible); break;
      case "export": setMobileExportOpen((open) => !open); break;
      case "settings": setMobilePanel("settings"); break;
    }
  }

  async function checkMobileCloudConnection() {
    setCloudConnection("checking");
    try {
      await chessPlatform.checkCloudHealth(serverUrl);
      setCloudConnection("online");
      setNotice("云端分析服务连接正常");
    } catch (error) {
      setCloudConnection("offline");
      setNotice(`云端服务不可达：${friendlyError(error)}`);
    }
  }

  function trapMobileDrawerFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function openCompactFloatingPanel(panel: FloatingPanel) {
    if (chessPlatform.kind !== "desktop") return;
    try {
      const created = await chessPlatform.openCompactFloatingPanel(panel);
      if (panel === "engine") {
        setCompactEngineCollapsed(true);
        setCompactPoppedOutPanels((panels) => ({ ...panels, engine: true }));
        setCompactDetachedPanels((panels) => ({ ...panels, engine: false }));
      } else if (panel === "manual") {
        setCompactManualCollapsed(true);
        setCompactPoppedOutPanels((panels) => ({ ...panels, manual: true }));
        setCompactDetachedPanels((panels) => ({ ...panels, manual: false }));
      }
      else if (panel === "cloud") {
        setCompactPoppedOutPanels((panels) => ({ ...panels, cloud: true }));
        setCloudBookCollapsed(true);
      }
      const label = panel === "engine" ? "引擎分析" : panel === "manual" ? "棋谱" : panel === "cloud" ? "云库/评估信息" : "连线提示";
      setNotice(created ? `${label}已弹出为独立窗口，可拖到工作台外` : `${label}窗口已置前`);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function openLinkSessionDialog(source: "windowLink" | "imageImport" = "windowLink") {
    screenshotCompactRailSnapshotRef.current = undefined;
    // Screenshot recognition is a modal over the research workspace. Keep a
    // full snapshot because collapseCompactStudyPanels also returns native
    // engine/manual windows before the modal can cover the main workspace.
    if (!reviewModeOpen && source === "imageImport") {
      screenshotCompactRailSnapshotRef.current = {
        engineCollapsed: compactEngineCollapsed,
        manualCollapsed: compactManualCollapsed,
        detachedPanels: { ...compactDetachedPanels },
        poppedOutPanels: { ...compactPoppedOutPanels },
        windowPositions: {
          engine: { ...compactWindowPositions.engine },
          manual: { ...compactWindowPositions.manual },
        },
        manualWidth: compactManualWidth,
        activeWindow: compactActiveWindow,
      };
    }
    // Review owns the insight panel. Collapsing the compact study panels here
    // also mutates its shared layout state and leaves the review workspace
    // visually empty after the recognition dialog closes.
    if (!reviewModeOpen) await collapseCompactStudyPanels();
    setLinkSessionSource(source);
    setLinkSessionOpen(true);
  }

  async function restoreScreenshotCompactStudyRails() {
    const snapshot = screenshotCompactRailSnapshotRef.current;
    screenshotCompactRailSnapshotRef.current = undefined;
    if (!snapshot) return;

    setCompactEngineCollapsed(snapshot.engineCollapsed);
    setCompactManualCollapsed(snapshot.manualCollapsed);
    setCompactDetachedPanels(snapshot.detachedPanels);
    setCompactPoppedOutPanels(snapshot.poppedOutPanels);
    setCompactWindowPositions(snapshot.windowPositions);
    setCompactManualWidth(snapshot.manualWidth);
    setCompactActiveWindow(snapshot.activeWindow);

    if (chessPlatform.kind !== "desktop") return;
    const panelsToRestore = (["engine", "manual"] as const).filter((panel) => snapshot.poppedOutPanels[panel]);
    const restored = await Promise.allSettled(
      panelsToRestore.map((panel) => chessPlatform.openCompactFloatingPanel(panel)),
    );
    const failedPanels = restored.flatMap((result, index) => result.status === "rejected" ? [panelsToRestore[index]] : []);
    if (failedPanels.length > 0) {
      if (failedPanels.includes("engine")) {
        setCompactPoppedOutPanels((panels) => ({ ...panels, engine: false }));
        setCompactEngineCollapsed(false);
        setCompactDetachedPanels((panels) => ({ ...panels, engine: false }));
      }
      if (failedPanels.includes("manual")) {
        setCompactPoppedOutPanels((panels) => ({ ...panels, manual: false }));
        setCompactManualCollapsed(false);
        setCompactDetachedPanels((panels) => ({ ...panels, manual: false }));
      }
      setNotice("部分研究面板未能恢复为独立窗口，已保留在主工作区");
    }
  }

  function closeLinkSessionDialog(options: { cleanupFileSession?: boolean } = {}) {
    setLinkSessionOpen(false);
    setLinkCapturePreview(undefined);
    if (options.cleanupFileSession && chessPlatform.kind === "desktop") {
      // File recognition leaves the backend session in Tracking after the
      // picture has been parsed. Closing this modal must invalidate it; live
      // window links have already dismissed this dialog before their floating
      // controller starts, so they are unaffected.
      void chessPlatform.stopLinkSession()
        .then(() => chessPlatform.getLinkSessionStatus())
        .then(setLinkSessionStatus)
        .catch(() => undefined);
    }
    if (reviewModeOpen) {
      // Keep the review workbench selected and restore its sole right-side
      // workspace instead of restoring the normal research rails.
      setAnalysisPanelCollapsed(false);
      setMobilePanel("analysis");
    } else {
      void restoreScreenshotCompactStudyRails();
    }
  }

  async function openReviewMode(mode: Extract<WorkspaceMode, "review" | "training"> = "review") {
    setReviewModeOpen(true);
    setWorkspaceMode(mode);
    if (chessPlatform.kind !== "desktop") return;
    try {
      // Review has its own report and insight panels; an old compact engine popout
      // would otherwise remain above the workbench and compete for attention.
      await chessPlatform.returnCompactFloatingPanel("engine");
    } catch {
      // There may be no detached engine window to return.
    }
    setCompactEngineCollapsed(true);
    setCompactPoppedOutPanels((panels) => ({ ...panels, engine: false }));
    setCompactDetachedPanels((panels) => ({ ...panels, engine: false }));
    setCompactWindowPositions((positions) => ({ ...positions, engine: compactEngineDefaultPosition() }));
  }

  async function exitReviewMode() {
    setReviewModeOpen(false);
    setWorkspaceMode("research");
    // The review workbench suppresses the research rails. Re-run the normal
    // position analysis after leaving it so the restored layout is immediately useful.
    if (analysisHintsEnabledRef.current && !analysisBusyRef.current) {
      await runAnalysis().catch(() => undefined);
    }
  }

  async function selectWorkspaceMode(mode: WorkspaceMode) {
    const selection = ++modeSelectionRef.current;
    if (mode === "research") {
      await exitReviewMode();
      return;
    }
    await openReviewMode(mode);
    if (selection !== modeSelectionRef.current) return;
    if (mode === "training") {
      if (subscription?.plan !== "pro" || subscription.status !== "active") {
        setDesktopDialog("subscription");
        setNotice("训练任务属于 Pro 内测权益，请先兑换 Pro；U10 拆棋仍可从有效报告进入");
        return;
      }
      await loadTrainingTasks();
      if (selection !== modeSelectionRef.current) return;
      setDesktopDialog("training");
    }
  }

  async function collapseCompactStudyPanels() {
    if (chessPlatform.kind === "desktop") {
      await Promise.allSettled([
        compactPoppedOutPanels.engine ? chessPlatform.returnCompactFloatingPanel("engine") : Promise.resolve(false),
        compactPoppedOutPanels.manual ? chessPlatform.returnCompactFloatingPanel("manual") : Promise.resolve(false),
      ]);
    }
    if (desktopPreferencesRef.current.layoutMode !== "compact") return;
    setCompactEngineCollapsed(true);
    setCompactManualCollapsed(true);
    setCompactPoppedOutPanels((panels) => ({ ...panels, engine: false, manual: false }));
    setCompactDetachedPanels({ engine: false, manual: false });
    setCompactWindowPositions(compactWindowDefaultPositions());
    setCompactManualWidth(undefined);
    setCompactActiveWindow("engine");
  }

  function openEngineDivergence() {
    setEngineDivergencePosition({ left: Math.max(8, window.innerWidth - 680), top: 72 });
    setEngineDivergenceOpen(true);
  }

  useEffect(() => {
    if (engineDivergenceOpen && !engineDivergenceAvailable) setEngineDivergenceOpen(false);
  }, [engineDivergenceAvailable, engineDivergenceOpen]);

  function startEngineDivergenceDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const panel = event.currentTarget.closest<HTMLElement>(".engine-divergence-float");
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    engineDivergenceDragRef.current = { offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveEngineDivergenceDrag(event: PointerEvent<HTMLElement>) {
    const drag = engineDivergenceDragRef.current;
    const panel = event.currentTarget.closest<HTMLElement>(".engine-divergence-float");
    if (!drag || !panel) return;
    const bounds = panel.getBoundingClientRect();
    setEngineDivergencePosition({
      left: Math.max(8, Math.min(event.clientX - drag.offsetX, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(event.clientY - drag.offsetY, window.innerHeight - bounds.height - 8)),
    });
  }

  function stopEngineDivergenceDrag(event: PointerEvent<HTMLElement>) {
    engineDivergenceDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function engineDivergenceDialog() {
    if (!engineDivergenceOpen) return null;
    return <aside className="engine-divergence-float" role="dialog" aria-label="引擎分歧对照" style={engineDivergencePosition}>
        <MultiEngineComparison
          busy={analysisBusy}
          disabled={analysisIsStale}
          divergencesOnly
          fen={analysisFen ?? board.fen}
          groups={engineComparisonGroups}
          sideToMove={candidateSideToMove}
          onClose={() => setEngineDivergenceOpen(false)}
          onDragStart={startEngineDivergenceDrag}
          onDragMove={moveEngineDivergenceDrag}
          onDragEnd={stopEngineDivergenceDrag}
          onPlay={(line, engine) => void playIccsMove(line.pv[0], analysisFen ?? board.fen, engine.primary ? undefined : engine.name)}
          onPreview={(line, engine) => void previewCandidateLine(line, analysisFen ?? board.fen, engine)}
        />
    </aside>;
  }

  function startCompactWindowDrag(key: "engine" | "manual", event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const startedFromButton = !!(event.target as HTMLElement).closest("button");
    const windowPanel = event.currentTarget.closest<HTMLElement>(".compact-floating-panel");
    if (!windowPanel) return;
    const panelBounds = windowPanel.getBoundingClientRect();
    const current = compactWindowPositions[key];
    const workspaceBounds = windowPanel.closest<HTMLElement>(".workspace")?.getBoundingClientRect();
    const bounds = workspaceBounds
      ? { left: workspaceBounds.left + 8, right: workspaceBounds.right - 8, top: workspaceBounds.top + 8, bottom: workspaceBounds.bottom - 8 }
      : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 };
    compactWindowDragRef.current = {
      key,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: current,
      bounds: {
        minX: current.x + bounds.left - panelBounds.left,
        maxX: current.x + bounds.right - panelBounds.right,
        minY: current.y + bounds.top - panelBounds.top,
        maxY: current.y + bounds.bottom - panelBounds.bottom,
      },
      moved: false,
    };
    setCompactActiveWindow(key);
    document.body.classList.add("compact-panel-dragging");
    window.addEventListener("pointermove", moveCompactWindowDragWindow);
    window.addEventListener("pointerup", stopCompactWindowDragWindow, { once: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!startedFromButton) event.preventDefault();
  }

  function moveCompactWindowDragWindow(event: globalThis.PointerEvent) {
    const drag = compactWindowDragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
    const x = Math.max(drag.bounds.minX, Math.min(drag.bounds.maxX, drag.startPosition.x + deltaX));
    const y = Math.max(drag.bounds.minY, Math.min(drag.bounds.maxY, drag.startPosition.y + deltaY));
    setCompactWindowPositions((positions) => ({ ...positions, [drag.key]: { x, y } }));
    event.preventDefault();
  }

  function stopCompactWindowDragWindow() {
    const drag = compactWindowDragRef.current;
    if (drag?.moved) {
      setCompactDetachedPanels((panels) => ({ ...panels, [drag.key]: true }));
      compactWindowSuppressClickRef.current[drag.key] = true;
      window.setTimeout(() => {
        compactWindowSuppressClickRef.current[drag.key] = false;
      }, 0);
    }
    compactWindowDragRef.current = undefined;
    document.body.classList.remove("compact-panel-dragging");
    window.removeEventListener("pointermove", moveCompactWindowDragWindow);
    window.removeEventListener("pointerup", stopCompactWindowDragWindow);
  }

  function consumeCompactWindowDragClick(key: "engine" | "manual") {
    if (!compactWindowSuppressClickRef.current[key]) return false;
    compactWindowSuppressClickRef.current[key] = false;
    return true;
  }

  function stopCompactWindowDrag(event: PointerEvent<HTMLElement>) {
    stopCompactWindowDragWindow();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startAnalysisPanelReopenDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    analysisPanelReopenDragRef.current = {
      startY: event.clientY,
      startTop: analysisPanelReopenTop,
      latestTop: analysisPanelReopenTop,
      moved: false,
    };
    document.body.classList.add("analysis-reopen-dragging");
    window.addEventListener("pointermove", moveAnalysisPanelReopenDragWindow);
    window.addEventListener("pointerup", stopAnalysisPanelReopenDragWindow, { once: true });
  }

  function moveAnalysisPanelReopenDragWindow(event: globalThis.PointerEvent) {
    const drag = analysisPanelReopenDragRef.current;
    if (!drag) return;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaY) > ANALYSIS_PANEL_REOPEN_DRAG_THRESHOLD) drag.moved = true;
    const nextTop = clampAnalysisPanelReopenTop(drag.startTop + deltaY, window.innerHeight);
    drag.latestTop = nextTop;
    setAnalysisPanelReopenTop(nextTop);
    event.preventDefault();
  }

  function stopAnalysisPanelReopenDragWindow() {
    const drag = analysisPanelReopenDragRef.current;
    if (drag?.moved) {
      analysisPanelReopenSuppressClickRef.current = true;
      try {
        localStorage.setItem(ANALYSIS_PANEL_REOPEN_TOP_KEY, String(drag.latestTop));
      } catch {
        // Best-effort UI preference.
      }
      window.setTimeout(() => {
        analysisPanelReopenSuppressClickRef.current = false;
      }, 0);
    }
    analysisPanelReopenDragRef.current = undefined;
    document.body.classList.remove("analysis-reopen-dragging");
    window.removeEventListener("pointermove", moveAnalysisPanelReopenDragWindow);
    window.removeEventListener("pointerup", stopAnalysisPanelReopenDragWindow);
  }

  function reopenAnalysisPanel() {
    if (analysisPanelReopenSuppressClickRef.current) {
      analysisPanelReopenSuppressClickRef.current = false;
      return;
    }
    void setAnalysisPanelVisibility(false);
  }

  function startCompactEngineResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>(".compact-engine-window");
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    compactEngineResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: bounds.width,
      startHeight: bounds.height,
      maxWidth: Math.max(COMPACT_ENGINE_MIN_WIDTH, Math.min(COMPACT_ENGINE_DEFAULT_WIDTH, window.innerWidth - 24)),
      maxHeight: compactEngineMaxHeight,
    };
    setCompactActiveWindow("engine");
    document.body.classList.add("compact-engine-resizing");
    window.addEventListener("pointermove", moveCompactEngineResize);
    window.addEventListener("pointerup", stopCompactEngineResize, { once: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveCompactEngineResize(event: globalThis.PointerEvent) {
    const resize = compactEngineResizeRef.current;
    if (!resize) return;
    setCompactEngineSize({
      width: Math.max(COMPACT_ENGINE_MIN_WIDTH, Math.min(resize.maxWidth, resize.startWidth + resize.startX - event.clientX)),
      height: Math.max(COMPACT_ENGINE_MIN_HEIGHT, Math.min(resize.maxHeight, resize.startHeight + event.clientY - resize.startY)),
    });
    event.preventDefault();
  }

  function stopCompactEngineResize() {
    compactEngineResizeRef.current = undefined;
    document.body.classList.remove("compact-engine-resizing");
    window.removeEventListener("pointermove", moveCompactEngineResize);
    window.removeEventListener("pointerup", stopCompactEngineResize);
  }

  function startCompactManualResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>(".compact-manual-panel");
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    const detached = compactDetachedPanels.manual;
    const boardBounds = panel.closest<HTMLElement>(".workspace")?.querySelector<HTMLElement>(".board-main-stack")?.getBoundingClientRect();
    // Keep enough of the board visible while allowing the docked manual to extend into its rail.
    const minimumLeft = detached || !boardBounds
      ? 8
      : Math.max(8, boardBounds.left + Math.min(420, Math.max(280, boardBounds.width * 0.55)));
    const maxWidth = Math.max(280, Math.min(window.innerWidth - 16, bounds.right - minimumLeft));
    compactManualResizeRef.current = {
      startX: event.clientX,
      startWidth: bounds.width,
      maxWidth,
      detached,
      startPosition: compactWindowPositions.manual,
    };
    setCompactManualWidth(bounds.width);
    setCompactActiveWindow("manual");
    document.body.classList.add("compact-manual-resizing");
    window.addEventListener("pointermove", moveCompactManualResize);
    window.addEventListener("pointerup", stopCompactManualResize, { once: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveCompactManualResize(event: globalThis.PointerEvent) {
    const resize = compactManualResizeRef.current;
    if (!resize) return;
    const width = Math.max(280, Math.min(resize.maxWidth, resize.startWidth - (event.clientX - resize.startX)));
    setCompactManualWidth(width);
    if (resize.detached) {
      setCompactWindowPositions((positions) => ({
        ...positions,
        manual: { ...resize.startPosition, x: resize.startPosition.x + resize.startWidth - width },
      }));
    }
    event.preventDefault();
  }

  function stopCompactManualResize() {
    compactManualResizeRef.current = undefined;
    document.body.classList.remove("compact-manual-resizing");
    window.removeEventListener("pointermove", moveCompactManualResize);
    window.removeEventListener("pointerup", stopCompactManualResize);
  }

  function toggleCompactPanelCollapsed(panel: "engine" | "manual") {
    if (panel === "engine") {
      setCompactEngineCollapsed((collapsed) => {
        if (collapsed) {
          setCompactDetachedPanels((panels) => ({ ...panels, engine: false }));
          setCompactWindowPositions((positions) => ({ ...positions, engine: compactEngineDefaultPosition() }));
        }
        return !collapsed;
      });
    } else {
      setCompactManualCollapsed((collapsed) => {
        if (collapsed) {
          setCompactDetachedPanels((panels) => ({ ...panels, manual: false }));
          setCompactWindowPositions((positions) => ({ ...positions, manual: compactManualDefaultPosition() }));
        }
        return !collapsed;
      });
    }
  }

  function playbackControls(className: string) {
    const mobile = className.includes("mobile-playback");
    const showManualPopout = desktopPreferences.layoutMode === "compact" && !floatingPanel && className.includes("compact-playback") && chessPlatform.kind === "desktop";
    return <div className={`playback-controls ${className}`} aria-label="棋谱播放控制">
      <button title="回到开局" disabled={!board.currentNode} onClick={() => void navigateTo()}><ChevronsLeft size={15}/></button>
      <button title="上一着（只浏览，不删除棋谱）" aria-label="上一着（只浏览，不删除棋谱）" disabled={!board.currentNode} onClick={() => void goPrevious()}><ChevronLeft size={15}/></button>
      <button className={isPlaying ? "active" : ""} title={isPlaying ? "暂停播放" : "播放主线"} disabled={board.history.length === 0 && board.branches.length === 0} onClick={() => void togglePlayback()}>{isPlaying ? <Pause size={14}/> : <Play size={14}/>}</button>
      <button title={board.branches.length > 1 ? "下一着（沿主线）" : "下一着"} disabled={!preferredContinuation(board)} onClick={() => void goNext()}><ChevronRight size={15}/></button>
      <button title="前往主线终局" disabled={!preferredContinuation(board)} onClick={() => void goToEnd()}><ChevronsRight size={15}/></button>
      {!mobile && <>
        <div className="branch-picker-anchor">
          <button className="variation-jump" aria-label="跳到下一个分支点" title={hasUpcomingBranch ? "跳到下一个分支点" : "后续没有分支点"} disabled={!hasUpcomingBranch} onClick={() => void goToNextBranchPoint()}><GitFork size={14}/></button>
          {showManualPopout && <button className="compact-manual-popout" type="button" title="弹出棋谱独立窗口" aria-label="弹出棋谱独立窗口" onClick={() => void openCompactFloatingPanel("manual")}><Maximize2 size={14}/></button>}
        </div>
        <div className="playback-tail">
          <span>第 <strong>{board.history.length}</strong> 着</span>
        </div>
      </>}
    </div>;
  }

  function engineBranchPreviewAction() {
    const active = candidatePreviewBranches.length > 0;
    const disabled = !active && (analysisIsStale || !orderedAnalysis.some((line) => line.pv.length > 0));
    const presentation = engineBranchActionPresentation(active, disabled, analysisIsStale);
    return <button
      type="button"
      className={`manual-engine-branch-action ${active ? "active" : ""}`}
      title={presentation.title}
      aria-label={presentation.ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (active) {
          cancelEnginePreviewBranches();
          return;
        }
        void previewEngineBranches(analysisFen ?? board.fen);
      }}
    >{active ? <X size={13}/> : <GitFork size={13}/>}<span>{presentation.label}</span></button>;
  }

  function branchMapControls() {
    if (!hasVisibleBranchChoices) return null;
    return <section className={`branch-map-controls ${branchEditing ? "editing" : ""}`} aria-label="当前分支选择">
      <header><span><GitFork size={14}/><strong>变招 {branchChoices.length} 条</strong><small>当前局面可选，点击即进入</small></span><button type="button" className="branch-map-edit" onClick={() => setBranchEditing((editing) => !editing)}>{branchEditing ? "完成" : "管理"}</button></header>
      <div className="branch-map-scroll">
        {branchChoices.map((move, index) => {
          const label = String(index + 1);
          const detail = move.isMainline ? `主线 ${label}` : `分支 ${label}`;
          return <div className="branch-map-option" key={move.id}>
            <button type="button" className="branch-map-choice" onClick={() => void selectBranchChoice(move.id)} title={`${detail} · ${move.notation}`}>
              <b>{label}</b><strong>{move.notation}</strong><small>{detail}</small>
            </button>
            {branchEditing && <div className="branch-map-actions">
              {!move.isMainline && <button type="button" title="设为主线" onClick={() => void makeMainline(move.id)}><ListStart size={12}/></button>}
              <button type="button" title="删除分支及其后续" onClick={() => void removeNode(move.id)}><Trash2 size={12}/></button>
            </div>}
          </div>;
        })}
      </div>
      {branchEditing && <button type="button" className="branch-map-done" onClick={() => setBranchEditing(false)}>完成管理</button>}
    </section>;
  }

  function setManualViewMode(mode: ManualViewMode) {
    if (desktopPreferences.manualViewMode === mode) return;
    if (chessPlatform.kind === "web") {
      const preferences = { ...desktopPreferencesRef.current, manualViewMode: mode };
      desktopPreferencesRef.current = preferences;
      persistedPreferencesRef.current = preferences;
      setDesktopPreferences(preferences);
      try {
        localStorage.setItem("xiangqi:manual-view-mode", mode);
      } catch {
        // Browser storage may be unavailable; the in-memory switch still works.
      }
      return;
    }
    void saveDesktopPreferencePatch({ manualViewMode: mode }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "棋谱显示方式保存失败");
    });
  }

  function manualReviewContent(label: string) {
    const currentMove = board.history.at(-1);
    const treeProps = {
      activePath: activeTreePath,
      collapsed: collapsedTreeNodes,
      currentNode: board.currentNode,
      editing: branchEditing,
      formatScore: formatMoveScore,
      nodes: board.manualTree ?? [],
      onMakeMainline: (nodeId: string) => void makeMainline(nodeId),
      onNavigate: (nodeId: string) => void navigateTo(nodeId),
      onRemove: (nodeId: string) => void removeNode(nodeId),
      onReorder: (nodeIds: string[], from: number, to: number) => void reorderBranchNodes(nodeIds, from, to),
      onToggle: (nodeId: string) => setCollapsedTreeNodes((collapsed) => {
        const next = new Set(collapsed);
        if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
        return next;
      }),
      qualityByMoveId: reportByMoveId,
    };
    return <div className={`manual-review-content ${desktopPreferences.manualViewMode === "tree" ? "tree-mode" : "track-mode"}`}>
      {desktopPreferences.manualViewMode === "tree"
        ? <div className="manual-tree-shell">
          <header className="manual-track-toolbar">
            <div className="manual-view-switch" role="tablist" aria-label="棋谱显示方式">
              <button type="button" onClick={() => setManualViewMode("track")}>分支树</button>
              <button type="button" className="active" onClick={() => setManualViewMode("tree")}>传统树</button>
            </div>
            {engineBranchPreviewAction()}
          </header>
          <div className="move-table" role="table" aria-label={label}>
            <div className="move-table-head" role="row"><span role="columnheader">序号</span><span role="columnheader">着法</span><span role="columnheader">分数</span></div>
            <div className="move-table-body" role="rowgroup">
              <button className={`move-table-row root ${!board.currentNode ? "active" : ""}`} role="row" onClick={() => void navigateTo()}>
                <span role="cell">0</span><span role="cell"><GitBranch size={12}/>开始局面</span><span role="cell" />
              </button>
              <ManualTreeView {...treeProps}/>
            </div>
          </div>
          {currentMove && <footer className="manual-track-current">
            <strong>当前：{currentMove.notation}</strong>
            <span>{currentMove.movedBy.replace("方", "")} · {formatMoveScore(currentMove) || "--"} · {currentMove.isMainline ? "主" : "变"}</span>
            <button type="button" className="manual-line-open" aria-label="完整棋谱" onClick={() => setManualLineDialogOpen(true)} disabled={board.history.length === 0}><span className="full">完整棋谱</span><span className="short">棋谱</span></button>
          </footer>}
        </div>
        : <ManualTrackView
          bestMoveHint={bestMoveHint}
          currentNode={board.currentNode}
          editing={branchEditing}
          formatScore={formatMoveScore}
          history={board.history}
          nodes={board.manualTree ?? []}
          onMakeMainline={(nodeId) => void makeMainline(nodeId)}
          onNavigate={(nodeId) => void navigateTo(nodeId)}
          onRemove={(nodeId) => void removeNode(nodeId)}
          onExportLine={(contents) => exportCurrentLineText(contents)}
          onStartBestMovePractice={startBestMovePractice}
          onToggleCurrentMoveMarker={toggleCurrentReviewMarker}
          toolbarExtra={engineBranchPreviewAction()}
          onViewModeChange={setManualViewMode}
          previewBranches={candidatePreview ? [{
            activeStep: candidatePreview.step,
            firstMove: candidatePreview.firstMove,
            rank: candidatePreview.rank,
            sourceEngineName: candidatePreview.sourceEngineName,
            steps: candidatePreview.steps,
          }] : candidatePreviewBranches}
          qualityByMoveId={reportByMoveId}
          strategyInsight={strategyInsight}
          viewMode={desktopPreferences.manualViewMode ?? "track"}
        />}
    </div>;
  }

  function candidateLinesView(className = "") {
    const compactLayout = desktopPreferences.layoutMode === "compact";
    const compactDockClass = [
      "variations",
      "candidate-dock",
      className,
      compactLayout ? "compact-floating-stack" : "",
      compactLayout && compactEngineCollapsed && !compactPoppedOutPanels.engine ? "compact-engine-collapsed" : "",
      compactLayout && compactManualCollapsed ? "compact-manual-collapsed" : "",
      compactLayout && compactDetachedPanels.engine ? "compact-engine-detached" : "",
      compactLayout && compactDetachedPanels.manual ? "compact-manual-detached" : "",
    ].filter(Boolean).join(" ");
    if (compactLayout) {
      const enginePosition = compactWindowPositions.engine;
      const manualPosition = compactWindowPositions.manual;
      const manualPanelStyle: CSSProperties = {
        transform: `translate(${manualPosition.x}px, ${manualPosition.y}px)`,
        ...(compactManualWidth == null || compactManualCollapsed ? {} : {
          width: `${compactManualWidth}px`,
          ...(compactDetachedPanels.manual ? {} : { left: "auto", right: "8px" }),
        }),
      };
      const engineSize = compactEnginePanelSize(compactEngineSize);
      return <section className={compactDockClass.trim()} aria-label="简洁布局可拖动面板">
        {!compactPoppedOutPanels.engine && <article
          className={`compact-floating-panel compact-engine-window ${compactEngineCollapsed ? "collapsed" : ""} ${compactDetachedPanels.engine ? "detached" : ""} ${compactActiveWindow === "engine" ? "active" : ""}`}
          style={{
            transform: `translate(${enginePosition.x}px, ${enginePosition.y}px)`,
            ...(engineSize ? { width: engineSize.width, height: engineSize.height } : {}),
          } as CSSProperties}
          onPointerDown={() => setCompactActiveWindow("engine")}
        >
          <div className="section-title compact-drag-handle" onPointerDown={(event) => startCompactWindowDrag("engine", event)} onPointerUp={stopCompactWindowDrag}>
            <strong>引擎分析</strong>
            <span>{compactEngineCollapsed ? "已收起 · 点展开回到停靠区" : compactDetachedPanels.engine ? "浮动中 · 不占棋盘空间" : analysisIsStale ? "旧候选保留中 · 新局面正在更新" : "深度 / 分数 / 时间 / NPS / HF"}</span>
            {chessPlatform.kind === "desktop" && <button className="compact-window-toggle compact-window-popout" title="弹出为独立窗口，可拖到 App 外面" aria-label="弹出引擎分析独立窗口" onPointerDown={(event) => event.stopPropagation()} onClick={() => void openCompactFloatingPanel("engine")}><Maximize2 size={14}/><span>弹出</span></button>}
            <button type="button" className="compact-window-toggle" title={compactEngineCollapsed ? "展开并停靠引擎分析；按住可拖动位置" : "收起引擎分析"} aria-label={compactEngineCollapsed ? "展开并停靠引擎分析" : "收起引擎分析"} onPointerDown={(event) => { if (!compactEngineCollapsed) event.stopPropagation(); }} onClick={() => { if (consumeCompactWindowDragClick("engine")) return; toggleCompactPanelCollapsed("engine"); }}>{compactEngineCollapsed ? <ChevronDown size={16}/> : <X size={15}/>}</button>
          </div>
          {!compactEngineCollapsed && <>
            <div className="analysis-lines">
              <CompactEngineAnalysisList
                busy={analysisBusy}
                rows={compactEngineRows}
                onPlayMove={(_, row) => row && void playCompactEngineRow(row)}
                onPreview={(row) => void previewCompactEngineRow(row)}
                onAdopt={(row) => void playCompactEngineRow(row)}
              />
            </div>
            <div className="compact-engine-resize-handle" title="拖动调整引擎分析宽度和高度" aria-label="调整引擎分析宽度和高度" onPointerDown={startCompactEngineResize}/>
          </>}
        </article>}

        <article
          className={`compact-floating-panel compact-manual-panel ${compactManualCollapsed ? "collapsed" : ""} ${compactDetachedPanels.manual ? "detached" : ""} ${compactActiveWindow === "manual" ? "active" : ""}`}
          style={manualPanelStyle}
          aria-label="简洁布局棋谱"
          onPointerDown={() => setCompactActiveWindow("manual")}
        >
          {!compactManualCollapsed && <div className="compact-manual-width-resizer" title="左右拖动调整棋谱宽度" aria-label="调整棋谱宽度" onPointerDown={startCompactManualResize}/>}
          <header className="compact-drag-handle" onPointerDown={(event) => startCompactWindowDrag("manual", event)} onPointerUp={stopCompactWindowDrag}>
            <button type="button" className="compact-window-toggle compact-window-toggle-leading" title={compactManualCollapsed ? "展开并停靠棋谱；按住可拖动位置" : "收起棋谱"} aria-label={compactManualCollapsed ? "展开并停靠棋谱" : "收起棋谱"} onPointerDown={(event) => { if (!compactManualCollapsed) event.stopPropagation(); }} onClick={() => { if (consumeCompactWindowDragClick("manual")) return; toggleCompactPanelCollapsed("manual"); }}>{compactManualCollapsed ? <ChevronDown size={16}/> : <X size={15}/>}</button>
            <span><ClipboardList size={14}/><strong>棋谱</strong></span>
            <small title={currentEngineTitle}>{compactManualCollapsed ? "已收起 · 点展开回到停靠区" : compactDetachedPanels.manual ? `主引擎：${currentEngineVersionLabel} · 浮动中 · ${board.history.length} 着` : `主引擎：${currentEngineVersionLabel} · ${board.history.length} 着${board.continuation.length ? ` · 后续 ${board.continuation.length} 着` : ""}`}</small>
          </header>
          {!compactManualCollapsed && <>
            {playbackControls("compact-playback")}
            {manualReviewContent("简洁布局棋谱着法")}
            {branchMapControls()}
          </>}
        </article>
      </section>;
    }
    if (candidateRailCollapsed && !compactLayout) {
      return <section className={`variations candidate-dock collapsed ${className}`.trim()} aria-label="棋盘候选已收起">
        <button className="panel-collapse-button" title="展开棋盘候选" aria-label="展开棋盘候选" onClick={() => void setCandidateRailVisibility(false)}><ChevronLeft size={16}/></button>
      </section>;
    }
    return <section className={compactDockClass.trim()}>
      <div className="section-title">
        <strong>{compactLayout ? "引擎分析" : "棋盘候选"}</strong>
        <span>{compactLayout ? compactEngineCollapsed ? "已收起 · 点击展开" : analysisIsStale ? "旧候选保留中 · 新局面正在更新" : "深度 / 分数 / 时间 / NPS / HF" : analysisIsStale ? "旧候选保留中 · 新局面正在更新" : `MultiPV ${multipv} · 点预览后手动下一步`}</span>
        {compactLayout
          ? <button type="button" className="compact-window-toggle" title={compactEngineCollapsed ? "展开并停靠引擎分析" : "收起引擎分析"} aria-label={compactEngineCollapsed ? "展开并停靠引擎分析" : "收起引擎分析"} onClick={() => { if (consumeCompactWindowDragClick("engine")) return; toggleCompactPanelCollapsed("engine"); }}>{compactEngineCollapsed ? <ChevronDown size={16}/> : <X size={15}/>}</button>
          : <button className="panel-collapse-button" title="收起棋盘候选" aria-label="收起棋盘候选" onClick={() => void setCandidateRailVisibility(true)}><ChevronRight size={16}/></button>}
      </div>
      {compactLayout && <div className="compact-engine-strip" aria-label="简洁布局引擎状态">
        <span className={analysisBusy ? "running" : ""}><Activity size={14}/><strong>引擎：</strong></span>
        <div className="compact-engine-config" title={currentEngineTitle}>
          <button type="button" onClick={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : selectWorkspacePanel("analysis")}>{currentEngineVersionLabel}</button>
          <small title={`${threads} 线程 · Hash ${hashMb} MB`}>{threads}T/{hashMb}M</small>
          <small title={currentNnueLabel ?? `MultiPV ${multipv}`}>{currentNnueHashLabel ? `NNUE ${currentNnueHashLabel}` : currentNnueLabel ? "NNUE" : `PV ${multipv}`}</small>
          <i aria-hidden="true"/>
        </div>
        <button type="button" title="引擎设置" aria-label="引擎设置" onClick={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : selectWorkspacePanel("analysis")}><Settings2 size={14}/></button>
        {analysisBusy
          ? <button type="button" className="stop" onClick={() => void stopAnalysis()}><Square size={12}/>停止</button>
          : <button type="button" disabled={!board.playable || isPlaying} onClick={() => void runAnalysis()}><Play size={13}/>分析</button>}
      </div>}
      <div className="analysis-lines">
        {compactLayout
          ? <CompactEngineAnalysisList
            busy={analysisBusy}
            rows={compactEngineRows}
            onPlayMove={(_, row) => row && void playCompactEngineRow(row)}
            onPreview={(row) => void previewCompactEngineRow(row)}
            onAdopt={(row) => void playCompactEngineRow(row)}
          />
          : analysis.length === 0
            ? <div className="empty-analysis"><Activity size={24}/><strong>等待分析</strong><span>启动当前引擎后在这里显示候选推演</span></div>
            : orderedAnalysis.map((line) => <CandidateLine
            coach={candidateInsights.find((candidate) => candidate.rank === line.multipv)}
            color={analysisArrowColors[line.multipv - 1] ?? "transparent"}
            disabled={analysisIsStale}
            fen={analysisFen ?? board.fen}
            key={line.multipv}
            line={line}
            visibleMoveCount={desktopPreferences.candidateLineMoves}
            preview={candidatePreview?.sourceEngineId === primaryAnalysisEngineRef.current && candidatePreview.rank === line.multipv ? { activeStep: candidatePreview.step, steps: candidatePreview.steps } : undefined}
            scoreText={redAnalysisScoreText(line, candidateSideToMove)}
            sideToMove={candidateSideToMove}
            stale={analysisIsStale}
            onPlay={(iccs, analyzedFen) => void playIccsMove(iccs, analyzedFen)}
            onPreview={(candidate, analyzedFen) => void previewCandidateLine(candidate, analyzedFen)}
            onPreviewStep={jumpCandidatePreview}
            />)}
        {!compactLayout && <MultiEngineComparison
          busy={analysisBusy}
          collapsed={multiEngineComparisonCollapsed}
          disabled={analysisIsStale}
          fen={analysisFen ?? board.fen}
          groups={engineComparisonGroups}
          onCollapsedChange={setMultiEngineComparisonCollapsed}
          onPopOut={openEngineDivergence}
          sideToMove={candidateSideToMove}
          onPlay={(line, engine) => void playIccsMove(line.pv[0], analysisFen ?? board.fen, engine.primary ? undefined : engine.name)}
          onPreview={(line, engine) => void previewCandidateLine(line, analysisFen ?? board.fen, engine)}
        />}
      </div>
      {!compactLayout && board.xqbCandidates?.length ? <section className="xqb-candidates" aria-label="本地开局库候选">
        <header><BookOpen size={14}/><strong>本地开局库</strong><span>{board.xqbCandidates.length} 个候选</span></header>
        {board.xqbCandidates.map((candidate) => {
          const total = candidate.win + candidate.draw + candidate.loss;
          const percent = (value: number) => total > 0 ? Math.round(value * 100 / total) : 0;
          return <button key={`${candidate.source}-${candidate.iccs}`} onClick={() => void playIccsMove(candidate.iccs)} title={candidate.memo || candidate.source}>
            <strong>{candidate.notation}</strong><span>{candidate.score > 0 ? `+${candidate.score}` : candidate.score}</span>
            {total > 0 ? <span className="xqb-distribution" aria-label={`胜 ${percent(candidate.win)}% ，和 ${percent(candidate.draw)}% ，负 ${percent(candidate.loss)}%`}><i className="red" style={{ width: `${percent(candidate.win)}%` }}>{percent(candidate.win)}%</i><i className="draw" style={{ width: `${percent(candidate.draw)}%` }}>{percent(candidate.draw)}%</i><i className="black" style={{ width: `${percent(candidate.loss)}%` }}>{percent(candidate.loss)}%</i></span> : <small>暂无对局统计</small>}
            <small>{total.toLocaleString()} 局 · {candidate.source}</small>
          </button>;
        })}
      </section> : null}
      {compactLayout && <section className={`compact-manual-panel ${compactManualCollapsed ? "collapsed" : ""}`} aria-label="简洁布局棋谱">
        <header>
          <span><ClipboardList size={14}/><strong>棋谱</strong></span>
          <small title={`当前主引擎：${currentEngineLabel}`}>{compactManualCollapsed ? "已收起" : `主引擎：${currentEngineLabel} · ${board.history.length} 着${board.continuation.length ? ` · 后续 ${board.continuation.length} 着` : ""}`}</small>
          <button className="compact-window-toggle" title={compactManualCollapsed ? "展开并停靠棋谱" : "收起棋谱"} aria-label={compactManualCollapsed ? "展开并停靠棋谱" : "收起棋谱"} onClick={() => toggleCompactPanelCollapsed("manual")}>{compactManualCollapsed ? <ChevronDown size={16}/> : <X size={15}/>}</button>
        </header>
        {!compactManualCollapsed && <>
          {playbackControls("compact-playback")}
          {manualReviewContent("简洁布局棋谱着法")}
          {branchMapControls()}
        </>}
      </section>}
    </section>;
  }

  function startCloudBookDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>(".cloud-book-float");
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    cloudBookDragRef.current = { offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    setCloudBookPosition({ left: bounds.left, top: bounds.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCloudBookDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = cloudBookDragRef.current;
    if (!drag) return;
    const panelWidth = 344;
    const panelHeight = cloudBookCollapsed ? 42 : cloudBookHeight ?? 380;
    setCloudBookPosition({
      left: Math.max(8, Math.min(event.clientX - drag.offsetX, window.innerWidth - panelWidth - 8)),
      top: Math.max(48, Math.min(event.clientY - drag.offsetY, window.innerHeight - panelHeight - 8)),
    });
  }

  function stopCloudBookDrag(event: PointerEvent<HTMLDivElement>) {
    cloudBookDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startCloudBookResize(event: PointerEvent<HTMLDivElement>) {
    const panel = event.currentTarget.closest<HTMLElement>(".cloud-book-float");
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    cloudBookResizeRef.current = { startY: event.clientY, startHeight: bounds.height, top: bounds.top };
    setCloudBookHeight(bounds.height);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCloudBookResize(event: PointerEvent<HTMLDivElement>) {
    const resize = cloudBookResizeRef.current;
    if (!resize) return;
    const maxHeight = Math.max(160, window.innerHeight - resize.top - 8);
    setCloudBookHeight(Math.max(160, Math.min(resize.startHeight + event.clientY - resize.startY, maxHeight)));
  }

  function stopCloudBookResize(event: PointerEvent<HTMLDivElement>) {
    cloudBookResizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function returnFloatingPanelToMain() {
    if (!floatingPanel) return;
    try {
      await chessPlatform.returnCompactFloatingPanel(floatingPanel);
    } catch (error) {
      setNotice(`回到主窗口失败：${friendlyError(error)}`);
    }
  }

  function markFloatingPanelInteracting() {
    if (floatingPanelInteractionTimerRef.current != null) {
      window.clearTimeout(floatingPanelInteractionTimerRef.current);
    }
    setFloatingPanelInteracting(true);
    floatingPanelInteractionTimerRef.current = window.setTimeout(() => {
      floatingPanelInteractionTimerRef.current = undefined;
      setFloatingPanelInteracting(false);
    }, 1600);
  }

  function startFloatingWindowDrag(event: PointerEvent<HTMLElement>) {
    if (!floatingPanel || chessPlatform.kind !== "desktop") return;
    if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    markFloatingPanelInteracting();
    void getCurrentWindow().startDragging().catch(() => undefined);
  }

  if (floatingPanel) {
    return (
      <div className={`floating-panel-shell theme-${effectiveColorTheme} board-skin-${displayedBoardSkin} piece-skin-${displayedPieceSkin} floating-panel-${floatingPanel} ${floatingPanelInteracting ? "interacting" : ""}`}>
        <header className="floating-panel-titlebar" onPointerDown={startFloatingWindowDrag}>
          <span>{floatingPanel === "engine" ? <Activity size={16}/> : floatingPanel === "cloud" ? <Database size={16}/> : floatingPanel === "link" ? <Link size={16}/> : <ClipboardList size={16}/>}<strong>{floatingPanel === "engine" ? "引擎分析" : floatingPanel === "cloud" ? "云库 / 评估信息" : floatingPanel === "link" ? "连线提示" : "棋谱"}</strong></span>
          <small>{floatingPanel === "engine" ? (analysisBusy ? `${currentEngineVersionLabel} 正在计算…` : analysisIsStale ? "旧候选保留中" : "系统独立窗口") : floatingPanel === "cloud" ? (cloudBookLoading ? "查询中…" : cloudBookError ?? `${compactBookRows.length} 条候选`) : floatingPanel === "link" ? `${linkSessionStateLabel(linkSessionStatus.state, linkSessionStatus.mode, linkSessionStatus.pendingExternalMove, linkPendingMoveDisplay)} · ${board.sideToMove}` : `主引擎：${currentEngineVersionLabel} · ${board.history.length} 着${board.continuation.length ? ` · 后续 ${board.continuation.length} 着` : ""}`}</small>
          {floatingPanel === "link" && <span className="floating-panel-drag-pill" aria-hidden="true"><GripVertical size={13}/>拖动</span>}
          <button className="floating-panel-return" type="button" title="关闭浮窗并回到主窗口停靠显示" onClick={() => void returnFloatingPanelToMain()}><ChevronLeft size={15}/>回主窗口</button>
        </header>
        {floatingPanel === "engine" ? (
          <section className="floating-panel-body floating-engine-body">
            <div className="compact-engine-strip" aria-label="浮动窗口引擎状态">
              <span className={analysisBusy ? "running" : ""}><Activity size={14}/><strong>引擎：</strong></span>
              <div className="compact-engine-config" title={currentEngineTitle}>
                <button type="button" onClick={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : selectWorkspacePanel("analysis")}>{currentEngineVersionLabel}</button>
                <small title={`${threads} 线程 · Hash ${hashMb} MB`}>{threads}T/{hashMb}M</small>
                <small title={currentNnueLabel ?? `MultiPV ${multipv}`}>{currentNnueHashLabel ? `NNUE ${currentNnueHashLabel}` : currentNnueLabel ? "NNUE" : `PV ${multipv}`}</small>
                <i aria-hidden="true"/>
              </div>
              <button type="button" title="引擎设置" aria-label="引擎设置" onClick={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : selectWorkspacePanel("analysis")}><Settings2 size={14}/></button>
              {analysisBusy
                ? <button type="button" className="stop" onClick={() => void stopAnalysis()}><Square size={12}/>停止</button>
                : <button type="button" disabled={!board.playable || isPlaying} onClick={() => void runAnalysis()}><Play size={13}/>分析</button>}
            </div>
            <div className="analysis-lines">
              <CompactEngineAnalysisList
                busy={analysisBusy}
                rows={compactEngineRows}
                onPlayMove={(_, row) => row && void playCompactEngineRow(row)}
                onPreview={(row) => void previewCompactEngineRow(row)}
                onAdopt={(row) => void playCompactEngineRow(row)}
              />
            </div>
            <p className="floating-panel-note">这是系统独立窗口，只保留最近 10 条引擎记录；多引擎分歧可从主窗口棋谱工具进入。</p>
          </section>
        ) : floatingPanel === "cloud" ? (
          <section className="floating-panel-body floating-cloud-body">
            <CompactReferencePanels
              cloudEnabled={desktopPreferences.cloudBookEnabled ?? false}
              bookLoading={cloudBookLoading}
              bookError={cloudBookError}
              bookRows={compactBookRows}
              bookAuditByMove={activeBookCandidateAuditByMove}
              bookAuditState={activeBookCandidateAuditState}
              builtinBookStatus={builtinOpeningBookReferenceStatus}
              evaluationRows={compactEvaluationRows}
              evaluationLabel={evaluation?.label ?? "等待分析"}
              evaluationScore={evaluation?.scoreText ?? "--"}
              qualityText={overviewReport?.score != null ? `${overviewReport.score} ${overviewReport.grade}` : "--"}
              redShare={evaluation?.redShare}
              depthText={`${primaryAnalysis?.depth ?? "--"}`}
              timeText={primaryAnalysis?.timeMs != null ? `${(primaryAnalysis.timeMs / 1000).toFixed(1)}s` : "--"}
              evaluationCollapsed={floatingEvaluationCollapsed}
              onOpenSettings={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : setNotice("Web 版使用云端引擎，无本地引擎设置")}
              onToggleEvaluationCollapsed={() => void setEvaluationVisibility(!floatingEvaluationCollapsed)}
              onAuditBookCandidates={() => void auditBookCandidatesWithPikafish()}
              onPlayBookMove={(iccs) => void playIccsMove(iccs)}
              onPlayEvaluationMove={(iccs) => void playIccsMove(iccs, analysisFen ?? board.fen)}
            />
            <p className="floating-panel-note">这是系统独立窗口，可拖到主窗口外；主窗口走棋后这里会自动刷新。</p>
          </section>
        ) : floatingPanel === "link" ? (
          <section className="floating-panel-body floating-link-body">
            <div className="link-control-card">
              <div>
                <strong>{linkSessionStatus.state === "stopped" ? "请切换到网页棋盘并框选" : linkSessionStateLabel(linkSessionStatus.state, linkSessionStatus.mode, linkSessionStatus.pendingExternalMove, linkPendingMoveDisplay)}</strong>
                <small>{linkAnalysisStatusText(linkSessionStatus, analysisBusy, analysisIsStale, compactEngineRows.length, board.sideToMove, linkConfirmMoveDisplay, linkPendingMoveDisplay)}</small>
              </div>
              <span>{linkPhaseLabel(linkSessionStatus)}</span>
            </div>
            <div className={`link-float-status ${linkSessionStatus.state}`}><span>{linkSessionStateLabel(linkSessionStatus.state, linkSessionStatus.mode, linkSessionStatus.pendingExternalMove, linkPendingMoveDisplay)}</span><strong>{board.sideToMove}行棋</strong><small>{linkSessionStatus.lastError ?? linkSessionStatus.reason ?? "窗口连线将同步经过稳定帧与棋规校验的着法"}</small>{linkSessionStatus.turnIndicator && <small>{linkSessionStatus.turnIndicator}</small>}{linkSessionStatus.lastDetectionSummary && <small>{linkSessionStatus.lastDetectionSummary}</small>}<small>{linkSessionStatus.captureRunning ? `${linkPhaseLabel(linkSessionStatus)} · ${linkSessionStatus.confidence == null ? "等待置信度" : `置信度 ${(linkSessionStatus.confidence * 100).toFixed(0)}%`} · 稳定 ${linkSessionStatus.stableFrames}/${linkSessionStatus.requiredStableFrames} · 尝试 ${linkSessionStatus.recognitionAttempts ?? 0}` : `${linkPhaseLabel(linkSessionStatus)} · ${linkSessionStatus.confidence == null ? "等待置信度" : `置信度 ${(linkSessionStatus.confidence * 100).toFixed(0)}%`} · 尝试 ${linkSessionStatus.recognitionAttempts ?? 0}`}</small>{linkSessionStatus.lastMove && <small>最近同步：{linkSessionStatus.lastMove}</small>}</div>
            <div
              className={`link-float-evaluation ${professionalEvaluationTone}`}
              aria-label={evaluation ? `当前局面评估：${evaluation.label}，分值 ${evaluation.scoreText}` : "等待局面评估"}
            >
              <header>
                <span className="red">红方</span>
                <strong>{evaluation?.scoreText ?? "--"}</strong>
                <span className="black">黑方</span>
              </header>
              <div className="link-eval-balance" aria-hidden="true">
                <i style={{ width: `${evaluation?.redShare ?? 50}%` } as CSSProperties}/>
              </div>
              <small>
                <b>{evaluation?.label ?? "等待引擎分析"}</b>
                <em>{evaluation ? `红 ${evaluation.redShare.toFixed(0)}% · 黑 ${(100 - evaluation.redShare).toFixed(0)}%` : "红 50% · 黑 50%"}</em>
              </small>
            </div>
            <section className={`link-mini-section ${linkMiniBoardSize}`}>
              <header><strong>{linkShouldShowMiniBoard ? (linkHasObservedPosition ? "已同步棋盘" : "同步中棋盘") : linkSessionStatus.capturePreviewKind ?? "实时识别预览"}{linkShouldShowMiniBoard && <em className={board.sideToMove === "黑方" ? "black" : "red"}>{board.sideToMove}走</em>}</strong><div className="link-mini-size" aria-label="棋盘预览大小"><button type="button" className={linkMiniBoardSize === "off" ? "active" : ""} onClick={() => setLinkMiniBoardSize("off")}>隐藏</button><button type="button" className={linkMiniBoardSize === "small" ? "active" : ""} onClick={() => setLinkMiniBoardSize("small")}>小</button><button type="button" className={linkMiniBoardSize === "large" ? "active" : ""} onClick={() => setLinkMiniBoardSize("large")}>大</button></div></header>
              {linkMiniBoardSize !== "off" && (linkShouldShowMiniBoard
                ? <LinkMiniBoard pieces={linkMiniPieces} arrows={linkMiniArrows} lastMove={linkDisplayedLastMove} sideToMove={board.sideToMove} reversed={linkMiniBoardReversed} markerStyle="tiantian" pieceScale={1.16} markerScale={.72} arrowVisualScale={.78} pieceAsset={(piece) => pieceAsset(piece, displayedPieceSkin)} boardAsset={`/skins/${skinAssetFolder(displayedBoardSkin)}/board.png`}/>
                : linkCapturePreview ? <img className="link-capture-preview" src={linkCapturePreview} alt={linkSessionStatus.capturePreviewKind ?? "实时识别预览"}/>
                : <div className="link-mini-empty">等待框选区域的实时截图；未同步前不会显示旧棋盘和旧箭头。</div>)}
              <small>{linkMiniBoardHint}</small>
            </section>
            <div className="link-float-candidates">
              <header><strong>候选线路</strong><small>中文 MultiPV</small></header>
              {analysisIsStale
                ? <p>网页局面已变化，旧候选已隐藏，等待当前局面重新分析。</p>
                : compactEngineRows.length || analysisBusy
                  ? <CompactEngineAnalysisList busy={analysisBusy} rows={compactEngineRows} onPlayMove={() => undefined}/>
                  : <p>{linkHasObservedPosition ? "当前局面已同步，等待引擎返回候选线路。" : "识别并同步局面后，在此显示当前设置的引擎候选线。"}</p>}
            </div>
            <div className="link-float-actions">
              {linkSessionStatus.mode === "confirmPlay" && <button type="button" title={linkConfirmMove ? `按箭头1选中起始棋子：${linkConfirmMoveDisplay ?? linkConfirmMove}` : "等待箭头1候选"} disabled={linkSessionStatus.state !== "tracking" || analysisIsStale || !linkConfirmMove} onClick={() => { const move = linkConfirmMove; if (move) void chessPlatform.confirmLinkEngineMove(move).then(async () => { setNotice(`已按箭头1选中 ${linkConfirmMoveDisplay ?? move} 的起始棋子，请在网页棋盘确认落点`); setLinkSessionStatus(await chessPlatform.getLinkSessionStatus()); }).catch((error) => setNotice(friendlyError(error))); }}><Play size={14}/>{linkConfirmMoveLabel ? `重选首选 ${linkConfirmMoveLabel}` : "选中走子"}</button>}
              <button type="button" disabled={linkSessionStatus.state === "stopped"} onClick={() => void chessPlatform.setLinkSideToMove(board.sideToMove === "红方" ? "black" : "red").then((next) => { applyBoard(next); return chessPlatform.getLinkSessionStatus(); }).then((status) => { setLinkSessionStatus(status); analysisHintsEnabledRef.current = true; setAnalysisHintsEnabled(true); window.setTimeout(() => void runAnalysis(true), 0); setNotice(`已校正为${board.sideToMove === "红方" ? "黑方" : "红方"}行棋`); }).catch((error) => setNotice(friendlyError(error)))}>{board.sideToMove === "红方" ? "改黑走" : "改红走"}</button>
              <button type="button" disabled={linkSessionStatus.state === "stopped"} onClick={() => void chessPlatform.pauseLinkSession().then(setLinkSessionStatus).catch((error) => setNotice(friendlyError(error)))}><Pause size={14}/>暂停</button>
              <button type="button" onClick={() => void chessPlatform.recalibrateLinkSession().then((status) => { setLinkSessionStatus(status); return chessPlatform.getLinkCapturePreview(); }).then(setLinkCapturePreview).catch((error) => setNotice(friendlyError(error)))}><RefreshCw size={14}/>{linkSessionStatus.source === "desktopDetect" ? "重新扫描" : linkSessionStatus.source === "imageImport" || linkSessionStatus.source === "cameraBoard" ? "重新选图" : "重新框选"}</button>
              <button type="button" className="stop" disabled={linkSessionStatus.state === "stopped"} onClick={() => void chessPlatform.stopLinkSession().then(() => chessPlatform.getLinkSessionStatus()).then(setLinkSessionStatus).catch((error) => setNotice(friendlyError(error)))}><Square size={13}/>停止</button>
            </div>
            <p className="floating-panel-note">模型在本机持续识别可见棋盘，不保存截图。确认走子和自动对战只会在稳定局面、有效引擎结果及明确授权下执行。</p>
          </section>
        ) : (
          <section className="floating-panel-body floating-manual-body">
            {playbackControls("compact-playback floating-playback")}
            {manualReviewContent("浮动窗口棋谱着法")}
            {branchMapControls()}
            <p className="floating-panel-note">这是系统独立窗口，可拖到主窗口外；主窗口走棋后这里会自动刷新。</p>
          </section>
        )}
        {engineDivergenceDialog()}
        {chessPlatform.kind === "desktop" && <DesktopDialogs
          dialog={desktopDialog}
          preferences={desktopPreferences}
          account={syncAccount}
          subscription={subscription}
          trainingTasks={trainingTasks}
          trainingSummary={trainingSummary}
          studySessions={studySessions}
          engineProfiles={engineProfiles}
          builtinOpeningBookManifest={builtinOpeningBookManifest}
          busy={dialogBusy}
          onClose={() => setDesktopDialog(null)}
          onChooseEngine={(currentPath) => chessPlatform.chooseEngineExecutable(currentPath)}
          onSaveEngine={saveEnginePreferences}
          onSelectEngineProfile={selectEngineProfile}
          onDeleteEngineProfile={removeEngineProfile}
          onSaveSync={saveSyncPreferences}
          onUnbindSync={unbindSync}
          onAuthenticate={authenticateSync}
          onRedeemSubscription={redeemSubscriptionCode}
          onGenerateTraining={generateTrainingTasks}
          onSaveStudy={saveStudySession}
          onAnalyzeStudy={analyzeStudySession}
          onCompleteTraining={completeTrainingTask}
          onChooseMirrorRoot={() => chessPlatform.chooseGameMirrorRoot()}
          onSaveMirrorPreferences={saveMirrorPreferences}
          onRebuildMirrors={rebuildGameMirrors}
        />}
        {chessPlatform.kind === "desktop" && masterLibraryOpen && <MasterLibraryDialog
          account={syncAccount}
          listPlayers={(query, options) => chessPlatform.listMasterPlayers(query, options)}
          getStats={(query) => chessPlatform.getMasterLibraryStats(query)}
          listGames={(playerId, query, options) => chessPlatform.listMasterGames(playerId, query, options)}
          onOpenGame={openMasterLibraryGame}
          onClose={() => setMasterLibraryOpen(false)}
        />}
      </div>
    );
  }

  const compactDockMinimized = desktopPreferences.layoutMode === "compact"
    && (compactEngineCollapsed || compactDetachedPanels.engine)
    && (compactManualCollapsed || compactDetachedPanels.manual);
  const compactHasSystemPopout = desktopPreferences.layoutMode === "compact"
    && Object.values(compactPoppedOutPanels).some(Boolean);
  const themeToggleTitle = desktopPreferences.layoutMode === "compact"
    ? "简洁模式固定浅色主题"
    : "专业模式固定暗黑主题";
  const engineMoveNowAvailable = canRequestEngineMoveNow({
    platformKind: chessPlatform.kind,
    playable: board.playable,
    reportBusy,
    engineSide,
    engineStarting,
    sideToMove: board.sideToMove,
  });
  const engineMoveNowTitle = engineStarting
    ? `${currentEngineVersionLabel} 正在启动`
    : engineThinking
      ? "停止搜索并立即落子"
      : engineMoveNowAvailable
        ? `轮到 ${currentEngineVersionLabel}，点击立即出招`
        : engineSide === "none"
          ? "请先选择引擎执红或执黑"
          : !board.playable
            ? "当前研究局面不可对弈"
            : reportBusy
              ? "整局报告生成期间不能开始人机对弈"
              : `等待轮到 ${currentEngineVersionLabel}`;

  return (
    <div className={`app-shell ${chessPlatform.kind}-shell theme-${effectiveColorTheme} layout-${desktopPreferences.layoutMode} board-skin-${displayedBoardSkin} piece-skin-${displayedPieceSkin}`}>
      <header className="titlebar">
        <div className="window-brand"><span className="brand-seal">象</span><strong>棋研</strong><small>XIANGQI STUDIO</small></div>
        <strong className="window-title">棋研工作台</strong>
        <button
          className={`autosave-status ${autosave.status}`}
          disabled={autosave.status !== "error"}
          title={autosave.status === "error" ? `本地保存失败：${autosave.message}` : autosaveLabel(autosave)}
          onClick={() => void retryLastSave()}
        ><Save size={12}/>{autosaveLabel(autosave)}</button>
        <div className="window-state"><span className={analysisBusy ? "pulse" : ""} />{notice}</div>
      </header>

      <MobileToolbar analysisBusy={analysisBusy} analysisDisabled={!board.playable || isPlaying || reportBusy || engineSide !== "none" || engineThinking || (chessPlatform.kind === "web" && !online)} evaluationVisible={mobileEvaluationVisible} colorTheme={effectiveColorTheme} onCommand={(command) => void executeMobileToolbar(command)}/>
      {mobileExportOpen && <>
        <button className="mobile-export-backdrop" aria-label="关闭复制与导出菜单" onClick={() => setMobileExportOpen(false)}/>
        <section className="mobile-export-menu" role="menu" aria-label="复制与导出">
          <header><strong>复制与导出</strong><button type="button" aria-label="关闭复制与导出菜单" onClick={() => setMobileExportOpen(false)}><X size={17}/></button></header>
          <button role="menuitem" onClick={() => { void copyPosition(); setMobileExportOpen(false); }}><Copy size={17}/>复制局面 FEN</button>
          <button role="menuitem" disabled={chessPlatform.kind === "web"} title={chessPlatform.kind === "web" ? "Web 端暂不支持文字棋谱导出" : undefined} onClick={() => { void copyExport("chinese", "文字棋谱"); setMobileExportOpen(false); }}><ClipboardList size={17}/>复制文字棋谱</button>
          <button role="menuitem" disabled={chessPlatform.kind === "web"} title={chessPlatform.kind === "web" ? "Web 端暂不支持东萍格式导出" : undefined} onClick={() => { void copyExport("dhtmlxq", "东萍棋谱"); setMobileExportOpen(false); }}><Copy size={17}/>复制东萍棋谱</button>
          <button role="menuitem" onClick={() => { void saveDocument(); setMobileExportOpen(false); }}><Download size={17}/>下载棋谱文件</button>
        </section>
      </>}
      {mobileDrawerOpen && <>
        <button className="mobile-workbench-backdrop" aria-label="关闭功能菜单" onClick={() => setMobileDrawerOpen(false)}/>
        <aside className="mobile-workbench-drawer" role="dialog" aria-modal="true" aria-label="移动端功能菜单" onKeyDown={trapMobileDrawerFocus}>
          <header><span><strong>棋盘工具</strong><small>图标与功能说明</small></span><button ref={mobileDrawerCloseRef} type="button" aria-label="关闭功能菜单" title="关闭功能菜单" onClick={() => setMobileDrawerOpen(false)}><X size={18}/></button></header>
          <section><small>棋谱</small><div>
            <button type="button" className="mobile-drawer-command" title="新建标准开局棋谱" onClick={() => { setMobileDrawerOpen(false); void createGame(startingFen); }}><Plus size={18}/><span><strong>新局</strong><small>新建标准开局</small></span></button>
            <button type="button" className="mobile-drawer-command" title="导入本地棋谱文件" onClick={() => { setMobileDrawerOpen(false); void openDocument(); }}><FolderOpen size={18}/><span><strong>导入棋谱</strong><small>打开本地棋谱文件</small></span></button>
            <button type="button" className="mobile-drawer-command" title="下载当前棋谱文件" onClick={() => { setMobileDrawerOpen(false); void saveDocument(); }}><Save size={18}/><span><strong>保存棋谱</strong><small>下载当前棋谱</small></span></button>
            <button type="button" className="mobile-drawer-command" title="编辑当前棋盘局面" onClick={() => { setMobileDrawerOpen(false); setPositionEditorOpen(true); }}><Pencil size={18}/><span><strong>编辑局面</strong><small>摆放或删除棋子</small></span></button>
            <button type="button" className="mobile-drawer-command" aria-label="翻转红黑方视角" title="翻转红黑方视角" onClick={() => { setMobileDrawerOpen(false); setReversed((value) => !value); }}><FlipVertical2 size={18}/><span><strong>翻转红黑方</strong><small>切换红方或黑方在下</small></span></button>
            <button type="button" className="mobile-drawer-command" title="复制局面或下载棋谱" onClick={() => { setMobileDrawerOpen(false); setMobileExportOpen(true); }}><Copy size={18}/><span><strong>复制与导出</strong><small>复制 FEN 或下载</small></span></button>
          </div></section>
          <section><small>分析</small><div>
            <button type="button" className="mobile-drawer-command" title={analysisBusy ? "停止当前 Pikafish 分析" : "向 Pikafish 请求当前局面的候选着法"} disabled={!analysisBusy && (!board.playable || isPlaying || reportBusy || engineSide !== "none" || engineThinking || !online)} onClick={() => void (analysisBusy ? stopAnalysis() : runAnalysis())}><Activity size={18}/><span><strong>{analysisBusy ? "停止分析" : "分析局面"}</strong><small>{analysisBusy ? "停止当前搜索" : "请求 Pikafish 推荐"}</small></span></button>
            <button type="button" className="mobile-drawer-command" title="切换到下一条引擎候选 PV" onClick={() => void advanceMobileForcedVariation()}><GitFork size={18}/><span><strong>强变招</strong><small>预览下一候选 PV</small></span></button>
            <label className="mobile-drawer-toggle"><input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)}/><span>自动分析</span></label>
            <label className="mobile-drawer-toggle"><input type="checkbox" checked={mobileArrowsEnabled} onChange={(event) => { setMobileArrowsEnabled(event.target.checked); if (!event.target.checked) setMobileArrowFocus(undefined); }}/><span>候选连线</span></label>
            <label className="mobile-drawer-select"><span>候选</span><select aria-label="候选数量" value={multipv} onChange={(event) => setMultipv(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>MultiPV {value}</option>)}</select></label>
            <label className="mobile-drawer-select"><span>搜索</span><select aria-label="搜索模式" value={searchMode === "time" ? "time" : "depth"} onChange={(event) => { const mode = event.target.value as "time" | "depth"; setSearchMode(mode); setSearchValue(mode === "time" ? 1000 : 20); }}><option value="time">时间</option><option value="depth">深度</option></select></label>
            <label className="mobile-drawer-select"><span>{searchMode === "time" ? "毫秒" : "深度"}</span><input aria-label={searchMode === "time" ? "搜索时间毫秒" : "搜索深度"} type="number" min={searchMode === "time" ? 100 : 1} max={searchMode === "time" ? 5000 : 30} value={searchValue} onChange={(event) => setSearchValue(Math.min(searchMode === "time" ? 5000 : 30, Math.max(searchMode === "time" ? 100 : 1, Number(event.target.value) || (searchMode === "time" ? 1000 : 20))))}/></label>
          </div></section>
          <section className="mobile-cloud-settings"><small>Pikafish 服务</small><div>
            <label className="mobile-cloud-field">服务地址<input aria-label="云端服务地址" inputMode="url" value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setCloudConnection("idle"); }} /></label>
            <button type="button" disabled={cloudConnection === "checking"} onClick={() => void checkMobileCloudConnection()}>{cloudConnection === "checking" ? "检测中" : cloudConnection === "online" ? "服务已连接" : "检测连接"}</button>
            <p className="mobile-cloud-status">首版免登录。连接成功后可直接请求 Pikafish 分析。</p>
          </div></section>
          <section><small>显示</small><div>
            <button type="button" className="mobile-drawer-command" title={mobileEvaluationVisible ? "收起棋盘上方的局势评分条" : "显示棋盘上方的局势评分条"} onClick={() => setMobileEvaluationVisible((visible) => !visible)}><BarChart3 size={18}/><span><strong>{mobileEvaluationVisible ? "收起局势图" : "显示局势图"}</strong><small>红黑双方局势评分</small></span></button>
            <button type="button" className="mobile-drawer-command" title="打开棋盘皮肤、候选箭头和引擎参数设置" onClick={() => { setMobileDrawerOpen(false); setMobilePanel("settings"); }}><Settings2 size={18}/><span><strong>更多设置</strong><small>皮肤与引擎参数</small></span></button>
          </div></section>
        </aside>
      </>}
      {mobilePanel === "settings" && <section className="mobile-settings-screen" aria-label="手机设置">
        <header><button type="button" aria-label="关闭设置" onClick={() => setMobilePanel("board")}><ChevronLeft size={20}/></button><strong>设置</strong><span/></header>
        <div className="mobile-settings-scroll">
          <h2>显示设置</h2>
          <button type="button" className="mobile-settings-row" onClick={() => setSkinShopOpen(true)}><span><strong>棋盘与棋子皮肤</strong><small>沿用当前主题与皮肤</small></span><ChevronRight size={18}/></button>
          <label className="mobile-settings-row"><span><strong>显示候选箭头</strong><small>点击引擎或开局库候选后显示</small></span><input type="checkbox" checked={mobileArrowsEnabled} onChange={(event) => { setMobileArrowsEnabled(event.target.checked); if (!event.target.checked) setMobileArrowFocus(undefined); }}/></label>
          <label className="mobile-settings-row"><span><strong>自动分析</strong><small>走棋后请求云端 Pikafish</small></span><input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)}/></label>
          <h2>引擎设置</h2>
          <div className="mobile-settings-row"><span><strong>显示着法数</strong><small>服务端最多支持 5 条候选</small></span><div className="mobile-stepper"><button type="button" aria-label="减少 MultiPV" disabled={multipv <= 1} onClick={() => setMultipv((value) => Math.max(1, value - 1))}>−</button><b>{multipv}</b><button type="button" aria-label="增加 MultiPV" disabled={multipv >= 5} onClick={() => setMultipv((value) => Math.min(5, value + 1))}>＋</button></div></div>
          <label className="mobile-settings-row"><span><strong>搜索限制</strong><small>{searchMode === "time" ? "100 - 5000 毫秒" : "1 - 30 层"}</small></span><select aria-label="搜索限制模式" value={searchMode === "time" ? "time" : "depth"} onChange={(event) => { const mode = event.target.value as "time" | "depth"; setSearchMode(mode); setSearchValue(mode === "time" ? 1000 : 20); }}><option value="depth">深度</option><option value="time">时间</option></select></label>
          <div className="mobile-settings-row"><span><strong>{searchMode === "time" ? "搜索时间" : "最大深度"}</strong><small>{searchMode === "time" ? "毫秒" : "层"}</small></span><div className="mobile-stepper"><button type="button" aria-label="减少搜索限制" onClick={() => setSearchValue((value) => Math.max(searchMode === "time" ? 100 : 1, value - (searchMode === "time" ? 100 : 1)))}>−</button><b>{searchValue}</b><button type="button" aria-label="增加搜索限制" onClick={() => setSearchValue((value) => Math.min(searchMode === "time" ? 5000 : 30, value + (searchMode === "time" ? 100 : 1)))}>＋</button></div></div>
          <h2>Pikafish 服务</h2>
          <button type="button" className="mobile-settings-row" onClick={() => { setMobilePanel("board"); setMobileDrawerOpen(true); }}><span><strong>连接 Pikafish 服务</strong><small>{cloudConnection === "online" ? "服务已连接，可直接分析" : "服务地址与连通性检测"}</small></span><ChevronRight size={18}/></button>
        </div>
      </section>}

      <nav className="menubar" aria-label="主菜单">
        {chessPlatform.kind === "desktop" && <DesktopMenuBar
          appVersion={appInfo?.version}
          mode={workspaceMode}
          status={{
            playable: board.playable,
            isPlaying,
            analysisBusy,
            engineThinking,
            engineArenaBusy,
            engineMoveNowAvailable,
            engineConfigured: !!enginePath.trim(),
            engineSide,
            hasContinuation: !!preferredContinuation(board),
            syncBusy,
            syncStatus: syncAccount.status,
            syncEmail: syncAccount.email,
            syncLastResult: syncAccount.lastSyncResult,
            linkSupported: linkPlatformSupported,
          }}
          execute={executeMenuCommand}
        />}
        <button className="engine-chip engine-chip-group" type="button" title={engineChipTitle || "当前用于分析的引擎；点击进入引擎设置"} onClick={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : selectWorkspacePanel("analysis")}>
          <Activity size={13}/>
          <span className="engine-chip-mode">{selectedAnalysisEngines.length > 1 ? "并行" : "单引擎"}</span>
          <span className="engine-chip-list">{selectedAnalysisEngines.map((engine, index) => {
            const result = engineAnalyses[engine.id];
            const status = result?.error ? "失败" : analysisBusy ? result?.lines.length ? "返回中" : "计算中" : engine.primary ? (enginePath ? engineRuntimeLabel[engineRuntimeState] : "未检测") : result?.lines.length ? "完成" : "待分析";
            return <span className={`engine-chip-entry ${engine.primary ? "primary" : "comparison"}`} title={engine.title} key={engine.id}><b>{engine.primary ? "主" : `对比${index}`}</b><strong>{engine.displayName}</strong><small>{status}</small>{engine.nnueLabel && <em>{engine.nnueLabel}</em>}</span>;
          })}</span>
        </button>
      </nav>

      {chessPlatform.kind === "desktop" && <DesktopDialogs
        dialog={desktopDialog}
        preferences={desktopPreferences}
        account={syncAccount}
        subscription={subscription}
        trainingTasks={trainingTasks}
        trainingSummary={trainingSummary}
        studySessions={studySessions}
        engineProfiles={engineProfiles}
        builtinOpeningBookManifest={builtinOpeningBookManifest}
        busy={dialogBusy}
        onClose={() => setDesktopDialog(null)}
        onChooseEngine={(currentPath) => chessPlatform.chooseEngineExecutable(currentPath)}
        onSaveEngine={saveEnginePreferences}
        onSelectEngineProfile={selectEngineProfile}
        onDeleteEngineProfile={removeEngineProfile}
        onSaveSync={saveSyncPreferences}
        onUnbindSync={unbindSync}
        onAuthenticate={authenticateSync}
        onRedeemSubscription={redeemSubscriptionCode}
        onGenerateTraining={generateTrainingTasks}
        onSaveStudy={saveStudySession}
        onAnalyzeStudy={analyzeStudySession}
        onCompleteTraining={completeTrainingTask}
        onChooseMirrorRoot={() => chessPlatform.chooseGameMirrorRoot()}
        onSaveMirrorPreferences={saveMirrorPreferences}
        onRebuildMirrors={rebuildGameMirrors}
      />}
      {userManualOpen && <UserManualDialog appVersion={appInfo?.version ?? "1.2.1"} markdown={userManualMarkdown} onClose={() => setUserManualOpen(false)}/>}
      {aboutOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAboutOpen(false); }}>
        <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
          <header><span><Info size={18}/><strong id="about-title">关于棋研</strong></span><button className="tool-button" title="关闭" onClick={() => setAboutOpen(false)}><X size={16}/></button></header>
          <div className="about-dialog-body">
            <div className="about-brand"><span className="brand-seal">象</span><div><strong>棋研工作台</strong><small>XIANGQI STUDIO</small></div></div>
            <dl>
              <div><dt>软件版本</dt><dd>{appInfo?.version ? `v${appInfo.version}` : "读取中…"}</dd></div>
              <div><dt>构建时间</dt><dd>{appInfo?.buildTimestamp ? new Date(appInfo.buildTimestamp * 1000).toLocaleString("zh-CN", { hour12: false }) : "读取中…"}</dd></div>
              <div><dt>运行平台</dt><dd>{appInfo?.platform ?? "读取中…"}</dd></div>
            </dl>
            <p>本地棋谱、分析缓存和设置保存在此设备；另存 PGN 由你主动选择文件位置。</p>
          </div>
          <footer><button onClick={() => setAboutOpen(false)}>关闭</button></footer>
        </section>
      </div>}
      {u10Start && u10Profile && <U10TrainingDialog
        start={u10Start}
        profile={u10Profile}
        dailyPlan={u10DailyPlan}
        weeklyReport={u10WeeklyReport}
        repertoire={u10Repertoire}
        busy={u10Busy}
        error={u10Error}
        onClose={closeU10Analysis}
        onCancel={(sessionId) => void chessPlatform.cancelGuidedAnalysis(sessionId)}
        onPreview={(moves) => chessPlatform.previewLine(u10Start.session.fen, moves)}
        onParseChineseLine={(notation) => chessPlatform.parseChineseLine(u10Start.session.fen, notation)}
        initialReversed={u10InitialReversed}
        pieceAsset={(piece) => pieceAsset(piece, displayedPieceSkin)}
        boardAsset={`/skins/${skinAssetFolder(displayedBoardSkin)}/board.png`}
        onSubmit={submitU10Analysis}
        onSaveProfile={saveU10Profile}
        onSaveVariation={saveU10Variation}
      />}
      {chessPlatform.kind === "desktop" && masterLibraryOpen && <MasterLibraryDialog
        account={syncAccount}
        listPlayers={(query, options) => chessPlatform.listMasterPlayers(query, options)}
        getStats={(query) => chessPlatform.getMasterLibraryStats(query)}
        listGames={(playerId, query, options) => chessPlatform.listMasterGames(playerId, query, options)}
        onOpenGame={openMasterLibraryGame}
        onClose={() => setMasterLibraryOpen(false)}
      />}
      {coachProfileOpen && <CoachProfileView
        reports={coachReports}
        masterStyleProfiles={masterStyleProfiles}
        importingMasterStyle={masterStyleImporting}
        onImportMasterStyle={() => void importDefaultMasterStyleProfile()}
        onClose={() => setCoachProfileOpen(false)}
      />}

      <div className="actionbar">
        <button className="wide-tool" onClick={() => void createGame(startingFen)}><FolderOpen size={14}/>手动录谱</button>
        <div className="tool-group">
          <button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={17}/></button>
          <button className="tool-button" title="打开棋谱" onClick={() => void openDocument()}><FolderOpen size={16}/></button>
          <button className="tool-button" title="保存棋谱" onClick={() => void saveDocument()}><Save size={16}/></button>
          <button className="tool-button" title="翻转棋盘" onClick={() => setReversed((value) => !value)}><RotateCcw size={16}/></button>
          <button className="tool-button" title="返回根局面" onClick={() => void navigateTo()}><RefreshCw size={16}/></button>
          {chessPlatform.kind === "desktop" && workspaceMode === "research" && <button className="tool-button" title={syncAccount.status === "signedIn" ? "大师棋谱" : "登录后查看大师棋谱"} onClick={() => syncAccount.status === "signedIn" ? setMasterLibraryOpen(true) : setDesktopDialog(syncAccount.status === "unbound" ? "register" : "login")}><Database size={16}/></button>}
          {chessPlatform.kind === "desktop" && <button className="tool-button" title="AI 私教棋力档案" onClick={() => void openCoachProfile()}><BarChart3 size={16}/></button>}
          {chessPlatform.kind === "desktop" && workspaceMode === "research" && <button className="tool-button flyknife-tool-button" title="飞刀库 / 专题库" onClick={() => setFlyknifeOpen(true)}><Zap size={16}/><span>飞刀库</span></button>}
        </div>
        {chessPlatform.kind === "desktop" && <div className="export-menu">
          <button className={`tool-button ${exportMenuOpen ? "active" : ""}`} title="分享与导出" aria-label="分享与导出" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)}><Share2 size={16}/></button>
          {exportMenuOpen && <div className="export-menu-popup" role="menu" aria-label="分享与导出">
            <button role="menuitem" onClick={() => void copyPosition()}><Copy size={15}/>复制局面</button>
            <button role="menuitem" onClick={() => void copyExport("chinese", "文字棋谱")}><ClipboardList size={15}/>复制文字棋谱</button>
            <button role="menuitem" onClick={() => void copyExport("dhtmlxq", "东萍棋谱")}><Copy size={15}/>复制东萍棋谱</button>
            <button role="menuitem" disabled={manualExporting} onClick={() => void exportManualFile("pgn", "PGN 棋谱")}><Download size={15}/>下载 PGN 棋谱</button>
            <button role="menuitem" disabled={manualExporting} onClick={() => void exportManualPdf()}><Download size={15}/>导出棋谱 PDF</button>
            <button role="menuitem" disabled={manualExporting} onClick={() => void exportMindMap()}><GitBranch size={15}/>导出完整变招图 SVG</button>
            <button role="menuitem" disabled={manualExporting} onClick={() => void exportReplayGif("currentSelection")}><Play size={15}/>生成当前分支 GIF</button>
            <button role="menuitem" disabled={manualExporting} onClick={() => void exportReplayGif("mainline")}><Play size={15}/>生成完整主线 GIF</button>
          </div>}
        </div>}
        <div className="tool-divider" />
        <WorkspaceLayoutSwitch mode={desktopPreferences.layoutMode} onChange={(mode) => void setWorkspaceLayout(mode)}/>
        <div className="tool-divider" />
        <WorkspaceModeSwitch
          active={workspaceMode}
          platformKind={chessPlatform.kind}
          engineReady={Boolean(engineProbe)}
          syncSignedIn={syncAccount.status === "signedIn"}
          linkSupported={linkPlatformSupported}
          onChange={(mode) => void selectWorkspaceMode(mode)}
        />
        <button
          className={`mode-tool ${analysisHintsEnabled ? "active" : ""}`}
          title={analysisHintsEnabled ? "停止自动分析并隐藏 MultiPV 提示" : "开启自动分析与 MultiPV 提示"}
          onClick={() => void (analysisHintsEnabled ? stopAnalysis() : runAnalysis())}
          disabled={!analysisHintsEnabled && (!board.playable || isPlaying)}
        ><Zap size={15}/>{analysisHintsEnabled ? "停止分析" : "分析"}</button>
        <button className="mode-tool move-now-tool" title={analysisIsStale ? "候选线路已过期，请等待当前局面重新分析" : primaryAnalysis?.pv[0] ? (engineSide !== "none" || engineStarting || engineThinking ? "停止人机搜索并采用当前第一候选着" : "采用当前第一候选着") : "请先完成当前局面分析"} disabled={chessPlatform.kind !== "desktop" || !primaryAnalysis?.pv[0] || analysisIsStale} onClick={() => void playPrimaryAnalysisMove()}><Zap size={15}/>引擎出招</button>
        <button className="tool-button" title="引擎设置" onClick={() => setDesktopDialog("engine")}><Settings2 size={16}/></button>
        <div className="skin-menu">
          <button className={`tool-button ${skinMenuOpen ? "active" : ""}`} title="棋盘皮肤" aria-label="棋盘皮肤" aria-expanded={skinMenuOpen} onClick={() => setSkinMenuOpen((open) => !open)}><Palette size={16}/></button>
          {skinMenuOpen && <section className="skin-menu-popup" aria-label="棋盘皮肤设置" onPointerLeave={() => setSkinHoverPreview(undefined)}>
            <header><strong>皮肤选择</strong><button className="tool-button" title="关闭皮肤选择" aria-label="关闭皮肤选择" onClick={() => { setSkinHoverPreview(undefined); setSkinMenuOpen(false); }}><X size={15}/></button></header>
            <div><span>棋盘</span><button className={activeBoardSkin === "default" && activePieceSkin === "default" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: "default", pieceSkin: "default" })} onClick={() => void updateBoardSkin({ boardSkin: "default", pieceSkin: "default" })}><i className="skin-choice-preview board default"/><b>默认</b></button></div>
            <div><span>棋子</span><button className={activePieceSkin === "default" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: activeBoardSkin, pieceSkin: "default" })} onClick={() => void updateBoardSkin({ boardSkin: desktopPreferences.boardSkin, pieceSkin: "default" })}><i className="skin-choice-preview piece default">将</i><b>默认</b></button></div>
            <div className="skin-menu-featured"><span>红木鎏金</span><button className={activeBoardSkin === "hongmu" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: "hongmu", pieceSkin: activePieceSkin })} onClick={() => void updateBoardSkin({ boardSkin: "hongmu", pieceSkin: desktopPreferences.pieceSkin })}><i className="skin-choice-preview board hongmu"/><b>棋盘</b></button><button className={activePieceSkin === "hongmu" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: activeBoardSkin, pieceSkin: "hongmu" })} onClick={() => void updateBoardSkin({ boardSkin: desktopPreferences.boardSkin, pieceSkin: "hongmu" })}><i className="skin-choice-preview piece hongmu">帅</i><b>棋子</b></button></div>
            {syncAccount.status === "signedIn" && <><div className="skin-menu-featured"><span>经典雅致</span><button className={activeBoardSkin === "jingdian" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: "jingdian", pieceSkin: activePieceSkin })} onClick={() => void updateBoardSkin({ boardSkin: "jingdian", pieceSkin: desktopPreferences.pieceSkin })}><i className="skin-choice-preview board jingdian"/><b>棋盘</b></button><button className={activePieceSkin === "jingdian" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: activeBoardSkin, pieceSkin: "jingdian" })} onClick={() => void updateBoardSkin({ boardSkin: desktopPreferences.boardSkin, pieceSkin: "jingdian" })}><i className="skin-choice-preview piece jingdian"/><b>棋子</b></button></div><div className="skin-menu-featured"><span>霓虹星河</span><button className={activeBoardSkin === "xinghe" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: "xinghe", pieceSkin: activePieceSkin })} onClick={() => void updateBoardSkin({ boardSkin: "xinghe", pieceSkin: desktopPreferences.pieceSkin })}><i className="skin-choice-preview board xinghe"/><b>棋盘</b></button><button className={activePieceSkin === "xinghe" ? "active" : ""} onPointerEnter={() => setSkinHoverPreview({ boardSkin: activeBoardSkin, pieceSkin: "xinghe" })} onClick={() => void updateBoardSkin({ boardSkin: desktopPreferences.boardSkin, pieceSkin: "xinghe" })}><i className="skin-choice-preview piece xinghe">将</i><b>棋子</b></button></div></>}
            <button className="skin-shop-launch" onClick={() => { setSkinMenuOpen(false); setSkinShopOpen(true); }}>打开装扮坊</button>
          </section>}
        </div>
        <button className="tool-button" title={themeToggleTitle} aria-label={themeToggleTitle} onClick={() => void toggleColorTheme()}>{effectiveColorTheme === "dark" ? <Moon size={16}/> : <Sun size={16}/>}</button>
        {chessPlatform.kind === "desktop" && workspaceMode === "research" && <button
          className={`mode-tool link-session-shortcut ${linkSessionStatus.state !== "stopped" ? "active" : ""}`}
          disabled={!linkPlatformSupported}
          title={!linkPlatformSupported ? "当前平台未接入持续屏幕采集和外部点击；可使用截图或照片导入" : linkSessionStatus.state === "stopped" ? "打开识别与连线，启动连线识别" : `连线中：${linkSessionStateLabel(linkSessionStatus.state, linkSessionStatus.mode, linkSessionStatus.pendingExternalMove, linkPendingMoveDisplay)}，点击查看设置`}
          onClick={() => void openLinkSessionDialog()}
        ><Link size={15}/>连线</button>}
      </div>

      <main className={`workspace layout-${desktopPreferences.layoutMode} ${reviewModeOpen ? "review-mode-active" : ""} ${libraryCollapsed ? "library-collapsed" : ""} ${candidateRailCollapsed ? "candidate-rail-collapsed" : ""} ${analysisPanelCollapsed ? "analysis-panel-collapsed" : ""} ${compactDockMinimized ? "compact-dock-minimized" : ""} ${compactHasSystemPopout ? "compact-system-popout" : ""} ${desktopPreferences.layoutMode === "compact" && cloudBookCollapsed ? "compact-cloud-collapsed" : ""}`}>
        <aside className={`library-panel ${libraryCollapsed ? "collapsed" : ""} ${mobilePanel === "library" ? "mobile-visible" : ""}`}>
          <div className="pane-title">
            <strong>{libraryCollapsed ? <Library size={16}/> : "棋谱库"}</strong>
            {!libraryCollapsed && <button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={15}/></button>}
            {chessPlatform.kind === "desktop" && <button className="tool-button library-toggle" title={libraryCollapsed ? "展开棋谱库" : "收起棋谱库"} aria-label={libraryCollapsed ? "展开棋谱库" : "收起棋谱库"} onClick={() => void setLibraryVisibility(!libraryCollapsed)}>{libraryCollapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button>}
            <button className="tool-button mobile-drawer-close" title="关闭侧栏" aria-label="关闭侧栏" onClick={() => setMobilePanel("board")}><X size={16}/></button>
          </div>
          <label className="library-search"><FolderOpen size={14}/><input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="搜索棋谱或标签" /></label>
          <div className="library-tree">
            <div className="tree-group open"><ChevronDown size={14}/><strong>研习棋谱</strong></div>
            <div className="library-filters">
              <button className={libraryFilter === "all" ? "active" : ""} onClick={() => setLibraryFilter("all")}>全部 {games.length}</button>
              <button className={libraryFilter === "favorites" ? "active" : ""} onClick={() => setLibraryFilter("favorites")}><Heart size={12}/>收藏 {games.filter((game) => game.favorite).length}</button>
              <button className={libraryFilter === "uncategorized" ? "active" : ""} onClick={() => setLibraryFilter("uncategorized")}>未分类 {games.filter((game) => !game.libraryFolder).length}</button>
            </div>
            <div className="library-folder-list">
              {libraryFolders.map((folder) => <div className="library-folder-row" key={folder.name}>
                <button className={libraryFilter === folder.name ? "active" : ""} onClick={() => setLibraryFilter(folder.name)}><FolderOpen size={12}/><span>{folder.name}</span><small>{folder.gameCount}</small></button>
                {!folder.system && <span className="library-folder-actions">
                  <button title={`重命名“${folder.name}”`} aria-label={`重命名“${folder.name}”`} onClick={() => void renameLibraryFolder(folder)}><Pencil size={12}/></button>
                  <button title={`删除“${folder.name}”`} aria-label={`删除“${folder.name}”`} onClick={() => void deleteLibraryFolder(folder)}><Trash2 size={12}/></button>
                </span>}
              </div>)}
              {chessPlatform.kind === "desktop" && <button className="library-folder-new" title="新建文件夹" onClick={() => void createLibraryFolder()}><FolderPlus size={13}/>新建文件夹</button>}
            </div>
            {visibleLibraryGames.map((game) => (
              <button key={game.id} className={`study-entry ${game.current ? "active" : ""}`} onClick={() => void openGame(game.id)}>
                {game.favorite ? <Heart size={15} fill="currentColor"/> : <BookOpen size={15}/>}
                <span><strong>{game.title}</strong><small>{game.libraryFolder ?? "未分类"}{game.tags.length ? ` · ${game.tags.join(" / ")}` : ""}</small></span>
              </button>
            ))}
          </div>
          <section className="study-meta">
            <label>棋谱名<input value={gameTitle} onChange={(event) => setGameTitle(event.target.value)} /></label>
            <label>局面备注<textarea value={gameNote} onChange={(event) => setGameNote(event.target.value)} rows={3}/></label>
            <button onClick={() => void saveGameMetadata()}><Save size={13}/>保存信息</button>
            {chessPlatform.kind === "desktop" && <>
              <div className={`mirror-status ${currentLibraryGame?.mirror?.state ?? "pending"}`}>
                <span>Finder 镜像：{currentLibraryGame?.mirror?.state === "synced" ? "已镜像" : currentLibraryGame?.mirror?.state === "failed" ? "写入失败" : currentLibraryGame?.mirror?.state === "disabled" ? "已暂停" : "待创建"}</span>
                {currentLibraryGame?.mirror?.error && <small title={currentLibraryGame.mirror.error}>{currentLibraryGame.mirror.error}</small>}
              </div>
              <div className="mirror-actions"><button title="立即更新当前棋谱的完整 PGN 镜像" onClick={() => void updateCurrentMirror()}>更新镜像</button><button title="在 Finder 中显示当前镜像文件" disabled={currentLibraryGame?.mirror?.state !== "synced"} onClick={() => void revealCurrentMirror()}>Finder 显示</button><button title="自动镜像目录设置" onClick={() => setDesktopDialog("mirrorSettings")}>镜像设置</button></div>
              <label>归档文件夹<select value={currentLibraryGame?.libraryFolder ?? ""} onChange={(event) => void saveCurrentLibrary(event.target.value || undefined)}><option value="">未分类</option>{libraryFolders.map((folder) => <option key={folder.name} value={folder.name}>{folder.name}</option>)}</select></label>
              <label>标签（逗号分隔）<input value={libraryTagsInput} onChange={(event) => setLibraryTagsInput(event.target.value)} onBlur={() => { const tags = libraryTagsInput.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean); void saveCurrentLibrary(currentLibraryGame?.libraryFolder, currentLibraryGame?.favorite, tags); }} /></label>
              <button className={currentLibraryGame?.favorite ? "active" : ""} onClick={() => void saveCurrentLibrary(currentLibraryGame?.libraryFolder, !(currentLibraryGame?.favorite ?? false))}><Heart size={13} fill={currentLibraryGame?.favorite ? "currentColor" : "none"}/>{currentLibraryGame?.favorite ? "已收藏" : "收藏棋谱"}</button>
            </>}
            <label>当前局面<input value={board.status} readOnly /></label>
            <label>行棋方<input value={board.sideToMove} readOnly /></label>
          </section>
          {chessPlatform.kind === "web" && <section className="sync-box">
            <div className="sync-title"><Link size={14}/><strong>个人同步</strong></div>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} aria-label="同步服务地址" />
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="登录令牌" aria-label="登录令牌" />
            <button onClick={() => void synchronize()} disabled={syncBusy}>{syncBusy ? "同步中…" : "立即同步"}</button>
          </section>}
          {chessPlatform.kind === "desktop" && <section className="sync-box desktop-sync-summary">
            <div className="sync-title"><Link size={14}/><strong>个人同步</strong><span className={`sync-status ${syncAccount.status}`}>{syncAccount.status === "signedIn" ? "已登录" : syncAccount.status === "expired" ? "已过期" : syncAccount.status === "signedOut" ? "未登录" : "未绑定"}</span></div>
            <span>{syncAccount.status === "signedOut" ? `已绑定账号：${syncAccount.email}` : syncAccount.email ?? "未绑定账号"}</span>
            <small>{syncAccount.lastSyncResult ?? (syncAccount.status === "signedIn" ? "已登录，等待同步" : syncAccount.status === "signedOut" ? "登录后可同步，本地编辑不受影响" : "本地编辑不受影响")}</small>
            <div className="sync-actions">
              <button disabled={syncBusy} onClick={() => syncAccount.status === "signedIn" ? void synchronize() : setDesktopDialog(syncAccount.status === "unbound" ? "register" : "login")}>{syncBusy ? "同步中…" : syncAccount.status === "signedIn" ? "立即同步" : syncAccount.status === "expired" ? "重新登录" : syncAccount.status === "signedOut" ? "登录该账号" : "注册账号"}</button>
              {(syncAccount.status === "signedIn" || syncAccount.status === "expired") && <button className="secondary" title="退出后本地棋谱和待同步改动会保留" onClick={() => void logoutSync()}><LogOut size={13}/>退出登录</button>}
            </div>
            {syncAccount.status !== "unbound" && <button className="danger" disabled={syncBusy} onClick={() => setDesktopDialog("unbind")}>解除绑定并切换账号</button>}
          </section>}
        </aside>

        <section className={`board-section ${mobilePanel === "board" ? "mobile-visible" : ""}`}>
          <div className="board-main-stack">
          {desktopPreferences.layoutMode === "compact" && <div className="compact-board-heading">
            <span className="compact-board-title"><LayoutGrid size={15}/><strong>棋盘</strong></span>
            {isMasterLibraryGame && <span className="compact-board-master-info" title={`${manualMeta.red} vs ${manualMeta.black} · ${manualMeta.event} · ${manualMeta.date} · ${manualMeta.moveCount}手 · ${sideResultText(manualMeta.result)}`}>
              <strong><em className="red">红：{manualMeta.red}</em><i>vs</i><em className="black">黑：{manualMeta.black}</em></strong>
              <small>{manualMeta.event} · {manualMeta.date} · {manualMeta.moveCount}手 · {sideResultText(manualMeta.result)}</small>
            </span>}
            <small>{board.sideToMove}行棋 · {boardPerspectiveLabel}</small>
          </div>}
          {mobileEvaluationVisible && <section className={`mobile-evaluation-strip ${boardEvaluationScore == null ? "pending" : boardEvaluationScore < -50 ? "black" : boardEvaluationScore > 50 ? "red" : "balanced"}`} aria-label="当前局势评分条">
            <div className="mobile-evaluation-track" aria-hidden="true"><span style={{ width: `${boardEvaluationRedShare}%` } as CSSProperties}/></div>
            <strong>{boardEvaluationRailText.side}</strong><span>{boardEvaluationRailText.score}</span>
            <button type="button" title="收起局势评分条" aria-label="收起局势评分条" onClick={() => setMobileEvaluationVisible(false)}><ChevronDown size={15}/></button>
          </section>}
          <div className="board-stage">
            <div className={`board-stage-inner ${isMasterLibraryGame ? "has-master-identity" : ""}`}>
            {isMasterLibraryGame ? <section className="master-game-identity side" aria-label="当前大师棋谱信息">
              <nav aria-label="大师棋谱快捷操作">
                <button type="button" onClick={() => void openMasterManualPanel()}><BookOpen size={14}/>棋谱</button>
                <button type="button" onClick={() => void openMasterAnalysisPanel()}><Activity size={14}/>分析</button>
                <button type="button" onClick={() => void openAnalysisReportPanel()}><BarChart3 size={14}/>报告</button>
                <button type="button" onClick={() => void openReviewMode()}><ClipboardList size={14}/>复盘</button>
              </nav>
            </section> : <aside className="board-quality-rail" aria-label="当前着法质量">
              {overviewReport?.grade && overviewReport.score != null && (
                <span className={`board-quality-chip grade-${overviewReport.grade}`} title={`当前着法质量 ${overviewReport.score} 分`}>
                  <b>{overviewReport.grade}</b><span>{overviewReport.score}分</span>
                </span>
              )}
            </aside>}
            <div className="board" aria-label="中国象棋棋盘">
              <div className="board-art" />
              <MainBoardLastMoveOverlay move={mainBoardMarkerMove} reversed={boardDisplayReversed} boardSkin={displayedBoardSkin} />
              {cells.map(({ row, col }) => {
                const piece = pieceMap.get(`${row}-${col}`);
                const isSelected = selected?.row === row && selected?.col === col;
                const cellStyle = boardCellStyle({ row, col }, boardDisplayReversed, displayedBoardSkin);
                const style = {
                  "--piece-left": cellStyle.left,
                  "--piece-top": cellStyle.top,
                } as CSSProperties;
                return (
                  <button
                    key={`${row}-${col}`}
                    className={`board-square piece-${piece?.color ?? "empty"} ${candidatePreview ? "previewing" : ""} ${isSelected ? "selected" : ""}`}
                    style={style}
                    disabled={isPlaying || !board.playable || !!candidatePreview}
                    onClick={() => void selectSquare(row, col)}
                    aria-label={`${squareToIccs(row, col)}${piece ? ` ${piece.color === "red" ? "红" : "黑"}${piece.label}` : ""}`}
                  >
                    {piece && <>
                      <img src={pieceAsset(piece, displayedPieceSkin)} alt="" draggable={false} />
                      <span className="board-piece-label" aria-hidden="true">{piece.label}</span>
                    </>}
                    {isSelected && <img className="selection-mask" src={`/skins/${displayedBoardSkin}/mask2.png`} alt="" />}
                  </button>
                );
              })}
              {mainBoardMoveGradeStyle && overviewReport?.grade && overviewReport.score != null && (
                <span className="board-move-grade-floating-cell" style={mainBoardMoveGradeStyle}>
                  <span
                    className={`board-move-grade grade-${overviewReport.grade}`}
                    data-tooltip={`${overviewReport.grade} ${overviewReport.score}分 · ${formatScoreDelta(overviewReport.deltaCp)}`}
                    title={`本着质量 ${overviewReport.score} 分，等级 ${overviewReport.grade}`}
                    aria-label={`本着质量 ${overviewReport.score} 分，等级 ${overviewReport.grade}`}
                  >
                    {overviewReport.grade}
                  </span>
                </span>
              )}
              {!candidatePreview && boardArrows.length > 0 && (
                <>
                  <svg className="analysis-arrow-lines" viewBox="0 0 1120 1240" aria-hidden="true">
                  <defs>
                    {boardArrows.map((arrow) => (
                      <marker key={arrow.rank} id={`analysis-arrowhead-${arrow.rank}`} markerWidth="48" markerHeight="48" refX="40" refY="24" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 48 24 L 0 48 z" fill={arrow.color}/>
                      </marker>
                    ))}
                  </defs>
                  {boardArrows.map((arrow) => {
                    return (
                      <g key={arrow.rank} style={{ "--arrow-color": arrow.color } as CSSProperties}>
                        <path id={`analysis-arrow-flow-${arrow.rank}`} className="analysis-arrow-flow-path" d={`M ${arrow.from.x} ${arrow.from.y} L ${arrow.to.x} ${arrow.to.y}`}/>
                        <line x1={arrow.from.x} y1={arrow.from.y} x2={arrow.to.x} y2={arrow.to.y} markerEnd={`url(#analysis-arrowhead-${arrow.rank})`}/>
                        <path className="analysis-arrow-water-flow" d={`M ${arrow.from.x} ${arrow.from.y} L ${arrow.to.x} ${arrow.to.y}`}/>
                        <g className="analysis-arrow-flow-marker" aria-hidden="true">
                          <path d="M -9 -6 L -2 0 L -9 6"/>
                          <path d="M 1 -6 L 8 0 L 1 6"/>
                          <animateMotion dur={`${2.7 + arrow.rank * .25}s`} repeatCount="indefinite" rotate="auto">
                            <mpath href={`#analysis-arrow-flow-${arrow.rank}`}/>
                          </animateMotion>
                        </g>
                      </g>
                    );
                  })}
                  </svg>
                  <svg className="analysis-arrow-labels" viewBox="0 0 1120 1240" aria-hidden="true">
                    {boardArrows.map((arrow) => {
                      const labelX = arrow.from.x + (arrow.to.x - arrow.from.x) * .55;
                      const labelY = arrow.from.y + (arrow.to.y - arrow.from.y) * .55;
                      const moveLabel = "label" in arrow && arrow.label ? `${arrow.rank} ${arrow.label}` : "";
                      const labelWidth = Math.max(54, Math.min(190, 30 + moveLabel.length * 18));
                      return (
                        <g key={arrow.rank} style={{ "--arrow-color": arrow.color } as CSSProperties}>
                          {moveLabel && <title>{moveLabel}</title>}
                          <circle cx={labelX} cy={labelY} r="23"/>
                          <text x={labelX} y={labelY}>{arrow.rank}</text>
                          {moveLabel && <>
                            <rect className="arrow-hover-bg" x={labelX - labelWidth / 2} y={labelY - 66} width={labelWidth} height="36" rx="18"/>
                            <text className="arrow-hover-label" x={labelX} y={labelY - 48}>{moveLabel}</text>
                          </>}
                      </g>
                    );
                  })}
                  </svg>
                </>
              )}
            </div>
            <aside className={`board-eval-rail ${boardEvaluationScore == null ? "pending" : boardEvaluationScore < -50 ? "black" : boardEvaluationScore > 50 ? "red" : "balanced"}`} aria-label="棋盘局势评分条">
              <button className="board-eval-help" type="button" title="查看棋谱分析说明" aria-label="查看棋谱分析说明" onClick={() => setAnalysisHelpOpen(true)}>?</button>
              <div className="board-eval-track" aria-hidden="true">
                <span style={{ height: `${boardEvaluationRedShare}%` } as CSSProperties}/>
              </div>
              <div className="board-eval-label" title={boardEvaluationRailTitle}>
                {boardEvaluationBalanced
                  ? <strong className="board-eval-balance-label"><i className="red">红</i><em>均势</em><i className="black">黑</i></strong>
                  : <strong>{boardEvaluationRailText.side}</strong>}
                <span>{boardEvaluationRailText.score}</span>
              </div>
            </aside>
            </div>
          </div>
          {candidatePreview && previewStep && (
            <div className="candidate-preview-bar" style={{ "--pv-color": candidatePreview.color } as CSSProperties}>
              <div className="candidate-preview-main">
                <span className="pv-rank">{candidatePreview.rank}</span>
                <div>
                  <strong>{candidatePreview.sourceEngineName} · 候选{candidatePreview.rank}预览 {candidatePreview.step + 1}/{candidatePreview.steps.length}：{previewStep.notation}</strong>
                  <small><em className={`candidate-preview-side ${previewStep.movedBy === "红方" ? "red" : "black"}`}>{previewStep.movedBy}</em>走子 · {previewStep.status} · 首着 {candidatePreview.firstMove}</small>
                </div>
              </div>
              <div className="candidate-preview-text">
                <span>思路：{previewStepAdvice(candidatePreview, previewStep)}</span>
                <span>风险/可能性：{candidatePreview.step === 0 ? candidatePreview.possibility : candidatePreview.risk}</span>
              </div>
              <CandidatePreviewSteps activeStep={candidatePreview.step} onSelect={jumpCandidatePreview} steps={candidatePreview.steps}/>
              <div className="candidate-preview-controls" role="group" aria-label="候选推演预览控制">
                <button type="button" className="preview-prev" onClick={() => stepCandidatePreview(-1)} disabled={candidatePreview.step === 0} title="上一步"><ChevronLeft size={14}/>上一步</button>
                <button type="button" className="preview-next" onClick={() => stepCandidatePreview(1)} disabled={candidatePreview.step >= candidatePreview.steps.length - 1} title="下一步">下一步<ChevronRight size={14}/></button>
                <button type="button" className="preview-exit" onClick={exitCandidatePreview} title="退出预览"><X size={14}/>退出</button>
              </div>
            </div>
          )}
          <div className="board-statusbar">
            {candidatePreview && previewStep
              ? <span className="last-move-status">预览着法：<strong>{previewStep.movedBy}</strong> {previewStep.notation}</span>
              : lastMove && <span className="last-move-status">上一着：<strong>{lastMove.movedBy}</strong> {lastMove.notation}</span>}
            {(candidatePreview && previewStep || lastMove) && <span className="status-separator" />}
            <span className={`turn-dot ${board.sideToMove === "红方" ? "red" : "black"}`} />
            <strong>{candidatePreview && previewStep ? "手动推演中" : `${board.sideToMove}行棋`}</strong>
            <span>{candidatePreview && previewStep ? `真实棋谱未改变 · 点“下一步”继续` : board.ruleReason ?? board.status}</span>
            <span className="status-spacer" />
            <span className="board-meta">节点 {board.history.length}</span>
            <span className="board-meta">{boardPerspectiveLabel}</span>
          </div>
          {playbackControls("mobile-playback")}
          <div className={`engine-livebar ${primaryAnalysis ? "has-analysis" : "empty"}`}>
            <span>{primaryAnalysis
              ? <>深度 {primaryAnalysis.depth ?? "-"} · PV {primaryAnalysis.multipv} · 分数 {formatAnalysisScore(primaryAnalysis)} · NPS {formatNps(primaryAnalysis.nps)} · 时间 {((primaryAnalysis.timeMs ?? 0) / 1000).toFixed(1)}s{primaryMove ? ` · ${primaryMove}` : ""}</>
              : "等待局面分析"}</span>
            <strong>{searchLimitLabel}</strong>
          </div>
          <MobileStudyPanel
            analysisBusy={analysisBusy}
            analysisStale={analysisIsStale}
            analysisDisabled={!board.playable || isPlaying || reportBusy || engineSide !== "none" || engineThinking || (chessPlatform.kind === "web" && !online)}
            analysisConfigText={`MultiPV ${multipv} · ${searchLimitLabel}`}
            analysisHint={analysisError ?? mobileCloudHint}
            engineRows={compactEngineRows}
            bookRows={compactBookRows}
            bookLoading={cloudBookLoading}
            bookError={cloudBookError}
            bookSideToMove={board.sideToMove}
            manual={<MobileManualRoute
              nodes={board.manualTree ?? []}
              history={board.history}
              continuation={board.continuation}
              currentNode={board.currentNode}
              disabled={isPlaying}
              onNavigate={(nodeId) => void navigateTo(nodeId)}
              onSaveComment={saveCommentForNode}
              onDelete={(nodeId) => removeNode(nodeId, true)}
            />}
            onRunAnalysis={() => void (analysisBusy ? stopAnalysis() : runAnalysis())}
            onFocusCandidate={(row) => { clearCandidatePreviews(); setMobileArrowsEnabled(true); setMobileArrowFocus(row.iccs); }}
            onPreviewCandidate={(row) => void previewCompactEngineRow(row)}
            onPlayCandidate={(row) => void playCompactEngineRow(row)}
            onFocusBookMove={(iccs) => { setMobileArrowsEnabled(true); setMobileArrowFocus(iccs); }}
            onPlayBookMove={(iccs) => void playIccsMove(iccs)}
          />
          <div className="fen-row">
            <label>FEN</label>
            <input value={fenInput} onChange={(event) => setFenInput(event.target.value)} />
            <button onClick={() => void createGame()}>载入</button>
          </div>
          </div>
          {!reviewModeOpen && candidateLinesView("board-candidate-rail")}
        </section>

        <aside className={`analysis-panel ${reviewModeOpen ? "review-mode-panel" : ""} ${analysisPanelCollapsed && desktopPreferences.layoutMode !== "compact" ? "collapsed" : ""} ${mobilePanel === "analysis" ? "mobile-visible" : ""}`}>
          {reviewModeOpen ? <ReviewWorkspace
            board={board}
            report={reportPresentation}
            reportBusy={reportBusy}
            reportExporting={reportExporting}
            reportProgress={reportProgress}
            engineReady={!!enginePath.trim()}
            libraryFolder={currentLibraryGame?.libraryFolder}
            libraryFolders={libraryFolders}
            favorite={currentLibraryGame?.favorite ?? false}
            libraryTags={currentLibraryGame?.tags ?? []}
            flyknifePlanCount={flyknifePlans.filter((plan) => plan.sourceGameId === currentLibraryGame?.id).length}
            trainingTasks={trainingTasks.filter((task) => task.gameId === currentLibraryGame?.id)}
            trainingGenerating={dialogBusy}
            trainingGeneration={trainingGeneration}
            analysisConfig={{ reportDepth: desktopPreferences.reportDepth, multipv, threads, hashMb }}
            playbackControls={playbackControls("review-playback")}
            onClose={() => void exitReviewMode()}
            onNavigate={(nodeId) => void navigateTo(nodeId)}
            onGenerateReport={() => void generateGameReport()}
            onCancelReport={() => void cancelGameReport()}
            onExportReport={() => void exportGameReport()}
            onOpenReport={() => setReportDialogOpen(true)}
            onImport={() => void openDocument()}
            onImportScreenshot={() => void openLinkSessionDialog("imageImport")}
            onPaste={() => void pasteDocument()}
            onManualRecord={() => void createGame(startingFen)}
            onSaveLibrary={(folder, favorite, tags) => saveCurrentLibrary(folder, favorite, tags)}
            onOpenFlyknife={() => setFlyknifeOpen(true)}
            onGenerateTraining={() => generateTrainingTasks()}
            onOpenTraining={() => setDesktopDialog("training")}
            onCompleteTraining={(taskId, completed) => void completeTrainingTask(taskId, completed)}
            onStudyIssue={(nodeId) => void startCoachStudy(nodeId)}
            onStartU10={(nodeId) => void startU10Analysis(nodeId)}
          /> : <>
          {analysisPanelCollapsed && desktopPreferences.layoutMode !== "compact"
            ? <button
                className="panel-collapse-button analysis-panel-reopen"
                type="button"
                title="拖动调整位置，点击展开局面分析"
                aria-label="展开局面分析"
                style={{ top: analysisPanelReopenTop } as CSSProperties}
                onPointerDown={startAnalysisPanelReopenDrag}
                onClick={reopenAnalysisPanel}
              ><ChevronLeft size={16}/></button>
            : null}
          {(!analysisPanelCollapsed || desktopPreferences.layoutMode === "compact") && <>
            <CompactReferencePanels
              cloudEnabled={desktopPreferences.cloudBookEnabled ?? false}
              bookLoading={cloudBookLoading}
              bookError={cloudBookError}
              bookRows={compactBookRows}
              bookAuditByMove={activeBookCandidateAuditByMove}
              bookAuditState={activeBookCandidateAuditState}
              builtinBookStatus={builtinOpeningBookReferenceStatus}
              evaluationRows={compactEvaluationRows}
              evaluationLabel={evaluation?.label ?? "等待分析"}
              evaluationScore={evaluation?.scoreText ?? "--"}
              qualityText={overviewReport?.score != null ? `${overviewReport.score} ${overviewReport.grade}` : "--"}
              redShare={evaluation?.redShare}
              depthText={`${primaryAnalysis?.depth ?? "--"}`}
              timeText={primaryAnalysis?.timeMs != null ? `${(primaryAnalysis.timeMs / 1000).toFixed(1)}s` : "--"}
              collapsed={desktopPreferences.layoutMode === "compact" && cloudBookCollapsed}
              evaluationCollapsed={desktopPreferences.evaluationCollapsed}
              onOpenSettings={() => chessPlatform.kind === "desktop" ? setDesktopDialog("engine") : setNotice("Web 版使用云端引擎，无本地引擎设置")}
              onToggleCollapsed={() => setCloudBookCollapsed((collapsed) => !collapsed)}
              onToggleEvaluationCollapsed={() => void setEvaluationVisibility(!desktopPreferences.evaluationCollapsed)}
              onPopOut={chessPlatform.kind === "desktop" ? () => void openCompactFloatingPanel("cloud") : undefined}
              onAuditBookCandidates={() => void auditBookCandidatesWithPikafish()}
              onPlayBookMove={(iccs) => void playIccsMove(iccs)}
              onPlayEvaluationMove={(iccs) => void playIccsMove(iccs, analysisFen ?? board.fen)}
            />
            <div className="standard-analysis-layout">
          <div className="position-overview" aria-label="局势概览">
            <div className="overview-heading"><span><TrendingUp size={14}/>局势概览</span><strong>{evaluation?.label ?? "等待分析"}</strong><button className="panel-collapse-button" title="收起局面分析" aria-label="收起局面分析" onClick={() => void setAnalysisPanelVisibility(true)}><ChevronRight size={16}/></button></div>
            <div className="overview-metrics">
              <div><small>局面分</small><strong>{evaluation?.scoreText ?? "--"}</strong></div>
              <div><small>质量分</small><strong className={overviewReport?.grade ? `overview-quality grade-${overviewReport.grade}` : "overview-quality"}>{overviewReport?.score != null ? `${overviewReport.score} ${overviewReport.grade}` : "--"}</strong></div>
              <div><small>红方</small><strong>{evaluation ? `${evaluation.redShare.toFixed(0)}%` : "--"}</strong></div>
              <div><small>黑方</small><strong>{evaluation ? `${(100 - evaluation.redShare).toFixed(0)}%` : "--"}</strong></div>
              <div><small>深度</small><strong>{primaryAnalysis?.depth ?? "--"}</strong></div>
              <div><small>耗时</small><strong>{primaryAnalysis?.timeMs != null ? `${(primaryAnalysis.timeMs / 1000).toFixed(1)}s` : "--"}</strong></div>
            </div>
            <div className={`overview-balance ${professionalEvaluationTone}`} aria-label={evaluation ? `当前局势：${evaluation.label}` : "等待局势分析"}><i style={{ width: `${evaluation?.redShare ?? 50}%` } as CSSProperties}/></div>
          </div>
          <WorkspaceTabs active={workspacePanel} onChange={selectWorkspacePanel}/>

          {workspacePanel === "analysis" && <div id="workspace-panel-analysis" className="workspace-content analysis-workspace" role="tabpanel" aria-labelledby="workspace-tab-analysis">
          <section className="engine-control">
            <div className="engine-heading">
              <div title={currentEngineTitle}><Activity size={16}/><strong>{currentEngineVersionLabel}</strong></div>
              <div className="engine-heading-actions">
                <label className="auto-analysis-toggle" title="每次落子或切换棋谱节点后自动分析">
                  <input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)}/>
                  <span aria-hidden="true"/><strong>自动</strong>
                </label>
                <span className={`engine-state ${analysisBusy ? "running" : ""}`}>{analysisBusy ? "分析中" : chessPlatform.kind === "web" ? online ? "在线" : "离线" : enginePath ? "就绪" : "未配置"}</span>
              </div>
            </div>
            {chessPlatform.kind === "desktop" && <>
              <div className="engine-play-row">
                <div className="engine-side-buttons" role="group" aria-label="人机对弈引擎执方">
                  <button className={engineSide === "red" ? "active red" : ""} onClick={() => toggleEngineSide("red")}><Bot size={12}/>执红</button>
                  <button className={engineSide === "black" ? "active black" : ""} onClick={() => toggleEngineSide("black")}><Bot size={12}/>执黑</button>
                </div>
                <label><span>每步</span><input type="number" min={100} max={30000} step={100} value={moveTimeMs} onChange={(event) => setMoveTimeMs(Number(event.target.value))}/><small>ms</small></label>
                <button className="move-now" title={engineMoveNowTitle} disabled={!engineThinking && !engineMoveNowAvailable} onClick={() => void moveNow()}><Zap size={12}/>立即</button>
              </div>
              {engineSide !== "none" && <div className="engine-play-status"><span className={engineThinking ? "thinking" : engineStarting ? "starting" : ""}/><strong>人机对弈</strong><small>{currentEngineVersionLabel} 执{engineSide === "red" ? "红" : "黑"}{engineStarting ? " · 启动中" : engineThinking ? " · 思考中" : ponderMove ? ` · 预测 ${ponderMove}` : engineMoveNowAvailable ? " · 轮到引擎，可立即出招" : " · 等待你走"}</small></div>}
              <button className="engine-config-summary" title={currentEngineTitle} onClick={() => setDesktopDialog("engine")}>
                <Settings2 size={14}/><span>{currentEngineVersionLabel}</span><small>{threads} 线程 · Hash {hashMb} MB · MultiPV {multipv} · {ruleModeLabel(desktopPreferences.ruleMode)}{currentEngineHashLabel ? ` · 引擎 ${currentEngineHashLabel}` : ""}{currentNnueLabel ? ` · ${currentNnueLabel}` : ""}{currentNnueHashLabel ? ` · ${currentNnueHashLabel}` : ""}</small>
              </button>
              {engineProfiles.length > 0 && <div className="engine-profile-select"><label><span>当前引擎</span><select value={desktopPreferences.activeEngineId ?? ""} onChange={(event) => void selectEngineProfile(event.target.value)}><option value="" disabled>选择已添加的引擎</option>{engineProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.protocol.toUpperCase()}</option>)}</select></label><button title="删除当前引擎档案" onClick={() => void removeEngineProfile()}><Trash2 size={13}/></button></div>}
            </>}
            {chessPlatform.kind === "web" && <div className="web-engine-source"><span>{serverUrl}</span><strong>MultiPV {multipv}</strong></div>}
            <div className="engine-run-row">
              <div className={`search-modes ${chessPlatform.kind === "web" ? "web-modes" : ""}`} role="group" aria-label="搜索模式">
                <button className={searchMode === "time" ? "active" : ""} onClick={() => { setSearchMode("time"); setSearchValue(1500); }}>时间</button>
                <button className={searchMode === "depth" ? "active" : ""} onClick={() => { setSearchMode("depth"); setSearchValue(18); }}>深度</button>
                {chessPlatform.kind === "desktop" && <button className={searchMode === "nodes" ? "active" : ""} onClick={() => { setSearchMode("nodes"); setSearchValue(250000); }}>节点</button>}
                {chessPlatform.kind === "desktop" && <button className={searchMode === "infinite" ? "active" : ""} onClick={() => setSearchMode("infinite")}>持续</button>}
                <input type="number" aria-label="搜索限制" disabled={searchMode === "infinite"} min={searchMode === "depth" ? 1 : searchMode === "nodes" ? 1000 : 100} max={searchMode === "depth" ? 100 : searchMode === "nodes" ? 100000000 : 30000} value={searchValue} onChange={(event) => setSearchValue(Number(event.target.value))}/>
              </div>
              {analysisBusy
                ? <button className="analysis-action stop" onClick={() => void stopAnalysis()} title="停止分析"><Square size={13}/><span>停止</span></button>
                : <button className="analysis-action" disabled={!board.playable || isPlaying} onClick={() => void runAnalysis()} title="分析当前局面"><Play size={14}/><span>分析</span></button>}
            </div>
            <button className="force-alternative" disabled={analysisBusy || !primaryAnalysis?.pv[0] || !board.playable} onClick={() => void runAnalysis(false, primaryAnalysis?.pv[0])}><GitFork size={12}/>强制变招：排除当前第一候选并重搜</button>
          </section>

          <section className="live-coach-advice" aria-label="AI 私教建议">
            <header>
              <div><strong>{liveCoachAdvice.title}</strong><small>{liveCoachAdvice.status}</small></div>
              <button disabled={analysisBusy || !board.playable || isPlaying} onClick={() => void runAnalysis()}><Zap size={12}/>获取候选</button>
            </header>
            <ul>{liveCoachAdvice.suggestions.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{liveCoachAdvice.nextAction}</p>
          </section>

          </div>}

          {workspacePanel !== "analysis" && <section className="workspace-content review-workspace">
            {workspacePanel === "moves" && <div id="workspace-panel-moves" className="moves-workspace" role="tabpanel" aria-labelledby="workspace-tab-moves">
            {playbackControls("desktop-playback")}
            <div className="move-review-pane tree-review-pane">
              {manualReviewContent("棋谱着法")}
              {branchMapControls()}
              {board.currentNode && (
                <div className="node-editor">
                  <input disabled={isPlaying} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="当前着法注释" />
                  <button className="node-editor-action" disabled={isPlaying} title="保存注释" onClick={() => void saveComment()}><Save size={14}/><span>保存</span></button>
                  <button className="node-editor-action mainline" disabled={isPlaying} title="将当前着法设为主线" onClick={() => void makeMainline(board.currentNode!)}><ListStart size={14}/><span>设为主线</span></button>
                  <button className="node-editor-action danger" disabled={isPlaying} title="删除当前分支及其所有后续着法" onClick={() => void removeNode(board.currentNode!)}><Trash2 size={14}/><span>删除分支</span></button>
                </div>
              )}
            </div></div>}
            {workspacePanel === "theory" && <div id="workspace-panel-theory" className="review-empty-or-content" role="tabpanel" aria-labelledby="workspace-tab-theory">
              <TheoryLibraryView library={theoryLibrary} busy={theoryLibraryBusy} error={theoryLibraryError} onScan={() => void scanTheoryLibrary()} onCreateCard={(card) => void createTheoryCard(card)} onReviewCard={(card) => void reviewTheoryCard(card)} onFeedbackCard={(card, verdict) => void saveTheoryFeedback(card, verdict)}/>
            </div>}
            {workspacePanel === "trend" && <div id="workspace-panel-trend" className="review-empty-or-content trend-review" role="tabpanel" aria-labelledby="workspace-tab-trend">
              {evaluationTrend.length === 0
                ? <div className="empty-review"><BarChart3 size={24}/><strong>暂无局势曲线</strong><span>分析棋谱节点后，这里会按红方视角显示历史分数</span></div>
                : <>
                  <div className="trend-legend"><span>红方优势</span><strong>{evaluation?.scoreText}</strong><span>黑方优势</span></div>
                  <svg
                    className="trend-chart-large"
                    viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
                    preserveAspectRatio="none"
                    role="group"
                    aria-label="可拖动的历史局面分数趋势"
                    tabIndex={0}
                    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateTrendCursor(event); }}
                    onPointerMove={(event) => { if (event.buttons) updateTrendCursor(event); }}
                    onPointerUp={() => releaseTrendCursor()}
                    onKeyDown={trendKeyDown}
                  >
                    <rect className="trend-equal-band" x={trendChart.left} y={trendChart.middle - 4} width={trendChart.right - trendChart.left} height="8"/>
                    <line className="trend-grid top" x1={trendChart.left} y1={trendChart.top} x2={trendChart.right} y2={trendChart.top}/>
                    <line className="trend-grid upper" x1={trendChart.left} y1="54" x2={trendChart.right} y2="54"/>
                    <line className="trend-grid middle" x1={trendChart.left} y1={trendChart.middle} x2={trendChart.right} y2={trendChart.middle}/>
                    <line className="trend-grid lower" x1={trendChart.left} y1="126" x2={trendChart.right} y2="126"/>
                    <line className="trend-grid bottom" x1={trendChart.left} y1={trendChart.bottom} x2={trendChart.right} y2={trendChart.bottom}/>
                    <text className="trend-scale-label" x="2" y={trendChart.top + 3}>胜势</text>
                    <text className="trend-scale-label" x="2" y="57">+100</text>
                    <text className="trend-scale-label" x="2" y={trendChart.middle + 3}>均势</text>
                    <text className="trend-scale-label" x="2" y="129">-100</text>
                    <text className="trend-scale-label" x="2" y={trendChart.bottom + 3}>胜势</text>
                    {trendSegments.map((segment, index) => <line key={index} className={`trend-segment ${segment.side}`} x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y}/>)}
                    {evaluationTrend.map((point, index) => {
                      const turn = trendTurnsByNode.get(point.nodeId);
                      return (
                      <circle
                        className={`${point.nodeId === board.currentNode ? "current" : ""} ${turn ? `turning ${turn.severity}` : ""}`}
                        key={`${point.label}-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={point.nodeId === board.currentNode ? 5 : 3.5}
                        tabIndex={point.nodeId ? 0 : undefined}
                        role={point.nodeId ? "button" : undefined}
                        aria-label={point.nodeId ? `${point.label}，红方视角 ${formatRedScore(point.scoreCp)}，点击定位` : undefined}
                        onClick={() => point.nodeId && void navigateTo(point.nodeId)}
                        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && point.nodeId) void navigateTo(point.nodeId); }}
                      ><title>{point.label}：{formatRedScore(point.scoreCp)}{turn ? `，波动 ${turn.deltaCp > 0 ? "+" : ""}${Math.round(turn.deltaCp)}` : ""}</title></circle>
                    )})}
                    {visibleTrendPoint && <>
                      <line className="trend-current-line" x1={visibleTrendPoint.x} y1={trendChart.top - 6} x2={visibleTrendPoint.x} y2={trendChart.bottom + 6}/>
                      <circle className="trend-current-halo" cx={visibleTrendPoint.x} cy={visibleTrendPoint.y} r="7"/>
                      <circle className="trend-current-node" cx={visibleTrendPoint.x} cy={visibleTrendPoint.y} r="3.5"/>
                      <g className={`trend-marker-label ${visibleTrendPoint.scoreCp >= 0 ? "red" : "black"}`} transform={`translate(${trendMarkerX} ${trendMarkerY})`}>
                        <rect width="84" height="14" rx="3"/>
                        <text x="4" y="10">{trendMarkerText}</text>
                      </g>
                    </>}
                  </svg>
                  <div className="trend-axis"><span>红方优势</span><span>{visibleTrendPoint ? `${visibleTrendPoint.label} · ${formatRedScore(visibleTrendPoint.scoreCp)}${visibleTrendDelta != null ? ` · 变化 ${formatRedScore(visibleTrendDelta)}` : ""}` : "拖动趋势线，松开定位"}</span><span>第 {board.history.length} 着</span></div>
                  {trendTurns.length > 0 && <section className="trend-turning-list"><header><strong>关键转折</strong><span>分差变化 ≥ 120</span></header>{trendTurns.map((turn) => <button key={turn.nodeId ?? turn.label} onClick={() => turn.nodeId && void navigateTo(turn.nodeId)}><span className={turn.severity}/><strong>{turn.label}</strong><small>{turn.deltaCp > 0 ? "红方" : "黑方"}获益 {Math.abs(Math.round(turn.deltaCp))}</small></button>)}</section>}
                </>}
            </div>}
            {workspacePanel === "summary" && <div id="workspace-panel-summary" className="review-empty-or-content retry-review" role="tabpanel" aria-labelledby="workspace-tab-summary">
              {reports.length === 0
                ? <div className="empty-review"><RefreshCw size={24}/><strong>暂无重试题</strong><span>先生成整局报告，系统会把差招、错招和漏杀整理到这里</span></div>
                : retryReports.length === 0
                  ? <div className="empty-review"><RefreshCw size={24}/><strong>本局没有明显重试项</strong><span>当前分析深度下没有发现差招、错招或漏杀，可到“报告”查看完整逐步评分</span></div>
                  : <div className="retry-board">
                    {([
                      ["red", "红方错误", retryReportsBySide.red, manualMeta.red],
                      ["black", "黑方错误", retryReportsBySide.black, manualMeta.black],
                    ] as const).map(([side, title, items, player]) => (
                      <section className={`retry-column ${side}`} key={side}>
                        <header><strong>{title}</strong><span>{player} · {items.length} 个</span></header>
                        {items.length === 0
                          ? <p>暂无明显错误。</p>
                          : items.map((report) => {
                            const feedback = report.grade ? moveQualityFeedback(report.grade, report.missedMate) : undefined;
                            const reportPosition = reportPositionByNode.get(report.move.id);
                            const bestNotation = reportPosition?.before?.bestNotation;
                            const recommendationDepth = reportPosition?.before?.depth ?? gameReport?.analysisDepth ?? desktopPreferences.reportDepth;
                            return <button
                              className={`retry-row ${report.grade ? `grade-${report.grade}` : ""} ${report.missedMate ? "missed-mate" : ""} ${board.currentNode === report.move.id ? "active" : ""}`}
                              key={report.move.id}
                              onClick={() => void navigateTo(report.move.id)}
                            >
                              <span>{report.index + 1}.</span>
                              <strong>{report.move.notation}</strong>
                              <em>{report.missedMate ? "漏杀" : report.grade ?? "题"}</em>
                              <small>{feedback?.hint ?? "需要复盘"} · {formatScoreDelta(report.deltaCp)}{bestNotation ? ` · 深度${recommendationDepth}建议 ${bestNotation}` : ""}</small>
                            </button>
                          })}
                      </section>
                    ))}
                  </div>}
              <p className="report-note">点击任一重试项会跳到原棋谱节点；可在棋盘上重算候选、添加变招，或切到“报告”查看完整解释。</p>
            </div>}
            {workspacePanel === "report" && <div id="workspace-panel-report" className="review-empty-or-content game-report" role="tabpanel" aria-labelledby="workspace-tab-report">
              <header className="game-report-actions">
                <div><strong>整局分析报告</strong><small>{gameReport ? new Date(gameReport.generatedAt).toLocaleString() : "分析当前选中线路"}</small></div>
                <nav aria-label="整局报告操作">
                  {reportPresentation && <button title="放大查看报告" disabled={reportBusy} onClick={() => setReportDialogOpen(true)}><Maximize2 size={13}/>放大</button>}
                  {reportPresentation && <button title="导出 PDF 报告" disabled={reportBusy || reportExporting} onClick={() => void exportGameReport()}><Download size={13}/>{reportExporting ? "导出中" : "PDF"}</button>}
                  {reportBusy
                    ? <button className="danger" onClick={() => void cancelGameReport()}><Square size={13}/>取消</button>
                    : <button disabled={!enginePath.trim()} onClick={() => void generateGameReport()}><Activity size={13}/>{gameReport ? "重新分析" : "生成报告"}</button>}
                </nav>
              </header>
              {reportPresentation && <section className="master-report-scorecard" aria-label="双方分析评分">
                <article className="red">
                  <header><strong>{manualMeta.red}</strong><span>红方</span></header>
                  <b>{scoreDisplay(reportPresentation.red.overall)}</b>
                  <small>开局 {scoreDisplay(reportPresentation.red.phases.opening)} · 中局 {scoreDisplay(reportPresentation.red.phases.middle)} · 残局 {scoreDisplay(reportPresentation.red.phases.endgame)}</small>
                  <p><button type="button" onClick={() => selectWorkspacePanel("summary")}>{reportPresentation.red.counts.poor + reportPresentation.red.counts.error} 个失误</button><em>{reportPresentation.red.counts.missedMate} 个漏杀</em></p>
                </article>
                <div className="master-report-result">
                  <strong>{sideResultText(manualMeta.result)}</strong>
                  <small>{manualMeta.event}</small>
                  <span>{manualMeta.date}</span>
                </div>
                <article className="black">
                  <header><strong>{manualMeta.black}</strong><span>黑方</span></header>
                  <b>{scoreDisplay(reportPresentation.black.overall)}</b>
                  <small>开局 {scoreDisplay(reportPresentation.black.phases.opening)} · 中局 {scoreDisplay(reportPresentation.black.phases.middle)} · 残局 {scoreDisplay(reportPresentation.black.phases.endgame)}</small>
                  <p><button type="button" onClick={() => selectWorkspacePanel("summary")}>{reportPresentation.black.counts.poor + reportPresentation.black.counts.error} 个失误</button><em>{reportPresentation.black.counts.missedMate} 个漏杀</em></p>
                </article>
              </section>}
              {reportBusy && <div className="report-progress" aria-live="polite">
                <div><span>正在分析第 {Math.min((reportProgress?.completed ?? 0) + 1, reportProgress?.total ?? 1)} 个局面{reportProgress?.currentDepth ? ` · 深度 ${reportProgress.currentDepth}/${reportProgress.targetDepth ?? desktopPreferences.reportDepth}` : ` · 目标深度 ${reportProgress?.targetDepth ?? desktopPreferences.reportDepth}`}</span><strong>{reportProgress?.completed ?? 0}/{reportProgress?.total ?? "--"}</strong></div>
                <progress max={Math.max(1, reportProgress?.total ?? 1)} value={reportProgress?.completed ?? 0}/>
                <small>已用 {((reportProgress?.elapsedMs ?? 0) / 1000).toFixed(1)} 秒 · 缓存 {reportProgress?.cached ?? 0} 个{reportProgress?.estimatedRemainingMs ? ` · 预计剩余 ${(reportProgress.estimatedRemainingMs / 1000).toFixed(0)} 秒` : ""}</small>
              </div>}
              {!gameReport || !reportPresentation
                ? !reportBusy && <div className="empty-review"><ClipboardList size={26}/><strong>尚未生成整局报告</strong><span>从根局面到当前节点，再沿主线逐局面调用 Pikafish 分析</span></div>
                : <GameReportView
                  report={reportPresentation}
                  currentNode={board.currentNode}
                  onNavigate={(nodeId) => void navigateTo(nodeId)}
                  onStudy={(nodeId) => void startCoachStudy(nodeId)}
                />}
            </div>}
          </section>}
          </div>
          </>}
          </>}
        </aside>
      </main>
      {skinShopOpen && (
        <SkinShopDialog preferences={desktopPreferences} signedIn={syncAccount.status === "signedIn"} onClose={() => { setSkinHoverPreview(undefined); setSkinShopOpen(false); }} onPreview={setSkinHoverPreview} onEquip={(patch) => void updateBoardSkin(patch)}/>
      )}
      {chessPlatform.kind === "desktop" && desktopPreferences.layoutMode !== "compact" && (desktopPreferences.cloudBookEnabled || !!board.xqbCandidates?.length || desktopPreferences.builtinOpeningBookEnabled) && cloudBookVisible && <aside
        className={`cloud-book-float ${cloudBookCollapsed ? "collapsed" : ""}`}
        aria-label="开局库候选"
        style={{ ...(cloudBookPosition ? { ...cloudBookPosition, right: "auto", bottom: "auto" } : {}), height: cloudBookCollapsed ? undefined : cloudBookHeight } as CSSProperties}
      >
        <div className="cloud-book-float-header" onPointerDown={startCloudBookDrag} onPointerMove={moveCloudBookDrag} onPointerUp={stopCloudBookDrag}>
          <span><GripVertical size={15}/><BookOpen size={15}/><strong>开局库候选</strong></span>
          <small>{cloudBookLoading ? "查询中…" : cloudBookError ?? `${compactBookRows.length} 个候选`}</small>
          <button type="button" title="用 Pikafish 验证开局库候选" aria-label="Pikafish 验证开局库候选" disabled={activeBookCandidateAuditState.status === "running"} onPointerDown={(event) => event.stopPropagation()} onClick={() => void auditBookCandidatesWithPikafish()}><Activity size={16}/></button>
          <button type="button" title="上一步（只浏览，不删除棋谱）" aria-label="上一步（只浏览，不删除棋谱）" disabled={!board.currentNode} onPointerDown={(event) => event.stopPropagation()} onClick={() => void goPrevious()}><ChevronLeft size={16}/></button>
          <button type="button" title="下一步" aria-label="下一步" disabled={!preferredContinuation(board)} onPointerDown={(event) => event.stopPropagation()} onClick={() => void goNext()}><ChevronRight size={16}/></button>
          <button type="button" title={cloudBookCollapsed ? "展开云库" : "折叠云库"} aria-label={cloudBookCollapsed ? "展开云库" : "折叠云库"} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCloudBookCollapsed((collapsed) => !collapsed)}><ChevronDown size={16}/></button>
          <button type="button" title="关闭云库面板" aria-label="关闭云库面板" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCloudBookVisible(false)}><X size={16}/></button>
        </div>
        {!cloudBookCollapsed && <div className="xqb-candidates cloud-book-candidate-list">
          {activeBookCandidateAuditState.status !== "idle" && <p className={`book-audit-status ${activeBookCandidateAuditState.status}`}>{activeBookCandidateAuditState.message}</p>}
          {compactBookRows.map((candidate) => {
            const audit = activeBookCandidateAuditByMove[candidate.iccs];
            const auditText = auditResultText(audit);
            return <button key={candidate.id} onClick={() => void playIccsMove(candidate.iccs)} title={[candidate.notation, candidate.scoreText, candidate.advantageText, audit?.note, candidate.winRateText === "--" ? undefined : `胜率 ${candidate.winRateText}`, candidate.detail, candidate.source].filter(Boolean).join(" · ")}>
            <strong>{candidate.notation}</strong><span className={audit ? `cloud-book-audit book-audit-${audit.status}` : ""}>{auditText ?? candidate.scoreText}</span>
            {candidate.distribution ? <span className="xqb-distribution" aria-label={`胜 ${candidate.distribution.redWin}% ，和 ${candidate.distribution.draw}% ，负 ${candidate.distribution.blackWin}%`}><i className="red" style={{ width: `${candidate.distribution.redWin}%` }}>{candidate.distribution.redWin}%</i><i className="draw" style={{ width: `${candidate.distribution.draw}%` }}>{candidate.distribution.draw}%</i><i className="black" style={{ width: `${candidate.distribution.blackWin}%` }}>{candidate.distribution.blackWin}%</i></span> : <small>{candidate.winRateText === "--" ? "云库候选" : `胜率 ${candidate.winRateText}`}</small>}
            <small>{auditText ? `${candidate.scoreText} · ` : ""}{candidate.advantageText ? `${candidate.advantageText} · ` : ""}{candidate.sampleCount?.toLocaleString() ?? "云库"}{candidate.detail ? ` · ${candidate.detail}` : ` · ${candidate.source}`}</small>
          </button>;
          })}
          {!cloudBookLoading && compactBookRows.length === 0 && <p className="cloud-book-status">{cloudBookError ? "本局面暂时无法从云库读取候选" : activeBookCandidateAuditState.status === "error" ? activeBookCandidateAuditState.message : desktopPreferences.builtinOpeningBookEnabled ? "内嵌库待 vkey 验证，暂不显示推荐" : "当前局面暂无开局库候选"}</p>}
        </div>}
        {!cloudBookCollapsed && (
          <div className="cloud-book-resize-handle" title="上下拖动调整云库面板高度" onPointerDown={startCloudBookResize} onPointerMove={moveCloudBookResize} onPointerUp={stopCloudBookResize}/>
        )}
      </aside>}
      {chessPlatform.kind === "desktop" && desktopPreferences.layoutMode !== "compact" && (desktopPreferences.cloudBookEnabled || !!board.xqbCandidates?.length || desktopPreferences.builtinOpeningBookEnabled) && !cloudBookVisible && <button className="cloud-book-reopen" title="打开开局库面板" onClick={() => setCloudBookVisible(true)}><BookOpen size={15}/>打开开局库</button>}
      {reportDialogOpen && reportPresentation && <GameReportDialog
        report={reportPresentation}
        currentNode={board.currentNode}
        exporting={reportExporting}
        onClose={() => setReportDialogOpen(false)}
        onExport={() => void exportGameReport()}
        onRegenerate={() => { setReportDialogOpen(false); void generateGameReport(); }}
        onNavigate={(nodeId) => void navigateTo(nodeId)}
        onStudy={(nodeId) => void startCoachStudy(nodeId)}
      />}
      {masterAnalysisDialogOpen && reportPresentation && <div className="master-analysis-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMasterAnalysisDialogOpen(false); }}>
        <section className="master-analysis-dialog" role="dialog" aria-modal="true" aria-label={`${reportPresentation.title}整局评分分析`}>
          <header>
            <div>
              <strong>{manualMeta.red} vs {manualMeta.black}</strong>
              <small>{manualMeta.event} · {manualMeta.date} · {manualMeta.moveCount}手 · {sideResultText(manualMeta.result)}</small>
            </div>
            <button className="icon-button" type="button" aria-label="关闭分析" onClick={() => setMasterAnalysisDialogOpen(false)}><X size={17}/></button>
          </header>
          <nav className="master-analysis-tabs" aria-label="复盘分析分页">
            <button type="button" className="muted" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("trend"); }}><BarChart3 size={15}/>局势图</button>
            <button type="button" className="active"><Activity size={15}/>分析</button>
            <button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); setReportDialogOpen(true); }}><ClipboardList size={15}/>报告</button>
            <button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("summary"); }}><RefreshCw size={15}/>重试</button>
          </nav>
          <div className="master-analysis-scoreline">
            <article className="red">
              <span><em>红方</em><strong>{manualMeta.red}</strong></span>
              <b>{scoreDisplay(reportPresentation.red.overall)}</b>
              <small>综合表现</small>
            </article>
            <div className="master-analysis-result">
              <strong>{sideResultText(manualMeta.result)}</strong>
              <span>整局评分</span>
            </div>
            <article className="black">
              <span><em>黑方</em><strong>{manualMeta.black}</strong></span>
              <b>{scoreDisplay(reportPresentation.black.overall)}</b>
              <small>综合表现</small>
            </article>
          </div>
          <section className="master-analysis-phase-table" aria-label="阶段评分">
            <div><span>{scoreDisplay(reportPresentation.red.phases.opening)}</span><strong>开局评分</strong><span>{scoreDisplay(reportPresentation.black.phases.opening)}</span></div>
            <div><span>{scoreDisplay(reportPresentation.red.phases.middle)}</span><strong>中局评分</strong><span>{scoreDisplay(reportPresentation.black.phases.middle)}</span></div>
            <div><span>{scoreDisplay(reportPresentation.red.phases.endgame)}</span><strong>残局评分</strong><span>{scoreDisplay(reportPresentation.black.phases.endgame)}</span></div>
            <div><button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("summary"); }}>{reportPresentation.red.counts.missedMate}个</button><strong>漏杀</strong><button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("summary"); }}>{reportPresentation.black.counts.missedMate}个</button></div>
            <div><button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("summary"); }}>{reportPresentation.red.counts.poor + reportPresentation.red.counts.error}个</button><strong>失误摘要</strong><button type="button" onClick={() => { setMasterAnalysisDialogOpen(false); selectWorkspacePanel("summary"); }}>{reportPresentation.black.counts.poor + reportPresentation.black.counts.error}个</button></div>
          </section>
          <p className="master-analysis-footnote">不同引擎版本、线程和深度会有轻微波动；当前使用 {reportPresentation.engineLabel}，深度 {reportPresentation.analysisDepth ?? "--"}。</p>
        </section>
      </div>}
      {manualLineDialogOpen && <ManualLineDialog
        bestMoveHint={bestMoveHint}
        currentLabel={board.history.at(-1)?.notation}
        formatScore={formatMoveScore}
        history={board.history}
        onClose={() => setManualLineDialogOpen(false)}
        onExportLine={(contents) => exportCurrentLineText(contents)}
        onStartBestMovePractice={startBestMovePractice}
        currentMove={board.history.at(-1)}
        onToggleCurrentMoveMarker={toggleCurrentReviewMarker}
        qualityByMoveId={reportByMoveId}
        strategyInsight={strategyInsight}
      />}
      {engineDivergenceDialog()}
      {analysisHelpOpen && (
        <div className="analysis-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAnalysisHelpOpen(false); }}>
          <section className="analysis-help-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-help-title">
            <header>
              <button className="tool-button" title="关闭" aria-label="关闭说明" onClick={() => setAnalysisHelpOpen(false)}><X size={18}/></button>
              <strong id="analysis-help-title">棋谱分析</strong>
            </header>
            <div className="analysis-help-scroll">
              <p>棋谱分析是一个智能复盘功能，棋力相当于强大师水平（AI=20 层）。它会结合内置经典开局“官着”信息，并调用 Pikafish 自动算出每步招法优劣和评分。分析需要一定时间，耗时取决于本机性能、线程、Hash 和设定深度。</p>
              <h3>局势图</h3>
              <p>当棋谱分析完成后，可以通过局势图快速找到本局局势转折点，定位哪一步出现明显问题。</p>
              <p>曲线在 0 上方表示红方占优，局面分 &gt; 0；曲线在 0 下方表示黑方占优，局面分 &lt; 0。局面分是引擎对当前局面的综合判断，不等同于真实子力；标签按优势程度显示，50 分以内可能有计算误差，可忽略不计。</p>
              <h3>分析</h3>
              <p>当你不明白实战着为什么差、AI 推荐为什么好时，可以切换到“分析”页查看后续招法推演。棋盘上的绿色/彩色箭头代表当前 MultiPV 候选线路，编号与右侧候选线路一致。</p>
              <h3>报告</h3>
              <p>报告会根据每步表现用 100 分制打分。100 分表示在当前分析深度下几乎没有局面损失，可视作“特级大师级准确招法”的本应用定义。</p>
              <p>评价图标标准：优 ≥ 80，良 ≥ 60，中 ≥ 40，差 ≥ 20，错 &lt; 20。评分不是棋力绝对值，而是本局每一步相对引擎推荐造成的局面损失；遇到更强对手，失误可能更多，评分也会偏低。</p>
              <p>官着表示开局阶段人类历史积累下来的经典布局招法，只作标记与开局说明，不会强行提高该步质量分。</p>
              <p>失误表示整局中评分较低的着法数量；漏杀表示有绝杀机会但实战走漏的次数。残局判断按双方大子（车、马、炮）数量和总子力估算，对局未进入残局时不会显示残局评分。</p>
              <h3>自我分析与重试</h3>
              <p>如果想研究某个局面，可以从问题着法进入推演，重新尝试其他走法；应用会尽量复用已有分析缓存，让你专注比较不同变招的后续演变。</p>
            </div>
            <footer><button onClick={() => setAnalysisHelpOpen(false)}>知道了</button></footer>
          </section>
        </div>
      )}
      {(mobilePanel === "library" || mobilePanel === "settings") && <button className="mobile-drawer-backdrop" aria-label="关闭侧栏" onClick={() => setMobilePanel("board")}/>}
      {positionEditorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPositionEditorOpen(false); }}>
          <section className="position-editor" role="dialog" aria-modal="true" aria-labelledby="position-editor-title">
            <header><div><LayoutGrid size={17}/><strong id="position-editor-title">编辑研究局面</strong></div><button className="tool-button" title="关闭" onClick={() => setPositionEditorOpen(false)}><X size={16}/></button></header>
            <div className="editor-body">
              <div className="editor-board" aria-label="局面编辑棋盘">
                {cells.map(({ row, col }) => {
                  const piece = editorPieceMap.get(`${row}-${col}`);
                  return <button key={`${row}-${col}`} onClick={() => editSquare(row, col)} aria-label={`编辑 ${squareToIccs(row, col)}`}>{piece && <img src={pieceAsset(piece, displayedPieceSkin)} alt={piece.label}/>}</button>;
                })}
              </div>
              <aside className="editor-tools">
                <div className="piece-palette">
                  {editorPalette.map((piece) => <button key={`${piece.color}-${piece.kind}`} className={editorPiece?.color === piece.color && editorPiece.kind === piece.kind ? "active" : ""} onClick={() => setEditorPiece(piece)}><img src={pieceAsset(piece, displayedPieceSkin)} alt={`${piece.color === "red" ? "红" : "黑"}${piece.label}`}/></button>)}
                  <button className={editorPiece == null ? "active erase" : "erase"} onClick={() => setEditorPiece(null)}><Trash2 size={18}/><span>删除</span></button>
                </div>
                <div className="editor-actions">
                  <button onClick={() => setEditorPieces([])}>清空</button>
                  <button onClick={() => setEditorPieces(initialPieces.map((piece) => ({ ...piece })))}>标准局面</button>
                </div>
                <label>棋谱名<input value={gameTitle} onChange={(event) => setGameTitle(event.target.value)}/></label>
                <label>局面备注<textarea rows={4} value={gameNote} onChange={(event) => setGameNote(event.target.value)}/></label>
                <fieldset><legend>行棋方</legend><label><input type="radio" checked={editorSide === "red"} onChange={() => setEditorSide("red")}/>红方</label><label><input type="radio" checked={editorSide === "black"} onChange={() => setEditorSide("black")}/>黑方</label></fieldset>
                <p>允许保存研究局面；缺少将帅、将帅离开九宫或双方同时被将时会标记为不可对弈。</p>
              </aside>
            </div>
            <footer><button onClick={() => setPositionEditorOpen(false)}>取消</button><button className="primary" onClick={() => void confirmPositionEditor()}>创建局面</button></footer>
          </section>
        </div>
      )}
      {linkSessionOpen && <LinkSessionDialog
        initialSource={linkSessionSource}
        onClose={closeLinkSessionDialog}
        onStart={async (request) => {
          try {
            await saveDesktopPreferencePatch({
              linkCaptureSource: request.source,
              linkRecognitionMode: request.recognitionMode,
              linkMode: request.mode,
              linkStableFrames: request.stableFrames,
            });
            if (request.source === "windowLink" || request.source === "desktopDetect") {
              flushSync(() => setLinkSessionOpen(false));
            }
            await collapseCompactStudyPanels();
            if (request.source === "windowLink" || request.source === "desktopDetect") {
              const created = await chessPlatform.openCompactFloatingPanel("link");
              setNotice(created ? "连线提示已打开，正在准备框选棋盘区域…" : "连线提示窗口已置前，正在准备框选棋盘区域…");
            }
            const result = await chessPlatform.startLinkSession(request);
            analysisHintsEnabledRef.current = true;
            setAnalysisHintsEnabled(true);
            if (!analysisBusyRef.current) window.setTimeout(() => void runAnalysis(true), 0);
            setNotice(result.reason ?? "连线会话已启动，请提交并确认识别局面");
            return result;
          } catch (error) {
            const message = friendlyError(error);
            setNotice(message);
            throw new Error(message);
          }
        }}
        onStop={async () => {
          const result = await chessPlatform.stopLinkSession();
          setNotice("连线已停止");
          return result;
        }}
        onSubmit={async (fen) => {
          const result = await chessPlatform.submitLinkPosition(fen);
          if (result.board) applyBoard(result.board);
          setNotice(result.accepted ? `已同步外部走子 ${result.moveIccs}` : result.reason ?? "局面已确认");
          return result;
        }}
        onImport={async (fen, title) => {
          try {
            applyBoard(await chessPlatform.importRecognizedPosition(fen, title));
            closeLinkSessionDialog({ cleanupFileSession: true });
            setNotice("识别局面已导入为新棋局，请确认后开始分析");
          } catch (error) {
            setNotice(friendlyError(error));
          }
        }}
        onStartTraining={async (fen, title, initialReversed = false) => {
          try {
            const next = normalizeBoardState(await chessPlatform.importRecognizedPosition(fen, title));
            applyBoard(next);
            closeLinkSessionDialog({ cleanupFileSession: true });
            setNotice("天天象棋截图局面已保存为独立练习棋谱，正在进入 U10 拆棋");
            await startU10Analysis(undefined, initialReversed);
          } catch (error) {
            setNotice(friendlyError(error));
          }
        }}
        onRecognizeImage={async (source) => {
          try {
            const result = await chessPlatform.recognizeLinkImageFile(source);
            if (!result) return undefined;
            const preview = await chessPlatform.getLinkCapturePreview().catch(() => undefined);
            setLinkCapturePreview(preview);
            analysisHintsEnabledRef.current = true;
            setAnalysisHintsEnabled(true);
            if (!analysisBusyRef.current) window.setTimeout(() => void runAnalysis(true), 0);
            setNotice(result.reason ?? "图片局面已识别并同步");
            return result;
          } catch (error) {
            const message = friendlyError(error);
            setNotice(message);
            throw new Error(message);
          }
        }}
        onPreviewMarkedMove={(iccs) => chessPlatform.previewRecognizedMoveFromCurrent(iccs)}
        onResolveScreenshotMove={() => chessPlatform.resolveScreenshotMove()}
        onConfirmMarkedMove={async (iccs) => {
          try {
            const next = normalizeBoardState(await chessPlatform.confirmRecognizedMove(iccs));
            applyBoard(next);
            closeLinkSessionDialog({ cleanupFileSession: true });
            setNotice("已确认写入当前棋谱变例，原有后续棋谱已保留");
          } catch (error) {
            setNotice(friendlyError(error));
            throw error;
          }
        }}
        pieceAsset={(piece) => pieceAsset(piece, displayedPieceSkin)}
        boardAsset={`/skins/${skinAssetFolder(displayedBoardSkin)}/board.png`}
      />}
      {flyknifeOpen && <FlyknifeDialog
        currentFen={board.fen}
        currentSideToMove={board.sideToMove}
        cloudCandidates={cloudCandidates}
        xqbCandidates={board.xqbCandidates ?? []}
        enginePath={enginePath}
        threads={threads}
        hashMb={hashMb}
        searchMode={searchMode === "infinite" ? "depth" : searchMode}
        searchValue={searchMode === "infinite" ? 18 : searchValue}
        onClose={() => setFlyknifeOpen(false)}
        onPlanSaved={(plan) => {
          setFlyknifePlans((plans) => [plan, ...plans.filter((item) => item.id !== plan.id)]);
          void chessPlatform.initialize().then((next) => applyBoard(normalizeBoardState(next))).catch((error) => setNotice(friendlyError(error)));
        }}
        onPractice={(plan) => void chessPlatform.openFlyknifePractice(plan.id!).then((next) => { applyBoard(normalizeBoardState(next)); setFlyknifePractice({ plan, fen: next.fen ?? plan.startingFen, ply: (next.history ?? []).length, step: 0 }); setFlyknifeOpen(false); setNotice("已打开飞刀练习：先走诱导着，再按保存主变走完出刀线。"); }).catch((error) => setNotice(friendlyError(error)))}
        onTopicOpened={(next, topic) => {
          applyBoard(normalizeBoardState(next));
          setAutosave({ status: "saved" });
          clearAnalysisState();
          setGameReport(undefined);
          setFlyknifeOpen(false);
          setNotice(`已打开飞刀专题：${topic.title}。可直接用皮卡鱼分析或生成复盘报告。`);
          void loadGameReport();
          void refreshGames();
        }}
      />}
      <nav className="mobile-nav" aria-label="移动端导航">
        <button className={mobilePanel === "board" ? "active" : ""} onClick={() => setMobilePanel("board")}><LayoutGrid size={19}/><span>棋盘</span></button>
        <button className={mobilePanel === "library" ? "active" : ""} onClick={() => setMobilePanel("library")}><BookOpen size={19}/><span>棋谱</span></button>
        <button className={mobilePanel === "analysis" ? "active" : ""} onClick={() => setMobilePanel("analysis")}><Activity size={19}/><span>分析</span></button>
        <button className={mobilePanel === "settings" ? "active" : ""} onClick={() => setMobilePanel("settings")}><Settings2 size={19}/><span>设置</span></button>
      </nav>
    </div>
  );
}

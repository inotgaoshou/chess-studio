import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
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
  FolderOpen,
  GitBranch,
  GitFork,
  GripVertical,
  Link,
  LayoutGrid,
  Library,
  ListStart,
  MessageSquare,
  Maximize2,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Sun,
  TrendingUp,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { chessPlatform, type AnalysisLine, type BoardState, type EngineRuntimeState, type GameReportDatasetDto, type GameReportProgressDto, type GameSummary, type MoveItem, type Piece } from "./platform";
import { moveQualityFeedback, moveReports, positionEvaluation, trendPoints, trendTurningPoints } from "./analysisView";
import { CandidateLine } from "./CandidateLine";
import { DesktopMenuBar, type MenuCommand } from "./DesktopMenuBar";
import { DesktopDialogs, type DesktopDialog } from "./DesktopDialogs";
import { GameReportDialog, GameReportView } from "./GameReportView";
import { buildGameReportPresentation } from "./gameReport";
import { moveThoughtHint } from "./coachInsights";
import { MobileToolbar, type MobileToolbarCommand } from "./MobileToolbar";
import type { DesktopPreferencesDto, SyncAccountDto } from "./platform";
import { applyColorTheme, initialColorTheme, type ColorTheme } from "./theme";
import { WorkspaceTabs, type WorkspacePanel } from "./WorkspaceTabs";


const startingFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
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
  pieces: initialPieces,
  history: [],
  branches: [],
  title: "新建棋谱",
  note: "",
  playable: true,
};
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
  multipv: 3,
  searchMode: "time",
  searchValue: 1500,
  moveTimeMs: 5000,
  ponder: false,
  autoAnalyze: true,
  libraryCollapsed: false,
  colorTheme: "dark",
  reportDepth: 20,
  serverUrl: "http://127.0.0.1:8080",
};
const defaultSyncAccount: SyncAccountDto = {
  serverUrl: defaultDesktopPreferences.serverUrl,
  status: "unbound",
};
const editorPalette: Piece[] = [
  ...["rook", "horse", "elephant", "advisor", "king", "cannon", "pawn"].map((kind, index) => ({ row: 0, col: index, color: "red" as const, kind, label: ["车", "马", "相", "仕", "帅", "炮", "兵"][index] })),
  ...["rook", "horse", "elephant", "advisor", "king", "cannon", "pawn"].map((kind, index) => ({ row: 1, col: index, color: "black" as const, kind, label: ["车", "马", "象", "士", "将", "炮", "卒"][index] })),
];

function initialAutoAnalysis() {
  try {
    return localStorage.getItem("xiangqi:auto-analysis") !== "false";
  } catch {
    return true;
  }
}

function normalizeBoardState(value?: Partial<BoardState> | null): BoardState {
  return {
    ...fallback,
    ...value,
    pieces: Array.isArray(value?.pieces) ? value.pieces : fallback.pieces,
    history: Array.isArray(value?.history) ? value.history : [],
    branches: Array.isArray(value?.branches) ? value.branches : [],
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

function boardPoint(square: { row: number; col: number }, reversed: boolean) {
  const row = reversed ? 9 - square.row : square.row;
  const col = reversed ? 8 - square.col : square.col;
  return { x: 80 + col * 120, y: 80 + row * 120 };
}

function pieceAsset(piece: Piece) {
  return `/skins/tchess/${piece.color === "red" ? "r" : "b"}${pieceCode[piece.kind] ?? "p"}.png`;
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

function formatNps(nps?: number) {
  if (!nps) return "-";
  return nps >= 1_000_000 ? `${(nps / 1_000_000).toFixed(1)}M` : `${Math.round(nps / 1000)}K`;
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

function formatReportScore(move: MoveItem, redScoreCp?: number) {
  if (move.mate != null) {
    const redMate = move.movedBy === "黑方" ? move.mate : -move.mate;
    return `${redMate >= 0 ? "红" : "黑"}杀${Math.abs(redMate)}`;
  }
  return formatRedScore(redScoreCp);
}

export default function App() {
  const [board, setBoard] = useState<BoardState>(fallback);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [reversed, setReversed] = useState(false);
  const [fenInput, setFenInput] = useState(startingFen);
  const [enginePath, setEnginePath] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisLine[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [searchMode, setSearchMode] = useState<"time" | "depth" | "nodes" | "infinite">("time");
  const [searchValue, setSearchValue] = useState(1500);
  const [threads, setThreads] = useState(2);
  const [hashMb, setHashMb] = useState(256);
  const [multipv, setMultipv] = useState(3);
  const [autoAnalyze, setAutoAnalyze] = useState(initialAutoAnalysis);
  const [autoRetry, setAutoRetry] = useState(0);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8080");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("本地数据已保存");
  const [mobilePanel, setMobilePanel] = useState<"board" | "library" | "analysis" | "settings">("board");
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>("moves");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [editorPieces, setEditorPieces] = useState<Piece[]>(initialPieces);
  const [editorPiece, setEditorPiece] = useState<Piece | null>(editorPalette[0]);
  const [editorSide, setEditorSide] = useState<"red" | "black">("red");
  const [gameTitle, setGameTitle] = useState("新建棋谱");
  const [gameNote, setGameNote] = useState("");
  const [draggedBranch, setDraggedBranch] = useState<number | null>(null);
  const [engineSide, setEngineSide] = useState<"none" | "red" | "black">("none");
  const [engineThinking, setEngineThinking] = useState(false);
  const [moveTimeMs, setMoveTimeMs] = useState(5000);
  const [ponderEnabled, setPonderEnabled] = useState(false);
  const [ponderMove, setPonderMove] = useState<string | undefined>();
  const [engineRuntimeState, setEngineRuntimeState] = useState<EngineRuntimeState>("idle");
  const [desktopPreferences, setDesktopPreferences] = useState(defaultDesktopPreferences);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => initialColorTheme(chessPlatform.kind));
  const [gameReport, setGameReport] = useState<GameReportDatasetDto>();
  const [reportProgress, setReportProgress] = useState<GameReportProgressDto>();
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [analysisHelpOpen, setAnalysisHelpOpen] = useState(false);
  const [trendCursorIndex, setTrendCursorIndex] = useState<number | undefined>();
  const [syncAccount, setSyncAccount] = useState(defaultSyncAccount);
  const [desktopDialog, setDesktopDialog] = useState<DesktopDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const boardRevision = useRef(0);
  const reportExportingRef = useRef(false);
  const analysisLoadRevision = useRef(0);
  const reportLoadRevision = useRef(0);
  const boardRef = useRef<BoardState>(fallback);
  const analysisBusyRef = useRef(false);
  const pendingAutoAnalysis = useRef(false);
  const playbackRevision = useRef(0);
  const navigationRevision = useRef(0);
  const boardOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const desktopPreferencesRef = useRef(defaultDesktopPreferences);
  const preferenceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const activeMoveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    void chessPlatform.initialize()
      .then((state) => {
        applyBoard(state);
        void loadSavedAnalysis(state.fen ?? startingFen);
        if (chessPlatform.kind === "desktop") void loadGameReport();
        void refreshGames();
        if (chessPlatform.kind === "web") setNotice("离线棋谱已就绪");
      })
      .catch((error) => setNotice(friendlyError(error)));
    if (chessPlatform.kind === "desktop") {
      void chessPlatform.getDesktopPreferences().then((preferences) => {
        applyDesktopPreferences(preferences);
        if (!preferences.enginePath) {
          void chessPlatform.detectEngine().then((path) => {
            if (path) {
              setEnginePath(path);
              const detected = { ...desktopPreferencesRef.current, enginePath: path };
              desktopPreferencesRef.current = detected;
              setDesktopPreferences(detected);
              setNotice("已自动识别 Pikafish 2026，请在引擎设置中保存");
            }
          }).catch(() => undefined);
        }
      }).catch((error) => setNotice(friendlyError(error)));
      void chessPlatform.getSyncAccount().then(setSyncAccount).catch((error) => setNotice(friendlyError(error)));
    }
  }, []);

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
    applyColorTheme(colorTheme);
    if (chessPlatform.kind === "web") {
      try {
        localStorage.setItem("xiangqi:color-theme", colorTheme);
      } catch {
        // Theme persistence is optional in restricted browser contexts.
      }
    }
  }, [colorTheme]);

  useEffect(() => {
    if (workspacePanel !== "moves") return;
    activeMoveRef.current?.scrollIntoView({ block: "nearest" });
  }, [board.currentNode, workspacePanel]);

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
      } else if (event.type === "info") {
        if (event.fen !== boardRef.current.fen) return;
        setAnalysis((current) => [...current.filter((line) => line.multipv !== event.line.multipv), event.line]
          .sort((left, right) => left.multipv - right.multipv));
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
    if (!autoAnalyze) return;
    if (isPlaying || reportBusy) return;
    if (engineSide !== "none" || engineThinking) return;
    if (!board.playable) return;
    if (chessPlatform.kind === "desktop" && !enginePath.trim()) return;
    if (chessPlatform.kind === "web" && (!online || !token.trim())) return;
    if (analysisBusyRef.current) {
      pendingAutoAnalysis.current = true;
      setNotice("局面已更新，正在切换自动分析…");
      void chessPlatform.stopAnalysis(true).catch(() => undefined);
      return;
    }
    const timer = window.setTimeout(() => void runAnalysis(true), 180);
    return () => window.clearTimeout(timer);
  }, [autoAnalyze, autoRetry, board.currentNode, board.fen, board.playable, enginePath, engineSide, engineThinking, hashMb, isPlaying, multipv, online, reportBusy, searchMode, searchValue, serverUrl, threads, token]);

  const pieceMap = useMemo(() => new Map(board.pieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [board.pieces]);
  const editorPieceMap = useMemo(() => new Map(editorPieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [editorPieces]);
  const cells = useMemo(() => Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), []);
  const lastMove = board.history.at(-1);
  const evaluation = useMemo(() => positionEvaluation(board, analysis), [analysis, board]);
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
      y: 60,
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
  const trendMarkerOnLeft = (visibleTrendPoint?.x ?? 0) > 200;
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
  const boardEvaluationScore = evaluation?.samples.at(-1)?.scoreCp;
  const boardEvaluationSide = evaluation?.mateSide
    ? `${evaluation.mateSide}绝杀`
    : boardEvaluationScore == null || Math.abs(boardEvaluationScore) <= 50
      ? "均势"
      : boardEvaluationScore > 0 ? "红优" : "黑优";
  const boardEvaluationRailShare = boardEvaluationScore == null
    ? 50
    : boardEvaluationScore < -50 ? 100 - (evaluation?.redShare ?? 50) : evaluation?.redShare ?? 50;
  const reportPresentation = useMemo(() => gameReport ? buildGameReportPresentation(board.title, gameReport) : undefined, [board.title, gameReport]);
  const orderedAnalysis = useMemo(() => analysis.slice().sort((left, right) => left.multipv - right.multipv), [analysis]);
  const primaryAnalysis = orderedAnalysis[0];
  const primaryMove = primaryAnalysis?.notation?.[0] ?? primaryAnalysis?.pv[0];
  const searchLimitLabel = searchMode === "infinite"
    ? "持续分析"
    : searchMode === "depth"
      ? `固定深度 ${searchValue}`
      : searchMode === "nodes"
        ? `固定节点 ${searchValue.toLocaleString()}`
      : `固定时间 ${(searchValue / 1000).toFixed(1)}s`;
  const engineRuntimeLabel: Record<EngineRuntimeState, string> = {
    idle: "已就绪",
    analyzing: "分析中",
    thinking: "思考中",
    pondering: "后台思考",
    stopping: "停止中",
    faulted: "故障",
  };
  const analysisArrows = useMemo(() => orderedAnalysis
    .filter((line) => line.multipv >= 1 && line.multipv <= analysisArrowColors.length && line.pv.length > 0)
    .flatMap((line) => {
      const from = squareFromIccs(line.pv[0].slice(0, 2));
      const to = squareFromIccs(line.pv[0].slice(2, 4));
      if (!from || !to) return [];
      return [{
        rank: line.multipv,
        color: analysisArrowColors[line.multipv - 1] ?? analysisArrowColors[0],
        from: boardPoint(from, reversed),
        to: boardPoint(to, reversed),
      }];
    }), [orderedAnalysis, reversed]);

  function applyDesktopPreferences(preferences: DesktopPreferencesDto) {
    desktopPreferencesRef.current = preferences;
    setDesktopPreferences(preferences);
    setEnginePath(preferences.enginePath);
    setThreads(preferences.threads);
    setHashMb(preferences.hashMb);
    setMultipv(preferences.multipv);
    setSearchMode(preferences.searchMode);
    setSearchValue(preferences.searchValue);
    setMoveTimeMs(preferences.moveTimeMs);
    setPonderEnabled(preferences.ponder);
    setAutoAnalyze(preferences.autoAnalyze);
    setLibraryCollapsed(preferences.libraryCollapsed);
    setColorTheme(preferences.colorTheme);
    setServerUrl(preferences.serverUrl);
  }

  function saveDesktopPreferencePatch(patch: Partial<DesktopPreferencesDto>) {
    const snapshot = { ...desktopPreferencesRef.current, ...patch };
    desktopPreferencesRef.current = snapshot;
    setDesktopPreferences(snapshot);
    const keys = Object.keys(patch) as Array<keyof DesktopPreferencesDto>;
    const operation = preferenceSaveQueue.current.then(async () => {
      const saved = await chessPlatform.saveDesktopPreferences(snapshot);
      const current = desktopPreferencesRef.current;
      const confirmed = Object.fromEntries(keys
        .filter((key) => Object.is(current[key], snapshot[key]))
        .map((key) => [key, saved[key]])) as Partial<DesktopPreferencesDto>;
      const reconciled = { ...current, ...confirmed };
      desktopPreferencesRef.current = reconciled;
      setDesktopPreferences(reconciled);
      return reconciled;
    });
    preferenceSaveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function toggleColorTheme() {
    const previous = chessPlatform.kind === "desktop" ? desktopPreferencesRef.current.colorTheme : colorTheme;
    const next = previous === "dark" ? "light" : "dark";
    setColorTheme(next);
    if (chessPlatform.kind !== "desktop") return;
    try {
      const saved = await saveDesktopPreferencePatch({ colorTheme: next });
      if (desktopPreferencesRef.current.colorTheme === next) setColorTheme(saved.colorTheme);
    } catch (error) {
      if (desktopPreferencesRef.current.colorTheme === next) {
        const restored = { ...desktopPreferencesRef.current, colorTheme: previous };
        desktopPreferencesRef.current = restored;
        setDesktopPreferences(restored);
        setColorTheme(previous);
      }
      setNotice(friendlyError(error));
    }
  }

  async function setLibraryVisibility(collapsed: boolean) {
    const previous = desktopPreferencesRef.current.libraryCollapsed;
    setLibraryCollapsed(collapsed);
    if (chessPlatform.kind !== "desktop") return;
    try {
      await saveDesktopPreferencePatch({ libraryCollapsed: collapsed });
    } catch (error) {
      if (desktopPreferencesRef.current.libraryCollapsed === collapsed) {
        const restored = { ...desktopPreferencesRef.current, libraryCollapsed: previous };
        desktopPreferencesRef.current = restored;
        setDesktopPreferences(restored);
        setLibraryCollapsed(previous);
      }
      setNotice(friendlyError(error));
    }
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

  async function generateGameReport() {
    if (chessPlatform.kind !== "desktop") {
      setNotice("整局分析报告仅支持桌面版");
      return;
    }
    if (!enginePath.trim()) {
      setNotice("请先在引擎设置中选择 Pikafish");
      return;
    }
    stopPlayback();
    setEngineSide("none");
    setPonderMove(undefined);
    if (engineThinking) await chessPlatform.moveNow().catch(() => false);
    await chessPlatform.stopEnginePlay().catch(() => false);
    await cancelAnalysisForDocumentChange();
    setWorkspacePanel("report");
    setReportBusy(true);
    setReportProgress({
      completed: 0,
      total: Math.max(1, board.history.length + 1),
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
    } catch (error) {
      const message = friendlyError(error);
      if (!message.includes("取消")) setNotice(message);
    } finally {
      setReportBusy(false);
    }
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
      setNotice(friendlyError(error));
    } finally {
      reportExportingRef.current = false;
      setReportExporting(false);
    }
  }

  async function cancelGameReportForStructureChange() {
    reportLoadRevision.current += 1;
    if (reportBusy) await cancelGameReport(false);
  }

  async function playIccsMove(iccs: string, expectedFen?: string) {
    stopPlayback();
    if (expectedFen && boardRef.current.fen !== expectedFen) {
      setNotice("候选线路已过期，请等待当前局面重新分析");
      return;
    }
    if (!board.playable) {
      setNotice("当前研究局面不可对弈，请先修正局面");
      return;
    }
    if (engineThinking || isEngineTurn(board)) {
      setNotice(engineThinking ? "Pikafish 正在思考" : "当前轮到 Pikafish 行棋");
      return;
    }
    try {
      await cancelGameReportForStructureChange();
      await enqueueBoardOperation(() => chessPlatform.navigateTo(boardRef.current.currentNode));
      const next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.playMove(iccs)));
      applyBoard(next);
      setAnalysis([]);
      await loadGameReport();
      setNotice(`已记录 ${next.history.at(-1)?.notation ?? iccs}`);
      await requestEngineMove(next);
    } catch (error) {
      setNotice(friendlyError(error));
    }
    setSelected(null);
  }

  async function selectSquare(row: number, col: number) {
    if (!board.playable) {
      setNotice("当前研究局面不可对弈，请先修正局面");
      return;
    }
    if (engineThinking || isEngineTurn(board)) {
      setNotice(engineThinking ? "Pikafish 正在思考" : "当前轮到 Pikafish 行棋");
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
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.newGame(fen)));
      await refreshGames();
      setSelected(null);
      setAnalysis([]);
      setGameReport(undefined);
      setNotice("已创建新棋谱");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function openDocument() {
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      const next = await enqueueBoardOperation(() => chessPlatform.openDocument());
      if (!next) {
        setNotice("已取消打开棋谱");
        return;
      }
      applyBoard(next);
      setAnalysis([]);
      await loadGameReport();
      await refreshGames();
      setNotice("棋谱已导入并自动保存到本地库");
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

  async function pasteDocument() {
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.pasteDocument()));
      setAnalysis([]);
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
    const fen = piecesToFen(editorPieces, editorSide);
    try {
      await cancelAnalysisForDocumentChange();
      await cancelGameReportForStructureChange();
      applyBoard(await enqueueBoardOperation(() => chessPlatform.newGame(fen, gameTitle.trim() || "研究局面", gameNote)));
      setAnalysis([]);
      setGameReport(undefined);
      setPositionEditorOpen(false);
      await refreshGames();
      setNotice("研究局面已创建；异常局面会禁用走棋和引擎");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function reorderBranch(from: number, to: number) {
    if (from === to || to < 0 || to >= board.branches.length) return;
    const ordered = board.branches.map((move) => move.id);
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

  function stopEnginePlay() {
    setEngineSide("none");
    setPonderMove(undefined);
    if (engineThinking) void chessPlatform.moveNow().catch(() => undefined);
    void chessPlatform.stopEnginePlay().catch(() => undefined);
  }

  async function cancelAnalysisForDocumentChange() {
    if (!analysisBusyRef.current) return;
    pendingAutoAnalysis.current = false;
    analysisBusyRef.current = false;
    setAnalysisBusy(false);
    await chessPlatform.stopAnalysis(true).catch(() => undefined);
  }

  async function requestEngineMove(state = boardRef.current, side = engineSide) {
    if (chessPlatform.kind !== "desktop" || side === "none" || !isEngineTurn(state, side) || engineThinking || reportBusy) return;
    if (!enginePath.trim()) {
      setNotice("未找到 Pikafish，无法开始人机对弈");
      setEngineSide("none");
      return;
    }
    if (!state.playable) {
      setNotice("当前研究局面不可对弈");
      setEngineSide("none");
      return;
    }
    if (analysisBusyRef.current) {
      pendingAutoAnalysis.current = false;
      await chessPlatform.stopAnalysis(true).catch(() => undefined);
    }
    setEngineThinking(true);
    setNotice(`Pikafish 执${side === "red" ? "红" : "黑"}思考中…`);
    try {
      const result = await chessPlatform.playEngineMove({ enginePath, moveTimeMs, threads, hashMb, ponder: ponderEnabled });
      applyBoard(result.board);
      setAnalysis([]);
      await loadGameReport();
      setPonderMove(result.ponder);
      setNotice(`Pikafish 已走 ${result.board.history.at(-1)?.notation ?? "一着"}${result.ponder ? ` · 预测 ${result.ponder}` : ""}`);
    } catch (error) {
      setNotice(friendlyError(error));
      setEngineSide("none");
    } finally {
      setEngineThinking(false);
    }
  }

  function toggleEngineSide(side: "red" | "black") {
    if (reportBusy) {
      setNotice("整局报告生成期间不能开始人机对弈");
      return;
    }
    if (engineThinking && engineSide !== side) {
      setNotice("Pikafish 正在思考，请先停止当前对弈再切换执方");
      return;
    }
    const next = engineSide === side ? "none" : side;
    setEngineSide(next);
    setPonderMove(undefined);
    if (next === "none") {
      stopEnginePlay();
      setNotice("人机对弈已停止");
    } else {
      if (analysisBusyRef.current) void chessPlatform.stopAnalysis(true).catch(() => undefined);
      window.setTimeout(() => void requestEngineMove(boardRef.current, next), 0);
    }
  }

  async function moveNow() {
    try {
      const stopped = await chessPlatform.moveNow();
      setNotice(stopped ? "已要求 Pikafish 立即出招" : "引擎当前没有正在计算的着法");
    } catch (error) {
      setNotice(friendlyError(error));
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
        pendingAutoAnalysis.current = true;
        setNotice("局面已更新，正在切换自动分析…");
        await chessPlatform.stopAnalysis(true).catch(() => undefined);
      }
      return;
    }
    if (chessPlatform.kind === "desktop" && !enginePath.trim()) {
      if (!automatic) setNotice("未找到 Pikafish，请填写引擎路径");
      return;
    }
    if (chessPlatform.kind === "web" && (!online || !token.trim())) {
      if (!automatic) setNotice(online ? "服务端分析需要先填写登录令牌" : "当前离线，无法启动云端分析");
      return;
    }
    analysisBusyRef.current = true;
    analysisLoadRevision.current += 1;
    setAnalysis([]);
    setAnalysisBusy(true);
    setNotice(automatic ? "Pikafish 正在自动分析…" : "Pikafish 正在计算…");
    const currentBoard = boardRef.current;
    const analyzedFen = currentBoard.fen;
    const analyzedRevision = boardRevision.current;
    const effectiveMode = automatic && searchMode === "infinite" ? "time" : searchMode;
    const effectiveValue = automatic && searchMode === "infinite" ? 1500 : searchValue;
    try {
      const result = await chessPlatform.analyze({
        enginePath,
        fen: analyzedFen,
        searchMode: effectiveMode,
        searchValue: effectiveValue,
        threads,
        hashMb,
        multipv,
        serverUrl,
        token,
        excludeMove,
      });
      if (boardRevision.current !== analyzedRevision) {
        setNotice("原局面分析已结束；当前棋盘已变化，未覆盖当前候选线");
        return;
      }
      setAnalysis(result);
      applyBoard(await chessPlatform.initialize());
      setNotice(automatic ? "自动分析完成并已保存" : "分析完成并已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
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
    try {
      await chessPlatform.stopAnalysis();
      setNotice("正在停止 Pikafish");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  function applyBoard(value?: Partial<BoardState> | null) {
    const next = normalizeBoardState(value);
    boardRevision.current += 1;
    boardRef.current = next;
    setBoard(next);
    setFenInput(next.fen);
  }

  async function loadSavedAnalysis(fen = board.fen) {
    const loadRevision = ++analysisLoadRevision.current;
    const expectedBoardRevision = boardRevision.current;
    try {
      const saved = await chessPlatform.loadSavedAnalysis(fen);
      if (loadRevision === analysisLoadRevision.current && expectedBoardRevision === boardRevision.current && boardRef.current.fen === fen) {
        setAnalysis(saved);
      }
    } catch {
      if (loadRevision === analysisLoadRevision.current && expectedBoardRevision === boardRevision.current) {
        setAnalysis([]);
      }
    }
  }

  async function refreshGames() {
    try {
      setGames(await chessPlatform.listGames());
    } catch {
      setGames([]);
    }
  }

  async function openGame(gameId: string) {
    stopPlayback();
    stopEnginePlay();
    await cancelAnalysisForDocumentChange();
    await cancelGameReportForStructureChange();
    try {
      const next = await enqueueBoardOperation(() => chessPlatform.openGame(gameId));
      applyBoard(next);
      setSelected(null);
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
    const operation = boardOperationQueue.current.then(run);
    boardOperationQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function navigateTo(nodeId?: string, playbackToken?: number): Promise<BoardState | null> {
    if (playbackToken == null) {
      stopPlayback();
      stopEnginePlay();
    }
    if (playbackToken != null && playbackToken !== playbackRevision.current) return null;
    const requestRevision = ++navigationRevision.current;
    try {
      const next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.navigateTo(nodeId)));
      if (requestRevision !== navigationRevision.current) return null;
      if (playbackToken != null && playbackToken !== playbackRevision.current) return null;
      applyBoard(next);
      setSelected(null);
      setTrendCursorIndex(undefined);
      await loadSavedAnalysis(next.fen ?? board.fen);
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
    await navigateTo(previous?.id);
  }

  async function startCoachStudy(nodeId: string) {
    const moveIndex = board.history.findIndex((move) => move.id === nodeId);
    const previousNode = moveIndex > 0 ? board.history[moveIndex - 1].id : undefined;
    const cached = reportPositionByNode.get(nodeId)?.before;
    const next = await navigateTo(previousNode);
    if (!next) return;
    setWorkspacePanel("analysis");
    if (cached?.bestIccs) {
      setAnalysis([{
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
    const x = (event.clientX - rect.left) / rect.width * 300;
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
    let next = preferredContinuation(state);
    while (next) {
      const navigated = await navigateTo(next.id, token);
      if (!navigated) return;
      state = navigated;
      if (state.branches.length > 1) {
        setIsPlaying(false);
        setWorkspacePanel("moves");
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

  async function saveComment() {
    if (!board.currentNode) return;
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.updateComment(board.currentNode!, comment)));
      setNotice("注释已保存");
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

  async function removeNode(nodeId: string) {
    stopPlayback();
    try {
      await cancelGameReportForStructureChange();
      applyBoard(await enqueueBoardOperation(() => chessPlatform.deleteNode(nodeId)));
      setAnalysis([]);
      await loadGameReport();
      setNotice("节点已删除");
    } catch (error) {
      setNotice(friendlyError(error));
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

  async function saveEnginePreferences(preferences: DesktopPreferencesDto) {
    setDialogBusy(true);
    try {
      stopEnginePlay();
      await cancelAnalysisForDocumentChange();
      const probe = await chessPlatform.probeEngine(preferences.enginePath);
      const saved = await saveDesktopPreferencePatch({
        enginePath: probe.path,
        threads: preferences.threads,
        hashMb: preferences.hashMb,
        multipv: preferences.multipv,
        searchMode: preferences.searchMode,
        searchValue: preferences.searchValue,
        moveTimeMs: preferences.moveTimeMs,
        ponder: preferences.ponder,
        autoAnalyze: preferences.autoAnalyze,
        reportDepth: preferences.reportDepth,
      });
      applyDesktopPreferences(saved);
      setDesktopDialog(null);
      setNotice(`引擎设置已保存，${probe.protocol.toUpperCase()} 握手成功`);
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setDialogBusy(false);
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
      const account = mode === "register"
        ? await chessPlatform.registerSyncAccount(email, password)
        : await chessPlatform.loginSyncAccount(email, password);
      setSyncAccount(account);
      setDesktopDialog(null);
      setNotice(mode === "register" ? "账号已注册并绑定本地棋谱库" : "同步账号已登录");
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setDialogBusy(false);
    }
  }

  async function logoutSync() {
    try {
      setSyncAccount(await chessPlatform.logoutSyncAccount());
      setNotice("已退出登录，本地棋谱和待同步改动保留");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function executeMenuCommand(command: MenuCommand) {
    switch (command) {
      case "newGame": await createGame(startingFen); break;
      case "openDocument": await openDocument(); break;
      case "saveDocument": await saveDocument(); break;
      case "saveDocumentAs": await saveDocument(true); break;
      case "editPosition": openPositionEditor(); break;
      case "flipBoard": setReversed((value) => !value); break;
      case "copyFen": await copyPosition(); break;
      case "pasteDocument":
      case "pasteTextManual": await pasteDocument(); break;
      case "copyFullManual": await copyGame(); break;
      case "copyMainline": await copyGame(true); break;
      case "nextBranch": await goToNextBranchPoint(); break;
      case "engineRed": toggleEngineSide("red"); break;
      case "engineBlack": toggleEngineSide("black"); break;
      case "moveNow": await moveNow(); break;
      case "analyze": await runAnalysis(); break;
      case "stopAnalysis": await stopAnalysis(); break;
      case "engineSettings": setDesktopDialog("engine"); break;
      case "syncRegister": setDesktopDialog("register"); break;
      case "syncLogin": setDesktopDialog("login"); break;
      case "syncNow": await synchronize(); break;
      case "syncSettings": setDesktopDialog("syncSettings"); break;
      case "syncLogout": await logoutSync(); break;
    }
  }

  async function executeMobileToolbar(command: MobileToolbarCommand) {
    switch (command) {
      case "library": setMobilePanel("library"); break;
      case "settings": setMobilePanel("settings"); break;
      case "newGame": await createGame(startingFen); break;
      case "flipBoard": setReversed((value) => !value); break;
      case "analysis": analysisBusy ? await stopAnalysis() : await runAnalysis(); break;
      case "theme": await toggleColorTheme(); break;
    }
  }

  function playbackControls(className: string) {
    return <div className={`playback-controls ${className}`} aria-label="棋谱播放控制">
      <button title="回到开局" disabled={!board.currentNode} onClick={() => void navigateTo()}><ChevronsLeft size={15}/></button>
      <button title="上一着" disabled={!board.currentNode} onClick={() => void goPrevious()}><ChevronLeft size={15}/></button>
      <button className={isPlaying ? "active" : ""} title={isPlaying ? "暂停播放" : "播放主线"} disabled={board.history.length === 0 && board.branches.length === 0} onClick={() => void togglePlayback()}>{isPlaying ? <Pause size={14}/> : <Play size={14}/>}</button>
      <button title="下一着" disabled={!preferredContinuation(board)} onClick={() => void goNext()}><ChevronRight size={15}/></button>
      <button title="前往主线终局" disabled={!preferredContinuation(board)} onClick={() => void goToEnd()}><ChevronsRight size={15}/></button>
      <button className="variation-jump" title="下变：跳到下一个分支点" disabled={!preferredContinuation(board)} onClick={() => void goToNextBranchPoint()}><GitFork size={13}/><small>下变</small></button>
      <span>第 <strong>{board.history.length}</strong> 着</span>
    </div>;
  }

  return (
    <div className={`app-shell ${chessPlatform.kind}-shell theme-${colorTheme}`}>
      <header className="titlebar">
        <div className="window-brand"><span className="brand-seal">象</span><strong>棋研</strong><small>XIANGQI STUDIO</small></div>
        <strong className="window-title">棋研工作台</strong>
        <div className="window-state"><span className={analysisBusy ? "pulse" : ""} />{notice}</div>
      </header>

      <MobileToolbar analysisBusy={analysisBusy} analysisDisabled={!board.playable || isPlaying || reportBusy || engineSide !== "none" || engineThinking} colorTheme={colorTheme} onCommand={(command) => void executeMobileToolbar(command)}/>

      <nav className="menubar" aria-label="主菜单">
        {chessPlatform.kind === "desktop" && <DesktopMenuBar
          status={{
            playable: board.playable,
            isPlaying,
            analysisBusy,
            engineThinking,
            engineConfigured: !!enginePath.trim(),
            engineSide,
            hasContinuation: !!preferredContinuation(board),
            syncBusy,
            syncStatus: syncAccount.status,
            syncEmail: syncAccount.email,
            syncLastResult: syncAccount.lastSyncResult,
          }}
          execute={executeMenuCommand}
        />}
        <div className="engine-chip"><Activity size={13}/><strong>Pikafish</strong><span>{chessPlatform.kind === "web" ? online ? "云端" : "离线" : enginePath ? engineRuntimeLabel[engineRuntimeState] : "未检测"}</span></div>
      </nav>

      {chessPlatform.kind === "desktop" && <DesktopDialogs
        dialog={desktopDialog}
        preferences={desktopPreferences}
        account={syncAccount}
        busy={dialogBusy}
        onClose={() => setDesktopDialog(null)}
        onChooseEngine={(currentPath) => chessPlatform.chooseEngineExecutable(currentPath)}
        onSaveEngine={saveEnginePreferences}
        onSaveSync={saveSyncPreferences}
        onAuthenticate={authenticateSync}
      />}

      <div className="actionbar">
        <button className="wide-tool" onClick={() => void createGame(startingFen)}><FolderOpen size={14}/>新建研习棋谱</button>
        <div className="tool-group">
          <button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={17}/></button>
          <button className="tool-button" title="打开棋谱" onClick={() => void openDocument()}><FolderOpen size={16}/></button>
          <button className="tool-button" title="保存棋谱" onClick={() => void saveDocument()}><Save size={16}/></button>
          <button className="tool-button" title="翻转棋盘" onClick={() => setReversed((value) => !value)}><RotateCcw size={16}/></button>
          <button className="tool-button" title="返回根局面" onClick={() => void navigateTo()}><RefreshCw size={16}/></button>
        </div>
        <div className="tool-divider" />
        <button className="mode-tool" onClick={() => void runAnalysis()} disabled={!board.playable || analysisBusy || isPlaying}><Zap size={15}/>分析当前局面</button>
        <button className={`mode-tool engine-side ${engineSide === "red" ? "active" : ""}`} disabled={!board.playable || (engineThinking && engineSide !== "red")} onClick={() => toggleEngineSide("red")}><Bot size={15}/>引擎红</button>
        <button className={`mode-tool engine-side ${engineSide === "black" ? "active" : ""}`} disabled={!board.playable || (engineThinking && engineSide !== "black")} onClick={() => toggleEngineSide("black")}><Bot size={15}/>引擎黑</button>
        <button className="tool-button" title="立即出招" disabled={!engineThinking} onClick={() => void moveNow()}><Zap size={15}/></button>
        <button className="tool-button" title="引擎设置" onClick={() => setDesktopDialog("engine")}><Settings2 size={16}/></button>
        <button className="tool-button" title={colorTheme === "dark" ? "切换浅色主题" : "切换深色主题"} aria-label={colorTheme === "dark" ? "切换浅色主题" : "切换深色主题"} onClick={() => void toggleColorTheme()}>{colorTheme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}</button>
      </div>

      <main className={`workspace ${libraryCollapsed ? "library-collapsed" : ""}`}>
        <aside className={`library-panel ${libraryCollapsed ? "collapsed" : ""} ${mobilePanel === "library" || mobilePanel === "settings" ? "mobile-visible" : ""} ${mobilePanel === "settings" ? "mobile-settings-mode" : ""}`}>
          <div className="pane-title">
            <strong>{libraryCollapsed ? <Library size={16}/> : "棋谱库"}</strong>
            {!libraryCollapsed && <button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={15}/></button>}
            {chessPlatform.kind === "desktop" && <button className="tool-button library-toggle" title={libraryCollapsed ? "展开棋谱库" : "收起棋谱库"} aria-label={libraryCollapsed ? "展开棋谱库" : "收起棋谱库"} onClick={() => void setLibraryVisibility(!libraryCollapsed)}>{libraryCollapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button>}
            <button className="tool-button mobile-drawer-close" title="关闭侧栏" aria-label="关闭侧栏" onClick={() => setMobilePanel("board")}><X size={16}/></button>
          </div>
          <label className="library-search"><FolderOpen size={14}/><input placeholder="搜索棋谱" /></label>
          <div className="library-tree">
            <div className="tree-group"><ChevronDown size={14}/><strong>古谱</strong></div>
            <button className="tree-entry"><ChevronRight size={13}/><span>适情雅趣</span></button>
            <button className="tree-entry"><ChevronRight size={13}/><span>橘中秘</span></button>
            <div className="tree-group open"><ChevronDown size={14}/><strong>研习棋谱</strong></div>
            {games.map((game) => (
              <button key={game.id} className={`study-entry ${game.current ? "active" : ""}`} onClick={() => void openGame(game.id)}>
                <BookOpen size={15}/>
                <span><strong>{game.title}</strong><small>{game.current ? `${board.history.length} 着 · 自动保存` : "已同步 · 点击打开"}</small></span>
              </button>
            ))}
            <div className="tree-group"><ChevronRight size={14}/><strong>对局谱</strong></div>
            <div className="tree-group"><ChevronRight size={14}/><strong>残局库</strong></div>
          </div>
          <section className="study-meta">
            <label>棋谱名<input value={gameTitle} onChange={(event) => setGameTitle(event.target.value)} /></label>
            <label>局面备注<textarea value={gameNote} onChange={(event) => setGameNote(event.target.value)} rows={3}/></label>
            <button onClick={() => void saveGameMetadata()}><Save size={13}/>保存信息</button>
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
            <div className="sync-title"><Link size={14}/><strong>个人同步</strong></div>
            <span>{syncAccount.email ?? "未绑定账号"}</span>
            <small>{syncAccount.lastSyncResult ?? (syncAccount.status === "signedIn" ? "已登录，等待同步" : "本地编辑不受影响")}</small>
            <button disabled={syncBusy} onClick={() => syncAccount.status === "signedIn" ? void synchronize() : setDesktopDialog(syncAccount.status === "unbound" ? "register" : "login")}>{syncBusy ? "同步中…" : syncAccount.status === "signedIn" ? "立即同步" : syncAccount.status === "expired" ? "重新登录" : syncAccount.status === "signedOut" ? "登录" : "注册账号"}</button>
          </section>}
        </aside>

        <section className={`board-section ${mobilePanel === "board" ? "mobile-visible" : ""}`}>
          <div className="board-stage">
            <div className="board-stage-inner">
            <div className="board" aria-label="中国象棋棋盘">
              <div className="board-art" />
              {cells.map(({ row, col }) => {
                const piece = pieceMap.get(`${row}-${col}`);
                const visualRow = reversed ? 9 - row : row;
                const visualCol = reversed ? 8 - col : col;
                const isSelected = selected?.row === row && selected?.col === col;
                const isLastFrom = lastMove?.from.row === row && lastMove.from.col === col;
                const isLastTo = lastMove?.to.row === row && lastMove.to.col === col;
                const style = {
                  "--piece-left": `${((20 + visualCol * 120) / 1120) * 100}%`,
                  "--piece-top": `${((20 + visualRow * 120) / 1240) * 100}%`,
                } as CSSProperties;
                return (
                  <button
                    key={`${row}-${col}`}
                    className={`board-square ${isSelected ? "selected" : ""} ${isLastFrom ? "last-from" : ""} ${isLastTo ? "last-to" : ""}`}
                    style={style}
                    disabled={isPlaying || !board.playable}
                    onClick={() => void selectSquare(row, col)}
                    aria-label={`${squareToIccs(row, col)}${piece ? ` ${piece.color === "red" ? "红" : "黑"}${piece.label}` : ""}`}
                  >
                    {piece && <img src={pieceAsset(piece)} alt="" draggable={false} />}
                    {isSelected && <img className="selection-mask" src="/skins/tchess/mask2.png" alt="" />}
                    {isLastTo && board.currentNode === lastMove?.id && overviewReport?.grade && overviewReport.score != null && (
                      <span
                        className={`board-move-grade grade-${overviewReport.grade}`}
                        data-tooltip={`${overviewReport.grade} ${overviewReport.score}分 · ${formatScoreDelta(overviewReport.deltaCp)}`}
                        title={`本着质量 ${overviewReport.score} 分，等级 ${overviewReport.grade}`}
                      >
                        {overviewReport.grade}
                      </span>
                    )}
                  </button>
                );
              })}
              {analysisArrows.length > 0 && (
                <>
                  <svg className="analysis-arrow-lines" viewBox="0 0 1120 1240" aria-hidden="true">
                  <defs>
                    {analysisArrows.map((arrow) => (
                      <marker key={arrow.rank} id={`analysis-arrowhead-${arrow.rank}`} markerWidth="48" markerHeight="48" refX="40" refY="24" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 48 24 L 0 48 z" fill={arrow.color}/>
                      </marker>
                    ))}
                  </defs>
                  {analysisArrows.map((arrow) => {
                    return (
                      <g key={arrow.rank} style={{ "--arrow-color": arrow.color } as CSSProperties}>
                        <line x1={arrow.from.x} y1={arrow.from.y} x2={arrow.to.x} y2={arrow.to.y} markerEnd={`url(#analysis-arrowhead-${arrow.rank})`}/>
                      </g>
                    );
                  })}
                  </svg>
                  <svg className="analysis-arrow-labels" viewBox="0 0 1120 1240" aria-hidden="true">
                    {analysisArrows.map((arrow) => {
                      const labelX = arrow.from.x + (arrow.to.x - arrow.from.x) * .55;
                      const labelY = arrow.from.y + (arrow.to.y - arrow.from.y) * .55;
                      return (
                        <g key={arrow.rank} style={{ "--arrow-color": arrow.color } as CSSProperties}>
                        <circle cx={labelX} cy={labelY} r="23"/>
                        <text x={labelX} y={labelY}>{arrow.rank}</text>
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
                <span style={{ height: `${Math.max(8, Math.min(92, boardEvaluationRailShare))}%` }}/>
              </div>
              <div className="board-eval-label">
                <strong>{boardEvaluationSide}</strong>
                <span>{evaluation?.scoreText ?? "--"}</span>
              </div>
            </aside>
            </div>
          </div>
          <div className="board-statusbar">
            {overviewReport?.grade && overviewReport.score != null && (
              <span className={`board-quality-chip grade-${overviewReport.grade}`} title={`当前着法质量 ${overviewReport.score} 分`}>
                <b>{overviewReport.grade}</b><span>{overviewReport.score}分</span>
              </span>
            )}
            {lastMove && <span className="last-move-status">上一着：<strong>{lastMove.movedBy}</strong> {lastMove.notation}</span>}
            {lastMove && <span className="status-separator" />}
            <span className={`turn-dot ${board.sideToMove === "红方" ? "red" : "black"}`} />
            <strong>{board.sideToMove}行棋</strong>
            <span>{board.status}</span>
            <span className="status-spacer" />
            <span className="board-meta">节点 {board.history.length}</span>
            <span className="board-meta">{reversed ? "黑方视角" : "红方视角"}</span>
          </div>
          {playbackControls("mobile-playback")}
          <div className={`engine-livebar ${primaryAnalysis ? "has-analysis" : "empty"}`}>
            <span>{primaryAnalysis
              ? <>深度 {primaryAnalysis.depth ?? "-"} · PV {primaryAnalysis.multipv} · 分数 {formatAnalysisScore(primaryAnalysis)} · NPS {formatNps(primaryAnalysis.nps)} · 时间 {((primaryAnalysis.timeMs ?? 0) / 1000).toFixed(1)}s{primaryMove ? ` · ${primaryMove}` : ""}</>
              : "等待局面分析"}</span>
            <strong>{searchLimitLabel}</strong>
          </div>
          <div className="fen-row">
            <label>FEN</label>
            <input value={fenInput} onChange={(event) => setFenInput(event.target.value)} />
            <button onClick={() => void createGame()}>载入</button>
          </div>
        </section>

        <aside className={`analysis-panel ${mobilePanel === "analysis" ? "mobile-visible" : ""}`}>
          <div className="position-overview" aria-label="局势概览">
            <div className="overview-heading"><span><TrendingUp size={14}/>局势概览</span><strong>{evaluation?.label ?? "等待分析"}</strong></div>
            <div className="overview-metrics">
              <div><small>局面分</small><strong>{evaluation?.scoreText ?? "--"}</strong></div>
              <div><small>质量分</small><strong className={overviewReport?.grade ? `overview-quality grade-${overviewReport.grade}` : "overview-quality"}>{overviewReport?.score != null ? `${overviewReport.score} ${overviewReport.grade}` : "--"}</strong></div>
              <div><small>红方</small><strong>{evaluation ? `${evaluation.redShare.toFixed(0)}%` : "--"}</strong></div>
              <div><small>黑方</small><strong>{evaluation ? `${(100 - evaluation.redShare).toFixed(0)}%` : "--"}</strong></div>
              <div><small>深度</small><strong>{primaryAnalysis?.depth ?? "--"}</strong></div>
              <div><small>耗时</small><strong>{primaryAnalysis?.timeMs != null ? `${(primaryAnalysis.timeMs / 1000).toFixed(1)}s` : "--"}</strong></div>
            </div>
            <div className="overview-balance" aria-label={evaluation ? `红方占比 ${evaluation.redShare.toFixed(0)}%` : "等待局势分析"}><i style={{ width: `${evaluation?.redShare ?? 50}%` }}/></div>
          </div>
          <WorkspaceTabs active={workspacePanel} onChange={setWorkspacePanel}/>

          {workspacePanel === "analysis" && <div id="workspace-panel-analysis" className="workspace-content analysis-workspace" role="tabpanel" aria-labelledby="workspace-tab-analysis">
          <section className="engine-control">
            <div className="engine-heading">
              <div><Activity size={16}/><strong>{chessPlatform.kind === "web" ? "云端 Pikafish" : "Pikafish 引擎"}</strong></div>
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
                <label className="ponder-toggle"><input type="checkbox" checked={ponderEnabled} onChange={(event) => setPonderEnabled(event.target.checked)}/><span>后台思考</span></label>
                <button className="move-now" disabled={!engineThinking} onClick={() => void moveNow()}><Zap size={12}/>立即</button>
              </div>
              {engineSide !== "none" && <div className="engine-play-status"><span className={engineThinking ? "thinking" : ""}/><strong>人机对弈</strong><small>Pikafish 执{engineSide === "red" ? "红" : "黑"}{ponderMove ? ` · 预测 ${ponderMove}` : ""}</small></div>}
              <button className="engine-config-summary" onClick={() => setDesktopDialog("engine")}>
                <Settings2 size={14}/><span>{enginePath ? enginePath.split(/[\\/]/).at(-1) : "选择 Pikafish"}</span><small>{threads} 线程 · Hash {hashMb} MB · MultiPV {multipv}</small>
              </button>
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

          <section className="variations">
            <div className="section-title"><strong>引擎输出</strong><span>MultiPV {multipv}</span></div>
            <div className="analysis-lines">
              {analysis.length === 0
                ? <div className="empty-analysis"><Activity size={24}/><strong>等待分析</strong><span>启动 Pikafish 后显示候选线路</span></div>
                : orderedAnalysis.map((line) => <CandidateLine
                  color={analysisArrowColors[line.multipv - 1] ?? "transparent"}
                  fen={board.fen}
                  key={line.multipv}
                  line={line}
                  scoreText={formatAnalysisScore(line)}
                  sideToMove={board.sideToMove}
                  onPlay={(iccs, analyzedFen) => void playIccsMove(iccs, analyzedFen)}
                />)}
            </div>
          </section>
          </div>}

          {workspacePanel !== "analysis" && <section className="workspace-content review-workspace">
            {workspacePanel === "moves" && <div id="workspace-panel-moves" className="moves-workspace" role="tabpanel" aria-labelledby="workspace-tab-moves">
            {playbackControls("desktop-playback")}
            <div className="move-review-pane">
              <div className="move-table" role="table" aria-label="棋谱着法">
                <div className="move-table-head" role="row">
                  <span role="columnheader">序号</span><span role="columnheader">着法</span><span role="columnheader">分数</span>
                </div>
                <div className="move-table-body" role="rowgroup">
                  <button className={`move-table-row root ${!board.currentNode ? "active" : ""}`} role="row" onClick={() => void navigateTo()}>
                    <span role="cell">0</span><span role="cell"><GitBranch size={12}/>开始局面</span><span role="cell" />
                  </button>
                {board.history.map((move, index) => {
                  const quality = reportByMoveId.get(move.id);
                  return (
                    <button
                      ref={board.currentNode === move.id ? activeMoveRef : undefined}
                      className={`move-table-row ${quality?.grade ? `grade-${quality.grade}` : ""} ${board.currentNode === move.id ? "active" : ""}`}
                      key={move.id}
                      role="row"
                      title={`${move.movedBy} · ICCS ${move.iccs}${quality?.score != null ? ` · 质量 ${quality.score} 分 ${quality.grade}` : ""}`}
                      onClick={() => void navigateTo(move.id)}
                    >
                      <span role="cell">{index + 1}</span>
                      <span role="cell"><i className={move.movedBy === "红方" ? "red" : "black"}/><strong>{move.notation}</strong>{quality?.grade && <em className={`move-quality-mini grade-${quality.grade}`}>{quality.grade}</em>}{move.comment && <MessageSquare className="comment-marker" size={11}/>} {move.isMainline && <small>主线</small>}</span>
                      <span role="cell" className={move.mate != null ? "mate-score" : ""}>{quality?.score != null ? `${quality.score}分` : formatMoveScore(move)}</span>
                    </button>
                  );
                })}
                </div>
              </div>
              {board.currentNode && (
                <div className="node-editor">
                  <input disabled={isPlaying} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="当前着法注释" />
                  <button className="tool-button" disabled={isPlaying} title="保存注释" onClick={() => void saveComment()}><Save size={14}/></button>
                  <button className="tool-button" disabled={isPlaying} title="设为主线" onClick={() => void makeMainline(board.currentNode!)}><ListStart size={14}/></button>
                  <button className="tool-button danger" disabled={isPlaying} title="删除节点" onClick={() => void removeNode(board.currentNode!)}><Trash2 size={14}/></button>
                </div>
              )}
              <div className="branch-list">
                <div className="branch-heading"><strong>变招列表</strong><span>{board.branches.length}</span></div>
                {board.branches.length === 0
                  ? <p className="empty-branch">在当前局面落子以建立分支</p>
                  : board.branches.map((move, index) => (
                    <div
                      className="branch-row"
                      key={move.id}
                      draggable={!isPlaying}
                      onDragStart={() => setDraggedBranch(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => { if (draggedBranch != null) void reorderBranch(draggedBranch, index); setDraggedBranch(null); }}
                    >
                      <GripVertical className="branch-grip" size={13}/>
                      <button className="branch-move" disabled={isPlaying} title={`${move.movedBy} · ICCS ${move.iccs}`} onClick={() => void navigateTo(move.id)}><GitBranch size={12}/><span>{move.notation}</span><small>{formatMoveScore(move)}</small></button>
                      <button className="tool-button branch-order" disabled={isPlaying || index === 0} title="上移变招" onClick={() => void reorderBranch(index, index - 1)}>↑</button>
                      <button className="tool-button branch-order" disabled={isPlaying || index === board.branches.length - 1} title="下移变招" onClick={() => void reorderBranch(index, index + 1)}>↓</button>
                      <button className="tool-button" disabled={isPlaying} title="设为主线" onClick={() => void makeMainline(move.id)}><ListStart size={13}/></button>
                      <button className="tool-button danger" disabled={isPlaying} title="删除分支" onClick={() => void removeNode(move.id)}><Trash2 size={13}/></button>
                    </div>
                  ))}
              </div>
            </div></div>}
            {workspacePanel === "trend" && <div id="workspace-panel-trend" className="review-empty-or-content trend-review" role="tabpanel" aria-labelledby="workspace-tab-trend">
              {evaluationTrend.length === 0
                ? <div className="empty-review"><BarChart3 size={24}/><strong>暂无局势曲线</strong><span>分析棋谱节点后，这里会按红方视角显示历史分数</span></div>
                : <>
                  <div className="trend-legend"><span>红方优势</span><strong>{evaluation?.scoreText}</strong><span>黑方优势</span></div>
                  <svg
                    className="trend-chart-large"
                    viewBox="0 0 300 120"
                    preserveAspectRatio="none"
                    role="group"
                    aria-label="可拖动的历史局面分数趋势"
                    tabIndex={0}
                    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateTrendCursor(event); }}
                    onPointerMove={(event) => { if (event.buttons) updateTrendCursor(event); }}
                    onPointerUp={() => releaseTrendCursor()}
                    onKeyDown={trendKeyDown}
                  >
                    <rect className="trend-equal-band" x="10" y="58" width="280" height="4"/>
                    <line className="trend-grid top" x1="10" y1="20" x2="290" y2="20"/>
                    <line className="trend-grid upper" x1="10" y1="40" x2="290" y2="40"/>
                    <line className="trend-grid middle" x1="10" y1="60" x2="290" y2="60"/>
                    <line className="trend-grid lower" x1="10" y1="80" x2="290" y2="80"/>
                    <line className="trend-grid bottom" x1="10" y1="100" x2="290" y2="100"/>
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
                      <line className="trend-current-line" x1={visibleTrendPoint.x} y1="12" x2={visibleTrendPoint.x} y2="108"/>
                      <circle className="trend-current-halo" cx={visibleTrendPoint.x} cy={visibleTrendPoint.y} r="7"/>
                      <circle className="trend-current-node" cx={visibleTrendPoint.x} cy={visibleTrendPoint.y} r="3.5"/>
                      <g className={`trend-marker-label ${visibleTrendPoint.scoreCp >= 0 ? "red" : "black"}`} transform={`translate(${trendMarkerX} ${trendMarkerY})`}>
                        <rect width="84" height="14" rx="3"/>
                        <text x="4" y="10">{trendMarkerText}</text>
                      </g>
                    </>}
                  </svg>
                  <div className="trend-axis"><span>+1000 / +500 / 0 / -500 / -1000</span><span>{visibleTrendPoint ? `${visibleTrendPoint.label} · ${formatRedScore(visibleTrendPoint.scoreCp)}${visibleTrendDelta != null ? ` · 变化 ${formatRedScore(visibleTrendDelta)}` : ""}` : "拖动趋势线，松开定位"}</span><span>第 {board.history.length} 着</span></div>
                  {trendTurns.length > 0 && <section className="trend-turning-list"><header><strong>关键转折</strong><span>分差变化 ≥ 120</span></header>{trendTurns.map((turn) => <button key={turn.nodeId ?? turn.label} onClick={() => turn.nodeId && void navigateTo(turn.nodeId)}><span className={turn.severity}/><strong>{turn.label}</strong><small>{turn.deltaCp > 0 ? "红方" : "黑方"}获益 {Math.abs(Math.round(turn.deltaCp))}</small></button>)}</section>}
                </>}
            </div>}
            {workspacePanel === "summary" && <div id="workspace-panel-summary" className="review-empty-or-content report-review" role="tabpanel" aria-labelledby="workspace-tab-summary">
              {reports.length === 0
                ? <div className="empty-review"><ClipboardList size={24}/><strong>暂无分析摘要</strong><span>录入并分析着法后生成逐着局面变化</span></div>
                : reports.map((report) => {
                  const feedback = report.grade ? moveQualityFeedback(report.grade, report.missedMate) : undefined;
                  const reportPosition = reportPositionByNode.get(report.move.id);
                  const opening = reportPosition?.position.opening;
                  const bestNotation = reportPosition?.before?.bestNotation;
                  const recommendationDepth = reportPosition?.before?.depth ?? gameReport?.analysisDepth ?? desktopPreferences.reportDepth;
                  const thought = moveThoughtHint({
                    notation: report.move.notation,
                    movedBy: report.move.movedBy,
                    grade: report.grade,
                    missedMate: report.missedMate,
                    opening,
                    bestNotation,
                    deltaCp: report.deltaCp,
                  });
                  return <button className={`report-row ${report.grade ? `grade-${report.grade}` : ""} ${report.missedMate ? "missed-mate" : ""} ${board.currentNode === report.move.id ? "active" : ""}`} key={report.move.id} onClick={() => void navigateTo(report.move.id)}>
                    <span className="report-number">{report.index + 1}</span>
                    <span className={`report-side ${report.move.movedBy === "红方" ? "red" : "black"}`}/>
                    <span className="report-move" title={feedback?.description}>
                      <strong>{report.move.notation}{report.grade && <em className={`report-inline-grade grade-${report.grade}`}>{report.grade}</em>}{report.missedMate && <em className="missed-mate-chip">漏杀</em>}</strong>
                      <small>{report.move.movedBy} · {formatScoreDelta(report.deltaCp)}{feedback ? ` · ${feedback.hint}` : ""}{opening ? ` · 官着 ${opening.name}` : ""}{bestNotation ? ` · 深度${recommendationDepth}推荐 ${bestNotation}` : ""}</small>
                      <small className="report-move-thought">{thought}</small>
                    </span>
                    <span className="report-position-score" title="Pikafish 局面分，正数表示红方占优，负数表示黑方占优"><small>局面</small><b>{formatReportScore(report.move, report.redScoreCp)}</b></span>
                    {report.grade && report.score != null
                      ? <span className={`report-quality grade-${report.grade}`} title={`${feedback?.hint}：${feedback?.description}。单着质量 ${report.score} 分，等级 ${report.grade}`}><b>{report.grade}</b><small>{report.score}分</small></span>
                      : <span className="report-quality pending"><b>-</b><small>待分析</small></span>}
                  </button>
                })}
              <p className="report-note">局面分表示当前优劣；质量分表示该着相对前一局面的表现。</p>
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
        </aside>
      </main>
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
              <p>曲线在 0 上方表示红方占优，局面分 &gt; 0；曲线在 0 下方表示黑方占优，局面分 &lt; 0。局面分近似理解：1000 分相当于多一个车，500 相当于多一个马或炮，200 相当于多一个过河兵，100 相当于多一个兵。50 分以内可能有计算误差，可忽略不计。</p>
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
                  return <button key={`${row}-${col}`} onClick={() => editSquare(row, col)} aria-label={`编辑 ${squareToIccs(row, col)}`}>{piece && <img src={pieceAsset(piece)} alt={piece.label}/>}</button>;
                })}
              </div>
              <aside className="editor-tools">
                <div className="piece-palette">
                  {editorPalette.map((piece) => <button key={`${piece.color}-${piece.kind}`} className={editorPiece?.color === piece.color && editorPiece.kind === piece.kind ? "active" : ""} onClick={() => setEditorPiece(piece)}><img src={pieceAsset(piece)} alt={`${piece.color === "red" ? "红" : "黑"}${piece.label}`}/></button>)}
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
      <nav className="mobile-nav" aria-label="移动端导航">
        <button className={mobilePanel === "board" ? "active" : ""} onClick={() => setMobilePanel("board")}><LayoutGrid size={19}/><span>棋盘</span></button>
        <button className={mobilePanel === "library" ? "active" : ""} onClick={() => setMobilePanel("library")}><BookOpen size={19}/><span>棋谱</span></button>
        <button className={mobilePanel === "analysis" ? "active" : ""} onClick={() => setMobilePanel("analysis")}><Activity size={19}/><span>分析</span></button>
        <button className={mobilePanel === "settings" ? "active" : ""} onClick={() => setMobilePanel("settings")}><Settings2 size={19}/><span>设置</span></button>
      </nav>
    </div>
  );
}

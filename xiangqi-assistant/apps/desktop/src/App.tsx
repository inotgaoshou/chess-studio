import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
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
  FolderOpen,
  GitBranch,
  GitFork,
  GripVertical,
  Link,
  LayoutGrid,
  ListStart,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  TrendingUp,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { chessPlatform, type AnalysisLine, type BoardState, type EngineRuntimeState, type GameSummary, type MoveItem, type Piece } from "./platform";
import { moveReports, positionEvaluation, trendPoints } from "./analysisView";


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
const reviewPanels = ["moves", "trend", "report"] as const;
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
  const score = ((line.scoreCp ?? 0) / 100).toFixed(2);
  return (line.scoreCp ?? 0) > 0 ? `+${score}` : score;
}

function formatMoveScore(move: MoveItem) {
  if (move.mate != null) return move.mate >= 0 ? `杀${move.mate}` : `被杀${Math.abs(move.mate)}`;
  if (move.scoreCp == null) return "";
  const score = (move.scoreCp / 100).toFixed(2);
  return move.scoreCp > 0 ? `+${score}` : score;
}

function formatRedScore(scoreCp?: number) {
  if (scoreCp == null) return "待分析";
  const score = (scoreCp / 100).toFixed(2);
  return scoreCp > 0 ? `+${score}` : score;
}

function formatScoreDelta(scoreCp?: number) {
  if (scoreCp == null) return "缺少相邻局面分数";
  const score = (scoreCp / 100).toFixed(2);
  return `红方视角 ${scoreCp >= 0 ? "+" : ""}${score}`;
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
  const [reviewPanel, setReviewPanel] = useState<"moves" | "trend" | "report">("moves");
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
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const boardRevision = useRef(0);
  const analysisLoadRevision = useRef(0);
  const boardRef = useRef<BoardState>(fallback);
  const analysisBusyRef = useRef(false);
  const pendingAutoAnalysis = useRef(false);
  const playbackRevision = useRef(0);
  const navigationRevision = useRef(0);
  const boardOperationQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void chessPlatform.initialize()
      .then((state) => {
        applyBoard(state);
        void loadSavedAnalysis(state.fen ?? startingFen);
        void refreshGames();
        if (chessPlatform.kind === "web") setNotice("离线棋谱已就绪");
      })
      .catch((error) => setNotice(friendlyError(error)));
    void chessPlatform.detectEngine()
      .then((path) => {
        if (path) {
          setEnginePath(path);
          setNotice("已自动识别 Pikafish 2026");
        }
      })
      .catch(() => undefined);
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
    try {
      localStorage.setItem("xiangqi:auto-analysis", String(autoAnalyze));
    } catch {
      // Preference persistence is optional in restricted browser contexts.
    }
  }, [autoAnalyze]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void chessPlatform.subscribeEngineEvents((event) => {
      if (disposed) return;
      if (event.type === "state") {
        setEngineRuntimeState(event.state);
        setEngineThinking(event.state === "thinking");
      } else if (event.type === "info") {
        setAnalysis((current) => [...current.filter((line) => line.multipv !== event.line.multipv), event.line]
          .sort((left, right) => left.multipv - right.multipv));
      } else if (event.type === "bestmove") {
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
    if (isPlaying) return;
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
  }, [autoAnalyze, autoRetry, board.currentNode, board.fen, board.playable, enginePath, engineSide, engineThinking, hashMb, isPlaying, multipv, online, searchMode, searchValue, serverUrl, threads, token]);

  const pieceMap = useMemo(() => new Map(board.pieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [board.pieces]);
  const editorPieceMap = useMemo(() => new Map(editorPieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [editorPieces]);
  const cells = useMemo(() => Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), []);
  const lastMove = board.history.at(-1);
  const evaluation = useMemo(() => positionEvaluation(board, analysis), [analysis, board]);
  const evaluationTrend = useMemo(() => trendPoints(evaluation?.samples ?? [], board.history.length), [board.history.length, evaluation]);
  const reports = useMemo(() => moveReports(board.history), [board.history]);
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

  async function selectSquare(row: number, col: number) {
    stopPlayback();
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
    try {
      await enqueueBoardOperation(() => chessPlatform.navigateTo(boardRef.current.currentNode));
      const next = normalizeBoardState(await enqueueBoardOperation(() => chessPlatform.playMove(iccs)));
      applyBoard(next);
      setAnalysis([]);
      setNotice(`已记录 ${next.history.at(-1)?.notation ?? iccs}`);
      await requestEngineMove(next);
    } catch (error) {
      setNotice(friendlyError(error));
    }
    setSelected(null);
  }

  async function createGame(fen = fenInput) {
    stopPlayback();
    stopEnginePlay();
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.newGame(fen)));
      await refreshGames();
      setSelected(null);
      setAnalysis([]);
      setNotice("已创建新棋谱");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function openDocument() {
    stopPlayback();
    stopEnginePlay();
    try {
      const next = await enqueueBoardOperation(() => chessPlatform.openDocument());
      if (!next) return;
      applyBoard(next);
      setAnalysis([]);
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
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.pasteDocument()));
      setAnalysis([]);
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
      applyBoard(await enqueueBoardOperation(() => chessPlatform.newGame(fen, gameTitle.trim() || "研究局面", gameNote)));
      setAnalysis([]);
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
      applyBoard(await enqueueBoardOperation(() => chessPlatform.reorderBranches(ordered)));
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

  async function requestEngineMove(state = boardRef.current, side = engineSide) {
    if (chessPlatform.kind !== "desktop" || side === "none" || !isEngineTurn(state, side) || engineThinking) return;
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
    try {
      const next = await enqueueBoardOperation(() => chessPlatform.openGame(gameId));
      applyBoard(next);
      setSelected(null);
      await loadSavedAnalysis(next.fen ?? startingFen);
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
      await loadSavedAnalysis(next.fen ?? board.fen);
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
        setReviewPanel("moves");
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

  function handleReviewTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? reviewPanels.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + reviewPanels.length) % reviewPanels.length;
    const nextPanel = reviewPanels[nextIndex];
    setReviewPanel(nextPanel);
    window.requestAnimationFrame(() => document.getElementById(`review-tab-${nextPanel}`)?.focus());
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
      applyBoard(await enqueueBoardOperation(() => chessPlatform.setMainline(nodeId)));
      setNotice("已设为主线");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function removeNode(nodeId: string) {
    stopPlayback();
    try {
      applyBoard(await enqueueBoardOperation(() => chessPlatform.deleteNode(nodeId)));
      setAnalysis([]);
      setNotice("节点已删除");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function synchronize() {
    if (!token.trim()) {
      setNotice("请先填写登录令牌");
      return;
    }
    setSyncBusy(true);
    try {
      const result = await chessPlatform.synchronize(serverUrl, token);
      applyBoard(await chessPlatform.initialize());
      await refreshGames();
      setNotice(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}`);
    } catch (error) {
      setNotice(friendlyError(error));
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div className={`app-shell ${chessPlatform.kind}-shell`}>
      <header className="titlebar">
        <div className="window-brand"><span className="brand-seal">象</span><strong>棋研</strong><small>XIANGQI STUDIO</small></div>
        <strong className="window-title">棋研工作台</strong>
        <div className="window-state"><span className={analysisBusy ? "pulse" : ""} />{notice}</div>
      </header>

      <nav className="menubar" aria-label="主菜单">
        <div className="menu-items">
          <details><summary>棋局</summary><div className="menu-popup">
            <button onClick={() => void createGame(startingFen)}><Plus size={14}/>新建棋局</button>
            <button onClick={() => void openDocument()}><FolderOpen size={14}/>打开棋谱</button>
            <button onClick={() => void saveDocument()}><Save size={14}/>保存棋谱</button>
            <button onClick={() => void saveDocument(true)}><Save size={14}/>另存为 PGN</button>
          </div></details>
          <details><summary>局面</summary><div className="menu-popup">
            <button onClick={openPositionEditor}><LayoutGrid size={14}/>编辑局面</button>
            <button onClick={() => setReversed((value) => !value)}><RotateCcw size={14}/>翻转棋盘</button>
            <button onClick={() => void copyPosition()}><Copy size={14}/>复制局面 FEN</button>
            <button onClick={() => void pasteDocument()}><ClipboardPaste size={14}/>粘贴局面或棋谱</button>
          </div></details>
          <details><summary>棋谱</summary><div className="menu-popup">
            <button onClick={() => void copyGame()}><Copy size={14}/>复制完整棋谱</button>
            <button onClick={() => void copyGame(true)}><ClipboardList size={14}/>复制当前主线</button>
            <button onClick={() => void pasteDocument()}><ClipboardPaste size={14}/>粘贴文本棋谱</button>
            <button onClick={() => void goToNextBranchPoint()}><GitFork size={14}/>跳到下个分支点</button>
          </div></details>
          <details><summary>引擎</summary><div className="menu-popup">
            <button className={engineSide === "red" ? "active" : ""} onClick={() => toggleEngineSide("red")}><Bot size={14}/>引擎执红</button>
            <button className={engineSide === "black" ? "active" : ""} onClick={() => toggleEngineSide("black")}><Bot size={14}/>引擎执黑</button>
            <button disabled={!engineThinking} onClick={() => void moveNow()}><Zap size={14}/>立即出招</button>
            <button disabled={!board.playable || analysisBusy} onClick={() => void runAnalysis()}><Zap size={14}/>分析当前局面</button>
            <button onClick={() => document.getElementById("engine-path")?.focus()}><Settings2 size={14}/>引擎设置</button>
          </div></details>
          <button className="menu-command" onClick={() => setMobilePanel("settings")}>同步</button>
        </div>
        <div className="engine-chip"><Activity size={13}/><strong>Pikafish</strong><span>{chessPlatform.kind === "web" ? online ? "云端" : "离线" : enginePath ? engineRuntimeLabel[engineRuntimeState] : "未检测"}</span></div>
      </nav>

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
        <button className={`mode-tool engine-side ${engineSide === "red" ? "active" : ""}`} disabled={!board.playable} onClick={() => toggleEngineSide("red")}><Bot size={15}/>引擎红</button>
        <button className={`mode-tool engine-side ${engineSide === "black" ? "active" : ""}`} disabled={!board.playable} onClick={() => toggleEngineSide("black")}><Bot size={15}/>引擎黑</button>
        <button className="tool-button" title="立即出招" disabled={!engineThinking} onClick={() => void moveNow()}><Zap size={15}/></button>
        <button className="tool-button" title="引擎设置" onClick={() => document.getElementById("engine-path")?.focus()}><Settings2 size={16}/></button>
      </div>

      <main className="workspace">
        <aside className={`library-panel ${mobilePanel === "library" || mobilePanel === "settings" ? "mobile-visible" : ""} ${mobilePanel === "settings" ? "mobile-settings-mode" : ""}`}>
          <div className="pane-title"><strong>棋谱库</strong><button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={15}/></button></div>
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
          <section className="sync-box">
            <div className="sync-title"><Link size={14}/><strong>个人同步</strong></div>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} aria-label="同步服务地址" />
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="登录令牌" aria-label="登录令牌" />
            <button onClick={() => void synchronize()} disabled={syncBusy}>{syncBusy ? "同步中…" : "立即同步"}</button>
          </section>
        </aside>

        <section className={`board-section ${mobilePanel === "board" ? "mobile-visible" : ""}`}>
          <div className="board-stage">
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
          </div>
          <div className="board-statusbar">
            {lastMove && <span className="last-move-status">上一着：<strong>{lastMove.movedBy}</strong> {lastMove.notation}</span>}
            {lastMove && <span className="status-separator" />}
            <span className={`turn-dot ${board.sideToMove === "红方" ? "red" : "black"}`} />
            <strong>{board.sideToMove}行棋</strong>
            <span>{board.status}</span>
            <span className="status-spacer" />
            <span className="board-meta">节点 {board.history.length}</span>
            <span className="board-meta">{reversed ? "黑方视角" : "红方视角"}</span>
          </div>
          {primaryAnalysis && (
            <div className="engine-livebar">
              <span>
                深度 {primaryAnalysis.depth ?? "-"} · PV {primaryAnalysis.multipv} · 分数 {formatAnalysisScore(primaryAnalysis)} · NPS {formatNps(primaryAnalysis.nps)} · 时间 {((primaryAnalysis.timeMs ?? 0) / 1000).toFixed(1)}s
                {primaryMove ? ` · ${primaryMove}` : ""}
              </span>
              <strong>{searchLimitLabel}</strong>
            </div>
          )}
          <div className="fen-row">
            <label>FEN</label>
            <input value={fenInput} onChange={(event) => setFenInput(event.target.value)} />
            <button onClick={() => void createGame()}>载入</button>
          </div>
        </section>

        <aside className={`analysis-panel ${mobilePanel === "analysis" ? "mobile-visible" : ""}`}>
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
              <div className="engine-config-row">
                <label className="path-field"><span>引擎</span><input id="engine-path" value={enginePath} onChange={(event) => setEnginePath(event.target.value)} placeholder="pikafish 路径" /></label>
                <label className="engine-number" title="引擎线程数"><span>线程</span><input aria-label="线程" type="number" min={1} max={64} value={threads} onChange={(event) => setThreads(Number(event.target.value))}/></label>
                <label className="engine-number" title="置换表大小"><span>Hash</span><input aria-label="Hash MB" type="number" min={16} max={4096} step={16} value={hashMb} onChange={(event) => setHashMb(Number(event.target.value))}/><small>MB</small></label>
                <label className="engine-number" title="候选线路数量"><span>PV</span><input aria-label="MultiPV" type="number" min={1} max={10} value={multipv} onChange={(event) => setMultipv(Number(event.target.value))}/></label>
              </div>
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
            {evaluation && (
              <div className="position-evaluation">
                <div className="evaluation-heading">
                  <span><TrendingUp size={13}/>局面趋势</span>
                  <strong>{evaluation.label}</strong>
                </div>
                <div className="evaluation-score-row">
                  <strong>{evaluation.scoreText}</strong>
                  <span>{evaluation.deltaText ?? "当前局面基准"}</span>
                  <small>{evaluation.detail}</small>
                </div>
                <div className="evaluation-balance" title={`红方占比 ${evaluation.redShare.toFixed(0)}%`}>
                  <span className="red-label">红</span>
                  <div><i style={{ width: `${evaluation.redShare}%` }}/></div>
                  <span className="black-label">黑</span>
                </div>
                {evaluationTrend.length > 0 && (
                  <svg className="trend-chart" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="历史局面分数趋势">
                    <line x1="10" y1="28" x2="290" y2="28"/>
                    <polyline points={evaluationTrend.map((point) => `${point.x},${point.y}`).join(" ")}/>
                    {evaluationTrend.map((point, index) => (
                      <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r={index === evaluationTrend.length - 1 ? 3.5 : 2.2}>
                        <title>{point.label}：{point.scoreCp > 0 ? "+" : ""}{(point.scoreCp / 100).toFixed(2)}</title>
                      </circle>
                    ))}
                  </svg>
                )}
              </div>
            )}
            <div className="section-title"><strong>引擎输出</strong><span>MultiPV {multipv}</span></div>
            <div className="analysis-lines">
              {analysis.length === 0
                ? <div className="empty-analysis"><Activity size={24}/><strong>等待分析</strong><span>启动 Pikafish 后显示候选线路</span></div>
                : orderedAnalysis.map((line) => (
                  <article className="pv-line" key={line.multipv} style={{ "--pv-color": analysisArrowColors[line.multipv - 1] ?? "transparent" } as CSSProperties} title={`ICCS: ${line.pv.join(" ")}`}>
                    <div className="pv-meta">
                      <span>深度 {line.depth ?? "-"}</span>
                      <span>PV {line.multipv}</span>
                      <strong>分数 {formatAnalysisScore(line)}</strong>
                      <span>NPS {formatNps(line.nps)}</span>
                      <span>时间 {((line.timeMs ?? 0) / 1000).toFixed(1)}s</span>
                    </div>
                    <p>{line.notation?.length ? line.notation.join("  ") : line.pv.join("  ")}</p>
                  </article>
                ))}
            </div>
          </section>

          <section className="move-tree">
            <div className="review-tabs" role="tablist" aria-label="复盘视图">
              <button id="review-tab-moves" role="tab" aria-controls="review-panel-moves" aria-selected={reviewPanel === "moves"} tabIndex={reviewPanel === "moves" ? 0 : -1} className={reviewPanel === "moves" ? "active" : ""} onKeyDown={(event) => handleReviewTabKey(event, 0)} onClick={() => setReviewPanel("moves")}><BookOpen size={12}/>棋谱</button>
              <button id="review-tab-trend" role="tab" aria-controls="review-panel-trend" aria-selected={reviewPanel === "trend"} tabIndex={reviewPanel === "trend" ? 0 : -1} className={reviewPanel === "trend" ? "active" : ""} onKeyDown={(event) => handleReviewTabKey(event, 1)} onClick={() => setReviewPanel("trend")}><BarChart3 size={12}/>局势图</button>
              <button id="review-tab-report" role="tab" aria-controls="review-panel-report" aria-selected={reviewPanel === "report"} tabIndex={reviewPanel === "report" ? 0 : -1} className={reviewPanel === "report" ? "active" : ""} onKeyDown={(event) => handleReviewTabKey(event, 2)} onClick={() => setReviewPanel("report")}><ClipboardList size={12}/>分析摘要</button>
            </div>
            <div className="playback-controls" aria-label="棋谱播放控制">
              <button title="回到开局" disabled={!board.currentNode} onClick={() => void navigateTo()}><ChevronsLeft size={15}/></button>
              <button title="上一着" disabled={!board.currentNode} onClick={() => void goPrevious()}><ChevronLeft size={15}/></button>
              <button className={isPlaying ? "active" : ""} title={isPlaying ? "暂停播放" : "播放主线"} disabled={board.history.length === 0 && board.branches.length === 0} onClick={() => void togglePlayback()}>{isPlaying ? <Pause size={14}/> : <Play size={14}/>}</button>
              <button title="下一着" disabled={!preferredContinuation(board)} onClick={() => void goNext()}><ChevronRight size={15}/></button>
              <button title="前往主线终局" disabled={!preferredContinuation(board)} onClick={() => void goToEnd()}><ChevronsRight size={15}/></button>
              <button className="variation-jump" title="下变：跳到下一个分支点" disabled={!preferredContinuation(board)} onClick={() => void goToNextBranchPoint()}><GitFork size={13}/><small>下变</small></button>
              <span>第 <strong>{board.history.length}</strong> 着</span>
            </div>
            {reviewPanel === "moves" && <div id="review-panel-moves" className="move-review-pane" role="tabpanel" aria-labelledby="review-tab-moves">
              <div className="move-table" role="table" aria-label="棋谱着法">
                <div className="move-table-head" role="row">
                  <span role="columnheader">序号</span><span role="columnheader">着法</span><span role="columnheader">分数</span>
                </div>
                <div className="move-table-body" role="rowgroup">
                  <button className={`move-table-row root ${!board.currentNode ? "active" : ""}`} role="row" onClick={() => void navigateTo()}>
                    <span role="cell">0</span><span role="cell"><GitBranch size={12}/>开始局面</span><span role="cell" />
                  </button>
                {board.history.map((move, index) => (
                    <button
                      className={`move-table-row ${board.currentNode === move.id ? "active" : ""}`}
                      key={move.id}
                      role="row"
                      title={`${move.movedBy} · ICCS ${move.iccs}`}
                      onClick={() => void navigateTo(move.id)}
                    >
                      <span role="cell">{index + 1}</span>
                      <span role="cell"><i className={move.movedBy === "红方" ? "red" : "black"}/><strong>{move.notation}</strong>{move.comment && <MessageSquare className="comment-marker" size={11}/>} {move.isMainline && <small>主线</small>}</span>
                      <span role="cell" className={move.mate != null ? "mate-score" : ""}>{formatMoveScore(move)}</span>
                    </button>
                ))}
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
            </div>}
            {reviewPanel === "trend" && <div id="review-panel-trend" className="review-empty-or-content trend-review" role="tabpanel" aria-labelledby="review-tab-trend">
              {evaluationTrend.length === 0
                ? <div className="empty-review"><BarChart3 size={24}/><strong>暂无局势曲线</strong><span>分析棋谱节点后，这里会按红方视角显示历史分数</span></div>
                : <>
                  <div className="trend-legend"><span>红方优势</span><strong>{evaluation?.scoreText}</strong><span>黑方优势</span></div>
                  <svg className="trend-chart-large" viewBox="0 0 300 120" preserveAspectRatio="none" role="group" aria-label="可点击的历史局面分数趋势">
                    <line className="trend-grid top" x1="10" y1="20" x2="290" y2="20"/>
                    <line className="trend-grid middle" x1="10" y1="60" x2="290" y2="60"/>
                    <line className="trend-grid bottom" x1="10" y1="100" x2="290" y2="100"/>
                    <polyline points={evaluationTrend.map((point) => `${point.x},${60 + (point.y - 28) * 1.8}`).join(" ")}/>
                    {evaluationTrend.map((point, index) => (
                      <circle
                        className={point.nodeId === board.currentNode ? "current" : ""}
                        key={`${point.label}-${index}`}
                        cx={point.x}
                        cy={60 + (point.y - 28) * 1.8}
                        r={point.nodeId === board.currentNode ? 5 : 3.5}
                        tabIndex={point.nodeId ? 0 : undefined}
                        role={point.nodeId ? "button" : undefined}
                        aria-label={point.nodeId ? `${point.label}，红方视角 ${formatRedScore(point.scoreCp)}，点击定位` : undefined}
                        onClick={() => point.nodeId && void navigateTo(point.nodeId)}
                        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && point.nodeId) void navigateTo(point.nodeId); }}
                      ><title>{point.label}：{formatRedScore(point.scoreCp)}</title></circle>
                    ))}
                  </svg>
                  <div className="trend-axis"><span>开局</span><span>红方视角，点击节点定位</span><span>第 {board.history.length} 着</span></div>
                </>}
            </div>}
            {reviewPanel === "report" && <div id="review-panel-report" className="review-empty-or-content report-review" role="tabpanel" aria-labelledby="review-tab-report">
              {reports.length === 0
                ? <div className="empty-review"><ClipboardList size={24}/><strong>暂无分析摘要</strong><span>录入并分析着法后生成逐着局面变化</span></div>
                : reports.map((report) => (
                  <button className={`report-row ${board.currentNode === report.move.id ? "active" : ""}`} key={report.move.id} onClick={() => void navigateTo(report.move.id)}>
                    <span className="report-number">{report.index + 1}</span>
                    <span className={`report-side ${report.move.movedBy === "红方" ? "red" : "black"}`}/>
                    <span className="report-move"><strong>{report.move.notation}</strong><small>{report.move.movedBy} · {formatScoreDelta(report.deltaCp)}</small></span>
                    <span className="report-score">{formatReportScore(report.move, report.redScoreCp)}</span>
                    {report.grade ? <span className={`report-grade grade-${report.grade}`}>{report.grade}</span> : <span className="report-grade pending">-</span>}
                  </button>
                ))}
              <p className="report-note">评价依据相邻已分析局面的分数变化，仅作复盘提示。</p>
            </div>}
          </section>
        </aside>
      </main>
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

import { ManualMoveSuggestion } from "./ManualMoveSuggestion";
import { ManualShareDialog } from "./ManualShareDialog";
import { ManualSaveDialog, isImeEnter, type ManualSaveValues } from "./ManualSaveDialog";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheckBig, CircleHelp, ClipboardCopy, ClipboardList, Clock3, Cpu, Database, Ellipsis, Eye, EyeOff, FilePenLine, FileUp, FlipVertical2, Folder, Lightbulb, Link, ListRestart, Minus, Palette, Pause, Pencil, Play, Plus, RotateCcw, Search, Settings2, Square as StopIcon, Trash2, Undo2, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { trainingStore } from "./store";
import type { Attempt, BoardPiece, BoardState, LocalManualAnalysisSummary, LocalManualFolder, LocalManualGame, MobileWorkspaceMode, RuleMode, SolutionMove, TrainingLibrary, TrainingProblem } from "./types";
import { acceptsMove, boardAt, cancelPikafishSearch, chineseLine, hasLocalPikafish, parseCbl, parseCblGames, queryCloudBook, queryPikafishAnalysis, queryPikafishReply, type CloudBookMove, type PikafishAnalysisLine } from "./wasm";
import { deriveTrainingFeedback, playTrainingFeedback, TRAINING_FEEDBACK_PACK, type TrainingFeedbackKind } from "./moveFeedback";
import { setPreferredOrientation, type PreferredOrientation } from "./orientation";
import { DEFAULT_SKIN_ID, LEGACY_DEFAULT_SKIN_ID, SKIN_CATALOG, normalizeSkinId, skinById, type SkinCatalogItem } from "./skinCatalog";
import { StudyManualTree, type StudyManualBranch } from "./StudyManualTree";
import { applyTrainingLogicSidecar, trainingLogicHint, trainingLogicMiss } from "./logicSidecar";

type Mode = "cloud" | "ai" | "solver" | "replay" | "free";
type StudyPanelTab = "engine" | "cloud" | "manual";
type ManualPanelTab = "moves" | "analysis" | "library";
type ManualAnalysisView = "trend" | "report" | "issues";
type Square = { row: number; col: number };
type AnalysisLine = PikafishAnalysisLine & { notation: string[] };
type StudyBranch = StudyManualBranch;
type ManualBranch = StudyManualBranch;
type BoardGeometry = { columns: readonly number[]; rows: readonly number[] };
type BoardDragState = { from: Square; piece: BoardPiece; x: number; y: number; target?: Square };
type BoardDragCandidate = { pointerId: number; from: Square; piece: BoardPiece; startX: number; startY: number; active: boolean };
type PendingAutoReply = {
  problemId: string;
  activeMode: "cloud" | "ai";
  playerMoves: string[];
  playerFen: string;
  durationAfterMove: number;
};
type StudyStateSnapshot = {
  enabled: boolean;
  tab: StudyPanelTab;
  startingFen: string;
  moves: string[];
  cursor: number;
  branches?: StudyBranch[];
  comments?: Record<string, string>;
  showMoveText?: boolean;
  fenEditorExpanded?: boolean;
};
type ManualSheetState =
  | { type: "gameInfo"; title: string; note: string }
  | { type: "folderCreate"; parent: string; name: string }
  | { type: "folderRename"; target: string; path: string }
  | { type: "folderDelete"; target: string }
  | { type: "gameMove"; game: LocalManualGame; folder: string }
  | { type: "gameDelete"; game: LocalManualGame };
const LOCAL_PIKAFISH_AVAILABLE = hasLocalPikafish();
const SKIN_DEV_TOOLS_ENABLED = import.meta.env.VITE_ENABLE_SKIN_DEV_TOOLS === "true";
const SKIN_DEV_TAP_TARGET = 5;
const SKIN_DEV_UNLOCK_COMMAND = "舒服skin";
const STUDY_STATE_KEY = "xiangqi-training-study-state";
const BOARD_SKIN_KEY = "xiangqi-training-board-skin";
const PIECE_SKIN_KEY = "xiangqi-training-piece-skin";
const SKIN_DEFAULT_MIGRATION_KEY = "xiangqi-training-skin-default-migration-v2";
const modeLabel: Record<Mode, string> = { cloud: LOCAL_PIKAFISH_AVAILABLE ? "云库 + 皮卡鱼" : "云库对练", ai: "本地 AI 对练", solver: "只走解题方", replay: "双方复现", free: "自由实战" };
const fmt = (value: number) => `${String(Math.floor(value / 60000)).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}`;
const compactNumber = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);
const signedAdvantage = (score: number) => score > 0 ? `+${score}` : String(score);
const analysisAdvantage = (line: AnalysisLine, scoreSide: "red" | "black") => {
  const redFactor = scoreSide === "red" ? 1 : -1;
  if (line.mate != null) {
    const redMateSide = (line.mate === 0 ? -1 : Math.sign(line.mate)) * redFactor;
    const mateText = `${Math.abs(line.mate)} 步杀`;
    return redMateSide > 0
      ? { red: `红方 ${mateText}`, black: "黑优 0", compact: `红方 ${mateText}` }
      : { red: "红优 0", black: `黑方 ${mateText}`, compact: `黑方 ${mateText}` };
  }
  const score = Math.round((line.scoreCp ?? 0) * redFactor);
  if (score > 0) return { red: `红优 ${signedAdvantage(score)}`, black: "黑优 0", compact: `红优 ${signedAdvantage(score)}` };
  if (score < 0) return { red: "红优 0", black: `黑优 ${signedAdvantage(Math.abs(score))}`, compact: `黑优 ${signedAdvantage(Math.abs(score))}` };
  return { red: "红优 0", black: "黑优 0", compact: "红优 0" };
};
const analysisScore = (line: AnalysisLine, scoreSide: "red" | "black") => analysisAdvantage(line, scoreSide).compact;
const redWinRate = (line?: AnalysisLine, scoreSide: "red" | "black" = "red") => {
  if (!line) return 50;
  const redFactor = scoreSide === "red" ? 1 : -1;
  if (line.mate != null) {
    const redMateSide = (line.mate === 0 ? -1 : Math.sign(line.mate)) * redFactor;
    return redMateSide > 0 ? 99 : 1;
  }
  const redCp = (line.scoreCp ?? 0) * redFactor;
  return Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-redCp / 520)))));
};
const cloudEvaluation = (move: CloudBookMove, scoreSide: "red" | "black") => {
  const redScore = scoreSide === "red" ? move.score : -move.score;
  const redRate = scoreSide === "red" ? move.winRate : 100 - move.winRate;
  return { redScore, redRate: Math.max(0, Math.min(100, redRate)), blackRate: Math.max(0, Math.min(100, 100 - redRate)) };
};
const squareName = (square: Square) => `${String.fromCharCode(97 + square.col)}${9 - square.row}`;
const iccsSquares = (move: string) => ({ from: { col: move.charCodeAt(0) - 97, row: 9 - Number(move[1]) }, to: { col: move.charCodeAt(2) - 97, row: 9 - Number(move[3]) } });
const mainline = (line: SolutionMove[]) => { const moves: string[] = []; let cursor = line[0]; while (cursor) { moves.push(cursor.iccs); cursor = cursor.children[0]; } return moves; };
const AUTO_REPLY_DELAY_MS = 650;
const STANDARD_STARTING_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const APP_VERSION = __APP_VERSION__;
const APP_BUILD_TIME = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(__APP_BUILD_TIME__));
const CBL_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
const STUDY_RULE_MODE_KEY = "xiangqi-training-study-rule-mode";
const ANALYSIS_ARROWS_VISIBLE_KEY = "xiangqi-training-analysis-arrows-visible";
const STUDY_ENGINE_ENABLED_KEY = "xiangqi-training-study-engine-enabled";
const BOARD_ART_WIDTH = 1120;
const BOARD_ART_HEIGHT = 1240;
const QINGXIN_COLUMNS = [83, 213, 330, 444, 559, 675, 789, 906, 1035];
const QINGXIN_ROWS = [82, 192, 306, 425, 546, 676, 791, 909, 1023, 1136];
const BLACK_FILE_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RED_FILE_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const DEFAULT_BOARD_GEOMETRY: BoardGeometry = { columns: QINGXIN_COLUMNS, rows: QINGXIN_ROWS };
const BOARD_GEOMETRY_BY_SKIN: Record<string, BoardGeometry> = {
  "qingxin-zhuyun": DEFAULT_BOARD_GEOMETRY,
  "skin-bb439484": {
    columns: [83, 203, 324, 442, 561, 678, 796, 913, 1034],
    rows: [82, 200, 317, 433, 554, 679, 793, 910, 1027, 1148],
  },
  "skin-8b6b4eeb": {
    columns: [79, 197, 314, 434, 556, 675, 796, 914, 1040],
    rows: [64, 189, 304, 419, 537, 655, 769, 886, 1002, 1135],
  },
  "skin-8871865b": {
    columns: [85, 206, 323, 442, 558, 677, 796, 911, 1033],
    rows: [79, 197, 318, 436, 559, 685, 801, 920, 1040, 1163],
  },
  "skin-efb016e6": {
    columns: [83, 205, 327, 444, 558, 678, 796, 913, 1034],
    rows: [82, 199, 316, 433, 554, 679, 796, 911, 1028, 1148],
  },
  "skin-f71dbfdb": {
    columns: [83, 206, 327, 444, 558, 678, 794, 913, 1034],
    rows: [82, 200, 317, 432, 555, 679, 796, 909, 1028, 1148],
  },
  "skin-a84084f7": {
    columns: [91, 204, 323, 442, 559, 676, 795, 912, 1039],
    rows: [78, 195, 311, 426, 547, 677, 795, 913, 1032, 1153],
  },
  "skin-a48d1624": {
    columns: [83, 205, 326, 443, 558, 678, 794, 913, 1034],
    rows: [82, 200, 316, 435, 555, 680, 793, 911, 1028, 1148],
  },
  "skin-ca04de9d": {
    columns: [83, 206, 327, 443, 561, 679, 793, 913, 1034],
    rows: [82, 199, 318, 433, 556, 679, 793, 909, 1028, 1148],
  },
  "skin-da64d5ba": {
    columns: [83, 206, 327, 444, 558, 678, 796, 913, 1034],
    rows: [82, 199, 315, 433, 553, 679, 794, 908, 1027, 1148],
  },
  "skin-bad031d6": {
    columns: [63, 191, 309, 431, 551, 671, 790, 908, 1026],
    rows: [69, 187, 309, 432, 556, 673, 793, 919, 1042, 1169],
  },
};
const markerCornerPath = "M -46 -46 H -22 M -46 -46 V -22 M 46 -46 H 22 M 46 -46 V -22 M -46 46 H -22 M -46 46 V 22 M 46 46 H 22 M 46 46 V 22";
const pieceCodes: Record<string, string> = {
  king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p",
};
const pieceKinds = [
  ["king", "帅"], ["advisor", "仕"], ["elephant", "相"], ["horse", "马"], ["rook", "车"], ["cannon", "炮"], ["pawn", "兵"],
] as const;
const MANUAL_SETUP_DEFAULT_PIECES: BoardPiece[] = [
  { row: 0, col: 4, color: "black", kind: "king", label: "将" },
  { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
];
const MANUAL_SETUP_PIECE_LIMITS: Record<string, number> = { king: 1, advisor: 2, elephant: 2, horse: 2, rook: 2, cannon: 2, pawn: 5 };
const MANUAL_SETUP_ADVISOR_POINTS = {
  red: new Set(["7,3", "7,5", "8,4", "9,3", "9,5"]),
  black: new Set(["0,3", "0,5", "1,4", "2,3", "2,5"]),
};
const MANUAL_SETUP_ELEPHANT_POINTS = {
  red: new Set(["5,2", "5,6", "7,0", "7,4", "7,8", "9,2", "9,6"]),
  black: new Set(["0,2", "0,6", "2,0", "2,4", "2,8", "4,2", "4,6"]),
};
function defaultManualSetupPieces() {
  return MANUAL_SETUP_DEFAULT_PIECES.map((piece) => ({ ...piece }));
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function persistentStudyNotice(message: string) {
  return /(失败|错误|不合法|无法|请|暂无|没有|当前轮到|将|杀|和棋|终局|正在分析|正在查询)/.test(message);
}

function readStoredStudyState(): StudyStateSnapshot {
  const fallback: StudyStateSnapshot = { enabled: false, tab: "manual", startingFen: STANDARD_STARTING_FEN, moves: [], cursor: 0, branches: [], comments: {}, showMoveText: false, fenEditorExpanded: false };
  try {
    const raw = localStorage.getItem(STUDY_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StudyStateSnapshot>;
    const moves = Array.isArray(parsed.moves) ? parsed.moves.filter((move): move is string => typeof move === "string" && /^[a-i][0-9][a-i][0-9]$/.test(move)) : [];
    const cursor = Math.max(0, Math.min(moves.length, Math.floor(Number(parsed.cursor) || 0)));
    const tab = parsed.tab === "cloud" || parsed.tab === "manual" || parsed.tab === "engine" ? parsed.tab : "manual";
    const startingFen = typeof parsed.startingFen === "string" && parsed.startingFen.trim() ? parsed.startingFen : STANDARD_STARTING_FEN;
    const branches = Array.isArray(parsed.branches) ? parsed.branches.flatMap((branch): StudyBranch[] => {
      const value = branch as Partial<StudyBranch>;
      const branchMoves = Array.isArray(value.moves) ? value.moves.filter((move): move is string => typeof move === "string" && /^[a-i][0-9][a-i][0-9]$/.test(move)) : [];
      if (!branchMoves.length) return [];
      return [{
        id: typeof value.id === "string" && value.id ? value.id : `branch-${Date.now()}-${branchMoves.join("-")}`,
        parentCursor: Math.max(0, Math.min(moves.length, Math.floor(Number(value.parentCursor) || 0))),
        parentPath: Array.isArray(value.parentPath) ? value.parentPath.filter((move): move is string => typeof move === "string" && /^[a-i][0-9][a-i][0-9]$/.test(move)) : moves.slice(0, Math.max(0, Math.min(moves.length, Math.floor(Number(value.parentCursor) || 0)))),
        moves: branchMoves,
        notation: Array.isArray(value.notation) ? value.notation.filter((item): item is string => typeof item === "string") : branchMoves,
        createdAt: Number(value.createdAt) || Date.now(),
        branchOrder: Number.isFinite(value.branchOrder) ? Math.max(0, Math.floor(Number(value.branchOrder))) : undefined,
      }];
    }) : [];
    const branchGroups = new Map<string, StudyBranch[]>();
    for (const branch of branches) {
      const key = `${branch.parentCursor}|${branch.parentPath.join(",")}`;
      const group = branchGroups.get(key) ?? [];
      group.push(branch);
      branchGroups.set(key, group);
    }
    for (const group of branchGroups.values()) {
      const rawOrders = group.map((branch, index) => Number.isFinite(branch.branchOrder) ? Math.max(0, Math.floor(Number(branch.branchOrder))) : index);
      const minOrder = rawOrders.length ? Math.min(...rawOrders) : 0;
      group.forEach((branch, index) => { branch.branchOrder = rawOrders[index] - minOrder; });
    }
    const comments = parsed.comments && typeof parsed.comments === "object" ? Object.fromEntries(Object.entries(parsed.comments).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
    return { enabled: parsed.enabled === true, tab, startingFen, moves, cursor, branches, comments, showMoveText: parsed.showMoveText === true, fenEditorExpanded: parsed.fenEditorExpanded === true };
  } catch {
    return fallback;
  }
}

function readStoredStudyRuleMode(): RuleMode {
  return localStorage.getItem(STUDY_RULE_MODE_KEY) === "asianAxf" ? "asianAxf" : "domestic2020";
}

function studyRuleLabel(mode: RuleMode) {
  return mode === "asianAxf" ? "亚洲规则" : "国内规则";
}

function terminalResult(status: string | undefined) {
  if (status === "将死") return "绝杀（将死）";
  if (status === "困毙") return "困毙";
  if (status && /(判负|和棋|被将死|困毙)$/.test(status)) return status;
  return undefined;
}

function sideToMove(startingFen: string, moves: string[]) {
  const startsWithBlack = startingFen.trim().split(/\s+/)[1] === "b";
  return (moves.length % 2 === 0) === startsWithBlack ? "black" : "red";
}

function trainingPieceAsset(piece: BoardPiece, skin: string) {
  const code = pieceCodes[piece.kind.toLowerCase()] ?? "p";
  return `/skins/${normalizeSkinId(skin)}/${piece.color === "red" ? "r" : "b"}${code}.png`;
}

function piecesToFen(boardPieces: BoardPiece[], side: "red" | "black" = "red") {
  const bySquare = new Map(boardPieces.map((piece) => [`${piece.row},${piece.col}`, piece]));
  const rows = Array.from({ length: 10 }, (_, row) => {
    let line = "";
    let empty = 0;
    for (let col = 0; col < 9; col += 1) {
      const piece = bySquare.get(`${row},${col}`);
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) { line += String(empty); empty = 0; }
      const code = pieceCodes[piece.kind.toLowerCase()] ?? "p";
      line += piece.color === "red" ? code.toUpperCase() : code;
    }
    return `${line}${empty ? String(empty) : ""}`;
  }).join("/");
  return `${rows} ${side === "red" ? "w" : "b"} - - 0 1`;
}

export function setupPiecePlacementError(piece: Pick<BoardPiece, "color" | "kind" | "label">, square: Square) {
  const key = `${square.row},${square.col}`;
  if (piece.kind === "king") {
    const firstRow = piece.color === "red" ? 7 : 0;
    if (square.col < 3 || square.col > 5 || square.row < firstRow || square.row > firstRow + 2) {
      return `${piece.color === "red" ? "红帅" : "黑将"}只能移到本方九宫格内的空位。`;
    }
  }
  if (piece.kind === "pawn") {
    const red = piece.color === "red";
    const homeSide = red ? square.row >= 5 : square.row <= 4;
    if (red ? square.row > 6 : square.row < 3) return `${piece.label}不能摆在初始兵卒线后方。`;
    if (homeSide && square.col % 2 !== 0) return `${piece.label}未过河不能平走，只能摆在本方兵卒纵线上。`;

  }
  if (piece.kind === "advisor" && !MANUAL_SETUP_ADVISOR_POINTS[piece.color].has(key)) return `${piece.label}只能摆在本方九宫斜线点。`;
  if (piece.kind === "elephant" && !MANUAL_SETUP_ELEPHANT_POINTS[piece.color].has(key)) return `${piece.label}不能过河，只能摆在本方象位。`;
  return "";
}

export function setupValidationError(boardPieces: BoardPiece[]) {
  const keys = new Set<string>();
  const counts = new Map<string, number>();
  for (const piece of boardPieces) {
    if (piece.row < 0 || piece.row > 9 || piece.col < 0 || piece.col > 8) return "有棋子不在棋盘内，请修正后再完成。";
    const placementError = setupPiecePlacementError(piece, piece);
    if (placementError) return placementError;
    const key = `${piece.row},${piece.col}`;
    if (keys.has(key)) return "同一个交叉点不能摆两个棋子。";
    keys.add(key);
    const countKey = `${piece.color}:${piece.kind}`;
    const nextCount = (counts.get(countKey) ?? 0) + 1;
    counts.set(countKey, nextCount);
    if (nextCount > (MANUAL_SETUP_PIECE_LIMITS[piece.kind] ?? 0)) return `${piece.color === "red" ? "红" : "黑"}方${piece.label}数量超过规则上限。`;
  }
  const redKing = boardPieces.filter((piece) => piece.color === "red" && piece.kind === "king");
  const blackKing = boardPieces.filter((piece) => piece.color === "black" && piece.kind === "king");
  if (redKing.length !== 1 || blackKing.length !== 1) return "必须保留双方各一个帅/将。";
  const red = redKing[0];
  const black = blackKing[0];
  if (red.col < 3 || red.col > 5 || red.row < 7 || red.row > 9) return "红帅必须在下方九宫格内。";
  if (black.col < 3 || black.col > 5 || black.row < 0 || black.row > 2) return "黑将必须在上方九宫格内。";
  if (red.col === black.col) {
    const top = Math.min(red.row, black.row);
    const bottom = Math.max(red.row, black.row);
    const blocked = boardPieces.some((piece) => piece.col === red.col && piece.row > top && piece.row < bottom);
    if (!blocked) return "将帅不能白脸相对，请在同列中间补子或移动将帅。";
  }
  return "";
}

function manualSummaryRedScore(summary: Pick<LocalManualAnalysisSummary, "scoreCp" | "mate">, scoreSide: "red" | "black") {
  const redFactor = scoreSide === "red" ? 1 : -1;
  if (summary.mate != null) {
    const redMateSide = (summary.mate === 0 ? -1 : Math.sign(summary.mate)) * redFactor;
    return redMateSide > 0 ? 1200 : -1200;
  }
  return Math.round((summary.scoreCp ?? 0) * redFactor);
}

function manualSummaryLabel(summary: Pick<LocalManualAnalysisSummary, "scoreCp" | "mate"> | undefined, scoreSide: "red" | "black") {
  if (!summary) return "未分析";
  const redFactor = scoreSide === "red" ? 1 : -1;
  if (summary.mate != null) {
    const redMateSide = (summary.mate === 0 ? -1 : Math.sign(summary.mate)) * redFactor;
    return redMateSide > 0 ? `红方 ${Math.abs(summary.mate)} 步杀` : `黑方 ${Math.abs(summary.mate)} 步杀`;
  }
  const score = manualSummaryRedScore(summary, scoreSide);
  if (score > 0) return `红优 ${signedAdvantage(score)}`;
  if (score < 0) return `黑优 ${signedAdvantage(Math.abs(score))}`;
  return "均势 0";
}

function manualNodeId(cursor: number) { return `main:${cursor}`; }
function cleanManualFolderPath(path?: string) {
  return (path ?? "").split("/").map((part) => part.trim()).filter(Boolean).join("/");
}
function manualParentFolder(path?: string) {
  const cleaned = cleanManualFolderPath(path);
  const index = cleaned.lastIndexOf("/");
  return index >= 0 ? cleaned.slice(0, index) : "";
}
function manualFolderLeaf(path: string) {
  return cleanManualFolderPath(path).split("/").filter(Boolean).at(-1) ?? "未命名";
}
function manualFolderBreadcrumbs(path?: string) {
  const parts = cleanManualFolderPath(path).split("/").filter(Boolean);
  return [{ label: "全部", path: "" }, ...parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join("/") }))];
}
function manualChildFolders(folders: LocalManualFolder[], parent?: string) {
  const current = cleanManualFolderPath(parent);
  return folders
    .filter((folder) => manualParentFolder(folder.path) === current)
    .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

export function ManualFolderTree({ folders, currentPath, onSelect }: {
  folders: LocalManualFolder[];
  currentPath: string;
  onSelect(path: string): void;
}) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: "nearest" }); }, [currentPath, folders]);
  const renderChildren = (parent: string) => <ul>{manualChildFolders(folders, parent).map((folder) =>
    <li key={folder.path}>
      <button type="button" ref={folder.path === currentPath ? active : undefined}
        aria-current={folder.path === currentPath ? "location" : undefined}
        aria-label={`目录：${folder.path}`} className={folder.path === currentPath ? "active" : ""}
        onClick={() => onSelect(folder.path)}>
        <Folder/><span>{manualFolderLeaf(folder.path)}</span>
        {folder.path === currentPath && <small>当前</small>}
      </button>
      {manualChildFolders(folders, folder.path).length > 0 && renderChildren(folder.path)}
    </li>)}</ul>;
  return <nav className="manual-folder-tree" aria-label="棋谱目录">
    <button type="button" className={!currentPath ? "active" : ""}
      aria-current={!currentPath ? "location" : undefined} onClick={() => onSelect("")}>全部棋谱</button>
    {folders.length ? renderChildren("") : <p>暂无目录，点击“新目录”创建。</p>}
  </nav>;
}

function renderNote(value: string) {
  return value.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, index) => {
    const match = /^\[b\]([\s\S]*)\[\/b\]$/i.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  });
}

type ZipFile = { name: string; content: string | Uint8Array };

const zipTextEncoder = new TextEncoder();
const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function createZip(files: ZipFile[]) {
  const now = dosTimestamp(new Date());
  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = zipTextEncoder.encode(file.name);
    const data = typeof file.content === "string" ? zipTextEncoder.encode(file.content) : file.content;
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, now.time, true);
    local.setUint16(12, now.day, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, nameBytes.byteLength, true);
    localHeader.set(nameBytes, 30);
    chunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, now.time, true);
    central.setUint16(14, now.day, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, nameBytes.byteLength, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }
  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, offset, true);
  chunks.push(centralDirectory, end);
  const zipBytes = concatBytes(chunks);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
}

function loadSkinImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败：${src}`));
    image.src = src;
  });
}

function canvasToPngBytes(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("棋盘截图生成失败"));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, "image/png");
  });
}

async function renderBoardSnapshotPng({ pieces, boardSkin, pieceSkin, riverText, riverTextColor, riverTextSize, supportsCustomRiverText, flipped }: { pieces: BoardPiece[]; boardSkin: string; pieceSkin: string; riverText: string; riverTextColor: string; riverTextSize: number; supportsCustomRiverText: boolean; flipped: boolean }) {
  const normalizedBoardSkin = normalizeSkinId(boardSkin);
  const normalizedPieceSkin = normalizeSkinId(pieceSkin);
  const geometry = boardGeometryForSkin(normalizedBoardSkin);
  const boardImage = riverText && supportsCustomRiverText ? "board-river-blank.png" : "board.png";
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_ART_WIDTH;
  canvas.height = BOARD_ART_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持棋盘截图 Canvas");
  const board = await loadSkinImage(`/skins/${normalizedBoardSkin}/${boardImage}`);
  context.drawImage(board, 0, 0, BOARD_ART_WIDTH, BOARD_ART_HEIGHT);
  if (riverText && supportsCustomRiverText) {
    context.fillStyle = riverTextColor;
    context.font = `600 ${Math.max(16, Math.min(42, riverTextSize))}px STKaiti, KaiTi, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "2px";
    context.fillText(riverText, BOARD_ART_WIDTH / 2, BOARD_ART_HEIGHT * 0.5);
  }
  for (const piece of pieces) {
    const point = boardPoint(piece, geometry, flipped);
    const image = await loadSkinImage(`/skins/${normalizedPieceSkin}/${piece.color === "red" ? "r" : "b"}${pieceCodes[piece.kind.toLowerCase()] ?? "p"}.png`);
    const x = point.x - 60;
    const y = point.y - 60;
    context.drawImage(image, x, y, 120, 120);
  }
  return canvasToPngBytes(canvas);
}

const displaySquare = (square: Square, flipped: boolean): Square => flipped ? { row: 9 - square.row, col: 8 - square.col } : square;
const sameSquare = (left?: Square, right?: Square) => Boolean(left && right && left.row === right.row && left.col === right.col);
const nearestIndex = (values: readonly number[], target: number) => values.reduce((best, value, index) => Math.abs(value - target) < Math.abs(values[best] - target) ? index : best, 0);
const boardGeometryForSkin = (skin: string): BoardGeometry => BOARD_GEOMETRY_BY_SKIN[normalizeSkinId(skin)] ?? DEFAULT_BOARD_GEOMETRY;
const boardPoint = (square: Square, geometry: BoardGeometry, flipped = false) => {
  const shown = displaySquare(square, flipped);
  return { x: geometry.columns[shown.col], y: geometry.rows[shown.row] };
};
const boardPointStyle = (square: Square, geometry: BoardGeometry, flipped = false) => {
  const point = boardPoint(square, geometry, flipped);
  return {
    "--piece-left": `${point.x / BOARD_ART_WIDTH * 100}%`,
    "--piece-top": `${point.y / BOARD_ART_HEIGHT * 100}%`,
  } as CSSProperties;
};
const ALL_SQUARES = Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 }));

function BoardMarkerLayer({ selected, lastMove, flipped = false, geometry }: { selected?: Square; lastMove?: { from: Square; to: Square }; flipped?: boolean; geometry: BoardGeometry }) {
  const point = (square: Square) => { const { x, y } = boardPoint(square, geometry, flipped); return `${x} ${y}`; };
  return <svg className="board-marker-layer" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
    {lastMove && [lastMove.from, lastMove.to].filter((square) => !sameSquare(square, selected)).map((square, index) => <g key={index} transform={`translate(${point(square)})`}><path d={markerCornerPath}/></g>)}
  </svg>;
}

function LegalTargetLayer({ targets, flipped = false, geometry }: { targets: Square[]; flipped?: boolean; geometry: BoardGeometry }) {
  if (!targets.length) return null;
  return <div className="legal-target-layer" aria-hidden="true">
    {targets.map((target) => {
      const point = boardPoint(target, geometry, flipped);
      const style = {
        "--target-left": `${point.x / BOARD_ART_WIDTH * 100}%`,
        "--target-top": `${point.y / BOARD_ART_HEIGHT * 100}%`,
      } as CSSProperties;
      return <span key={`${target.row}-${target.col}`} style={style}/>;
    })}
  </div>;
}

function AnalysisArrowLayer({ moves, activeIndex, flipped = false, geometry }: { moves: string[]; activeIndex: number; flipped?: boolean; geometry: BoardGeometry }) {
  const colors = ["#168a55", "#2f7da4", "#b97b18", "#8753a3"];
  const markerPrefix = useId().replace(/:/g, "");
  const arrows = moves.flatMap((move, index) => {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) return [];
    const parsed = iccsSquares(move);
    const from = boardPoint(parsed.from, geometry, flipped);
    const to = boardPoint(parsed.to, geometry, flipped);
    const fromX = from.x;
    const fromY = from.y;
    const toX = to.x;
    const toY = to.y;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const padding = Math.max(4, Math.min(8.5, length * .055));
    const startX = fromX + dx / length * padding;
    const startY = fromY + dy / length * padding;
    const endX = toX - dx / length * padding;
    const endY = toY - dy / length * padding;
    const labelX = Math.max(130, Math.min(990, fromX + dx * .55));
    const labelY = Math.max(130, Math.min(1110, fromY + dy * .55));
    const color = colors[index % colors.length];
    const active = index === activeIndex;
    const opacity = active ? 1 : .5;
    return [<g key={`${move}-${index}`} className={`analysis-candidate-arrow ${active ? "active" : ""}`} opacity={opacity} style={{ "--analysis-arrow-color": color } as CSSProperties}>
      <line className="analysis-arrow-backdrop" x1={startX} y1={startY} x2={endX} y2={endY}/>
      <line className="analysis-arrow-outline" x1={startX} y1={startY} x2={endX} y2={endY}/>
      <line className="analysis-arrow-stem" x1={startX} y1={startY} x2={endX} y2={endY} stroke={color} markerEnd={`url(#${markerPrefix}-analysis-arrow-${index})`}/>
      <line className="analysis-arrow-flow" x1={startX} y1={startY} x2={endX} y2={endY}/>
      <circle className="analysis-arrow-label" cx={labelX} cy={labelY} r="25"/><text x={labelX} y={labelY}>{index + 1}</text>
    </g>];
  });
  return <svg className="analysis-arrow-layer" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
    <defs>{colors.map((color, index) => <marker key={color} id={`${markerPrefix}-analysis-arrow-${index}`} markerWidth="46" markerHeight="46" refX="38" refY="23" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L46 23 L0 46 Z" fill={color} fillOpacity=".88" stroke="rgba(255,255,255,.76)" strokeWidth="4" strokeLinejoin="round"/></marker>)}</defs>
    {arrows}
  </svg>;
}

function BoardCoordinateLayer({ flipped = false, geometry }: { flipped?: boolean; geometry: BoardGeometry }) {
  const topLabels = flipped ? RED_FILE_LABELS : BLACK_FILE_LABELS;
  const bottomLabels = flipped ? [...BLACK_FILE_LABELS].reverse() : [...RED_FILE_LABELS].reverse();
  const topClassName = flipped ? "red-side" : "black-side";
  const bottomClassName = flipped ? "black-side" : "red-side";
  const topY = Math.max(20, geometry.rows[0] - 38);
  const bottomY = Math.min(BOARD_ART_HEIGHT - 20, geometry.rows[9] + 38);
  const labelStyle = (x: number, y: number) => ({
    "--coord-left": `${x / BOARD_ART_WIDTH * 100}%`,
    "--coord-top": `${y / BOARD_ART_HEIGHT * 100}%`,
  }) as CSSProperties;
  return <div className="board-coordinate-layer" aria-hidden="true">
    {geometry.columns.map((x, index) => <span key={`top-${index}`} className={topClassName} style={labelStyle(x, topY)}>{topLabels[index]}</span>)}
    {geometry.columns.map((x, index) => <span key={`bottom-${index}`} className={bottomClassName} style={labelStyle(x, bottomY)}>{bottomLabels[index]}</span>)}
  </div>;
}

export function Board({ pieces, selected, legalTargets = [], lastMove, hintMove, analysisMoves = [], activeAnalysis = 0, flipped = false, feedback, setupMode = false, showSideCoordinates = false, boardSkin, pieceSkin, riverText, riverTextColor, riverTextSize, supportsCustomRiverText, onSquare, onMove }: { pieces: BoardPiece[]; selected?: Square; legalTargets?: Square[]; lastMove?: string; hintMove?: string; analysisMoves?: string[]; activeAnalysis?: number; flipped?: boolean; feedback?: TrainingFeedbackKind; setupMode?: boolean; showSideCoordinates?: boolean; boardSkin: string; pieceSkin: string; riverText: string; riverTextColor: string; riverTextSize: number; supportsCustomRiverText: boolean; onSquare(square: Square): void; onMove?(from: Square, to: Square): void }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragCandidate = useRef<BoardDragCandidate | undefined>(undefined);
  const suppressNextClick = useRef(false);
  const [dragging, setDragging] = useState<BoardDragState>();
  const putDownClick = useRef<{ square: Square; at: number } | undefined>(undefined);
  useEffect(() => {
    putDownClick.current = undefined;
    dragCandidate.current = undefined;
    suppressNextClick.current = false;
    setDragging(undefined);
  }, [pieces, flipped, setupMode]);
  const hint = hintMove ? iccsSquares(hintMove).from : undefined;
  const last = lastMove ? iccsSquares(lastMove) : undefined;
  const normalizedBoardSkin = normalizeSkinId(boardSkin);
  const geometry = boardGeometryForSkin(normalizedBoardSkin);
  const boardImage = riverText && supportsCustomRiverText ? "board-river-blank.png" : "board.png";
  const boardStyle = { backgroundImage: `url("/skins/${normalizedBoardSkin}/${boardImage}")` } as CSSProperties;
  const squareFromPoint = (clientX: number, clientY: number): Square | undefined => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    const artX = Math.max(0, Math.min(BOARD_ART_WIDTH, (clientX - rect.left) / rect.width * BOARD_ART_WIDTH));
    const artY = Math.max(0, Math.min(BOARD_ART_HEIGHT, (clientY - rect.top) / rect.height * BOARD_ART_HEIGHT));
    const shown = { row: nearestIndex(geometry.rows, artY), col: nearestIndex(geometry.columns, artX) };
    return displaySquare(shown, flipped);
  };
  const dragPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 };
    return {
      x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)),
      y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100)),
    };
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const candidate = dragCandidate.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    dragCandidate.current = undefined;
    if (!candidate.active) {
      setDragging(undefined);
      return;
    }
    event.preventDefault();
    suppressNextClick.current = true;
    const target = squareFromPoint(event.clientX, event.clientY) ?? candidate.from;
    setDragging(undefined);
    if (sameSquare(candidate.from, target)) onSquare(candidate.from);
    else if (onMove) onMove(candidate.from, target);
    else onSquare(target);
  };
  return <div className="board-shell"><div ref={boardRef} className={`xiangqi-board ${setupMode ? "setup-board" : ""} ${feedback ? `move-feedback ${feedback}` : ""} ${dragging ? "dragging-piece" : ""}`} style={boardStyle} aria-label="残局棋盘" onPointerMove={(event) => {
    if (setupMode) return;
    const candidate = dragCandidate.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (!candidate.active && distance < 7) return;
    candidate.active = true;
    putDownClick.current = undefined;
    event.preventDefault();
    const point = dragPoint(event.clientX, event.clientY);
    setDragging({ from: candidate.from, piece: candidate.piece, ...point, target: squareFromPoint(event.clientX, event.clientY) });
  }} onPointerUp={setupMode ? undefined : finishDrag} onPointerCancel={() => { dragCandidate.current = undefined; setDragging(undefined); }}>
    {riverText && supportsCustomRiverText && <span className="river-custom-label" style={{ "--river-text-color": riverTextColor, "--river-text-size": `${riverTextSize}px` } as CSSProperties}>{riverText}</span>}
    {showSideCoordinates && <BoardCoordinateLayer flipped={flipped} geometry={geometry}/>}
    {analysisMoves.length > 0 && <AnalysisArrowLayer moves={analysisMoves} activeIndex={activeAnalysis} flipped={flipped} geometry={geometry}/>}
    <LegalTargetLayer targets={legalTargets} flipped={flipped} geometry={geometry}/>
    <BoardMarkerLayer selected={selected} lastMove={last} flipped={flipped} geometry={geometry}/>
    {ALL_SQUARES.map((square, index) => { const piece = pieces.find((item) => item.row === square.row && item.col === square.col); const isSelected = sameSquare(selected, square); const isLegalTarget = legalTargets.some((target) => sameSquare(target, square)); const isDraggingOrigin = sameSquare(dragging?.from, square); const isDragTarget = sameSquare(dragging?.target, square); const isLastFrom = last?.from.row === square.row && last.from.col === square.col; const isLastTo = last?.to.row === square.row && last.to.col === square.col; const highlighted = hint?.row === square.row && hint.col === square.col; const position = boardPointStyle(square, geometry, flipped); return <button key={index} style={position} className={`board-square ${isSelected ? "selected" : ""} ${isLegalTarget ? "legal-target" : ""} ${isDraggingOrigin ? "drag-origin" : ""} ${isDragTarget ? "drag-target" : ""} ${isLastFrom ? "last-from" : ""} ${isLastTo ? "last-to" : ""} ${highlighted ? "hint" : ""}`} onPointerDown={(event) => {
      suppressNextClick.current = false;
      if (setupMode) return;
      if (!piece || event.button !== 0) return;
      dragCandidate.current = { pointerId: event.pointerId, from: square, piece, startX: event.clientX, startY: event.clientY, active: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }} onClick={(event) => {
      if (suppressNextClick.current) {
        suppressNextClick.current = false;
        return;
      }
      const previous = putDownClick.current;
      // Touch browsers may report detail=1 for both taps, so also use elapsed time.
      if (previous && sameSquare(previous.square, square)
        && (event.detail >= 2 || event.timeStamp - previous.at < 350)) {
        putDownClick.current = undefined;
        return;
      }
      putDownClick.current = isSelected ? { square, at: event.timeStamp } : undefined;
      onSquare(square);
    }} aria-pressed={Boolean(piece && isSelected)} aria-label={`${squareName(square)}${piece ? ` ${piece.color === "red" ? "红" : "黑"}${piece.label}` : ""}`}>{piece && <><span className="piece-ground-shadow" aria-hidden="true"/><span className="piece-lift"><img className="piece" src={trainingPieceAsset(piece, pieceSkin)} alt={piece.label} draggable={false}/></span></>}</button>; })}
    {dragging && <img className="piece board-drag-ghost" style={{ "--drag-x": `${dragging.x}%`, "--drag-y": `${dragging.y}%` } as CSSProperties} src={trainingPieceAsset(dragging.piece, pieceSkin)} alt="" aria-hidden="true" draggable={false}/>}
    {feedback === "capture" && <span className="capture-feedback"><span>吃</span></span>}
    {(feedback === "check" || feedback === "checkmate" || feedback === "stalemate") && <span className={`ink-feedback ${feedback}`}><span>{TRAINING_FEEDBACK_PACK.labels[feedback]}</span></span>}
  </div></div>;
}

function AnalysisPanel({ lines, pending, activeIndex, disabled, enabled, multiPv, moveTimeSec, scoreSide, arrowsVisible, onToggle, onToggleArrows, onSelect, onMultiPvChange, onMoveTimeChange }: { lines: AnalysisLine[]; pending: boolean; activeIndex: number; disabled: boolean; enabled: boolean; multiPv: number; moveTimeSec: number; scoreSide: "red" | "black"; arrowsVisible: boolean; onToggle(): void; onToggleArrows(): void; onSelect(index: number): void; onMultiPvChange(value: number): void; onMoveTimeChange(value: number): void }) {
  const visibleLines = lines.slice(0, multiPv);
  const summary = visibleLines[0];
  const settingDisabled = disabled || pending;
  const summaryRedRate = redWinRate(summary, scoreSide);
  const summaryAdvantage = summary ? analysisAdvantage(summary, scoreSide) : undefined;
  const returnedCount = Math.min(lines.length, multiPv);
  return <section className="analysis-panel">
    <header><span><Cpu/><b>AI 拆棋</b><small>{enabled ? `候选 ${multiPv}条 · 用时 ${moveTimeSec}秒 · 返回 ${returnedCount}条` : "引擎未开启"}</small></span><div className="analysis-header-actions"><button type="button" className="analysis-arrow-toggle" aria-pressed={arrowsVisible} aria-label={arrowsVisible ? "隐藏棋盘候选箭头" : "显示棋盘候选箭头"} title={arrowsVisible ? "隐藏箭头" : "显示箭头"} onClick={onToggleArrows}>{arrowsVisible ? <Eye/> : <EyeOff/>}{arrowsVisible ? "隐藏" : "显示"}</button><button type="button" disabled={disabled} onClick={onToggle}>{pending ? <><StopIcon/>停止</> : !enabled ? <><Cpu/>开启</> : <><Cpu/>{lines.length ? "重算" : "分析"}</>}</button></div></header>
    <div className="analysis-settings" aria-label="AI 拆棋参数">
      <div className="analysis-multipv-picker"><span>候选数</span><div className="multipv-stepper"><button type="button" disabled={settingDisabled || multiPv <= 1} aria-label="减少候选数量" onClick={() => onMultiPvChange(multiPv - 1)}><Minus/></button><input type="number" inputMode="numeric" min={1} max={4} step={1} value={multiPv} disabled={settingDisabled} aria-label="AI 拆棋候选数量，范围一到四" onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 4) onMultiPvChange(value); }}/><button type="button" disabled={settingDisabled || multiPv >= 4} aria-label="增加候选数量" onClick={() => onMultiPvChange(multiPv + 1)}><Plus/></button></div><small>条</small></div>
      <div className="analysis-multipv-picker"><span>分析时长</span><div className="multipv-stepper"><button type="button" disabled={settingDisabled || moveTimeSec <= 1} aria-label="减少分析秒数" onClick={() => onMoveTimeChange(moveTimeSec - 1)}><Minus/></button><input type="number" inputMode="numeric" min={1} max={5} step={1} value={moveTimeSec} disabled={settingDisabled} aria-label="AI 拆棋分析秒数，范围一到五" onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 5) onMoveTimeChange(value); }}/><button type="button" disabled={settingDisabled || moveTimeSec >= 5} aria-label="增加分析秒数" onClick={() => onMoveTimeChange(moveTimeSec + 1)}><Plus/></button></div><small>秒</small></div>
    </div>
    {!enabled ? <p className="analysis-empty">引擎默认关闭。点击“开启”或顶部放大镜开始分析。</p> : pending ? <p className="analysis-working">Pikafish 正在分析当前局面…</p> : summary ? <>
      <div className="analysis-winrate" style={{ "--red-win-rate": `${summaryRedRate}%` } as CSSProperties}><span>{summaryAdvantage?.red ?? "红优 0"}</span><i aria-hidden="true"><b/></i><span>{summaryAdvantage?.black ?? "黑优 0"}</span></div>
      <div className="analysis-candidates">{visibleLines.map((line, index) => <button key={`${line.multipv}-${line.pv[0]}`} className={activeIndex === index ? "active" : ""} onClick={() => onSelect(index)}><b>{line.multipv}</b><strong>{line.notation[0] ?? line.pv[0]}</strong><em>{analysisScore(line, scoreSide)}</em><span>深度 {line.depth} · 节点 {compactNumber(line.nodes)} · NPS {compactNumber(line.nps)}</span><small>{line.notation.slice(1).join(" ") || line.pv.slice(1).join(" ")}</small></button>)}</div>
    </> : <p className="analysis-empty">当前局面尚未分析</p>}
  </section>;
}

type ManualTrendSample = { index: number; label: string; score?: number; active: boolean };

function ManualTrendChart({ samples, progress, onAnalyze }: { samples: ManualTrendSample[]; progress?: { done: number; total: number; running: boolean }; onAnalyze(): void }) {
  const scored = samples.filter((sample): sample is ManualTrendSample & { score: number } => sample.score != null);
  const width = 400;
  const height = 190;
  const left = 26;
  const right = 14;
  const top = 16;
  const bottom = 18;
  const usableWidth = width - left - right;
  const usableHeight = height - top - bottom;
  const maxScore = 1000;
  const xFor = (index: number) => left + (samples.length <= 1 ? usableWidth : index / (samples.length - 1) * usableWidth);
  const yFor = (score = 0) => top + (1 - (Math.max(-maxScore, Math.min(maxScore, score)) + maxScore) / (maxScore * 2)) * usableHeight;
  const points = scored.map((sample) => `${xFor(sample.index)},${yFor(sample.score)}`).join(" ");
  const activeSample = samples.find((sample) => sample.active) ?? samples.at(-1);
  const activeX = activeSample ? xFor(activeSample.index) : left;
  const activeScored = scored.find((sample) => sample.index === activeSample?.index) ?? scored.at(-1);
  return <section className="manual-trend-card">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="整局局势图">
      <line className="axis" x1={left} y1={yFor(0)} x2={width - right} y2={yFor(0)}/>
      {[-900, -333, 333, 900].map((score) => <g key={score}><line className="grid" x1={left} y1={yFor(score)} x2={width - right} y2={yFor(score)}/><text x="4" y={yFor(score) + 4}>{score}</text></g>)}
      {points && <polyline className="trend-line" points={points}/>}
      <line className="cursor" x1={activeX} y1={top} x2={activeX} y2={height - bottom}/>
      {activeScored && <circle className="cursor-dot" cx={xFor(activeScored.index)} cy={yFor(activeScored.score)} r="5"/>}
    </svg>
    <footer><span>{activeSample?.label ?? "未分析"}</span><button type="button" onClick={onAnalyze}>{progress?.running ? `分析中 ${progress.done}/${progress.total}` : scored.length ? "重新分析" : "整局分析"}</button></footer>
  </section>;
}

function ImportCblPanel({ onBack, onPick, onImportUrl }: { onBack(): void; onPick(): void; onImportUrl(url: string): Promise<void> }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function submitUrl() {
    const value = url.trim();
    if (!value) { setStatus("请先粘贴 CBL 下载地址。"); return; }
    setPending(true);
    setStatus("正在下载并解析 CBL…");
    try {
      await onImportUrl(value);
      setStatus("导入完成。");
    } catch (error) {
      setStatus(`URL 导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPending(false);
    }
  }
  return <section className="import-cbl-panel" role="dialog" aria-modal="true" aria-labelledby="import-cbl-title">
    <header><button type="button" aria-label="返回棋析" onClick={onBack}><ChevronLeft/><span>返回</span></button><div><b id="import-cbl-title">导入 CBL</b><small>选择本机、网盘或 URL 中的 .CBL 棋库</small></div></header>
    <main><FileUp/><strong>导入 CBL 棋库</strong><p>电脑本地文件请先通过 AirDrop、iCloud Drive、微信/QQ 文件或系统“文件 App”保存到手机，再点“选择 CBL 文件”。可多选题库；标准开局棋谱会自动进入录谱库。同名 .logic.json 可附加残局提示。</p><button type="button" className="primary" onClick={onPick}><FileUp/>选择 CBL 文件</button><div className="import-url-box"><label><span>URL 导入</span><input value={url} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://example.com/library.cbl" disabled={pending} onChange={(event) => { setUrl(event.target.value); setStatus(""); }}/></label><button type="button" disabled={pending} onClick={() => void submitUrl()}><Link/>{pending ? "导入中" : "下载导入"}</button>{status && <small>{status}</small>}</div><p className="import-cbl-hint">URL 服务器若限制跨域、防盗链或下载权限，请先下载到本机后使用文件导入。单个文件最大 50MB；URL 导入不附加 sidecar。</p></main>
  </section>;
}

function SkinPreview({ skinId, previewKind, large = false }: { skinId: string; previewKind: "board" | "piece"; large?: boolean }) {
  if (previewKind === "board") {
    return <span className={`skin-board-preview ${large ? "large" : ""}`} style={{ backgroundImage: `url("/skins/${skinId}/board.png")` }} aria-hidden="true"/>;
  }
  return <span className={`skin-piece-preview ${large ? "large" : ""}`} aria-hidden="true">
    {["rk", "rr", "rp", "bk", "br"].map((piece) => <img key={piece} src={`/skins/${skinId}/${piece}.png`} alt=""/>)}
  </span>;
}

const SKIN_BOARD_PREVIEW_PIECES = [
  { piece: "bk", left: 49.6, top: 7.5 },
  { piece: "br", left: 6.5, top: 7.5 },
  { piece: "bc", left: 28, top: 22.5 },
  { piece: "rp", left: 49.6, top: 66.5 },
  { piece: "rr", left: 92.5, top: 82 },
  { piece: "rk", left: 49.6, top: 82 },
] as const;

function SkinBoardEffectPreview({ boardSkin, pieceSkin }: { boardSkin: string; pieceSkin: string }) {
  return <div className="skin-board-effect-preview" aria-label="棋盘和棋子整盘预览" style={{ backgroundImage: `url("/skins/${boardSkin}/board.png")` }}>
    {SKIN_BOARD_PREVIEW_PIECES.map((item) => <img key={`${item.piece}-${item.left}-${item.top}`} src={`/skins/${pieceSkin}/${item.piece}.png`} alt="" style={{ left: `${item.left}%`, top: `${item.top}%` }}/>)}
  </div>;
}

function readSkinPreference(key: string) {
  const saved = localStorage.getItem(key);
  if (localStorage.getItem(SKIN_DEFAULT_MIGRATION_KEY) !== "done" && saved === LEGACY_DEFAULT_SKIN_ID) {
    localStorage.setItem(key, DEFAULT_SKIN_ID);
    return DEFAULT_SKIN_ID;
  }
  return normalizeSkinId(saved);
}

function skinCardName(skin: SkinCatalogItem, index?: number) {
  if (skin.id === DEFAULT_SKIN_ID) return <>默认 {skin.name}</>;
  const fallbackIndex = SKIN_CATALOG.filter((item) => item.id !== DEFAULT_SKIN_ID).findIndex((item) => item.id === skin.id);
  const displayIndex = (index ?? fallbackIndex) + 1;
  return <>{displayIndex}. {skin.group === "3d" && <em>3D</em>}{skin.name}</>;
}

function StudySkinSettings({ boardSkin, pieceSkin, boardSkinInfo, riverText, riverTextColor, riverTextSize, onBoardSkinChange, onPieceSkinChange, onUseSkinSet, onRiverTextChange, onRiverTextColorChange, onRiverTextSizeChange }: { boardSkin: string; pieceSkin: string; boardSkinInfo: SkinCatalogItem; riverText: string; riverTextColor: string; riverTextSize: number; onBoardSkinChange(id: string): void; onPieceSkinChange(id: string): void; onUseSkinSet(id: string): void; onRiverTextChange(value: string): void; onRiverTextColorChange(value: string): void; onRiverTextSizeChange(value: number): void }) {
  const [expanded, setExpanded] = useState(false);
  const board = skinById(boardSkin);
  const piece = skinById(pieceSkin);
  const extraSkins = SKIN_CATALOG.filter((skin) => skin.id !== DEFAULT_SKIN_ID);
  const usingDefaultSkin = boardSkin === DEFAULT_SKIN_ID && pieceSkin === DEFAULT_SKIN_ID;
  return <section className={`study-skin-settings ${expanded ? "expanded" : ""}`}>
    <button type="button" className="study-skin-summary" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpanded((open) => !open); }}>
      <Palette/><span><b>棋盘/棋子皮肤</b><small>{board.name} / {piece.name}</small></span><em className="study-skin-toggle"><i className="closed">展开</i><i className="opened">收起</i></em>
    </button>
    {expanded && <>
      <section className="study-skin-board-effect"><div><b>当前效果</b><button type="button" disabled={usingDefaultSkin} onClick={() => onUseSkinSet(DEFAULT_SKIN_ID)}>恢复默认</button></div><SkinBoardEffectPreview boardSkin={boardSkin} pieceSkin={pieceSkin}/></section>
      <section className="study-skin-card-library" aria-label="皮肤库">
        <header><b>皮肤库</b><small>默认清新竹韵，下面是 10 套额外方案</small></header>
        <div>{extraSkins.map((skin, index) => <button key={skin.id} type="button" className={boardSkin === skin.id && pieceSkin === skin.id ? "active" : ""} onClick={() => onUseSkinSet(skin.id)}>
          <SkinBoardEffectPreview boardSkin={skin.id} pieceSkin={skin.id}/>
          <span>{skinCardName(skin, index)}</span>
        </button>)}</div>
      </section>
      <details className="study-skin-mix-settings">
        <summary>高级：棋盘/棋子混搭</summary>
        <section className="study-skin-mix-panel" aria-label="只更换棋盘">
          <header><b>棋盘</b><small>只更换棋盘，可与任意棋子搭配</small></header>
          <div className="study-skin-mix-grid">
            {SKIN_CATALOG.map((skin) => <button key={`board-${skin.id}`} type="button" className={boardSkin === skin.id ? "active" : ""} onClick={() => onBoardSkinChange(skin.id)}>
              <SkinPreview skinId={skin.id} previewKind="board" large/>
              <span>{skinCardName(skin)}</span>
            </button>)}
          </div>
        </section>
        <section className="study-skin-mix-panel" aria-label="只更换棋子">
          <header><b>棋子</b><small>只更换棋子，可与任意棋盘搭配</small></header>
          <div className="study-skin-mix-grid">
            {SKIN_CATALOG.map((skin) => <button key={`piece-${skin.id}`} type="button" className={pieceSkin === skin.id ? "active" : ""} onClick={() => onPieceSkinChange(skin.id)}>
              <SkinPreview skinId={skin.id} previewKind="piece" large/>
              <span>{skinCardName(skin)}</span>
            </button>)}
          </div>
        </section>
      </details>
      <details className="study-river-settings">
        <summary>高级：楚河汉界文字</summary>
        <label><span>文字</span><input value={riverText} maxLength={16} placeholder="默认：楚河汉界" onChange={(event) => onRiverTextChange(event.target.value)}/></label>
        <label><span>颜色</span><input type="color" value={riverTextColor} disabled={!boardSkinInfo.supportsCustomRiverText} onChange={(event) => onRiverTextColorChange(event.target.value)}/></label>
        <label><span>字号 {riverTextSize}px</span><input type="range" min="16" max="42" value={riverTextSize} disabled={!boardSkinInfo.supportsCustomRiverText} onChange={(event) => onRiverTextSizeChange(Number(event.target.value))}/></label>
        <small>{boardSkinInfo.supportsCustomRiverText ? "留空保留皮肤原有河界文字。" : "当前棋盘缺少空河界图，暂不支持覆盖。"}</small>
      </details>
    </>}
  </section>;
}

function AboutDialog({ preferredOrientation, studyRuleMode, skinDevCommandOpen, skinDevCommand, skinDevUnlocked, skinDevNotice, onClose, onOrientationChange, onStudyRuleModeChange, onSkinDevTap, onSkinDevCommandChange, onRunSkinDevCommand, onExportAiSkinPackage }: {
  preferredOrientation: PreferredOrientation;
  studyRuleMode: RuleMode;
  skinDevCommandOpen: boolean;
  skinDevCommand: string;
  skinDevUnlocked: boolean;
  skinDevNotice: string;
  onClose(): void;
  onOrientationChange(value: PreferredOrientation): void;
  onStudyRuleModeChange(value: RuleMode): void;
  onSkinDevTap(): void;
  onSkinDevCommandChange(value: string): void;
  onRunSkinDevCommand(): void;
  onExportAiSkinPackage(): void;
}) {
  return <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={onClose}>
    <section className="about-dialog" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <BookOpen/><b id="about-title">棋析</b><p>本地 CBL 残局训练</p>
      <dl>
        <div><dt>版本</dt><dd>{SKIN_DEV_TOOLS_ENABLED ? <button type="button" className="skin-dev-tap" onClick={onSkinDevTap}>{APP_VERSION}</button> : APP_VERSION}</dd></div>
        <div><dt>构建时间</dt><dd>{APP_BUILD_TIME}</dd></div>
        {LOCAL_PIKAFISH_AVAILABLE && <div><dt>本地 AI</dt><dd>Pikafish 2026-09-06</dd></div>}
        <div><dt>当前棋规</dt><dd>{studyRuleLabel(studyRuleMode)}</dd></div>
        <div><dt>联系方式</dt><dd>xiangqistudio@outlook.com</dd></div>
      </dl>
      <fieldset className="orientation-picker"><legend>屏幕方向</legend>{(["auto", "landscape", "portrait"] as PreferredOrientation[]).map((value) => <button key={value} className={preferredOrientation === value ? "active" : ""} onClick={() => onOrientationChange(value)}>{value === "auto" ? "自动" : value === "landscape" ? "锁横屏" : "锁竖屏"}</button>)}</fieldset>
      <fieldset className="orientation-picker rule-mode-about"><legend>棋规模式</legend>{(["domestic2020", "asianAxf"] as RuleMode[]).map((value) => <button key={value} className={studyRuleMode === value ? "active" : ""} onClick={() => onStudyRuleModeChange(value)}>{studyRuleLabel(value)}</button>)}</fieldset>
      {SKIN_DEV_TOOLS_ENABLED && skinDevCommandOpen && <section className="skin-dev-panel"><strong>开发者命令</strong><div><input value={skinDevCommand} type="text" autoComplete="off" placeholder="舒服skin" onChange={(event) => onSkinDevCommandChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onRunSkinDevCommand(); }}/><button onClick={onRunSkinDevCommand}>执行</button></div>{skinDevNotice && <small>{skinDevNotice}</small>}{skinDevUnlocked && <button className="skin-export-button" onClick={onExportAiSkinPackage}>导出 AI 皮肤素材包</button>}</section>}
      <p className="about-rule-note">棋规用于本地局面与重复棋例提示；Pikafish 引擎搜索不切换规则。</p>
      <footer><button onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}

export function App() {
  const input = useRef<HTMLInputElement>(null);
  const initialStudyState = useMemo(() => readStoredStudyState(), []);
  const [libraries, setLibraries] = useState<TrainingLibrary[]>([]);
  const [library, setLibrary] = useState<TrainingLibrary>();
  const [expanded, setExpanded] = useState<string>();
  const [problems, setProblems] = useState<TrainingProblem[]>([]);
  const [problem, setProblem] = useState<TrainingProblem>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [mode, setMode] = useState<Mode>("cloud");
  const [line, setLine] = useState<SolutionMove[]>([]);
  const [moves, setMoves] = useState<string[]>([]);
  const [pieces, setPieces] = useState<BoardPiece[]>([]);
  const [selected, setSelected] = useState<Square>();
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<string>();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsedSaved, setElapsedSaved] = useState(0);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [, setTick] = useState(0);
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [notice, setNotice] = useState("请选择题目开始训练。");
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<string[]>([]);
  const [answerStep, setAnswerStep] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "library" | "problem"; id: string; title: string }>();
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [autoReplyPending, setAutoReplyPending] = useState(false);
  const [moveFeedback, setMoveFeedback] = useState<TrainingFeedbackKind>();
  const [trainingAnalysisLines, setTrainingAnalysisLines] = useState<AnalysisLine[]>([]);
  const [studyAnalysisLines, setStudyAnalysisLines] = useState<AnalysisLine[]>([]);
  const [manualAnalysisLines, setManualAnalysisLines] = useState<AnalysisLine[]>([]);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [trainingActiveAnalysis, setTrainingActiveAnalysis] = useState(0);
  const [studyActiveAnalysis, setStudyActiveAnalysis] = useState(0);
  const [manualActiveAnalysis, setManualActiveAnalysis] = useState(0);
  const [analysisMultiPv, setAnalysisMultiPv] = useState(() => Math.max(1, Math.min(4, Number(localStorage.getItem("xiangqi-training-analysis-multipv")) || 4)));
  const [analysisMoveTimeSec, setAnalysisMoveTimeSec] = useState(() => Math.max(1, Math.min(5, Number(localStorage.getItem("xiangqi-training-analysis-seconds")) || 2)));
  const [analysisArrowsVisible, setAnalysisArrowsVisible] = useState(() => localStorage.getItem(ANALYSIS_ARROWS_VISIBLE_KEY) !== "false");
  const [studyEngineEnabled, setStudyEngineEnabled] = useState(false);
  const [manualEngineEnabled, setManualEngineEnabled] = useState(false);
  const [studyRuleMode, setStudyRuleMode] = useState<RuleMode>(() => readStoredStudyRuleMode());
  const [workspaceMode, setWorkspaceMode] = useState<MobileWorkspaceMode>(initialStudyState.enabled ? "study" : "training");
  const studyMode = workspaceMode === "study";
  const manualMode = workspaceMode === "manual";
  const [studyPanelTab, setStudyPanelTab] = useState<StudyPanelTab>(initialStudyState.tab);
  const [studyStartingFen, setStudyStartingFen] = useState(initialStudyState.startingFen);
  const [studyCurrentFen, setStudyCurrentFen] = useState(initialStudyState.startingFen);
  const [studyMoves, setStudyMoves] = useState<string[]>(initialStudyState.moves);
  const [studyBranches, setStudyBranches] = useState<StudyBranch[]>(initialStudyState.branches ?? []);
  const [studyComments, setStudyComments] = useState<Record<string, string>>(initialStudyState.comments ?? {});
  const [studyCursor, setStudyCursor] = useState(initialStudyState.cursor);
  const [studyAutoPlaying, setStudyAutoPlaying] = useState(false);
  const [studyNotation, setStudyNotation] = useState<string[]>([]);
  const [studyPieces, setStudyPieces] = useState<BoardPiece[]>([]);
  const [studySelected, setStudySelected] = useState<Square>();
  const [studyLegalTargets, setStudyLegalTargets] = useState<Square[]>([]);
  const [studyLastMove, setStudyLastMove] = useState<string>();
  const [studyNotice, setStudyNotice] = useState(initialStudyState.moves.length ? "已恢复上次自由拆棋，可继续导航、落子或分析。" : "标准局面已就绪，可自由走棋或开始分析。");
  const [studyNoticeVisible, setStudyNoticeVisible] = useState(true);
  const [studyTerminal, setStudyTerminal] = useState<string>();
  const [studyCloudMoves, setStudyCloudMoves] = useState<CloudBookMove[]>([]);
  const [studyCloudFen, setStudyCloudFen] = useState<string>();
  const [studyCloudPending, setStudyCloudPending] = useState(false);
  const [studyCloudError, setStudyCloudError] = useState<string>();
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const [studyFenEditorOpen, setStudyFenEditorOpen] = useState(initialStudyState.fenEditorExpanded === true);
  const [studyFenDraft, setStudyFenDraft] = useState(STANDARD_STARTING_FEN);
  const [studyFenError, setStudyFenError] = useState<string>();
  const [studyMoveTextOpen, setStudyMoveTextOpen] = useState(initialStudyState.showMoveText === true);
  const [manualFolders, setManualFolders] = useState<LocalManualFolder[]>([]);
  const manualLibraryRequest = useRef(0);
  const [manualGames, setManualGames] = useState<LocalManualGame[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [manualFolder, setManualFolder] = useState("");
  const [manualGame, setManualGame] = useState<LocalManualGame>();
  const [manualPanelTab, setManualPanelTab] = useState<ManualPanelTab>("moves");
  const [manualPanelOpen, setManualPanelOpen] = useState(false);
  const [manualAnalysisExpanded, setManualAnalysisExpanded] = useState(false);
  const [manualAnalysisView, setManualAnalysisView] = useState<ManualAnalysisView>("trend");
  const [manualMenuOpen, setManualMenuOpen] = useState(false);
  const [manualAutoPlaying, setManualAutoPlaying] = useState(false);
  const [manualStartingFen, setManualStartingFen] = useState(STANDARD_STARTING_FEN);
  const [manualCurrentFen, setManualCurrentFen] = useState(STANDARD_STARTING_FEN);
  const [manualMoves, setManualMoves] = useState<string[]>([]);
  const [manualBranches, setManualBranches] = useState<ManualBranch[]>([]);
  const [manualComments, setManualComments] = useState<Record<string, string>>({});
  const [manualCursor, setManualCursor] = useState(0);
  const [manualNotation, setManualNotation] = useState<string[]>([]);
  const [manualPieces, setManualPieces] = useState<BoardPiece[]>([]);
  const [manualSelected, setManualSelected] = useState<Square>();
  const [manualLegalTargets, setManualLegalTargets] = useState<Square[]>([]);
  const [manualLastMove, setManualLastMove] = useState<string>();
  const [manualTerminal, setManualTerminal] = useState<string>();
  const [manualNotice, setManualNotice] = useState("新建或打开一局本地棋谱。");
  const [manualSetupOpen, setManualSetupOpen] = useState(false);
  const [manualSetupError, setManualSetupError] = useState("");
  useEffect(() => {
    if (!manualSetupError) return;
    const timeout = window.setTimeout(() => setManualSetupError(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [manualSetupError]);
  const [manualSheet, setManualSheet] = useState<ManualSheetState>();
  const [manualSheetError, setManualSheetError] = useState("");
  const [manualShareDraft, setManualShareDraft] = useState<LocalManualGame>();
  const [manualSaveDraft, setManualSaveDraft] = useState<LocalManualGame>();
  const manualSheetComposing = useRef(false);
  const manualSheetLock = useRef(false);
  const [manualSheetBusy, setManualSheetBusy] = useState(false);
  const [manualSaveStatus, setManualSaveStatus] = useState<"已保存" | "保存中" | "未保存" | "保存失败">("已保存");
  const [manualSetupPieces, setManualSetupPieces] = useState<BoardPiece[]>([]);
  const [manualSetupSide, setManualSetupSide] = useState<"red" | "black">("red");
  const [manualSetupTool, setManualSetupTool] = useState<{ color: "red" | "black"; kind: string; label: string } | "erase">({ color: "red", kind: "king", label: "帅" });
  const [manualSetupSelected, setManualSetupSelected] = useState<Square>();
  const [manualFullAnalysisProgress, setManualFullAnalysisProgress] = useState<{ done: number; total: number; running: boolean }>();
  const [manualAnalysisSummaries, setManualAnalysisSummaries] = useState<Record<string, LocalManualAnalysisSummary>>({});
  const [manualIssueSide, setManualIssueSide] = useState<"red" | "black">("red");
  const [boardFlipped, setBoardFlipped] = useState(() => localStorage.getItem("xiangqi-training-board-flipped") === "true");
  const [studyEvaluationVisible, setStudyEvaluationVisible] = useState(() => localStorage.getItem("xiangqi-training-study-evaluation") === "true");
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [boardSkin, setBoardSkin] = useState(() => readSkinPreference(BOARD_SKIN_KEY));
  const [pieceSkin, setPieceSkin] = useState(() => readSkinPreference(PIECE_SKIN_KEY));
  const [riverText, setRiverText] = useState(() => localStorage.getItem("xiangqi-training-river-text") ?? "");
  const [riverTextColor, setRiverTextColor] = useState(() => localStorage.getItem("xiangqi-training-river-text-color") ?? "#657b48");
  const [riverTextSize, setRiverTextSize] = useState(() => Number(localStorage.getItem("xiangqi-training-river-text-size")) || 29);
  const [skinDevTapCount, setSkinDevTapCount] = useState(0);
  const [skinDevCommandOpen, setSkinDevCommandOpen] = useState(false);
  const [skinDevCommand, setSkinDevCommand] = useState("");
  const [skinDevUnlocked, setSkinDevUnlocked] = useState(false);
  const [skinDevNotice, setSkinDevNotice] = useState("");
  const [preferredOrientation, setPreferredOrientationState] = useState<PreferredOrientation>(() => {
    const saved = localStorage.getItem("xiangqi-training-orientation");
    return saved === "landscape" || saved === "portrait" ? saved : "auto";
  });
  const session = useRef(0);
  const analysisGeneration = useRef(0);
  const studyGeneration = useRef(0);
  const studyCloudGeneration = useRef(0);
  const finishing = useRef(false);
  const pendingAutoReply = useRef<PendingAutoReply | undefined>(undefined);
  const trainingTimerWasRunning = useRef(false);
  const elapsed = elapsedSaved + (startedAt ? Date.now() - startedAt : 0);
  const categories = useMemo(() => ["全部", ...new Set(problems.map((item) => item.category))], [problems]);
  const visible = useMemo(() => problems.filter((item) => (category === "全部" || item.category === category) && (!query || `${item.title}${item.category}`.includes(query))), [category, problems, query]);
  const currentIndex = problem ? visible.findIndex((item) => item.id === problem.id) : -1;
  const expected = useMemo(() => line.map((item) => item.iccs), [line]);
  const currentStudyMoves = useMemo(() => studyMoves.slice(0, Math.min(studyCursor, studyMoves.length)), [studyCursor, studyMoves]);
  const currentManualMoves = useMemo(() => manualMoves.slice(0, Math.min(manualCursor, manualMoves.length)), [manualCursor, manualMoves]);
  const manualFolderPath = cleanManualFolderPath(manualFolder);
  const manualBreadcrumbs = useMemo(() => manualFolderBreadcrumbs(manualFolderPath), [manualFolderPath]);
  const studyNoticePersistent = persistentStudyNotice(studyNotice);
  const boardSkinInfo = skinById(boardSkin);
  const pieceSkinInfo = skinById(pieceSkin);
  const activeRiverText = boardSkinInfo.supportsCustomRiverText ? riverText : "";

  useEffect(() => {
    localStorage.setItem(SKIN_DEFAULT_MIGRATION_KEY, "done");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!problem || !selected || revealed || ended || autoReplyPending) {
      setLegalTargets([]);
      return () => { cancelled = true; };
    }
    const movingSide = sideToMove(problem.startingFen, moves);
    const source = pieces.find((piece) => piece.row === selected.row && piece.col === selected.col);
    if (source?.color !== movingSide) {
      setLegalTargets([]);
      return () => { cancelled = true; };
    }
    void Promise.all(ALL_SQUARES.map(async (target) => {
      if (sameSquare(selected, target)) return undefined;
      const targetPiece = pieces.find((piece) => piece.row === target.row && piece.col === target.col);
      if (targetPiece?.color === movingSide) return undefined;
      return (await acceptsMove(problem.startingFen, moves, `${squareName(selected)}${squareName(target)}`)) ? target : undefined;
    })).then((targets) => {
      if (!cancelled) setLegalTargets(targets.filter((target): target is Square => Boolean(target)));
    });
    return () => { cancelled = true; };
  }, [autoReplyPending, ended, moves, pieces, problem, revealed, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!studySelected || studyTerminal) {
      setStudyLegalTargets([]);
      return () => { cancelled = true; };
    }
    const movingSide = sideToMove(studyStartingFen, currentStudyMoves);
    const source = studyPieces.find((piece) => piece.row === studySelected.row && piece.col === studySelected.col);
    if (source?.color !== movingSide) {
      setStudyLegalTargets([]);
      return () => { cancelled = true; };
    }
    void Promise.all(ALL_SQUARES.map(async (target) => {
      if (sameSquare(studySelected, target)) return undefined;
      const targetPiece = studyPieces.find((piece) => piece.row === target.row && piece.col === target.col);
      if (targetPiece?.color === movingSide) return undefined;
      return (await acceptsMove(studyStartingFen, currentStudyMoves, `${squareName(studySelected)}${squareName(target)}`, studyRuleMode)) ? target : undefined;
    })).then((targets) => {
      if (!cancelled) setStudyLegalTargets(targets.filter((target): target is Square => Boolean(target)));
    });
    return () => { cancelled = true; };
  }, [currentStudyMoves, studyPieces, studyRuleMode, studySelected, studyStartingFen, studyTerminal]);

  useEffect(() => {
    let cancelled = false;
    if (!manualSelected || manualTerminal) {
      setManualLegalTargets([]);
      return () => { cancelled = true; };
    }
    const movingSide = sideToMove(manualStartingFen, currentManualMoves);
    const source = manualPieces.find((piece) => piece.row === manualSelected.row && piece.col === manualSelected.col);
    if (source?.color !== movingSide) {
      setManualLegalTargets([]);
      return () => { cancelled = true; };
    }
    void Promise.all(ALL_SQUARES.map(async (target) => {
      if (sameSquare(manualSelected, target)) return undefined;
      const targetPiece = manualPieces.find((piece) => piece.row === target.row && piece.col === target.col);
      if (targetPiece?.color === movingSide) return undefined;
      return (await acceptsMove(manualStartingFen, currentManualMoves, `${squareName(manualSelected)}${squareName(target)}`, studyRuleMode)) ? target : undefined;
    })).then((targets) => {
      if (!cancelled) setManualLegalTargets(targets.filter((target): target is Square => Boolean(target)));
    });
    return () => { cancelled = true; };
  }, [currentManualMoves, manualPieces, manualSelected, manualStartingFen, manualTerminal, studyRuleMode]);

  async function refresh() { setLibraries(await trainingStore.libraries()); }
  async function resetAnalysis(workspace: MobileWorkspaceMode = workspaceMode, clear = true) {
    analysisGeneration.current += 1;
    setAnalysisPending(false);
    if (clear) {
      if (workspace === "study") { setStudyAnalysisLines([]); setStudyActiveAnalysis(0); }
      else if (workspace === "manual") { setManualAnalysisLines([]); setManualActiveAnalysis(0); }
      else { setTrainingAnalysisLines([]); setTrainingActiveAnalysis(0); }
    }
    await cancelPikafishSearch().catch(() => undefined);
  }
  async function resetTrainingAnalysis() {
    if (studyMode) {
      setTrainingAnalysisLines([]);
      setTrainingActiveAnalysis(0);
      return;
    }
    await resetAnalysis("training");
  }
  async function selectLibrary(next: TrainingLibrary) { session.current += 1; pendingAutoReply.current = undefined; await resetTrainingAnalysis(); setLibrary(next); setExpanded(next.id); setProblems(await trainingStore.problems(next.id)); setProblem(undefined); setQuery(""); setCategory("全部"); }
  async function selectProblem(next: TrainingProblem) { session.current += 1; pendingAutoReply.current = undefined; await resetTrainingAnalysis(); finishing.current = false; setProblem(next); setLine(next.solution); setMoves([]); setPieces((await boardAt(next.startingFen, [])).pieces); setSelected(undefined); setLastMove(undefined); setStartedAt(undefined); setElapsedSaved(0); setAttemptStarted(false); setEnded(false); setAutoReplyPending(false); setHints(0); setMistakes(0); setMode("cloud"); setNotice(LOCAL_PIKAFISH_AVAILABLE ? "云库 + 皮卡鱼：云库未收录时由本地 AI 自动应手。" : "云库对练：选中棋子后再点目标点，云库会自动应手。"); setRevealed(false); setAnswer([]); setAnswerStep(0); setDemoPlaying(false); setShowHistory(false); setAttempts(await trainingStore.attempts(next.id)); setCatalogueOpen(false); }
  useEffect(() => { void refresh().then(async () => { const initial = (await trainingStore.libraries())[0]; if (initial) await selectLibrary(initial); }); }, []);
  useEffect(() => { void refreshManualLibrary(); void boardAt(STANDARD_STARTING_FEN, [], studyRuleMode).then((state) => { if (!manualPieces.length) setManualPieces(state.pieces); }); }, []);
  useEffect(() => { if (manualMode) void refreshManualLibrary(manualFolder, manualQuery); }, [manualFolder, manualMode, manualQuery]);
  useEffect(() => {
    const generation = ++studyGeneration.current;
    const activeMoves = initialStudyState.moves.slice(0, initialStudyState.cursor);
    void Promise.all([
      boardAt(initialStudyState.startingFen, activeMoves, studyRuleMode),
      initialStudyState.moves.length ? chineseLine(initialStudyState.startingFen, initialStudyState.moves).catch(() => initialStudyState.moves) : Promise.resolve([]),
    ]).then(([state, notation]) => {
      if (generation !== studyGeneration.current) return;
      setStudyCurrentFen(state.fen);
      setStudyPieces(state.pieces);
      setStudyNotation(notation);
      setStudyLastMove(activeMoves.at(-1));
      setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    }).catch(() => {
      if (generation !== studyGeneration.current) return;
      setStudyStartingFen(STANDARD_STARTING_FEN);
      setStudyCurrentFen(STANDARD_STARTING_FEN);
      setStudyMoves([]);
      setStudyCursor(0);
      setStudyNotation([]);
      setStudyLastMove(undefined);
      setStudyTerminal(undefined);
      setStudyNotice("上次拆棋局面无法恢复，已回到标准开局。");
      void boardAt(STANDARD_STARTING_FEN, [], studyRuleMode).then((state) => {
        if (generation === studyGeneration.current) setStudyPieces(state.pieces);
      });
    });
  }, [initialStudyState]);
  useEffect(() => {
    const snapshot: StudyStateSnapshot = {
      enabled: studyMode,
      tab: studyPanelTab,
      startingFen: studyStartingFen,
      moves: studyMoves,
      cursor: Math.max(0, Math.min(studyCursor, studyMoves.length)),
      branches: studyBranches,
      comments: studyComments,
      showMoveText: studyMoveTextOpen,
      fenEditorExpanded: studyFenEditorOpen,
    };
    localStorage.setItem(STUDY_STATE_KEY, JSON.stringify(snapshot));
  }, [studyMode, studyPanelTab, studyStartingFen, studyMoves, studyCursor, studyBranches, studyComments, studyMoveTextOpen, studyFenEditorOpen]);
  useEffect(() => {
    void setPreferredOrientation(preferredOrientation).catch(() => {
      setNotice("无法恢复屏幕方向设置，已使用系统自动旋转。");
    });
  }, []);
  useEffect(() => {
    setStudyNoticeVisible(true);
    if (persistentStudyNotice(studyNotice)) return;
    const timer = window.setTimeout(() => setStudyNoticeVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [studyNotice]);
  useEffect(() => { if (!startedAt) return; const timer = window.setInterval(() => setTick((value) => value + 1), 250); return () => clearInterval(timer); }, [startedAt]);
  useEffect(() => { if (!moveFeedback) return; const duration = moveFeedback === "checkmate" || moveFeedback === "stalemate" ? 3400 : moveFeedback === "check" ? 2800 : moveFeedback === "capture" ? 520 : 320; const timer = window.setTimeout(() => setMoveFeedback(undefined), duration); return () => clearTimeout(timer); }, [moveFeedback]);
  useEffect(() => { if (!demoPlaying || !problem || answerStep >= answer.length) return; const timer = window.setTimeout(() => { void previewAnswerStep(answerStep + 1); }, 750); return () => clearTimeout(timer); }, [answer.length, answerStep, demoPlaying, problem]);
  useEffect(() => {
    if (!studyMode || studyCloudFen === studyCurrentFen) return;
    void refreshStudyCloud(studyCurrentFen);
  }, [studyCloudFen, studyCurrentFen, studyMode]);
  useEffect(() => {
    const selector = showAbout ? ".about-dialog" : undefined;
    if (!selector) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>(selector);
      dialog?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowAbout(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(selector);
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>("textarea, input, select, button, [tabindex]:not([tabindex='-1'])") ?? [])].filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [showAbout]);
  useEffect(() => {
    if (!studyMode || !studyEngineEnabled || !LOCAL_PIKAFISH_AVAILABLE || studyTerminal) return;
    const timer = window.setTimeout(() => void startAnalysis(analysisMultiPv), 300);
    return () => window.clearTimeout(timer);
  }, [analysisMoveTimeSec, studyCurrentFen, studyMode, studyTerminal, studyEngineEnabled]);
  useEffect(() => {
    if (!studyAutoPlaying) return;
    if (studyCursor >= studyMoves.length) {
      setStudyAutoPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => void navigateStudyMove(studyCursor + 1, true), 700);
    return () => window.clearTimeout(timer);
  }, [studyAutoPlaying, studyCursor, studyMoves.length]);
  useEffect(() => {
    if (!manualAutoPlaying) return;
    if (manualCursor >= manualMoves.length) {
      setManualAutoPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => void navigateManualMove(manualCursor + 1), 700);
    return () => window.clearTimeout(timer);
  }, [manualAutoPlaying, manualCursor, manualMoves.length]);
  useEffect(() => () => { analysisGeneration.current += 1; void cancelPikafishSearch(); }, []);

  async function importBytes(bytes: Uint8Array, logicJson?: string) {
    if (bytes.byteLength > CBL_IMPORT_MAX_BYTES) throw new Error("文件超过 50MB，请拆分或改用更小题库。");
    setNotice("正在解析 CBL…");
    const parsed = logicJson ? applyTrainingLogicSidecar(await parseCbl(bytes), logicJson) : await parseCbl(bytes);
    const results: string[] = [];
    const containsStandardGames = parsed.warnings.some((warning) => warning.includes("标准开局记录不是残局题目"));
    if (!parsed.problems.length || containsStandardGames) {
      setNotice(parsed.problems.length ? "发现标准开局记录，正在解析完整棋谱…" : "未发现残局题目，正在按完整棋谱解析…");
      const manuals = await parseCblGames(bytes);
      const standardGames = manuals.games.filter((game) => game.startingFen.split(" ")[0] === STANDARD_STARTING_FEN.split(" ")[0]);
      if (standardGames.length) {
        const folder = manuals.title.trim() || "导入棋谱";
        await trainingStore.createManualFolder(folder);
        const now = new Date().toISOString();
        for (const game of standardGames) {
          const ending = await boardAt(game.startingFen, game.moves);
          await trainingStore.saveManualGame({
            id: `cbl-game:${game.recordHash}`,
            title: game.title || `棋谱 ${game.sourceIndex + 1}`,
            note: game.note,
            metadata: game.metadata,
            folderPath: folder,
            startingFen: game.startingFen,
            currentNodeId: manualNodeId(game.moves.length),
            currentFen: ending.fen,
            moves: game.moves,
            cursor: game.moves.length,
            branches: game.branches,
            comments: game.comments,
            createdAt: now,
            updatedAt: now,
          });
        }
        await refreshManualLibrary(folder, "");
        results.push(`“${folder}”已导入录谱库，共 ${standardGames.length} 盘${manuals.warnings.length ? `；${manuals.warnings.length} 条尾部异常已保留有效着法` : ""}`);
      }
    }
    if (parsed.problems.length) {
      setNotice(`正在保存 ${parsed.problems.length} 道题…`);
      const imported = await trainingStore.importLibrary(bytes, parsed);
      await refresh();
      await selectLibrary(imported);
      const logicCount = parsed.problems.filter((item) => item.logic).length;
      const suffix = logicCount ? `，已附加 ${logicCount} 条逻辑标注` : "";
      const damaged = parsed.warnings.filter((warning) => !warning.includes("标准开局记录不是残局题目")).length;
      results.unshift(`“${imported.title}”已导入 ${parsed.problems.length} 题${damaged ? `，跳过 ${damaged} 条损坏记录` : ""}${suffix}`);
    }
    if (!results.length) throw new Error("文件中没有可导入的残局题目或完整棋谱。");
    return results.join("；");
  }
  async function importFiles(files: File[]) {
    if (!files.length) return;
    const cblFiles = files.filter((file) => /\.cbl$/i.test(file.name));
    if (!cblFiles.length) { setImportPanelOpen(true); setNotice("导入失败：请选择 .cbl 棋库文件。"); return; }
    const results: string[] = [];
    for (const [index, cbl] of cblFiles.entries()) {
      try {
        setNotice(`正在读取 ${index + 1}/${cblFiles.length}：${cbl.name}`);
        const base = cbl.name.replace(/\.cbl$/i, "");
        const sidecar = files.find((file) => file.name.toLowerCase() === `${base}.logic.json`.toLowerCase());
        results.push(await importBytes(new Uint8Array(await cbl.arrayBuffer()), sidecar ? await sidecar.text() : undefined));
      } catch (error) {
        results.push(`“${cbl.name}”失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setImportPanelOpen(false);
    setNotice(results.join("；"));
  }
  async function importCblUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("URL 格式不正确。");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 http 或 https 下载地址。");
    const response = await fetch(url, { headers: { accept: "application/octet-stream,*/*" } });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > CBL_IMPORT_MAX_BYTES) throw new Error("远程文件超过 50MB。");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > CBL_IMPORT_MAX_BYTES) throw new Error("远程文件超过 50MB。");
    const result = await importBytes(new Uint8Array(buffer));
    setImportPanelOpen(false);
    setNotice(result);
  }
  async function renderBoard(nextMoves: string[], move?: string, expectedSession = session.current) {
    if (!problem || expectedSession !== session.current) return;
    const before = pieces;
    const state = await boardAt(problem.startingFen, nextMoves);
    if (expectedSession !== session.current) return;
    setSelected(undefined);
    setPieces(state.pieces); setMoves(nextMoves); setLastMove(move);
    if (move) {
      const feedback = deriveTrainingFeedback(before, state, move);
      setMoveFeedback(feedback);
      playTrainingFeedback(feedback);
    }
    return state;
  }
  async function startAnalysis(requestedMultiPv = analysisMultiPv, revealStudyEnginePanel = false) {
    const target = workspaceMode;
    const standalone = target === "study" || target === "manual";
    const terminal = target === "manual" ? manualTerminal : studyTerminal;
    if (!LOCAL_PIKAFISH_AVAILABLE || (standalone && terminal) || (!standalone && (!problem || autoReplyPending || revealed))) return;
    const startingFen = target === "manual" ? manualStartingFen : standalone ? studyStartingFen : problem!.startingFen;
    const currentMoves = target === "manual" ? currentManualMoves : standalone ? currentStudyMoves : moves;
    const request = ++analysisGeneration.current;
    if (target === "study" && revealStudyEnginePanel) setStudyPanelTab("engine");
    if (target === "manual") {
      setManualPanelTab("analysis");
      setManualAnalysisExpanded(true);
      setManualPanelOpen(false);
    }
    setAnalysisPending(true);
    if (target === "study") {
      setStudyAnalysisLines([]);
      setStudyActiveAnalysis(0);
      setStudyNotice("Pikafish 正在分析当前局面…");
    } else if (target === "manual") {
      setManualAnalysisLines([]);
      setManualActiveAnalysis(0);
      setManualNotice("Pikafish 正在分析当前录谱局面…");
    } else {
      setTrainingAnalysisLines([]);
      setTrainingActiveAnalysis(0);
      setNotice("Pikafish 正在分析当前局面…");
    }
    try {
      await waitForNextPaint();
      if (request !== analysisGeneration.current) return;
      const position = await boardAt(startingFen, currentMoves, standalone ? studyRuleMode : "domestic2020");
      const result = await queryPikafishAnalysis(position.fen, analysisMoveTimeSec * 1000, requestedMultiPv);
      const translated = await Promise.all(result.lines.filter((item) => item.pv.length > 0).map(async (item) => ({ ...item, notation: await chineseLine(position.fen, item.pv).catch(() => item.pv) })));
      if (request !== analysisGeneration.current) return;
      const sorted = translated.sort((left, right) => left.multipv - right.multipv);
      if (target === "study") setStudyAnalysisLines(sorted);
      else if (target === "manual") setManualAnalysisLines(sorted);
      else setTrainingAnalysisLines(sorted);
      const message = translated.length ? "AI 拆棋完成：点击候选可突出对应箭头。" : "Pikafish 没有返回可显示的候选线。";
      if (target === "study") setStudyNotice(message);
      else if (target === "manual") setManualNotice(message);
      else setNotice(message);
    } catch (error) {
      if (request === analysisGeneration.current) {
        const message = error instanceof Error ? error.message : "AI 拆棋失败。";
        if (target === "study") setStudyNotice(message);
        else if (target === "manual") setManualNotice(message);
        else setNotice(message);
      }
    } finally {
      if (request === analysisGeneration.current) setAnalysisPending(false);
    }
  }
  async function stopAnalysis() { await resetAnalysis(); if (studyMode) setStudyNotice("已停止 AI 拆棋。"); else if (manualMode) setManualNotice("已停止 AI 分析。"); else setNotice("已停止 AI 拆棋。"); }
  async function enableStudyEngine() {
    if (!LOCAL_PIKAFISH_AVAILABLE || studyTerminal) return;
    localStorage.setItem(STUDY_ENGINE_ENABLED_KEY, "true");
    setStudyEngineEnabled(true);
    setAnalysisArrowsVisible(true);
    localStorage.setItem(ANALYSIS_ARROWS_VISIBLE_KEY, "true");
    setStudyPanelTab("engine");
    setStudyNotice("引擎已开启，正在分析当前局面。");
  }
  async function disableStudyEngine() {
    localStorage.setItem(STUDY_ENGINE_ENABLED_KEY, "false");
    setStudyEngineEnabled(false);
    await resetAnalysis("study");
    setStudyNotice("引擎已关闭。需要时点击顶部放大镜开启。");
  }
  async function toggleStudyEngine() {
    if (studyEngineEnabled) await disableStudyEngine();
    else await enableStudyEngine();
  }
  async function changeAnalysisMultiPv(value: number) {
    if (autoReplyPending) return;
    const next = Math.max(1, Math.min(4, value));
    localStorage.setItem("xiangqi-training-analysis-multipv", String(next));
    setAnalysisMultiPv(next);
    setTrainingAnalysisLines([]); setTrainingActiveAnalysis(0);
    setStudyAnalysisLines([]); setStudyActiveAnalysis(0);
    setManualAnalysisLines([]); setManualActiveAnalysis(0);
    await resetAnalysis(workspaceMode, false);
    if (studyMode && studyEngineEnabled && LOCAL_PIKAFISH_AVAILABLE && !studyTerminal) void startAnalysis(next);
    if (manualMode && manualEngineEnabled && LOCAL_PIKAFISH_AVAILABLE && !manualTerminal) void startAnalysis(next);
  }
  async function changeAnalysisMoveTimeSec(value: number) {
    if (autoReplyPending) return;
    const next = Math.max(1, Math.min(5, Math.round(value)));
    localStorage.setItem("xiangqi-training-analysis-seconds", String(next));
    setAnalysisMoveTimeSec(next);
    setTrainingAnalysisLines([]); setTrainingActiveAnalysis(0);
    setStudyAnalysisLines([]); setStudyActiveAnalysis(0);
    setManualAnalysisLines([]); setManualActiveAnalysis(0);
    await resetAnalysis(workspaceMode, false);
  }
  function toggleAnalysisArrows() {
    setAnalysisArrowsVisible((visible) => {
      const next = !visible;
      localStorage.setItem(ANALYSIS_ARROWS_VISIBLE_KEY, String(next));
      return next;
    });
  }
  async function finish(outcome: Attempt["outcome"], duration = elapsed, expectedSession = session.current) {
    if (!problem || ended || finishing.current || expectedSession !== session.current) return;
    const completedProblem = problem;
    const completedMode = mode;
    const completedHints = hints;
    const completedMistakes = mistakes;
    finishing.current = true; pendingAutoReply.current = undefined; setEnded(true); setAutoReplyPending(false); setElapsedSaved(duration); setStartedAt(undefined);
    await resetAnalysis();
    await trainingStore.saveAttempt({ problemId: completedProblem.id, mode: completedMode, elapsedMs: duration, hintsUsed: completedHints, mistakes: completedMistakes, outcome });
    const [nextAttempts, updatedProblems, nextLibraries] = await Promise.all([
      trainingStore.attempts(completedProblem.id),
      trainingStore.problems(completedProblem.libraryId),
      trainingStore.libraries(),
    ]);
    if (expectedSession !== session.current) return;
    setAttempts(nextAttempts);
    const updated = updatedProblems.find((item) => item.id === completedProblem.id);
    if (updated) setProblem(updated);
    setLibraries(nextLibraries);
  }
  function continueAfterMissingReply(activeMode: "cloud" | "ai") {
    pendingAutoReply.current = undefined;
    setAutoReplyPending(false);
    setNotice(activeMode === "cloud" ? "云库和本地 Pikafish 暂时均不可用。请手动走对方这一手，下一回合会继续自动查询。" : "本地 Pikafish 暂时不可用。请手动走对方这一手，下一回合会继续调用本地 AI。");
  }
  async function continueAutoReply(pending: PendingAutoReply, currentSession: number) {
    if (!problem || problem.id !== pending.problemId || ended || currentSession !== session.current) return;
    setAutoReplyPending(true);
    setNotice(pending.activeMode === "cloud" ? "正在查询云库应手…" : "本地 Pikafish 正在思考…");
    const replyStartedAt = Date.now();
    let reply: { iccs: string; notation: string } | undefined;
    let replySource = "皮卡鱼";
    if (pending.activeMode === "cloud") {
      replySource = "云库";
      try { reply = (await queryCloudBook(pending.playerFen))[0]; }
      catch { /* A local Pikafish reply remains available when the cloud request fails. */ }
    }
    if (currentSession !== session.current || finishing.current) return;
    if (!reply) {
      replySource = "皮卡鱼";
      try { reply = await queryPikafishReply(pending.playerFen); }
      catch {
        if (currentSession === session.current && !finishing.current) continueAfterMissingReply(pending.activeMode);
        return;
      }
    }
    if (currentSession !== session.current || finishing.current) return;
    if (!reply) {
      continueAfterMissingReply(pending.activeMode);
      return;
    }
    window.setTimeout(() => {
      if (currentSession !== session.current || finishing.current) return;
      void (async () => {
        try {
          const replyMoves = [...pending.playerMoves, reply.iccs];
          const replyState = await renderBoard(replyMoves, reply.iccs, currentSession);
          if (currentSession !== session.current || finishing.current) return;
          pendingAutoReply.current = undefined;
          const replyTerminal = terminalResult(replyState?.status);
          if (replyTerminal) {
            setNotice(`${replySource}应手后${replyTerminal}，本轮结束。`);
            await finish("free_finished", pending.durationAfterMove + Date.now() - replyStartedAt, currentSession);
            return;
          }
          setAutoReplyPending(false);
          setNotice(`${replySource}应手：${reply.notation}。请继续走棋。`);
        } catch {
          if (currentSession === session.current && !finishing.current) continueAfterMissingReply(pending.activeMode);
        }
      })();
    }, AUTO_REPLY_DELAY_MS);
  }
  async function playAutoReplyMove(iccs: string, moveStartedAt: number, activeMode: "cloud" | "ai", currentSession: number) {
    if (!problem || ended || currentSession !== session.current) return;
    const accepted = await acceptsMove(problem.startingFen, moves, iccs);
    if (currentSession !== session.current) return;
    if (!accepted) { setMistakes((value) => value + 1); setNotice("该走法不合法，局面没有改变。"); return; }
    await resetAnalysis();
    if (currentSession !== session.current) return;
    const durationAfterMove = elapsedSaved + (startedAt ? moveStartedAt - startedAt : 0);
    if (!startedAt) setStartedAt(moveStartedAt);
    setAttemptStarted(true); setAutoReplyPending(true);
    const playerMoves = [...moves, iccs];
    const playerState = await boardAt(problem.startingFen, playerMoves);
    if (currentSession !== session.current) return;
    if (!(await renderBoard(playerMoves, iccs, currentSession))) return;
    const playerTerminal = terminalResult(playerState.status);
    if (playerTerminal) {
      setNotice(`${activeMode === "cloud" ? modeLabel.cloud : modeLabel.ai}：${playerTerminal}，本轮结束。`);
      await finish("free_finished", durationAfterMove, currentSession);
      return;
    }
    const pending = { problemId: problem.id, activeMode, playerMoves, playerFen: playerState.fen, durationAfterMove };
    pendingAutoReply.current = pending;
    await continueAutoReply(pending, currentSession);
  }
  async function move(to: Square) {
    if (!problem || revealed || ended || autoReplyPending) return;
    const pieceAtTarget = pieces.find((piece) => piece.row === to.row && piece.col === to.col);
    const movingSide = sideToMove(problem.startingFen, moves);
    if (!selected) {
      if (pieceAtTarget?.color === movingSide) setSelected(to);
      else if (pieceAtTarget) setNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋，请先选择己方棋子。`);
      return;
    }
    if (sameSquare(selected, to)) { setSelected(undefined); return; }
    if (pieceAtTarget?.color === movingSide) { setSelected(to); return; }
    await playTrainingMove(`${squareName(selected)}${squareName(to)}`);
  }
  async function moveFromTo(from: Square, to: Square) {
    if (!problem || revealed || ended || autoReplyPending) return;
    const movingSide = sideToMove(problem.startingFen, moves);
    const pieceAtSource = pieces.find((piece) => piece.row === from.row && piece.col === from.col);
    const pieceAtTarget = pieces.find((piece) => piece.row === to.row && piece.col === to.col);
    if (sameSquare(from, to)) { setSelected((current) => sameSquare(current, from) ? undefined : from); return; }
    if (pieceAtSource?.color !== movingSide) {
      if (pieceAtSource) setNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋，请拖动己方棋子。`);
      return;
    }
    if (pieceAtTarget?.color === movingSide) { setSelected(to); return; }
    await playTrainingMove(`${squareName(from)}${squareName(to)}`);
  }
  async function playTrainingMove(iccs: string) {
    if (!problem || revealed || ended || autoReplyPending) return;
    const moveSession = ++session.current;
    if (mode === "free") {
      const accepted = await acceptsMove(problem.startingFen, moves, iccs);
      if (moveSession !== session.current) return;
      if (!accepted) { setMistakes((value) => value + 1); setNotice("该走法不合法，局面没有改变。"); return; }
      await resetAnalysis();
      if (moveSession !== session.current) return;
      const moveStartedAt = startedAt ?? Date.now();
      const durationAfterMove = elapsedSaved + (startedAt ? moveStartedAt - startedAt : 0);
      if (!startedAt) setStartedAt(moveStartedAt);
      setAttemptStarted(true);
      const state = await renderBoard([...moves, iccs], iccs, moveSession);
      if (!state) return;
      const terminal = terminalResult(state?.status);
      if (terminal) {
        setNotice(`自由实战：${terminal}，本轮结束。`);
        await finish("free_finished", durationAfterMove, moveSession);
      } else setNotice("已走出合法着法，可继续自由实战。");
      return;
    }
    if (mode === "cloud" || mode === "ai") { await playAutoReplyMove(iccs, Date.now(), mode, moveSession); return; }
    const match = line.find((item) => item.iccs === iccs);
    if (!match) {
      const legal = await acceptsMove(problem.startingFen, moves, iccs);
      if (moveSession !== session.current) return;
      setMistakes((value) => value + 1);
      setNotice(trainingLogicMiss(problem, iccs, legal));
      return;
    }
    await resetAnalysis();
    if (moveSession !== session.current) return;
    const moveStartedAt = startedAt ?? Date.now();
    const durationAfterMove = elapsedSaved + (startedAt ? moveStartedAt - startedAt : 0);
    if (!startedAt) setStartedAt(moveStartedAt);
    setAttemptStarted(true);
    const nextMoves = [...moves, iccs];
    const nextLine = match.children;
    const state = await renderBoard(nextMoves, iccs, moveSession);
    if (!state) return;
    const terminal = terminalResult(state?.status);
    if (terminal) {
      setNotice(`正确，${terminal}，本题结束。`);
      await finish("completed", durationAfterMove, moveSession);
      return;
    }
    if (mode !== "solver" || !nextLine.length) {
      setLine(nextLine);
      setNotice("正确，继续完成题解。");
      if (!nextLine.length) await finish("completed", durationAfterMove, moveSession);
      return;
    }
    const reply = nextLine[0];
    const currentSession = moveSession;
    setLine(nextLine);
    setAutoReplyPending(true);
    setNotice("正确，正在显示对方应手…");
    window.setTimeout(() => {
      if (currentSession !== session.current || finishing.current) return;
      void (async () => {
        const replyMoves = [...nextMoves, reply.iccs];
        const replyState = await renderBoard(replyMoves, reply.iccs, currentSession);
        if (currentSession !== session.current || finishing.current) return;
        const replyTerminal = terminalResult(replyState?.status);
        if (replyTerminal) {
          setNotice(`正确，对方应手后${replyTerminal}，本题结束。`);
          await finish("completed", durationAfterMove + Date.now() - moveStartedAt, currentSession);
          return;
        }
        setLine(reply.children);
        const notation = (await chineseLine(problem.startingFen, replyMoves).catch(() => [reply.iccs])).at(-1) ?? reply.iccs;
        setNotice(`正确，对方应手已自动走出：${notation}。`);
        setAutoReplyPending(false);
        if (!reply.children.length) await finish("completed", durationAfterMove + Date.now() - moveStartedAt, currentSession);
      })();
    }, AUTO_REPLY_DELAY_MS);
  }
  async function previewAnswerStep(nextStep: number) {
    if (!problem) return;
    const previewSession = session.current;
    const activeProblem = problem;
    const solutionMoves = mainline(activeProblem.solution);
    const boundedStep = Math.max(0, Math.min(nextStep, solutionMoves.length));
    const state = await boardAt(activeProblem.startingFen, solutionMoves.slice(0, boundedStep));
    if (previewSession !== session.current) return;
    setPieces(state.pieces);
    setAnswerStep(boundedStep);
    setLastMove(boundedStep > 0 ? solutionMoves[boundedStep - 1] : undefined);
    if (boundedStep >= solutionMoves.length) setDemoPlaying(false);
  }
  function toggleAnswerPreview() {
    if (answerStep >= answer.length) {
      void previewAnswerStep(0).then(() => setDemoPlaying(true));
      return;
    }
    setDemoPlaying((value) => !value);
  }
  async function reveal() { if (!problem || ended) return; const revealSession = session.current; const activeProblem = problem; const notation = await chineseLine(activeProblem.startingFen, mainline(activeProblem.solution)); if (revealSession !== session.current) return; await finish("revealed", elapsed, revealSession); if (revealSession !== session.current) return; const initialBoard = await boardAt(activeProblem.startingFen, []); if (revealSession !== session.current) return; setAnswer(notation); setRevealed(true); setPieces(initialBoard.pieces); setMoves([]); setLastMove(undefined); setAnswerStep(0); setDemoPlaying(false); setNotice("答案已显示，可预演。"); }
  async function restart() { if (!problem) return; const restartSession = session.current; const activeProblem = problem; if (!ended && (attemptStarted || mistakes || hints)) await finish("abandoned", elapsed, restartSession); if (restartSession !== session.current) return; await selectProblem(activeProblem); }
  function pause() { if (ended) return; if (startedAt) { setElapsedSaved(elapsed); setStartedAt(undefined); setNotice("已暂停，暂停时间不会计入用时。"); } else if (elapsedSaved) { setStartedAt(Date.now()); setNotice("继续作答。"); } }
  async function confirmDelete() { const target = deleteTarget; if (!target) return; setDeleteTarget(undefined); if (target.type === "library") { await trainingStore.deleteLibrary(target.id); const next = await trainingStore.libraries(); setLibraries(next); if (next[0]) await selectLibrary(next[0]); else { session.current += 1; await resetAnalysis(); setLibrary(undefined); setProblems([]); setProblem(undefined); } } else { await trainingStore.hideProblem(target.id); if (library) await selectLibrary(library); } }
  const giveHint = async () => {
    if (!problem || ended) return;
    const next = Math.min(3, hints + 1) as 1 | 2 | 3;
    setHints(next);
    const lead = line[0]?.iccs;
    const notation = lead ? (await chineseLine(problem.startingFen, [...moves, lead])).at(-1) ?? lead : undefined;
    const logicHint = trainingLogicHint(problem, next, notation);
    if (logicHint) setNotice(logicHint);
    else if (next === 1) setNotice(problem.note || "先寻找将军、吃子和强制着。");
    else if (!lead) setNotice("题解已完成。");
    else if (next === 2) setNotice("提示：棋盘上已标出当前应走棋子。");
    else setNotice(`首着：${notation}`);
  };
  async function changeOrientation(next: PreferredOrientation) {
    try {
      const result = await setPreferredOrientation(next);
      localStorage.setItem("xiangqi-training-orientation", next);
      setPreferredOrientationState(next);
      if (result.requiresPhysicalRotation) {
        setNotice(`已限制为${next === "landscape" ? "横屏" : "竖屏"}。请关闭系统方向锁定，再将设备实际转为${next === "landscape" ? "横向" : "竖向"}一次。`);
      } else {
        setNotice(next === "auto" ? "已恢复自动旋转。" : `已锁定${next === "landscape" ? "横屏" : "竖屏"}。`);
      }
    } catch {
      setNotice("屏幕方向切换失败，请确认系统方向锁定已关闭。");
    }
  }
  function changeRiverText(next: string) { const value = next.slice(0, 16); localStorage.setItem("xiangqi-training-river-text", value); setRiverText(value); }
  function changeRiverTextColor(next: string) { localStorage.setItem("xiangqi-training-river-text-color", next); setRiverTextColor(next); }
  function changeRiverTextSize(next: number) { const value = Math.max(16, Math.min(42, next)); localStorage.setItem("xiangqi-training-river-text-size", String(value)); setRiverTextSize(value); }
  function changeBoardSkin(next: string) {
    const value = normalizeSkinId(next);
    localStorage.setItem(BOARD_SKIN_KEY, value);
    setBoardSkin(value);
  }
  function changePieceSkin(next: string) {
    const value = normalizeSkinId(next);
    localStorage.setItem(PIECE_SKIN_KEY, value);
    setPieceSkin(value);
  }
  function useSkinSet(skin: string) {
    const value = normalizeSkinId(skin);
    localStorage.setItem(BOARD_SKIN_KEY, value);
    localStorage.setItem(PIECE_SKIN_KEY, value);
    setBoardSkin(value);
    setPieceSkin(value);
  }
  function handleSkinDevTap() {
    if (!SKIN_DEV_TOOLS_ENABLED) return;
    setSkinDevTapCount((current) => {
      const next = current + 1;
      if (next >= SKIN_DEV_TAP_TARGET) {
        setSkinDevCommandOpen(true);
        setSkinDevNotice("开发者命令入口已开启。");
        return 0;
      }
      return next;
    });
  }
  function runSkinDevCommand() {
    if (!SKIN_DEV_TOOLS_ENABLED) return;
    if (skinDevCommand.trim() !== SKIN_DEV_UNLOCK_COMMAND) { setSkinDevNotice("命令不正确。"); return; }
    setSkinDevUnlocked(true);
    setSkinDevCommand("");
    setSkinDevNotice("AI 素材包导出已解锁。");
  }
  async function exportAiSkinPackage() {
    if (!SKIN_DEV_TOOLS_ENABLED || !skinDevUnlocked) return;
    let currentFen = "";
    let moveSummary = "";
    let snapshot: Uint8Array | undefined;
    try {
      currentFen = studyMode ? studyCurrentFen : problem ? (await boardAt(problem.startingFen, moves)).fen : "";
      moveSummary = studyMode
        ? studyNotation.slice(0, studyCursor).join(" ") || currentStudyMoves.join(" ")
        : moves.join(" ");
      snapshot = await renderBoardSnapshotPng({
        pieces: studyMode ? studyPieces : pieces,
        boardSkin,
        pieceSkin,
        riverText: activeRiverText,
        riverTextColor,
        riverTextSize,
        supportsCustomRiverText: boardSkinInfo.supportsCustomRiverText,
        flipped: boardFlipped,
      });
    } catch (error) {
      setSkinDevNotice(error instanceof Error ? error.message : "AI 素材包生成失败。");
      return;
    }
    const payload = {
      app: "棋析",
      exportedAt: new Date().toISOString(),
      scene: studyMode ? "拆棋" : "残局训练",
      title: studyMode ? "自由拆棋当前局面" : problem?.title ?? "未选择题目",
      fen: currentFen,
      moves: moveSummary,
      boardSkin: boardSkinInfo,
      pieceSkin: pieceSkinInfo,
      assetSpec: {
        board: "board.png，1120×1240 PNG",
        pieces: "红方 rk/ra/rb/rn/rr/rc/rp.png，黑方 bk/ba/bb/bn/br/bc/bp.png，每个 120×120 PNG，透明背景",
        optional: "board-river-blank.png 用于自定义楚河汉界；mask.png/mask2.png 可选",
      },
      prompt: [
        "请基于中国象棋移动端 App 生成一套完整棋盘和棋子皮肤。",
        "保持棋盘 1120×1240，交叉点坐标与现有棋盘一致；棋子 120×120，透明背景。",
        "文件名必须严格使用 board.png、rk.png、ra.png、rb.png、rn.png、rr.png、rc.png、rp.png、bk.png、ba.png、bb.png、bn.png、br.png、bc.png、bp.png。",
        "风格要适合手机触屏，棋子边缘清晰，红黑辨识度高，不能影响候选箭头和选中标记可读性。",
      ].join("\n"),
    };
    const namingSpec = [
      "# 棋析皮肤文件命名与尺寸规范",
      "",
      "- 棋盘：board.png，1120×1240 PNG。",
      "- 可选空河界棋盘：board-river-blank.png，1120×1240 PNG，用于 App 内自定义“楚河汉界”文字。",
      "- 红方棋子：rk.png、ra.png、rb.png、rn.png、rr.png、rc.png、rp.png。",
      "- 黑方棋子：bk.png、ba.png、bb.png、bn.png、br.png、bc.png、bp.png。",
      "- 每个棋子：120×120 PNG，透明背景，边缘清晰。",
      "- 可选遮罩：mask.png、mask2.png。",
      "",
      "注意：棋盘交叉点坐标必须沿用现有 1120×1240 几何体系，不能重新排版。",
    ].join("\n");
    const positionSummary = [
      `场景：${payload.scene}`,
      `标题：${payload.title}`,
      `FEN：${payload.fen || "无"}`,
      `着法摘要：${payload.moves || "无"}`,
      `棋盘皮肤：${payload.boardSkin.name} (${payload.boardSkin.id})`,
      `棋子皮肤：${payload.pieceSkin.name} (${payload.pieceSkin.id})`,
      "",
      "当前局面截图：current-board.png。",
      "本包不联网、不调用 AI；截图由本机 Canvas 根据当前皮肤与局面离线生成。",
    ].join("\n");
    const blob = createZip([
      { name: "manifest.json", content: JSON.stringify(payload, null, 2) },
      { name: "position.txt", content: positionSummary },
      { name: "naming-and-size-spec.md", content: namingSpec },
      { name: "ai-prompt.txt", content: payload.prompt },
      { name: "current-board.png", content: snapshot },
    ]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qixi-ai-skin-package-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setSkinDevNotice("AI 素材包已导出。");
  }
  function changeMode(next: Mode) {
    setMode(next);
    if (next === "cloud") setNotice(LOCAL_PIKAFISH_AVAILABLE ? "云库优先应手，未收录时由本地 Pikafish 接手。" : "云库会自动应手，未收录时转为手动走棋。");
    else if (next === "ai") setNotice("本地 AI 对练：Pikafish 将在设备上离线应手。");
    else setNotice("选棋子，再点目标点。错误走法不会改变局面。");
  }

  function invalidateStudyCloud(fen: string) {
    studyCloudGeneration.current += 1;
    setStudyCurrentFen(fen);
    setStudyCloudFen(undefined);
    setStudyCloudMoves([]);
    setStudyCloudPending(false);
    setStudyCloudError(undefined);
  }
  async function refreshStudyCloud(fen = studyCurrentFen) {
    const request = ++studyCloudGeneration.current;
    setStudyCloudPending(true);
    setStudyCloudError(undefined);
    try {
      const rows = await queryCloudBook(fen);
      if (request !== studyCloudGeneration.current) return;
      setStudyCloudMoves(rows.slice(0, 12));
      setStudyCloudFen(fen);
      if (!rows.length) setStudyCloudError("ChessDB 当前局面暂无可用着法。");
    } catch (error) {
      if (request !== studyCloudGeneration.current) return;
      setStudyCloudMoves([]);
      setStudyCloudFen(fen);
      setStudyCloudError(error instanceof Error ? error.message : "云库请求失败。");
    } finally {
      if (request === studyCloudGeneration.current) setStudyCloudPending(false);
    }
  }
  function commitStudyPosition(state: BoardState, message: string) {
    setStudyAutoPlaying(false);
    setStudyStartingFen(state.fen);
    setStudyMoves([]);
    setStudyBranches([]);
    setStudyComments({});
    setStudyCursor(0);
    setStudyNotation([]);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(undefined);
    setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    setStudyNotice(message);
    invalidateStudyCloud(state.fen);
  }
  async function loadStudyPosition(fen: string, message: string, generation = ++studyGeneration.current) {
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const state = await boardAt(fen, [], studyRuleMode);
    if (generation !== studyGeneration.current) return;
    commitStudyPosition(state, message);
  }
  function resetStudyMenuPanels() {
    setStudyFenEditorOpen(false);
    setStudyFenError(undefined);
    setStudyMoveTextOpen(false);
  }
  async function openStudyMode() {
    session.current += 1;
    trainingTimerWasRunning.current = Boolean(startedAt);
    setAutoReplyPending(false);
    setSelected(undefined);
    if (startedAt) { setElapsedSaved(elapsed); setStartedAt(undefined); }
    await resetAnalysis("training", false);
    if (!studyPieces.length) await loadStudyPosition(STANDARD_STARTING_FEN, "标准局面已就绪，可自由走棋或开始分析。");
    setWorkspaceMode("study");
    setCatalogueOpen(false);
    setControlsOpen(false);
  }
  async function closeStudyMode() {
    studyGeneration.current += 1;
    studyCloudGeneration.current += 1;
    setStudyAutoPlaying(false);
    setStudyCloudPending(false);
    await resetAnalysis("study", false);
    setStudySelected(undefined);
    setStudyMenuOpen(false);
    resetStudyMenuPanels();
    setWorkspaceMode("training");
    if (trainingTimerWasRunning.current && problem && !ended && !revealed) setStartedAt(Date.now());
    trainingTimerWasRunning.current = false;
    const pending = pendingAutoReply.current;
    if (pending && problem?.id === pending.problemId && !ended && !revealed) {
      const resumeSession = ++session.current;
      void continueAutoReply(pending, resumeSession);
    }
  }

  async function switchFromStudyToManualMode() {
    studyGeneration.current += 1;
    studyCloudGeneration.current += 1;
    setStudyAutoPlaying(false);
    setStudyCloudPending(false);
    await resetAnalysis("study", false);
    setStudySelected(undefined);
    setStudyMenuOpen(false);
    resetStudyMenuPanels();
    localStorage.setItem("xiangqi-training-board-flipped", "false");
    setBoardFlipped(false);
    setWorkspaceMode("manual");
    setCatalogueOpen(false);
    setControlsOpen(false);
    await refreshManualLibrary();
    if (!manualPieces.length) await createManualFromFen(STANDARD_STARTING_FEN, "标准开局");
  }

  async function refreshManualLibrary(folder = manualFolder, queryText = manualQuery) {
    const request = ++manualLibraryRequest.current;
    const [folders, games] = await Promise.all([
      trainingStore.manualFolders(),
      trainingStore.manualGames(folder || undefined, queryText || undefined),
    ]);
    if (request !== manualLibraryRequest.current) return;
    setManualFolders(folders);
    setManualGames(games);
  }

  function manualPayload(overrides: Partial<LocalManualGame> = {}): LocalManualGame {
    const now = new Date().toISOString();
    const id = overrides.id ?? manualGame?.id ?? crypto.randomUUID();
    const cursor = overrides.cursor ?? manualCursor;
    const movesValue = overrides.moves ?? manualMoves;
    return {
      id,
      title: overrides.title ?? manualGame?.title ?? `本地录谱 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())}`,
      note: overrides.note ?? manualGame?.note ?? "",
      metadata: overrides.metadata ?? manualGame?.metadata,
      folderPath: (overrides.folderPath ?? manualGame?.folderPath ?? manualFolder) || undefined,
      startingFen: overrides.startingFen ?? manualStartingFen,
      currentNodeId: overrides.currentNodeId ?? manualNodeId(cursor),
      currentFen: overrides.currentFen ?? manualCurrentFen,
      moves: movesValue,
      cursor,
      branches: overrides.branches ?? manualBranches,
      comments: overrides.comments ?? manualComments,
      createdAt: overrides.createdAt ?? manualGame?.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };
  }

  async function saveManualGame(overrides: Partial<LocalManualGame> = {}) {
    setManualSaveStatus("保存中");
    try {
      const saved = await trainingStore.saveManualGame(manualPayload(overrides));
      setManualGame(saved);
      await refreshManualLibrary(saved.folderPath ?? manualFolder, manualQuery);
      setManualSaveStatus("已保存");
      return saved;
    } catch (error) {
      setManualSaveStatus("保存失败");
      throw error;
    }
  }

  async function saveManualGameAndShowLibrary() {
    setManualSaveDraft(manualPayload());
  }

  async function saveManualDetails(values: ManualSaveValues) {
    // Keep the existing document identity, moves and branches; only commit the form fields.
    const saved = await saveManualGame({ ...values, id: manualSaveDraft!.id, folderPath: values.folderPath ?? "" });
    const folder = saved.folderPath ?? "";
    setManualFolder(folder);
    setManualQuery("");
    await refreshManualLibrary(folder, "");
    setManualNotice(`棋谱已保存到${folder || "未分类"}。`);
    openManualPanel("library");
  }

  async function openManualMode() {
    session.current += 1;
    trainingTimerWasRunning.current = Boolean(startedAt);
    if (startedAt) { setElapsedSaved(elapsed); setStartedAt(undefined); }
    setAutoReplyPending(false);
    setSelected(undefined);
    await resetAnalysis("training", false);
    localStorage.setItem("xiangqi-training-board-flipped", "false");
    setBoardFlipped(false);
    setWorkspaceMode("manual");
    setCatalogueOpen(false);
    setControlsOpen(false);
    await refreshManualLibrary();
    if (!manualPieces.length) await createManualFromFen(STANDARD_STARTING_FEN, "标准开局");
  }

  async function closeManualMode() {
    await resetAnalysis("manual", false);
    setManualSelected(undefined);
    setManualSetupOpen(false);
    setManualPanelOpen(false);
    setManualAnalysisExpanded(false);
    setManualMenuOpen(false);
    setWorkspaceMode("training");
    if (trainingTimerWasRunning.current && problem && !ended && !revealed) setStartedAt(Date.now());
    trainingTimerWasRunning.current = false;
  }

  async function switchFromManualMode(target: MobileWorkspaceMode) {
    if (target === "manual") return;
    await resetAnalysis("manual", false);
    setManualSelected(undefined);
    setManualSetupOpen(false);
    setManualPanelOpen(false);
    setManualAnalysisExpanded(false);
    setManualMenuOpen(false);
    if (target === "study") {
      session.current += 1;
      setAutoReplyPending(false);
      setSelected(undefined);
      if (!studyPieces.length) await loadStudyPosition(STANDARD_STARTING_FEN, "标准局面已就绪，可自由走棋或开始分析。");
      setWorkspaceMode("study");
      setCatalogueOpen(false);
      setControlsOpen(false);
      return;
    }
    await closeManualMode();
  }

  async function createManualFromFen(fen: string, title = "标准开局", folderPath = manualFolder) {
    setManualSaveStatus("保存中");
    const state = await boardAt(fen, [], studyRuleMode);
    const now = new Date().toISOString();
    const game: LocalManualGame = {
      id: crypto.randomUUID(),
      title,
      note: "",
      folderPath: folderPath || undefined,
      startingFen: state.fen,
      currentNodeId: manualNodeId(0),
      currentFen: state.fen,
      moves: [],
      cursor: 0,
      branches: [],
      comments: {},
      createdAt: now,
      updatedAt: now,
    };
    const saved = await trainingStore.saveManualGame(game);
    setManualGame(saved);
    setManualStartingFen(saved.startingFen);
    setManualCurrentFen(saved.currentFen);
    setManualMoves([]);
    setManualBranches([]);
    setManualComments({});
    setManualCursor(0);
    setManualNotation([]);
    setManualPieces(state.pieces);
    setManualSelected(undefined);
    setManualLastMove(undefined);
    setManualTerminal(terminalResult(state.ruleStatus ?? state.status));
    setManualAnalysisLines([]);
    setManualNotice(`已新建棋谱：${saved.title}`);
    setManualSaveStatus("已保存");
    setManualSetupOpen(false);
    setManualAnalysisExpanded(false);
    await refreshManualLibrary(saved.folderPath ?? "", manualQuery);
  }

  async function openManualGame(game: LocalManualGame) {
    const loaded = await trainingStore.openManualGame(game.id) ?? game;
    const cursor = Math.max(0, Math.min(loaded.cursor ?? loaded.moves.length, loaded.moves.length));
    const activeMoves = loaded.moves.slice(0, cursor);
    const [state, notation] = await Promise.all([
      boardAt(loaded.startingFen, activeMoves, studyRuleMode),
      loaded.moves.length ? chineseLine(loaded.startingFen, loaded.moves).catch(() => loaded.moves) : Promise.resolve([]),
    ]);
    setManualGame(loaded);
    setManualStartingFen(loaded.startingFen);
    setManualCurrentFen(state.fen);
    setManualMoves(loaded.moves);
    setManualBranches(loaded.branches ?? []);
    setManualComments(loaded.comments ?? {});
    setManualCursor(cursor);
    setManualNotation(notation);
    setManualPieces(state.pieces);
    setManualSelected(undefined);
    setManualLastMove(activeMoves.at(-1));
    setManualTerminal(terminalResult(state.ruleStatus ?? state.status));
    setManualNotice(`已打开：${loaded.title}`);
    setManualSaveStatus("已保存");
    setManualPanelTab("moves");
    setManualPanelOpen(false);
    setManualAnalysisExpanded(false);
    setManualSetupOpen(false);
  }

  async function createManualFolder() {
    setManualSheetError("");
    setManualSheet({ type: "folderCreate", parent: manualFolderPath, name: "" });
  }

  async function deleteManualFolder(path: string) {
    setManualSheetError("");
    setManualSheet({ type: "folderDelete", target: path });
  }

  async function renameManualGame() {
    setManualSaveDraft(manualPayload());
  }

  async function moveManualGameToFolder(game = manualGame) {
    if (!game) return;
    setManualSheetError("");
    setManualSheet({ type: "gameMove", game, folder: cleanManualFolderPath(game.folderPath ?? manualFolderPath) });
  }

  async function deleteManualGame(game = manualGame) {
    if (!game) return;
    setManualSheetError("");
    setManualSheet({ type: "gameDelete", game });
  }

  async function applyManualSheet() {
    if (manualSheetLock.current || manualSheetComposing.current) return;
    manualSheetLock.current = true;
    setManualSheetBusy(true);
    try { await commitManualSheet(); }
    catch (error) { setManualSheetError(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { manualSheetLock.current = false; setManualSheetBusy(false); }
  }

  async function commitManualSheet() {
    if (!manualSheet) return;
    if (manualSheet.type === "gameInfo") {
      const title = manualSheet.title.trim();
      if (!title) { setManualSheetError("棋谱标题不能为空。"); setManualNotice("棋谱标题不能为空。"); return; }
      await saveManualGame({ title, note: manualSheet.note.trim() });
      setManualNotice("棋谱信息已保存。");
      setManualSheetError("");
      setManualSheet(undefined);
      return;
    }
    if (manualSheet.type === "folderCreate") {
      const name = cleanManualFolderPath(manualSheet.name);
      if (!name) { setManualSheetError("目录名称不能为空。"); setManualNotice("目录名称不能为空。"); return; }
      const path = cleanManualFolderPath(manualSheet.parent ? `${manualSheet.parent}/${name}` : name);
      try {
        await trainingStore.createManualFolder(path);
        setManualFolder(path);
        setManualQuery("");
        await refreshManualLibrary(path, "");
        setManualNotice(`已创建目录：${path}`);
        setManualSheetError("");
        setManualSheet(undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "新建目录失败，请重试。";
        setManualSheetError(message);
        setManualNotice(message);
      }
      return;
    }
    if (manualSheet.type === "folderRename") {
      const next = cleanManualFolderPath(manualSheet.path);
      if (!next) { setManualSheetError("目录路径不能为空。"); setManualNotice("目录路径不能为空。"); return; }
      await trainingStore.renameManualFolder(manualSheet.target, next);
      setManualFolder(next);
      await refreshManualLibrary(next, manualQuery);
      setManualNotice(`已重命名目录：${next}`);
      setManualSheetError("");
      setManualSheet(undefined);
      return;
    }
    if (manualSheet.type === "folderDelete") {
      const parent = manualParentFolder(manualSheet.target);
      await trainingStore.deleteManualFolder(manualSheet.target);
      setManualFolder(parent);
      await refreshManualLibrary(parent, manualQuery);
      setManualNotice("目录已删除，棋谱已移动到上级或未分类。");
      setManualSheetError("");
      setManualSheet(undefined);
      return;
    }
    if (manualSheet.type === "gameMove") {
      const folder = cleanManualFolderPath(manualSheet.folder);
      await trainingStore.moveManualGame(manualSheet.game.id, folder);
      if (manualSheet.game.id === manualGame?.id) setManualGame({ ...manualSheet.game, folderPath: folder || undefined });
      await refreshManualLibrary(manualFolder, manualQuery);
      setManualNotice(folder ? `已移动到：${folder}` : "已移动到未分类。");
      setManualSheetError("");
      setManualSheet(undefined);
      return;
    }
    if (manualSheet.type === "gameDelete") {
      const game = manualSheet.game;
      await trainingStore.deleteManualGame(game.id);
      if (manualGame?.id === game.id) {
        setManualGame(undefined);
        setManualMoves([]);
        setManualNotation([]);
        setManualBranches([]);
        setManualComments({});
        setManualCursor(0);
        setManualPieces((await boardAt(STANDARD_STARTING_FEN, [], studyRuleMode)).pieces);
        setManualNotice("棋谱已删除。");
      }
      await refreshManualLibrary(manualFolder, manualQuery);
      setManualSheetError("");
      setManualSheet(undefined);
    }
  }

  async function renameManualFolder(path: string) {
    setManualSheetError("");
    setManualSheet({ type: "folderRename", target: path, path });
  }

  async function deleteManualGameConfirmed(game: LocalManualGame) {
    await trainingStore.deleteManualGame(game.id);
    if (manualGame?.id === game.id) {
      setManualGame(undefined);
      setManualMoves([]);
      setManualNotation([]);
      setManualBranches([]);
      setManualComments({});
      setManualCursor(0);
      setManualPieces((await boardAt(STANDARD_STARTING_FEN, [], studyRuleMode)).pieces);
      setManualNotice("棋谱已删除。");
    }
    await refreshManualLibrary(manualFolder, manualQuery);
  }

  function rememberManualBranch(parentCursor: number, branchMoves: string[], branchNotation: string[], parentPath = manualMoves.slice(0, parentCursor)) {
    if (!branchMoves.length) return;
    setManualBranches((items) => {
      const parentKey = parentPath.join(",");
      if (items.some((item) => item.parentCursor === parentCursor && item.parentPath.join(",") === parentKey && item.moves.join(",") === branchMoves.join(","))) return items;
      return [{ id: crypto.randomUUID(), parentCursor, parentPath, moves: branchMoves, notation: branchNotation.length ? branchNotation : branchMoves, createdAt: Date.now(), branchOrder: items.filter((item) => item.parentCursor === parentCursor && item.parentPath.join(",") === parentKey).length }, ...items];
    });
  }

  async function playManualMove(iccs: string) {
    if (manualTerminal) return;
    setManualAutoPlaying(false);
    if (manualCursor < manualMoves.length && manualMoves[manualCursor] === iccs) {
      await navigateManualMove(manualCursor + 1);
      return;
    }
    if (!(await acceptsMove(manualStartingFen, currentManualMoves, iccs, studyRuleMode))) {
      setManualNotice("该走法不合法，棋谱没有改变。");
      return;
    }
    setManualSelected(undefined);
    const nextMoves = [...currentManualMoves, iccs];
    if (manualCursor < manualMoves.length) rememberManualBranch(manualCursor, manualMoves.slice(manualCursor), manualNotation.slice(manualCursor));
    const [state, notation] = await Promise.all([
      boardAt(manualStartingFen, nextMoves, studyRuleMode),
      chineseLine(manualStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    const feedback = deriveTrainingFeedback(manualPieces, state, iccs);
    setManualMoves(nextMoves);
    setManualCursor(nextMoves.length);
    setManualNotation(notation);
    setManualPieces(state.pieces);
    setManualLastMove(iccs);
    setManualCurrentFen(state.fen);
    setMoveFeedback(feedback);
    playTrainingFeedback(feedback);
    const terminal = terminalResult(state.ruleStatus ?? state.status);
    setManualTerminal(terminal);
    setManualNotice(terminal ? `当前局面：${terminal}。` : `已记录：${notation.at(-1) ?? iccs}`);
    await resetAnalysis("manual", false);
    void saveManualGame({ moves: nextMoves, cursor: nextMoves.length, currentFen: state.fen, currentNodeId: manualNodeId(nextMoves.length), branches: manualBranches });
  }

  async function navigateManualMove(cursor: number) {
    const nextCursor = Math.max(0, Math.min(manualMoves.length, cursor));
    if (nextCursor === manualCursor) return;
    await resetAnalysis("manual");
    const nextMoves = manualMoves.slice(0, nextCursor);
    const state = await boardAt(manualStartingFen, nextMoves, studyRuleMode);
    setManualCursor(nextCursor);
    setManualPieces(state.pieces);
    setManualSelected(undefined);
    setManualLastMove(nextMoves.at(-1));
    setManualCurrentFen(state.fen);
    setManualTerminal(terminalResult(state.ruleStatus ?? state.status));
    setManualNotice(nextCursor ? `已定位到第 ${nextCursor} 手。` : "已回到起始局面。");
    void saveManualGame({ cursor: nextCursor, currentFen: state.fen, currentNodeId: manualNodeId(nextCursor) });
  }

  function manualText() {
    const rows = Array.from({ length: Math.ceil(manualMoves.length / 2) }, (_, index) => {
      const redIndex = index * 2;
      const blackIndex = redIndex + 1;
      const red = manualNotation[redIndex] ? `${manualNotation[redIndex]} (${manualMoves[redIndex]})` : "";
      const black = manualNotation[blackIndex] ? `${manualNotation[blackIndex]} (${manualMoves[blackIndex]})` : "";
      return `${index + 1}. ${red}${black ? `  ${black}` : ""}`;
    });
    const branches = manualBranches.map((branch, index) => {
      const movesText = branch.notation.map((item, moveIndex) => `${item} (${branch.moves[moveIndex]})`).join(" ");
      return `分支${index + 1}：第 ${branch.parentCursor} 手后 ${movesText}`;
    });
    return [
      manualGame?.title ?? "本地录谱",
      manualGame?.note ? `备注：${manualGame.note}` : "",
      `FEN: ${manualStartingFen}`,
      "",
      ...(rows.length ? rows : ["暂无主线走法"]),
      ...(branches.length ? ["", "分支", ...branches] : []),
    ].filter((line, index) => index !== 1 || line).join("\n");
  }

  async function copyManualText(label = "棋谱文本") {
    try {
      await navigator.clipboard.writeText(manualText());
      setManualNotice(`${label}已复制。`);
    } catch {
      setManualNotice(`${label}复制失败，请检查剪贴板权限。`);
    }
  }

  async function shareManualText() {
    setManualShareDraft(manualPayload());
  }

  const manualForkCursors = [...new Set(manualBranches.map((branch) => branch.parentCursor))]
    .filter((cursor) => cursor >= 0 && cursor <= manualMoves.length)
    .sort((left, right) => left - right);

  function openManualPanel(tab: ManualPanelTab) {
    setManualPanelTab(tab);
    setManualAnalysisExpanded(tab === "analysis");
    if (tab === "analysis") setManualAnalysisView("trend");
    setManualPanelOpen(tab !== "analysis");
    setManualSetupOpen(false);
    setManualMenuOpen(false);
  }

  async function jumpManualVariation(direction: -1 | 1) {
    const target = direction < 0
      ? [...manualForkCursors].reverse().find((cursor) => cursor < manualCursor)
      : manualForkCursors.find((cursor) => cursor > manualCursor);
    if (target == null) {
      setManualNotice(direction < 0 ? "前面没有变招点。" : "后面没有变招点。");
      return;
    }
    setManualAutoPlaying(false);
    await navigateManualMove(target);
    setManualPanelTab("moves");
    setManualNotice(`已定位到第 ${target} 手后的变招点。`);
  }

  async function toggleManualAutoPlay() {
    if (!manualMoves.length) return;
    if (manualAutoPlaying) {
      setManualAutoPlaying(false);
      setManualNotice("已暂停录谱预览。");
      return;
    }
    if (manualCursor >= manualMoves.length) await navigateManualMove(0);
    setManualAutoPlaying(true);
    setManualNotice("正在预览录谱主线。");
  }

  async function runManualMenuAction(action: "training" | "rename" | "save" | "share" | "library" | "comment" | "setup" | "analysis" | "new" | "flip" | "start" | "play" | "end" | "exit") {
    setManualMenuOpen(false);
    if (action === "training" || action === "exit") await closeManualMode();
    else if (action === "rename") await renameManualGame();
    else if (action === "save") await saveManualGameAndShowLibrary();
    else if (action === "share") await shareManualText();
    else if (action === "library") openManualPanel("library");
    else if (action === "comment") { openManualPanel("moves"); setManualNotice("正在查看当前棋谱与分支。"); }
    else if (action === "setup") await openManualSetup();
    else if (action === "analysis") {
      openManualPanel("analysis");
      if (!manualEngineEnabled) { setManualEngineEnabled(true); void startAnalysis(); }
    }
    else if (action === "new") await createManualFromFen(STANDARD_STARTING_FEN, "标准开局");
    else if (action === "flip") toggleBoardFlipped();
    else if (action === "start") { setManualAutoPlaying(false); await navigateManualMove(0); }
    else if (action === "play") await toggleManualAutoPlay();
    else if (action === "end") { setManualAutoPlaying(false); await navigateManualMove(manualMoves.length); }
  }

  async function adoptManualBranch(branch: ManualBranch, focusCursor?: number) {
    const prefix = branch.parentPath;
    const previousContinuation = manualMoves.slice(branch.parentCursor);
    const previousNotation = manualNotation.slice(branch.parentCursor);
    const fullMoves = [...prefix, ...branch.moves];
    const nextCursor = Math.max(0, Math.min(fullMoves.length, focusCursor ?? fullMoves.length));
    const focusedMoves = fullMoves.slice(0, nextCursor);
    const [state, notation] = await Promise.all([
      boardAt(manualStartingFen, focusedMoves, studyRuleMode),
      chineseLine(manualStartingFen, fullMoves).catch(() => fullMoves),
    ]);
    if (previousContinuation.length && previousContinuation.join(",") !== branch.moves.join(",")) rememberManualBranch(branch.parentCursor, previousContinuation, previousNotation, manualMoves.slice(0, branch.parentCursor));
    setManualMoves(fullMoves);
    setManualCursor(nextCursor);
    setManualNotation(notation);
    setManualPieces(state.pieces);
    setManualLastMove(focusedMoves.at(-1));
    setManualCurrentFen(state.fen);
    setManualTerminal(terminalResult(state.ruleStatus ?? state.status));
    setManualNotice("已切换录谱分支。");
    void saveManualGame({ moves: fullMoves, cursor: nextCursor, currentFen: state.fen, currentNodeId: manualNodeId(nextCursor), branches: manualBranches });
  }

  function deleteManualBranch(id: string) {
    setManualBranches((items) => items.filter((item) => item.id !== id));
    setManualNotice("已删除录谱分支。");
  }

  function moveManualBranch(id: string, direction: -1 | 1) {
    setManualBranches((items) => {
      const next = [...items];
      const index = next.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return items;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function moveManual(square: Square) {
    const pieceAtTarget = manualPieces.find((piece) => piece.row === square.row && piece.col === square.col);
    const movingSide = sideToMove(manualStartingFen, currentManualMoves);
    if (!manualSelected) {
      if (pieceAtTarget?.color === movingSide) setManualSelected(square);
      else if (pieceAtTarget) setManualNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋。`);
      return;
    }
    if (sameSquare(manualSelected, square)) { setManualSelected(undefined); return; }
    if (pieceAtTarget?.color === movingSide) { setManualSelected(square); return; }
    await playManualMove(`${squareName(manualSelected)}${squareName(square)}`);
  }

  async function moveManualFromTo(from: Square, to: Square) {
    const movingSide = sideToMove(manualStartingFen, currentManualMoves);
    const source = manualPieces.find((piece) => piece.row === from.row && piece.col === from.col);
    const target = manualPieces.find((piece) => piece.row === to.row && piece.col === to.col);
    if (source?.color !== movingSide) return;
    if (target?.color === movingSide) { setManualSelected(to); return; }
    await playManualMove(`${squareName(from)}${squareName(to)}`);
  }

  async function openManualSetup() {
    setManualSetupPieces(defaultManualSetupPieces());
    setManualSetupSide("red");
    setManualSetupTool({ color: "red", kind: "pawn", label: "兵" });
    setManualSetupSelected(undefined);
    setManualSetupError("");
    setManualNotice("默认红先，可切换黑先；选择棋子后点棋盘放置。");
    setManualPanelOpen(false);
    setManualAnalysisExpanded(false);
    setManualMenuOpen(false);
    setManualSelected(undefined);
    setManualSetupOpen(true);
  }

  async function confirmManualSetup() {
    const validationError = setupValidationError(manualSetupPieces);
    if (validationError) {
      setManualSetupError(validationError);
      setManualNotice(validationError);
      return;
    }
    const fen = piecesToFen(manualSetupPieces, manualSetupSide);
    try {
      await boardAt(fen, [], studyRuleMode);
      setManualSetupOpen(false);
      setManualSetupError("");
      await createManualFromFen(fen, "摆棋局面", manualFolder);
      setManualNotice(`摆棋局面已生成，${manualSetupSide === "red" ? "红方" : "黑方"}先走。`);
    } catch (error) {
      const message = `局面不符合当前规则：${error instanceof Error ? error.message : "请检查棋子位置"}`;
      setManualSetupError(message);
      setManualNotice(message);
    }
  }

  function editManualSetupSquare(square: Square) {
    setManualSetupPieces((items) => {
      const existing = items.find((piece) => piece.row === square.row && piece.col === square.col);
      const selectedPiece = manualSetupSelected ? items.find((piece) => sameSquare(piece, manualSetupSelected)) : undefined;
      if (selectedPiece && sameSquare(square, manualSetupSelected)) {
        setManualSetupSelected(undefined);
        setManualSetupError("");
        setManualNotice("已取消悬空棋子。");
        return items;
      }
      if (existing) {
        setManualSetupSelected(square);
        if (manualSetupTool === "erase" || manualSetupTool.color !== existing.color || manualSetupTool.kind !== existing.kind) setManualSetupTool({ color: existing.color, kind: existing.kind, label: existing.label });
        setManualSetupError("");
        setManualNotice(existing.kind === "king"
          ? `已选中${existing.color === "red" ? "红帅" : "黑将"}，点本方九宫内的空位可移动；不能回收或删除。`
          : `已悬空${existing.color === "red" ? "红" : "黑"}方${existing.label}，点空位可移动，点托盘同类棋子可收回。`);
        return items;
      }
      if (selectedPiece) {
        const placementError = setupPiecePlacementError(selectedPiece, square);
        if (placementError) {
          setManualSetupError(placementError);
          setManualNotice(placementError);
          return items;
        }
        setManualSetupSelected(undefined);
        setManualSetupError("");
        setManualNotice(`已移动${selectedPiece.color === "red" ? "红" : "黑"}方${selectedPiece.label}。`);
        return items.map((piece) => sameSquare(piece, manualSetupSelected) ? { ...piece, row: square.row, col: square.col } : piece);
      }
      if (manualSetupTool === "erase") { setManualSetupError("请先选择上方或下方棋子。"); return items; }
      const placementError = setupPiecePlacementError(manualSetupTool, square);
      if (placementError) {
        setManualSetupError(placementError);
        setManualNotice(placementError);
        return items;
      }
      const used = items.filter((piece) => piece.color === manualSetupTool.color && piece.kind === manualSetupTool.kind).length;
      const limit = MANUAL_SETUP_PIECE_LIMITS[manualSetupTool.kind] ?? 0;
      if (used >= limit) {
        const nextTool = firstAvailableManualSetupTool(manualSetupTool.color, items, manualSetupTool.kind) ?? firstAvailableManualSetupTool(manualSetupTool.color === "red" ? "black" : "red", items);
        if (nextTool) {
          setManualSetupTool(nextTool);
          setManualSetupError("");
          setManualNotice(`${manualSetupTool.color === "red" ? "红" : "黑"}方${manualSetupTool.label}已经摆满，已切换到${nextTool.color === "red" ? "红" : "黑"}方${nextTool.label}。`);
        } else {
          const message = `${manualSetupTool.color === "red" ? "红" : "黑"}方${manualSetupTool.label}已经摆满。`;
          setManualSetupError(message);
          setManualNotice(message);
        }
        return items;
      }
      const nextItems = [...items, { row: square.row, col: square.col, color: manualSetupTool.color, kind: manualSetupTool.kind, label: manualSetupTool.label }];
      if (used + 1 >= limit) {
        const nextTool = firstAvailableManualSetupTool(manualSetupTool.color, nextItems, manualSetupTool.kind) ?? firstAvailableManualSetupTool(manualSetupTool.color === "red" ? "black" : "red", nextItems);
        if (nextTool) setManualSetupTool(nextTool);
      }
      setManualSetupError("");
      setManualNotice(`已放置${manualSetupTool.color === "red" ? "红" : "黑"}方${manualSetupTool.label}。`);
      return nextItems;
    });
  }

  async function analyzeManualMainline() {
    if (!manualGame || !LOCAL_PIKAFISH_AVAILABLE) {
      setManualNotice("整局本地分析仅在 iOS/Android 真机可用，请先保存棋谱。");
      return;
    }
    const request = ++analysisGeneration.current;
    const total = manualMoves.length + 1;
    if (manualAnalysisExpanded) setManualPanelTab("analysis");
    else openManualPanel("analysis");
    setManualAnalysisView("trend");
    setManualFullAnalysisProgress({ done: 0, total, running: true });
    const summaries: Record<string, LocalManualAnalysisSummary> = {};
    for (let index = 0; index < total; index += 1) {
      if (request !== analysisGeneration.current) break;
      const position = await boardAt(manualStartingFen, manualMoves.slice(0, index), studyRuleMode);
      const result = await queryPikafishAnalysis(position.fen, analysisMoveTimeSec * 1000, 1);
      const first = result.lines[0];
      if (first) {
        const summary: LocalManualAnalysisSummary = { gameId: manualGame.id, nodeId: manualNodeId(index), fen: position.fen, scoreCp: first.scoreCp, mate: first.mate, depth: first.depth, bestMove: result.bestMove || first.pv[0] || "", pv: first.pv, updatedAt: new Date().toISOString() };
        summaries[summary.nodeId] = summary;
        await trainingStore.saveManualAnalysis(summary);
      }
      setManualFullAnalysisProgress({ done: index + 1, total, running: index + 1 < total });
    }
    setManualAnalysisSummaries((current) => ({ ...current, ...summaries }));
    setManualNotice(request === analysisGeneration.current ? "整局主线分析完成。" : "整局分析已停止。");
  }

  async function loadCurrentProblemIntoStudy() {
    if (!problem) { setStudyNotice("请先返回训练模式选择一道残局。"); return; }
    const generation = ++studyGeneration.current;
    const activeProblem = problem;
    const activeMoves = moves;
    await resetAnalysis();
    if (!studyMode || generation !== studyGeneration.current) return;
    const position = await boardAt(activeProblem.startingFen, activeMoves, studyRuleMode);
    if (!studyMode || generation !== studyGeneration.current) return;
    commitStudyPosition(position, `已载入题局：${activeProblem.title}`);
  }
  async function undoStudyMove() {
    if (!studyCursor) return;
    setStudyAutoPlaying(false);
    const generation = ++studyGeneration.current;
    await resetAnalysis();
    if (generation !== studyGeneration.current) return;
    const nextMoves = studyMoves.slice(0, studyCursor - 1);
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, nextMoves, studyRuleMode),
      chineseLine(studyStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    setStudyMoves(nextMoves);
    setStudyCursor(nextMoves.length);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(nextMoves.at(-1));
    setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    setStudyNotice("已撤销一步。");
    invalidateStudyCloud(state.fen);
  }
  function rememberStudyBranch(parentCursor: number, branchMoves: string[], branchNotation: string[], parentPath = studyMoves.slice(0, parentCursor)) {
    if (!branchMoves.length) return;
    setStudyBranches((items) => {
      const parentKey = parentPath.join(",");
      const branchKey = `${parentKey}|${branchMoves.join(",")}`;
      if (items.some((item) => `${item.parentPath.join(",")}|${item.moves.join(",")}` === branchKey)) return items;
      const sameFirstIndex = items.findIndex((item) => item.parentCursor === parentCursor && item.parentPath.join(",") === parentKey && item.moves[0] === branchMoves[0]);
      if (sameFirstIndex >= 0) {
        const existing = items[sameFirstIndex];
        if (existing.moves.length >= branchMoves.length) return items;
        const next = [...items];
        next[sameFirstIndex] = { ...existing, moves: branchMoves, notation: branchNotation.length ? branchNotation : branchMoves };
        return next;
      }
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `branch-${Date.now()}`;
      const siblingOrders = items
        .filter((item) => item.parentCursor === parentCursor && item.parentPath.join(",") === parentKey)
        .map((item, index) => Number.isFinite(item.branchOrder) ? Math.max(0, Math.floor(Number(item.branchOrder))) : index + 1);
      const branchOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
      return [{ id, parentCursor, parentPath, moves: branchMoves, notation: branchNotation.length ? branchNotation : branchMoves, createdAt: Date.now(), branchOrder }, ...items];
    });
  }
  async function adoptStudyBranch(branch: StudyBranch, focusCursor?: number) {
    setStudyAutoPlaying(false);
    const generation = ++studyGeneration.current;
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const prefix = branch.parentPath;
    const fullMoves = [...prefix, ...branch.moves];
    const nextCursor = Math.max(0, Math.min(fullMoves.length, focusCursor ?? fullMoves.length));
    const focusedMoves = fullMoves.slice(0, nextCursor);
    const previousContinuation = studyMoves.slice(branch.parentCursor);
    const previousNotation = studyNotation.slice(branch.parentCursor);
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, focusedMoves, studyRuleMode),
      chineseLine(studyStartingFen, fullMoves).catch(() => fullMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    setStudyBranches((items) => {
      const branchParentKey = branch.parentPath.join(",");
      const selectedSiblingIndex = items
        .filter((item) => item.parentCursor === branch.parentCursor && item.parentPath.join(",") === branchParentKey)
        .findIndex((item) => item.id === branch.id);
      const selectedOrder = Number.isFinite(branch.branchOrder) ? Math.max(0, Math.floor(Number(branch.branchOrder))) : Math.max(0, selectedSiblingIndex);
      const withSelectedOrder = items.map((item) => item.id === branch.id ? { ...item, branchOrder: selectedOrder } : item);
      if (!previousContinuation.length || previousContinuation.join(",") === branch.moves.join(",")) return withSelectedOrder;
      const previousParentPath = studyMoves.slice(0, branch.parentCursor);
      const previousParentKey = previousParentPath.join(",");
      const exactDuplicate = withSelectedOrder.some((item) => item.parentCursor === branch.parentCursor && item.parentPath.join(",") === previousParentKey && item.moves.join(",") === previousContinuation.join(","));
      if (exactDuplicate) return withSelectedOrder;
      const sameFirstIndex = withSelectedOrder.findIndex((item) => item.parentCursor === branch.parentCursor && item.parentPath.join(",") === previousParentKey && item.moves[0] === previousContinuation[0]);
      if (sameFirstIndex >= 0) {
        const existing = withSelectedOrder[sameFirstIndex];
        if (existing.moves.length >= previousContinuation.length) return withSelectedOrder;
        const next = [...withSelectedOrder];
        next[sameFirstIndex] = { ...existing, moves: previousContinuation, notation: previousNotation.length ? previousNotation : previousContinuation };
        return next;
      }
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `branch-${Date.now()}`;
      const siblingOrders = withSelectedOrder
        .filter((item) => item.parentCursor === branch.parentCursor && item.parentPath.join(",") === previousParentKey)
        .map((item, index) => Number.isFinite(item.branchOrder) ? Math.max(0, Math.floor(Number(item.branchOrder))) : index);
      const previousOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
      return [{ id, parentCursor: branch.parentCursor, parentPath: previousParentPath, moves: previousContinuation, notation: previousNotation, createdAt: Date.now(), branchOrder: previousOrder }, ...withSelectedOrder];
    });
    setStudyMoves(fullMoves);
    setStudyCursor(nextCursor);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(focusedMoves.at(-1));
    setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    setStudyNotice(`已切换到分支：第 ${branch.parentCursor + 1} 手 ${branch.notation[0] ?? branch.moves[0]}。`);
    invalidateStudyCloud(state.fen);
  }
  async function switchStudyLine(parentCursor: number, replacement?: StudyBranch, notice = "已切换到其它变招。") {
    setStudyAutoPlaying(false);
    const generation = ++studyGeneration.current;
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const prefix = replacement ? replacement.parentPath : studyMoves.slice(0, parentCursor);
    const nextMoves = replacement ? [...prefix, ...replacement.moves] : prefix;
    const nextCursor = replacement ? Math.min(nextMoves.length, replacement.parentCursor + 1) : nextMoves.length;
    const focusedMoves = nextMoves.slice(0, nextCursor);
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, focusedMoves, studyRuleMode),
      chineseLine(studyStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    setStudyMoves(nextMoves);
    setStudyCursor(nextCursor);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(focusedMoves.at(-1));
    setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    setStudyNotice(notice);
    invalidateStudyCloud(state.fen);
  }
  async function discardStudyCurrentLine(parentCursor: number, replacement?: StudyBranch) {
    if (!window.confirm("确定删除当前变招吗？删除后会切换到其它变招。")) return;
    await switchStudyLine(parentCursor, replacement, replacement ? "已删除当前变招，并切换到其它变招。" : "已删除当前变招。");
  }
  async function deleteStudyBranch(id: string) {
    const target = studyBranches.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm("确定删除这个变招吗？删除后不能恢复。")) return;
    const sameParent = (item: StudyBranch) => item.parentCursor === target.parentCursor && item.parentPath.join(",") === target.parentPath.join(",");
    const orderOf = (item: StudyBranch, fallback: number) => Number.isFinite(item.branchOrder) ? Math.max(0, Math.floor(Number(item.branchOrder))) : fallback;
    const targetIsCurrent = studyMoves.slice(0, target.parentCursor).join(",") === target.parentPath.join(",") && studyMoves.slice(target.parentCursor).join(",") === target.moves.join(",");
    const replacement = studyBranches
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.id !== id && sameParent(item))
      .sort((left, right) => orderOf(left.item, left.index) - orderOf(right.item, right.index))[0]?.item;
    setStudyBranches((items) => items.filter((item) => item.id !== id));
    if (targetIsCurrent) {
      await switchStudyLine(target.parentCursor, replacement, replacement ? "已删除当前变招，并切换到其它变招。" : "已删除当前变招。");
      return;
    }
    setStudyNotice("已移除临时分支。");
  }
  function moveStudyBranch(id: string, direction: -1 | 1) {
    setStudyBranches((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return items;
      const parentKey = items[index].parentPath.join(",");
      const parentCursor = items[index].parentCursor;
      const orderOf = (item: StudyBranch, fallback: number) => Number.isFinite(item.branchOrder) ? Math.max(0, Math.floor(Number(item.branchOrder))) : fallback;
      const siblings = items
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) => item.parentCursor === parentCursor && item.parentPath.join(",") === parentKey)
        .sort((left, right) => orderOf(left.item, left.itemIndex) - orderOf(right.item, right.itemIndex));
      const siblingIndex = siblings.findIndex(({ item }) => item.id === id);
      const target = siblings[siblingIndex + direction];
      if (!target) return items;
      const next = [...items];
      const leftOrder = orderOf(next[index], siblingIndex);
      const rightOrder = orderOf(next[target.itemIndex], siblingIndex + direction);
      next[index] = { ...next[index], branchOrder: rightOrder };
      next[target.itemIndex] = { ...next[target.itemIndex], branchOrder: leftOrder };
      [next[index], next[target.itemIndex]] = [next[target.itemIndex], next[index]];
      return next;
    });
  }
  async function moveStudy(to: Square) {
    if (studyTerminal) return;
    const pieceAtTarget = studyPieces.find((piece) => piece.row === to.row && piece.col === to.col);
    const movingSide = sideToMove(studyStartingFen, currentStudyMoves);
    if (!studySelected) {
      if (pieceAtTarget?.color === movingSide) setStudySelected(to);
      else if (pieceAtTarget) setStudyNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋。`);
      return;
    }
    if (sameSquare(studySelected, to)) { setStudySelected(undefined); return; }
    if (pieceAtTarget?.color === movingSide) { setStudySelected(to); return; }
    const iccs = `${squareName(studySelected)}${squareName(to)}`;
    await playStudyMove(iccs);
  }
  async function moveStudyFromTo(from: Square, to: Square) {
    if (studyTerminal) return;
    const movingSide = sideToMove(studyStartingFen, currentStudyMoves);
    const pieceAtSource = studyPieces.find((piece) => piece.row === from.row && piece.col === from.col);
    const pieceAtTarget = studyPieces.find((piece) => piece.row === to.row && piece.col === to.col);
    if (sameSquare(from, to)) { setStudySelected((current) => sameSquare(current, from) ? undefined : from); return; }
    if (pieceAtSource?.color !== movingSide) {
      if (pieceAtSource) setStudyNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋，请拖动己方棋子。`);
      return;
    }
    if (pieceAtTarget?.color === movingSide) { setStudySelected(to); return; }
    await playStudyMove(`${squareName(from)}${squareName(to)}`);
  }
  async function playStudyMove(iccs: string) {
    if (studyTerminal) return;
    setStudyAutoPlaying(false);
    if (studyCursor < studyMoves.length && studyMoves[studyCursor] === iccs) {
      await navigateStudyMove(studyCursor + 1);
      return;
    }
    const movingSide = sideToMove(studyStartingFen, currentStudyMoves);
    const generation = ++studyGeneration.current;
    if (!(await acceptsMove(studyStartingFen, currentStudyMoves, iccs, studyRuleMode))) {
      if (generation === studyGeneration.current) setStudyNotice("该走法不合法，局面没有改变。");
      return;
    }
    if (generation !== studyGeneration.current) return;
    setStudySelected(undefined);
    const nextMoves = [...currentStudyMoves, iccs];
    if (studyCursor < studyMoves.length) rememberStudyBranch(studyCursor, studyMoves.slice(studyCursor), studyNotation.slice(studyCursor));
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, nextMoves, studyRuleMode),
      chineseLine(studyStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    const feedback = deriveTrainingFeedback(studyPieces, state, iccs);
    setStudyMoves(nextMoves);
    setStudyCursor(nextMoves.length);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudyLastMove(iccs);
    setMoveFeedback(feedback);
    playTrainingFeedback(feedback);
    const terminal = terminalResult(state.ruleStatus ?? state.status);
    setStudyTerminal(terminal);
    setStudyNotice(terminal ? `当前局面：${terminal}。` : `${movingSide === "red" ? "红" : "黑"}方已走 ${notation.at(-1) ?? iccs}。`);
    invalidateStudyCloud(state.fen);
    void resetAnalysis("study");
  }

  async function navigateStudyMove(cursor: number, fromAutoPlay = false) {
    if (!fromAutoPlay) setStudyAutoPlaying(false);
    const nextCursor = Math.max(0, Math.min(studyMoves.length, cursor));
    if (nextCursor === studyCursor) return;
    const generation = ++studyGeneration.current;
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const nextMoves = studyMoves.slice(0, nextCursor);
    const state = await boardAt(studyStartingFen, nextMoves, studyRuleMode);
    if (generation !== studyGeneration.current) return;
    setStudyCursor(nextCursor);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(nextMoves.at(-1));
    setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
    setStudyNotice(nextCursor ? `已定位到第 ${nextCursor} 手：${studyNotation[nextCursor - 1] ?? nextMoves.at(-1)}。` : "已回到起始局面。");
    invalidateStudyCloud(state.fen);
  }

  async function toggleStudyAutoPlay() {
    if (studyAutoPlaying) {
      setStudyAutoPlaying(false);
      setStudyNotice("已停止自动播放棋谱。");
      return;
    }
    if (!studyMoves.length) return;
    if (studyCursor >= studyMoves.length) await navigateStudyMove(0, true);
    setStudyAutoPlaying(true);
    setStudyNotice("正在自动播放棋谱。");
  }

  function toggleBoardFlipped() {
    const next = !boardFlipped;
    localStorage.setItem("xiangqi-training-board-flipped", String(next));
    setBoardFlipped(next);
    setStudySelected(undefined);
    if (manualMode) setManualNotice(next ? "棋盘已翻转为黑方视角。" : "棋盘已恢复红方视角。");
    else setStudyNotice(next ? "棋盘已翻转为黑方视角。" : "棋盘已恢复红方视角。");
  }

  function toggleStudyEvaluation() {
    const next = !studyEvaluationVisible;
    localStorage.setItem("xiangqi-training-study-evaluation", String(next));
    setStudyEvaluationVisible(next);
  }

  async function changeStudyRuleMode(next: RuleMode) {
    if (next === studyRuleMode) return;
    localStorage.setItem(STUDY_RULE_MODE_KEY, next);
    setStudyRuleMode(next);
    if (manualMode) {
      await resetAnalysis("manual", false);
      try {
        const state = await boardAt(manualStartingFen, currentManualMoves, next);
        setManualPieces(state.pieces);
        setManualCurrentFen(state.fen);
        setManualTerminal(terminalResult(state.ruleStatus ?? state.status));
        setManualNotice(`已切换为${studyRuleLabel(next)}。`);
      } catch (error) {
        setManualNotice(`棋规切换失败：${error instanceof Error ? error.message : "当前局面无法重算"}`);
      }
      return;
    }
    if (!studyMode) return;
    const generation = ++studyGeneration.current;
    await resetAnalysis("study", false);
    if (generation !== studyGeneration.current) return;
    try {
      const state = await boardAt(studyStartingFen, currentStudyMoves, next);
      if (generation !== studyGeneration.current) return;
      setStudyPieces(state.pieces);
      setStudyTerminal(terminalResult(state.ruleStatus ?? state.status));
      setStudyNotice(`已切换为${studyRuleLabel(next)}。${state.ruleReason ?? "棋规用于本地局面判定，Pikafish 搜索不切换规则。"}`);
      invalidateStudyCloud(state.fen);
    } catch (error) {
      if (generation === studyGeneration.current) setStudyNotice(`棋规切换失败：${error instanceof Error ? error.message : "当前局面无法重算"}`);
    }
  }

  function openStudyFenEditor() {
    setStudyFenDraft(studyCurrentFen);
    setStudyFenError(undefined);
    setStudyFenEditorOpen((open) => !open);
    setStudyMenuOpen(true);
  }

  async function applyStudyFen() {
    const fen = studyFenDraft.trim();
    if (!fen) { setStudyFenError("请输入 FEN 局面。"); return; }
    try {
      await loadStudyPosition(fen, "已载入自定义 FEN 局面。");
      setStudyFenEditorOpen(false);
      setStudyMenuOpen(false);
      setStudyFenError(undefined);
    } catch (error) {
      setStudyFenError(error instanceof Error ? error.message : "FEN 局面无效。");
    }
  }

  async function playActiveStudyCandidate() {
    const move = studyPanelTab === "cloud"
      ? studyCloudMoves[0]?.iccs
      : studyAnalysisLines[studyActiveAnalysis]?.pv[0];
    if (!move) {
      setStudyNotice(studyPanelTab === "cloud" ? "当前没有可走的云库着法。" : "请先运行引擎分析，再采用候选着法。");
      return;
    }
    await playStudyMove(move);
  }

  async function copyStudyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStudyNotice(`${label}已复制。`);
    } catch {
      setStudyNotice(`${label}复制失败，请检查系统剪贴板权限。`);
    }
  }

  function studyManualText() {
    const rows = Array.from({ length: Math.ceil(studyMoves.length / 2) }, (_, index) => {
      const redIndex = index * 2;
      const blackIndex = redIndex + 1;
      const red = studyNotation[redIndex] ? `${studyNotation[redIndex]} (${studyMoves[redIndex]})` : "";
      const black = studyNotation[blackIndex] ? `${studyNotation[blackIndex]} (${studyMoves[blackIndex]})` : "";
      return `${index + 1}. ${red}${black ? `  ${black}` : ""}`;
    });
    const branches = studyBranches.map((branch, index) => {
      const moves = branch.notation.map((item, moveIndex) => `${item} (${branch.moves[moveIndex]})`).join(" ");
      return `分支${index + 1}：第 ${branch.parentCursor} 手后 ${moves}`;
    });
    return [`起始局面`, `FEN: ${studyStartingFen}`, "", ...(rows.length ? rows : ["暂无主线走法"]), ...(branches.length ? ["", "临时分支", ...branches] : [])].join("\n");
  }

  function selectNextStudyCandidate() {
    setStudyPanelTab("engine");
    if (studyAnalysisLines.length < 2) {
      setStudyNotice(studyAnalysisLines.length ? "当前只有一条引擎候选。" : "请先运行引擎分析，再切换候选。");
      return;
    }
    const next = (studyActiveAnalysis + 1) % studyAnalysisLines.length;
    setStudyActiveAnalysis(next);
    setStudyNotice(`已切换到第 ${next + 1} 条候选：${studyAnalysisLines[next].notation[0] ?? studyAnalysisLines[next].pv[0]}。`);
  }

  function openImportPanel() {
    setImportPanelOpen(true);
    setStudyMenuOpen(false);
    setCatalogueOpen(false);
    setControlsOpen(false);
  }

  function runStudyMenuAction(action: "training" | "problem" | "standard" | "undo" | "copyFen" | "copyManual" | "toggleMoves" | "edit" | "flip" | "candidate" | "engine" | "cloud" | "import" | "settings") {
    if (action !== "edit" && action !== "toggleMoves") setStudyMenuOpen(false);
    if (action === "training") void closeStudyMode();
    else if (action === "problem") void loadCurrentProblemIntoStudy();
    else if (action === "standard") void loadStudyPosition(STANDARD_STARTING_FEN, "已恢复标准开局。");
    else if (action === "undo") void undoStudyMove();
    else if (action === "copyFen") void copyStudyText(studyCurrentFen, "当前局面");
    else if (action === "copyManual") void copyStudyText(studyManualText(), "文字棋谱");
    else if (action === "toggleMoves") { setStudyMoveTextOpen((open) => !open); setStudyFenEditorOpen(false); setStudyMenuOpen(true); }
    else if (action === "edit") openStudyFenEditor();
    else if (action === "flip") toggleBoardFlipped();
    else if (action === "candidate") void playActiveStudyCandidate();
    else if (action === "engine" || action === "cloud") setStudyPanelTab(action);
    else if (action === "import") openImportPanel();
    else setShowAbout(true);
  }

  const studyScoreSide = sideToMove(studyStartingFen, currentStudyMoves);
  const studySummaryLine = studyAnalysisLines[0];
  const studyEvaluationLabel = studySummaryLine ? analysisScore(studySummaryLine, studyScoreSide) : "--";
  const studyPanelItems = ([["manual", "棋谱", ClipboardList], ["cloud", "云库", Database], ["engine", "引擎", Cpu]] as const);
  const visibleStudyAnalysisLines = studyAnalysisLines.slice(0, analysisMultiPv);
  const studyArrowMoves = analysisArrowsVisible ? studyPanelTab === "cloud" ? studyCloudMoves.slice(0, analysisMultiPv).map((item) => item.iccs) : studyEngineEnabled ? visibleStudyAnalysisLines.map((item) => item.pv[0]) : [] : [];
  const studyArrowActiveIndex = studyPanelTab === "engine" ? Math.min(studyActiveAnalysis, Math.max(visibleStudyAnalysisLines.length - 1, 0)) : 0;
  const manualScoreSide = sideToMove(manualStartingFen, currentManualMoves);
  const visibleManualAnalysisLines = manualAnalysisLines.slice(0, analysisMultiPv);
  const manualArrowMoves = analysisArrowsVisible && manualEngineEnabled ? visibleManualAnalysisLines.map((item) => item.pv[0]) : [];
  const manualArrowActiveIndex = Math.min(manualActiveAnalysis, Math.max(visibleManualAnalysisLines.length - 1, 0));
  const manualTrendSamples = useMemo<ManualTrendSample[]>(() => Array.from({ length: manualMoves.length + 1 }, (_, index) => {
    const summary = manualAnalysisSummaries[manualNodeId(index)];
    const scoreSide = sideToMove(manualStartingFen, manualMoves.slice(0, index));
    return {
      index,
      active: index === manualCursor,
      score: summary ? manualSummaryRedScore(summary, scoreSide) : undefined,
      label: `${index ? `第 ${index} 手` : "起始局面"} · ${manualSummaryLabel(summary, scoreSide)}`,
    };
  }), [manualAnalysisSummaries, manualCursor, manualMoves, manualStartingFen]);
  const manualAnalysisRows = useMemo(() => manualMoves.map((move, index) => {
    const nodeId = manualNodeId(index + 1);
    const summary = manualAnalysisSummaries[nodeId];
    const scoreSide = sideToMove(manualStartingFen, manualMoves.slice(0, index + 1));
    return {
      index: index + 1,
      move,
      notation: manualNotation[index] ?? move,
      summary,
      label: manualSummaryLabel(summary, scoreSide),
      depth: summary?.depth,
    };
  }), [manualAnalysisSummaries, manualMoves, manualNotation, manualStartingFen]);
  const manualMoveEvaluations = useMemo(() => manualAnalysisRows.flatMap((row) => {
    const previous = manualTrendSamples[row.index - 1]?.score;
    const current = manualTrendSamples[row.index]?.score;
    if (previous == null || current == null) return [];
    const mover = sideToMove(manualStartingFen, manualMoves.slice(0, row.index - 1));
    const loss = mover === "red" ? previous - current : current - previous;
    const phaseIndex = manualMoves.length <= 1 ? 0 : (row.index - 1) / Math.max(1, manualMoves.length - 1);
    const phase = phaseIndex < 0.34 ? "opening" : phaseIndex < 0.67 ? "middle" : "endgame";
    const beforeSummary = manualAnalysisSummaries[manualNodeId(row.index - 1)];
    return [{ ...row, mover, phase, loss: Math.max(0, loss), quality: Math.max(0, Math.round(100 - Math.max(0, loss) / 10)), bestMove: beforeSummary?.bestMove ?? "", beforeFen: beforeSummary?.fen ?? "" }];
  }), [manualAnalysisRows, manualAnalysisSummaries, manualMoves, manualStartingFen, manualTrendSamples]);
  const manualAnalysisIssueRows = useMemo(() => manualMoveEvaluations.filter((row) => row.loss >= 120).sort((a, b) => b.loss - a.loss), [manualMoveEvaluations]);
  const manualVisibleIssueRows = manualAnalysisIssueRows.filter((row) => row.mover === manualIssueSide).slice(0, 8);
  const manualRedIssueCount = manualAnalysisIssueRows.filter((row) => row.mover === "red").length;
  const manualBlackIssueCount = manualAnalysisIssueRows.filter((row) => row.mover === "black").length;
  const manualReportStats = useMemo(() => {
    const average = (values: number[]) => values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : undefined;
    const sideRows = (side: "red" | "black") => manualMoveEvaluations.filter((row) => row.mover === side);
    const sideScore = (side: "red" | "black") => {
      const rows = sideRows(side);
      const losses = rows.map((row) => row.loss);
      const avgLoss = average(losses) ?? 0;
      const lossSpread = losses.length ? Math.sqrt(losses.reduce((total, value) => total + (value - avgLoss) ** 2, 0) / losses.length) : 0;
      return {
        overall: average(rows.map((row) => row.quality)),
        opening: average(rows.filter((row) => row.phase === "opening").map((row) => row.quality)),
        middle: average(rows.filter((row) => row.phase === "middle").map((row) => row.quality)),
        endgame: average(rows.filter((row) => row.phase === "endgame").map((row) => row.quality)),
        accuracy: average(rows.map((row) => row.quality)),
        stability: rows.length ? Math.max(0, Math.round(100 - lossSpread / 10)) : undefined,
        issues: manualAnalysisIssueRows.filter((row) => row.mover === side).length,
      };
    };
    return { red: sideScore("red"), black: sideScore("black") };
  }, [manualAnalysisIssueRows, manualMoveEvaluations]);
  const manualAnalyzedCount = Object.keys(manualAnalysisSummaries).length;
  const manualCurrentSummary = manualAnalysisSummaries[manualNodeId(manualCursor)];
  const manualCurrentLabel = manualSummaryLabel(manualCurrentSummary, manualScoreSide);
  const manualLatestSummary = manualAnalysisSummaries[manualNodeId(manualMoves.length)];
  const manualLatestLabel = manualSummaryLabel(manualLatestSummary, sideToMove(manualStartingFen, manualMoves));
  const manualScoreDisplay = (score?: number) => score == null ? "--" : `${score}分`;
  const renderManualAnalysisBody = () => <section className="manual-analysis-workbench">
    <nav className="manual-analysis-tabs" role="tablist" aria-label="录谱分析视图">
      {([["trend", "局势图"], ["report", "报告"], ["issues", "错误"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={manualAnalysisView === value} className={manualAnalysisView === value ? "active" : ""} onClick={() => setManualAnalysisView(value)}>{label}</button>)}
    </nav>
    {manualAnalysisView === "trend" && <>
      <ManualTrendChart samples={manualTrendSamples} progress={manualFullAnalysisProgress} onAnalyze={() => void analyzeManualMainline()}/>
      <div className="manual-analysis-summary-grid">
        <p><b>当前</b><span>{manualCurrentLabel}</span></p>
        <p><b>末尾</b><span>{manualLatestLabel}</span></p>
        <p><b>已分析</b><span>{manualAnalyzedCount}/{manualMoves.length + 1}</span></p>
      </div>
      <div className="manual-analysis-list compact">
        {manualAnalysisRows.length ? manualAnalysisRows.slice(Math.max(0, manualCursor - 3), Math.max(6, manualCursor + 3)).map((row) => <p key={`${row.move}-${row.index}`} className={row.index === manualCursor ? "active" : ""} onClick={() => void navigateManualMove(row.index)}><b>{row.index}</b><span>{row.notation}</span><small>{row.depth ? `${row.label} · 深度 ${row.depth}` : row.label}</small></p>) : <p><b>0</b><span>起始局面</span><small>{manualCurrentLabel}</small></p>}
      </div>
    </>}
    {manualAnalysisView === "report" && <section className="manual-analysis-brief">
      <div><b>复盘概览</b><span>已分析 {manualAnalyzedCount}/{manualMoves.length + 1} 个局面</span></div>
      {manualAnalyzedCount ? <>
        <div className="manual-report-scoreline"><article className="red"><b>{manualScoreDisplay(manualReportStats.red.overall)}</b><span>红方</span></article><strong>{manualCurrentLabel}</strong><article className="black"><b>{manualScoreDisplay(manualReportStats.black.overall)}</b><span>黑方</span></article></div>
        <div className="manual-report-table">
          <div><span>{manualScoreDisplay(manualReportStats.red.opening)}</span><b>开局评分</b><span>{manualScoreDisplay(manualReportStats.black.opening)}</span></div>
          <div><span>{manualScoreDisplay(manualReportStats.red.middle)}</span><b>中局评分</b><span>{manualScoreDisplay(manualReportStats.black.middle)}</span></div>
          <div><span>{manualScoreDisplay(manualReportStats.red.endgame)}</span><b>残局评分</b><span>{manualScoreDisplay(manualReportStats.black.endgame)}</span></div>
          <div><span>{manualScoreDisplay(manualReportStats.red.accuracy)}</span><b>准确评分</b><span>{manualScoreDisplay(manualReportStats.black.accuracy)}</span></div>
          <div><span>{manualScoreDisplay(manualReportStats.red.stability)}</span><b>稳定评分</b><span>{manualScoreDisplay(manualReportStats.black.stability)}</span></div>
          <div><button type="button" onClick={() => { setManualIssueSide("red"); setManualAnalysisView("issues"); }}>{manualRedIssueCount}</button><b>失误</b><button type="button" onClick={() => { setManualIssueSide("black"); setManualAnalysisView("issues"); }}>{manualBlackIssueCount}</button></div>
        </div>
      </> : <p>整局分析后会显示双方综合评分、阶段评分和失误数量。</p>}
      <button type="button" onClick={() => void analyzeManualMainline()}>{manualFullAnalysisProgress?.running ? "分析中" : manualAnalyzedCount ? "重新生成报告" : "开始整局分析"}</button>
    </section>}
    {manualAnalysisView === "issues" && <section className="manual-analysis-brief issues">
      <div><b>错误着法</b><span>红 {manualRedIssueCount} · 黑 {manualBlackIssueCount}</span></div>
      <div className="manual-issue-side-switch" role="group" aria-label="选择错误方"><button type="button" className={manualIssueSide === "red" ? "active red" : "red"} onClick={() => setManualIssueSide("red")}>红方错误 <b>{manualRedIssueCount}</b></button><button type="button" className={manualIssueSide === "black" ? "active black" : "black"} onClick={() => setManualIssueSide("black")}>黑方错误 <b>{manualBlackIssueCount}</b></button></div>
      {manualVisibleIssueRows.length ? <div className="manual-issue-list">{manualVisibleIssueRows.map((row) => <button key={`${row.move}-${row.index}`} type="button" onClick={() => void navigateManualMove(row.index)}><strong>第 {row.index} 手 {row.notation}</strong><span>损失约 {Math.round(row.loss)} 分 · {row.label}<ManualMoveSuggestion gameId={manualGame?.id ?? ""} fen={row.beforeFen} move={row.bestMove}/></span></button>)}</div> : <p>{manualAnalyzedCount ? `${manualIssueSide === "red" ? "红方" : "黑方"}暂无明显错误。` : "先开始整局分析，再查看红黑双方问题着法。"}</p>}
      {!manualAnalyzedCount && <button type="button" onClick={() => void analyzeManualMainline()}>开始整局分析</button>}
    </section>}
  </section>;
  const workspaceTitle = studyMode ? `自由拆棋 · ${studyRuleLabel(studyRuleMode)}` : manualMode ? "本地录谱" : library?.title ?? "本地 CBL 题库";
  const manualSetupTrayItems = [
    { kind: "pawn", redLabel: "兵", blackLabel: "卒", count: 5 },
    { kind: "cannon", redLabel: "炮", blackLabel: "炮", count: 2 },
    { kind: "horse", redLabel: "马", blackLabel: "马", count: 2 },
    { kind: "rook", redLabel: "车", blackLabel: "车", count: 2 },
    { kind: "elephant", redLabel: "相", blackLabel: "象", count: 2 },
    { kind: "advisor", redLabel: "仕", blackLabel: "士", count: 2 },
  ];
  function firstAvailableManualSetupTool(color: "red" | "black", pieces: BoardPiece[], excludedKind?: string) {
    const item = manualSetupTrayItems.find((candidate) => candidate.kind !== excludedKind && candidate.count > pieces.filter((piece) => piece.color === color && piece.kind === candidate.kind).length);
    if (!item) return undefined;
    return { color, kind: item.kind, label: color === "red" ? item.redLabel : item.blackLabel };
  }
  const renderManualSetupTray = (color: "red" | "black") => <section className={`manual-setup-tray ${color}`} aria-label={color === "red" ? "红方摆棋棋子" : "黑方摆棋棋子"}>
    {manualSetupTrayItems.map((item) => {
      const label = color === "red" ? item.redLabel : item.blackLabel;
      const used = manualSetupPieces.filter((piece) => piece.color === color && piece.kind === item.kind).length;
      const remaining = Math.max(0, item.count - used);
      const selectedPiece = manualSetupSelected ? manualSetupPieces.find((piece) => sameSquare(piece, manualSetupSelected)) : undefined;
      const canRecoverSelected = Boolean(selectedPiece && selectedPiece.kind !== "king" && selectedPiece.color === color && selectedPiece.kind === item.kind);
      const depleted = remaining <= 0;
      const disabled = depleted && !canRecoverSelected;
      const active = canRecoverSelected || (!depleted && manualSetupTool !== "erase" && manualSetupTool.color === color && manualSetupTool.kind === item.kind);
      const piece: BoardPiece = { row: 0, col: 0, color, kind: item.kind, label };
      return <button key={`${color}-${item.kind}`} type="button" disabled={disabled} className={`${active ? "active" : ""} ${depleted ? "depleted" : ""}`.trim()} aria-label={canRecoverSelected ? `收回${color === "red" ? "红" : "黑"}${label}` : depleted ? `${color === "red" ? "红" : "黑"}${label}已摆满` : `${color === "red" ? "红" : "黑"}${label}`} onClick={() => {
        if (canRecoverSelected && manualSetupSelected) {
          setManualSetupPieces((items) => items.filter((boardPiece) => !sameSquare(boardPiece, manualSetupSelected)));
          setManualSetupSelected(undefined);
          setManualSetupTool({ color, kind: item.kind, label });
          setManualSetupError("");
          setManualNotice(`已收回${color === "red" ? "红" : "黑"}方${label}。`);
          return;
        }
        if (depleted) return;
        setManualSetupSelected(undefined);
        setManualSetupTool({ color, kind: item.kind, label });
        setManualSetupError("");
      }}>
        <img src={trainingPieceAsset(piece, pieceSkin)} alt="" draggable={false}/>
        <span>{label}</span>
        {remaining > 1 && <em>{remaining}</em>}
      </button>;
    })}
  </section>;

  return <div className={`training-app ${studyMode ? "study-active" : ""} ${manualMode ? "manual-active" : ""} ${revealed && !studyMode && !manualMode ? "answer-revealed" : ""}`}><header className={`app-header ${studyMode || manualMode ? "study-mode-header" : ""}`}><span><BookOpen/><strong>棋析</strong><small>{workspaceTitle}</small></span><div><nav className="workspace-switcher" aria-label="移动端模式切换"><button className={workspaceMode === "training" ? "active" : ""} aria-current={workspaceMode === "training" ? "page" : undefined} aria-label="残棋" data-tooltip="残棋" onClick={() => { if (studyMode) void closeStudyMode(); else if (manualMode) void closeManualMode(); else { setCatalogueOpen((open) => !open); setControlsOpen(false); } }}><BookOpen/><span>残棋</span></button><button className={studyMode ? "active" : ""} aria-current={studyMode ? "page" : undefined} aria-label="拆棋" data-tooltip="拆棋" onClick={() => { if (!studyMode) void openStudyMode(); }}><Cpu/><span>拆棋</span></button><button className={manualMode ? "active" : ""} aria-current={manualMode ? "page" : undefined} aria-label="录谱" data-tooltip="录谱" onClick={() => { if (!manualMode) void openManualMode(); }}><FilePenLine/><span>录谱</span></button></nav><button className="mobile-drawer-toggle catalogue-toggle" aria-label={catalogueOpen ? "收起题库目录" : "打开题库目录"} data-tooltip={catalogueOpen ? "收起题库目录" : "题库目录"} aria-expanded={catalogueOpen} onClick={() => { setCatalogueOpen((open) => !open); setControlsOpen(false); }}><BookOpen/><span>目录</span></button><button className="import-cbl-action" aria-label="导入 CBL" data-tooltip="导入 CBL" onClick={openImportPanel}><FileUp/><span>导入 CBL</span></button><button className="mobile-drawer-toggle controls-toggle" aria-label={controlsOpen ? "收起训练控制" : "打开训练控制"} data-tooltip={controlsOpen ? "收起训练控制" : "训练控制"} aria-expanded={controlsOpen} onClick={() => { setControlsOpen((open) => !open); setCatalogueOpen(false); }}><Clock3/><span>控制</span></button><button className="about-trigger" aria-label="关于棋析" data-tooltip="关于棋析" onClick={() => setShowAbout(true)}><CircleHelp/></button></div><input ref={input} type="file" multiple accept=".cbl,.json,application/json,application/octet-stream" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.currentTarget.value = ""; void importFiles(files); }}/></header><div className="training-layout">
    <aside className={`catalogue ${catalogueOpen ? "drawer-open" : ""}`}><header className="catalogue-heading"><span><strong>题库目录</strong><small>{libraries.length} 本本地题库</small></span>{library && <button className="catalogue-delete" title="删除当前题库" onClick={() => setDeleteTarget({ type: "library", id: library.id, title: library.title })}><Trash2/></button>}</header><div className="library-list">{libraries.map((item) => <section key={item.id}><button className={`library-row ${expanded === item.id ? "expanded" : ""}`} onClick={() => expanded === item.id ? setExpanded(undefined) : void selectLibrary(item)}><BookOpen/><span><b>{item.title}</b><small>{item.completedCount}/{item.problemCount} 已完成</small></span>{expanded === item.id ? <ChevronDown/> : <ChevronRight/>}</button>{expanded === item.id && <div className="problem-area"><div className="filters"><div className="problem-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索残局题名或分类" aria-label="搜索残局题名或分类" autoComplete="off"/>{query && <button type="button" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery("")}><X/></button>}</div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="按残局分类筛选">{categories.map((value) => <option key={value}>{value}</option>)}</select></div>{visible.length ? visible.map((item) => <button key={item.id} className={`problem-row ${problem?.id === item.id ? "active" : ""}`} onClick={() => void selectProblem(item)}><b>{item.sourceIndex + 1}</b><span>{item.title}<small>{item.category} · {item.completedAttempts ? `累计 ${fmt(item.totalElapsedMs)}` : "未练"}</small></span></button>) : <p className="problem-empty">没有找到匹配的残局</p>}</div>}</section>)}</div></aside>
    <main className="training-stage">{problem ? <><header className="problem-heading"><small>第 {problem.sourceIndex + 1}/{problems.length} 题</small><strong>{problem.title}</strong><button title="移除当前残局" onClick={() => setDeleteTarget({ type: "problem", id: problem.id, title: problem.title })}><Trash2/></button></header><Board key="training" pieces={pieces} selected={selected} legalTargets={legalTargets} lastMove={lastMove} hintMove={hints >= 2 ? line[0]?.iccs : undefined} analysisMoves={analysisArrowsVisible ? trainingAnalysisLines.map((item) => item.pv[0]) : []} activeAnalysis={trainingActiveAnalysis} flipped={boardFlipped} feedback={moveFeedback} boardSkin={boardSkin} pieceSkin={pieceSkin} riverText={activeRiverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} supportsCustomRiverText={boardSkinInfo.supportsCustomRiverText} onSquare={(square) => void move(square)} onMove={(from, to) => void moveFromTo(from, to)}/><p className="board-tip">{mode === "cloud" ? "云库优先应手；未收录时由本地 Pikafish 接手。" : mode === "ai" ? "本地 Pikafish 离线应手，不访问云库。" : "选棋子或拖动棋子到目标点。错误走法不会改变局面。"}</p></> : <div className="empty"><BookOpen/><strong>选择CBL文件</strong><span>题库和练习记录仅保存在这台手机或平板。</span></div>}</main>
    <aside className={`controls ${controlsOpen ? "drawer-open" : ""} ${revealed ? "answer-revealed" : ""}`}>{problem ? <><section className="clock"><Clock3/><small>本题用时</small><strong>{fmt(elapsed)}</strong><span>累计用时 {fmt(problem.totalElapsedMs)}</span><button onClick={() => { setShowHistory((value) => !value); void trainingStore.attempts(problem.id).then(setAttempts); }}>记录</button></section><section className="modes">{(["cloud", ...(LOCAL_PIKAFISH_AVAILABLE ? ["ai" as const] : []), "solver", "replay", "free"] as Mode[]).map((value) => <label key={value}><input type="radio" checked={mode === value} disabled={attemptStarted || ended} onChange={() => changeMode(value)}/>{modeLabel[value]}{value === "cloud" && (LOCAL_PIKAFISH_AVAILABLE ? "（云库优先）" : "（云库应手）")}{value === "ai" && "（纯离线）"}{value === "replay" && "（按题解）"}</label>)}</section>{LOCAL_PIKAFISH_AVAILABLE && <AnalysisPanel lines={trainingAnalysisLines} pending={analysisPending && !studyMode} activeIndex={trainingActiveAnalysis} disabled={autoReplyPending || revealed || ended} enabled={true} multiPv={analysisMultiPv} moveTimeSec={analysisMoveTimeSec} scoreSide={sideToMove(problem.startingFen, moves)} arrowsVisible={analysisArrowsVisible} onToggle={() => void (analysisPending ? stopAnalysis() : startAnalysis())} onToggleArrows={toggleAnalysisArrows} onSelect={setTrainingActiveAnalysis} onMultiPvChange={(value) => void changeAnalysisMultiPv(value)} onMoveTimeChange={(value) => void changeAnalysisMoveTimeSec(value)}/>}<section className={`actions ${revealed ? "revealed-actions" : ""}`}>{revealed ? <><button className="primary" onClick={toggleAnswerPreview}>{demoPlaying ? <Pause/> : <Play/>}{demoPlaying ? "暂停预演" : answerStep >= answer.length ? "重播答案" : "答案预演"}</button><button onClick={() => void restart()}><RotateCcw/>重来</button></> : <><button className="primary" disabled={ended} onClick={() => void giveHint()}><Lightbulb/>提示 {hints}/3</button><button disabled={ended || (!startedAt && !elapsedSaved)} onClick={pause}>{startedAt ? <Pause/> : <Play/>}{startedAt ? "暂停" : "继续"}</button><button onClick={() => void restart()}><RotateCcw/>重来</button>{mode === "free" || mode === "cloud" || mode === "ai" ? <button disabled={ended} onClick={() => void finish("free_finished")}>{mode === "free" ? "结束实战" : "结束对练"}</button> : <button disabled={ended} onClick={() => void reveal()}><ListRestart/>看答案</button>}</>}</section><section className={`notice ${revealed ? "answer-notice" : ""}`}><b>错误 {mistakes} 次{revealed ? " · 答案已显示，可预演" : ""}</b>{!revealed && <p>{renderNote(notice)}</p>}</section>{showHistory ? <section className="history"><b>答题记录</b>{attempts.length ? attempts.slice(0, 30).map((item) => <p key={item.id}><strong>{item.outcome === "completed" ? "解出" : item.outcome === "revealed" ? "看答案" : item.outcome === "free_finished" ? "实战结束" : "已放弃"}</strong><span>{modeLabel[item.mode]} · {fmt(item.elapsedMs)} · 错 {item.mistakes} · 提示 {item.hintsUsed}</span></p>) : <p>还没有答题记录</p>}</section> : revealed && <section className="answer"><header><b>答案预演</b><small>{answerStep}/{answer.length} 手</small></header><footer className="answer-preview-controls"><button disabled={answerStep <= 0} onClick={() => { setDemoPlaying(false); void previewAnswerStep(answerStep - 1); }}><ChevronLeft/>上一步</button><button disabled={answerStep >= answer.length} onClick={() => { setDemoPlaying(false); void previewAnswerStep(answerStep + 1); }}><ChevronRight/>下一步</button><button disabled={!answer.length} onClick={toggleAnswerPreview}>{demoPlaying ? <Pause/> : <Play/>}{demoPlaying ? "暂停" : answerStep >= answer.length ? "重播" : "继续"}</button><button onClick={() => { setDemoPlaying(false); void previewAnswerStep(0); }}><RotateCcw/>从头</button></footer><div className="answer-move-list">{Array.from({ length: Math.ceil(answer.length / 2) }, (_, index) => <p key={index} className={answerStep > index * 2 ? "active" : ""}><b>第 {index + 1} 回合</b><span>红方 {answer[index * 2]}{answer[index * 2 + 1] ? ` · 黑方 ${answer[index * 2 + 1]}` : ""}</span></p>)}</div></section>}<footer className="navigate"><button disabled={currentIndex <= 0} onClick={() => void selectProblem(visible[currentIndex - 1])}><ChevronLeft/></button><button disabled={currentIndex >= visible.length - 1} onClick={() => void selectProblem(visible[currentIndex + 1])}><ChevronRight/></button></footer></> : <p>从目录选择题目。</p>}</aside>
  </div>{studyMode && <div className="study-workspace">
    <main className={`study-stage${studyEvaluationVisible ? "" : " evaluation-hidden"}`}><header className={`study-toolbar ${studyMenuOpen ? "menu-open" : ""}`}><nav className="study-command-bar" aria-label="拆棋工具栏">
      <button className="study-return-training" aria-label="返回残局训练" title="返回残局训练" onClick={() => runStudyMenuAction("training")}><BookOpen/><span>训练</span></button>
      <button aria-label="切换到录谱" title="切换到录谱" onClick={() => void switchFromStudyToManualMode()}><FilePenLine/><span>录谱</span></button>
      <button className={studyMenuOpen ? "active" : ""} aria-label="更多功能" title="更多功能" aria-expanded={studyMenuOpen} onClick={() => setStudyMenuOpen((open) => !open)}><Ellipsis/><span>更多</span></button>
      <button aria-label="新建标准棋局" title="新建标准棋局" onClick={() => runStudyMenuAction("standard")}><Plus/><span>新局</span></button>
      <button aria-label="编辑 FEN 局面" title="编辑 FEN 局面" onClick={() => runStudyMenuAction("edit")}><Pencil/><span>编辑</span></button>
      <button className={boardFlipped ? "active" : ""} aria-label="翻转棋盘" title="翻转棋盘" onClick={() => runStudyMenuAction("flip")}><FlipVertical2/><span>翻转</span></button>
      <button className={`study-engine-toggle ${studyEngineEnabled ? "active engine-enabled" : ""}`} disabled={Boolean(studyTerminal)} aria-pressed={studyEngineEnabled} aria-label={studyEngineEnabled ? "关闭引擎分析" : "开启引擎分析"} title={studyEngineEnabled ? "关闭引擎分析" : "开启引擎分析"} onClick={() => void toggleStudyEngine()}><Search/><span>{studyEngineEnabled ? "引擎开" : "引擎关"}</span></button>
      <button className={studyPanelTab === "engine" ? "active" : ""} aria-label="打开引擎面板" title="打开引擎面板" onClick={() => setStudyPanelTab("engine")}><Cpu/><span>引擎</span></button>
    </nav></header>{studyEvaluationVisible && <section className="study-engine-strip"><div><span>深度 {studySummaryLine?.depth ?? "--"}</span><span>节点 {studySummaryLine ? compactNumber(studySummaryLine.nodes) : "--"}</span><span>速度 {studySummaryLine ? `${compactNumber(studySummaryLine.nps)}/s` : "--"}</span></div><button className="study-evaluation-toggle" type="button" aria-label="隐藏顶部评估" onClick={toggleStudyEvaluation}>当前评估 {studyEvaluationLabel}</button></section>}<Board key="study" pieces={studyPieces} selected={studySelected} legalTargets={studyLegalTargets} lastMove={studyLastMove} analysisMoves={studyArrowMoves} activeAnalysis={studyArrowActiveIndex} flipped={boardFlipped} feedback={moveFeedback} boardSkin={boardSkin} pieceSkin={pieceSkin} riverText={activeRiverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} supportsCustomRiverText={boardSkinInfo.supportsCustomRiverText} onSquare={(square) => void moveStudy(square)} onMove={(from, to) => void moveStudyFromTo(from, to)}/></main>
    {studyMenuOpen && <section className="study-menu" aria-label="拆棋功能菜单">
        <header><span><strong>拆棋功能</strong><small>临时拆棋，不写题解树</small></span><button type="button" aria-label="关闭拆棋功能菜单" onClick={() => setStudyMenuOpen(false)}><X/></button></header>
        <StudySkinSettings boardSkin={boardSkin} pieceSkin={pieceSkin} boardSkinInfo={boardSkinInfo} riverText={riverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} onBoardSkinChange={changeBoardSkin} onPieceSkinChange={changePieceSkin} onUseSkinSet={useSkinSet} onRiverTextChange={changeRiverText} onRiverTextColorChange={changeRiverTextColor} onRiverTextSizeChange={changeRiverTextSize}/>
        <div className="study-menu-group"><button onClick={() => runStudyMenuAction("training")}><BookOpen/><span>题库训练</span></button><button onClick={() => runStudyMenuAction("standard")}><Plus/><span>新局</span></button><button className={studyMoveTextOpen ? "active" : ""} onClick={() => runStudyMenuAction("toggleMoves")}><ListRestart/><span>{studyBranches.length ? `棋谱/分支(${studyBranches.length})` : "棋谱/分支"}</span></button></div>
        <div className="study-menu-group"><button aria-label="复制当前局面" onClick={() => runStudyMenuAction("copyFen")}><ClipboardCopy/><span>复制局面</span></button><button aria-label="编辑 FEN 局面" onClick={() => runStudyMenuAction("edit")}><FilePenLine/><span>编辑局面</span></button><button className={boardFlipped ? "active" : ""} onClick={() => runStudyMenuAction("flip")}><FlipVertical2/><span>翻转棋盘</span></button></div>
        <div className="study-menu-group"><button disabled={!problem} onClick={() => runStudyMenuAction("problem")}><BookOpen/><span>当前题局</span></button><button onClick={() => runStudyMenuAction("import")}><FileUp/><span>导入 CBL</span></button><button disabled={!studyCursor} onClick={() => runStudyMenuAction("undo")}><Undo2/><span>撤销一步</span></button><button disabled={!studyAnalysisLines.length && !studyCloudMoves.length} onClick={() => runStudyMenuAction("candidate")}><CircleCheckBig/><span>采用候选</span></button></div>
        <div className="study-menu-group study-menu-secondary"><button onClick={() => runStudyMenuAction("engine")}><Cpu/><span>引擎分析</span></button><button onClick={() => runStudyMenuAction("cloud")}><Database/><span>云库面板</span></button><button onClick={() => runStudyMenuAction("copyManual")}><ClipboardCopy/><span>复制棋谱</span></button></div>
        {studyFenEditorOpen && <section className="study-fen-inline" aria-label="编辑拆棋局面"><header><strong>编辑 FEN</strong><button type="button" onClick={() => setStudyFenEditorOpen(false)}>收起</button></header><textarea value={studyFenDraft} rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { setStudyFenDraft(event.target.value); setStudyFenError(undefined); }}/>{studyFenError && <p className="study-fen-error">{studyFenError}</p>}<footer><button type="button" onClick={() => setStudyFenEditorOpen(false)}>取消</button><button type="button" className="primary" onClick={() => void applyStudyFen()}>载入局面</button></footer></section>}
        {studyMoveTextOpen && <section className="study-moves study-moves-inline" aria-label="棋谱与临时分支"><header><b>棋谱与分支</b><button type="button" onClick={() => void copyStudyText(studyManualText(), "文字棋谱")}><ClipboardCopy/>复制</button></header>{studyMoves.length ? <div className="study-move-text"><button className={`start ${studyCursor === 0 ? "active" : ""}`} onClick={() => void navigateStudyMove(0)}><b>起始局面</b><small>FEN</small></button>{Array.from({ length: Math.ceil(studyMoves.length / 2) }, (_, index) => { const redIndex = index * 2; const blackIndex = redIndex + 1; return <div key={index} className="study-move-round"><span>{index + 1}</span><button className={studyCursor === redIndex + 1 ? "active" : ""} disabled={!studyMoves[redIndex]} onClick={() => void navigateStudyMove(redIndex + 1)}><b>{studyNotation[redIndex] ?? studyMoves[redIndex]}</b><small>{studyMoves[redIndex]}</small></button><button className={studyCursor === blackIndex + 1 ? "active" : ""} disabled={!studyMoves[blackIndex]} onClick={() => void navigateStudyMove(blackIndex + 1)}><b>{studyNotation[blackIndex] ?? studyMoves[blackIndex]}</b><small>{studyMoves[blackIndex]}</small></button></div>; })}</div> : <p>还没有主线走法。</p>}{studyBranches.length > 0 && <div className="study-branches" aria-label="临时分支"><header><b>临时分支</b><span>{studyBranches.length} 条</span></header>{studyBranches.map((branch, index) => <div key={branch.id} className="study-branch-row"><b>{index + 1}</b><span><strong>第 {branch.parentCursor} 手后</strong><small>{branch.notation.slice(0, 4).join(" ") || branch.moves.slice(0, 4).join(" ")}</small></span><div><button type="button" onClick={() => void adoptStudyBranch(branch)}>采用</button><button type="button" aria-label="删除临时分支" onClick={() => void deleteStudyBranch(branch.id)}><Trash2/></button></div></div>)}</div>}</section>}
        <fieldset className="study-rule-picker"><legend>棋规模式</legend>{(["domestic2020", "asianAxf"] as RuleMode[]).map((value) => <button key={value} type="button" className={studyRuleMode === value ? "active" : ""} onClick={() => void changeStudyRuleMode(value)}>{studyRuleLabel(value)}</button>)}</fieldset>
        <p className="study-rule-note">棋规用于本地局面/重复棋例提示；Pikafish 仍按中国象棋局面搜索。</p>
        <label className="study-menu-check"><input type="checkbox" checked={studyEvaluationVisible} onChange={toggleStudyEvaluation}/><span>顶部评估</span></label>
        <button className="study-menu-settings" onClick={() => runStudyMenuAction("settings")}><Settings2/><span>更多设置</span></button>
      </section>}
    <aside className="study-sidebar">
      <nav className="study-move-nav" aria-label="拆棋着法导航"><button disabled={!studyCursor} aria-label="回到开始" title="回到开始" onClick={() => void navigateStudyMove(0)}><ChevronsLeft/></button><button disabled={!studyCursor} aria-label="上一步" title="上一步" onClick={() => void navigateStudyMove(studyCursor - 1)}><ChevronLeft/></button><button className={studyAutoPlaying ? "active" : ""} disabled={!studyMoves.length} aria-label={studyAutoPlaying ? "暂停播放棋谱" : "自动播放棋谱"} title={studyAutoPlaying ? "暂停播放棋谱" : "自动播放棋谱"} onClick={() => void toggleStudyAutoPlay()}>{studyAutoPlaying ? <Pause/> : <Play/>}</button><button disabled={studyCursor >= studyMoves.length} aria-label="下一步" title="下一步" onClick={() => void navigateStudyMove(studyCursor + 1)}><ChevronRight/></button><button disabled={studyCursor >= studyMoves.length} aria-label="最后一步" title="最后一步" onClick={() => void navigateStudyMove(studyMoves.length)}><ChevronsRight/></button></nav>
      <nav className="study-panel-tabs" role="tablist" aria-label="拆棋研究面板">{studyPanelItems.map(([value, label, Icon]) => <button key={value} role="tab" aria-selected={studyPanelTab === value} className={studyPanelTab === value ? "active" : ""} onClick={() => setStudyPanelTab(value)}><Icon/><span>{label}</span></button>)}</nav>
      {studyPanelTab === "engine" && (LOCAL_PIKAFISH_AVAILABLE ? <AnalysisPanel lines={studyAnalysisLines} pending={analysisPending && studyMode} activeIndex={studyActiveAnalysis} disabled={Boolean(studyTerminal)} enabled={studyEngineEnabled} multiPv={analysisMultiPv} moveTimeSec={analysisMoveTimeSec} scoreSide={studyScoreSide} arrowsVisible={analysisArrowsVisible} onToggle={() => void (analysisPending ? stopAnalysis() : studyEngineEnabled ? startAnalysis() : enableStudyEngine())} onToggleArrows={toggleAnalysisArrows} onSelect={setStudyActiveAnalysis} onMultiPvChange={(value) => void changeAnalysisMultiPv(value)} onMoveTimeChange={(value) => void changeAnalysisMoveTimeSec(value)}/> : <section className="study-unavailable">本地 Pikafish 仅在 Android 或 iOS 版可用。</section>)}
      {studyPanelTab === "cloud" && <section className="study-cloud-panel">{studyCloudPending ? <p className="study-cloud-empty">正在查询当前局面…</p> : studyCloudMoves.length ? <div className="study-cloud-list">{studyCloudMoves.map((item, index) => { const evaluation = cloudEvaluation(item, studyScoreSide); return <button key={item.iccs} onClick={() => void playStudyMove(item.iccs)}><b>{index + 1}</b><strong>{item.notation}</strong><em>红分 {evaluation.redScore > 0 ? "+" : ""}{evaluation.redScore}</em><small>红 {evaluation.redRate.toFixed(1)}% · 黑 {evaluation.blackRate.toFixed(1)}%</small></button>; })}</div> : <p className="study-cloud-empty">{studyCloudError ?? "当前局面暂无云库着法。"}</p>}</section>}
      {studyPanelTab === "manual" && <StudyManualTree moves={studyMoves} notation={studyNotation} cursor={studyCursor} branches={studyBranches} comments={studyComments} onCommentChange={(key, comment) => setStudyComments((current) => ({ ...current, [key]: comment }))} onNavigate={(cursor) => void navigateStudyMove(cursor)} onAdopt={(branch, focusCursor) => void adoptStudyBranch(branch, focusCursor)} onDelete={(id) => void deleteStudyBranch(id)} onDiscardCurrent={(parentCursor, replacement) => void discardStudyCurrentLine(parentCursor, replacement)} onMove={moveStudyBranch}/>}
      <section className={`study-notice ${studyNoticeVisible ? "" : "hidden"} ${studyNoticePersistent ? "important" : ""}`} aria-live={studyNoticePersistent ? "assertive" : "polite"}><b>{studyRuleLabel(studyRuleMode)}</b><p>{studyNotice}</p></section>
    </aside>
    {studyMenuOpen && <button className="study-menu-scrim" aria-label="关闭拆棋菜单" onClick={() => setStudyMenuOpen(false)}/>}
  </div>}{manualMode && <div className="manual-workspace study-workspace">
    <main className={`study-stage manual-stage evaluation-hidden ${manualSetupOpen ? "manual-setup-active" : ""} ${manualAnalysisExpanded ? "manual-analysis-expanded" : ""}`}><header className="study-toolbar manual-statusbar" aria-label="录谱状态">
      <button type="button" aria-label={manualSetupOpen ? "取消设置局面" : "返回残局训练"} onClick={() => manualSetupOpen ? setManualSetupOpen(false) : void closeManualMode()}><ChevronLeft/></button>
      <div><b>{manualSetupOpen ? `创建局面 · ${manualSetupSide === "red" ? "红先" : "黑先"}` : manualAnalysisExpanded ? "录谱分析" : `录谱 ${manualCursor}/${manualMoves.length}`}</b><small>{manualSetupOpen ? manualNotice : `${manualGame?.title ?? "标准开局"} · ${manualSaveStatus}${manualTerminal ? ` · ${manualTerminal}` : ""}`}</small></div>
      <nav className="manual-mode-switch" aria-label="快捷切换模式"><button type="button" onClick={() => void switchFromManualMode("training")}><BookOpen/><span>残棋</span></button><button type="button" onClick={() => void switchFromManualMode("study")}><Cpu/><span>拆棋</span></button><button type="button" className="active" aria-current="page"><FilePenLine/><span>录谱</span></button></nav>
      <button type="button" aria-label="打开棋库" onClick={() => openManualPanel("library")}><Database/></button>
    </header>{manualSetupOpen ? <section className="manual-setup-board-area">{renderManualSetupTray("black")}{manualSetupError && <p className="manual-setup-toast" role="alert" aria-live="assertive">{manualSetupError}</p>}<div className="manual-setup-board-slot"><Board pieces={manualSetupPieces} selected={manualSetupSelected} legalTargets={[]} lastMove={undefined} analysisMoves={[]} activeAnalysis={manualArrowActiveIndex} flipped={boardFlipped} feedback={undefined} setupMode={true} showSideCoordinates={true} boardSkin={boardSkin} pieceSkin={pieceSkin} riverText={activeRiverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} supportsCustomRiverText={boardSkinInfo.supportsCustomRiverText} onSquare={editManualSetupSquare}/></div>{renderManualSetupTray("red")}</section> : <div className="manual-play-board-area"><Board key="manual" pieces={manualPieces} selected={manualSelected} legalTargets={manualLegalTargets} lastMove={manualLastMove} analysisMoves={manualArrowMoves} activeAnalysis={manualArrowActiveIndex} flipped={boardFlipped} feedback={moveFeedback} setupMode={false} showSideCoordinates={true} boardSkin={boardSkin} pieceSkin={pieceSkin} riverText={activeRiverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} supportsCustomRiverText={boardSkinInfo.supportsCustomRiverText} onSquare={(square) => void moveManual(square)} onMove={(from, to) => void moveManualFromTo(from, to)}/></div>}
      {manualAnalysisExpanded && <section className="manual-analysis-dock" aria-label="录谱分析面板">
        <header><strong>自我分析</strong><div><button type="button" onClick={() => void analyzeManualMainline()}>整局分析</button><button type="button" onClick={() => { setManualAnalysisExpanded(false); setManualPanelTab("moves"); }}>收起</button></div></header>
        {renderManualAnalysisBody()}
      </section>}
      <section className={`manual-bottom-tools ${manualSetupOpen ? "manual-setup-tools" : ""}`} aria-label={manualSetupOpen ? "摆棋工具" : "录谱常用工具"}>
        {manualSetupOpen ? <>
          <div className="manual-tool-row setup-actions"><button type="button" onClick={() => { setManualSetupSelected(undefined); setManualSetupError(""); setManualSetupTool({ color: "red", kind: "pawn", label: "兵" }); void boardAt(STANDARD_STARTING_FEN, [], studyRuleMode).then((state) => { setManualSetupPieces(state.pieces); setManualNotice("已摆满标准开局。"); }); }}>摆满</button><button type="button" onClick={() => { setManualSetupPieces(defaultManualSetupPieces()); setManualSetupSelected(undefined); setManualSetupTool({ color: "red", kind: "pawn", label: "兵" }); setManualSetupError(""); setManualNotice("已清空棋盘，仅保留默认将帅。"); }}>清空</button><button type="button" onClick={toggleBoardFlipped}>翻转</button><button type="button" onClick={() => setManualSetupSide((side) => { const next = side === "red" ? "black" : "red"; setManualSetupError(""); setManualNotice(`已设置为${next === "red" ? "红方" : "黑方"}先走。`); return next; })}>{manualSetupSide === "red" ? "红先⇄黑先" : "黑先⇄红先"}</button><button type="button" className="primary" onClick={() => void confirmManualSetup()}>完成</button></div>
        </> : <>
        <div className="manual-tool-row compact-actions">
          <button type="button" className={manualMenuOpen ? "active" : ""} onClick={() => setManualMenuOpen((open) => !open)}><Ellipsis/><span>菜单</span></button>
          {manualAnalysisExpanded ? <button type="button" className="active" onClick={() => void (analysisPending ? stopAnalysis() : startAnalysis())}><Cpu/><span>自我分析</span></button> : <button type="button" onClick={() => void openManualSetup()}><Pencil/><span>设置局面</span></button>}
          <button type="button" className={boardFlipped ? "active" : ""} onClick={toggleBoardFlipped}><FlipVertical2/><span>翻转</span></button>
          <button type="button" disabled={!manualCursor} onClick={() => { setManualAutoPlaying(false); void navigateManualMove(manualCursor - 1); }}><ChevronLeft/><span>上一步</span></button>
          <button type="button" disabled={manualCursor >= manualMoves.length} onClick={() => { setManualAutoPlaying(false); void navigateManualMove(manualCursor + 1); }}><ChevronRight/><span>下一步</span></button>
        </div>
        {manualMenuOpen && <section className="manual-popover-menu" aria-label="录谱菜单">
          <button type="button" onClick={() => void runManualMenuAction("save")}><CircleCheckBig/><span>保存棋谱</span></button>
          <button type="button" onClick={() => void runManualMenuAction("new")}><Plus/><span>新谱</span></button>
          <button type="button" onClick={() => void runManualMenuAction("library")}><Database/><span>棋库</span></button>
          <button type="button" onClick={() => void runManualMenuAction("comment")}><ClipboardList/><span>查看棋谱</span></button>
          <button type="button" onClick={() => void runManualMenuAction("analysis")}><Cpu/><span>分析</span></button>
          <button type="button" onClick={() => void runManualMenuAction("flip")}><FlipVertical2/><span>翻转</span></button>
          <button type="button" onClick={() => void runManualMenuAction("setup")}><Pencil/><span>设置局面</span></button>
          <button type="button" onClick={() => void runManualMenuAction("rename")}><FilePenLine/><span>标题备注</span></button>
          <button type="button" onClick={() => void runManualMenuAction("share")}><ClipboardCopy/><span>分享棋谱</span></button>
          <button type="button" onClick={() => void runManualMenuAction("start")}><ChevronsLeft/><span>回到开局</span></button>
          <button type="button" onClick={() => void runManualMenuAction("play")}><Play/><span>{manualAutoPlaying ? "暂停播放" : "播放棋谱"}</span></button>
          <button type="button" onClick={() => void runManualMenuAction("end")}><ChevronsRight/><span>跳到末尾</span></button>
          <button type="button" onClick={() => void runManualMenuAction("training")}><BookOpen/><span>返回残棋</span></button>
          <button type="button" onClick={() => void runManualMenuAction("exit")}><X/><span>退出录谱</span></button>
        </section>}
        </>}
      </section>
    </main>
    {manualPanelOpen && <button className="manual-panel-scrim" aria-label="关闭录谱面板" onClick={() => setManualPanelOpen(false)}/>}
    {manualPanelOpen && <aside className="manual-panel-sheet" role="dialog" aria-modal="true" aria-label="录谱面板">
      <header><strong>{manualPanelTab === "moves" ? "棋谱与注释" : manualPanelTab === "analysis" ? "本地分析" : "本地棋库"}</strong><button type="button" aria-label="关闭录谱面板" onClick={() => setManualPanelOpen(false)}><X/></button></header>
      <nav className="study-panel-tabs" role="tablist" aria-label="录谱面板">{([["moves", "棋谱", ClipboardList], ["analysis", "分析", Cpu], ["library", "棋库", Database]] as const).map(([value, label, Icon]) => <button key={value} role="tab" aria-selected={manualPanelTab === value} className={manualPanelTab === value ? "active" : ""} onClick={() => openManualPanel(value)}><Icon/><span>{label}</span></button>)}</nav>
      <div className="manual-panel-content">
        {manualPanelTab === "moves" && <StudyManualTree moves={manualMoves} notation={manualNotation} cursor={manualCursor} branches={manualBranches} comments={manualComments} onCommentChange={(key, comment) => { const comments = { ...manualComments, [key]: comment }; setManualComments(comments); void saveManualGame({ comments }); }} onNavigate={(cursor) => void navigateManualMove(cursor)} onAdopt={(branch, focusCursor) => void adoptManualBranch(branch, focusCursor)} onDelete={deleteManualBranch} onDiscardCurrent={() => setManualNotice("主线删除后续首版暂不开放，请使用分支切换。")} onMove={moveManualBranch}/>}
        {manualPanelTab === "analysis" && renderManualAnalysisBody()}
        {manualPanelTab === "library" && <section className="manual-library-panel">
          <header><button onClick={() => void createManualFolder()}><Folder/>{manualFolderPath ? "新子目录" : "新目录"}</button><button onClick={() => void createManualFromFen(STANDARD_STARTING_FEN, "标准开局")}><Plus/>新谱</button><button disabled={!manualGame} onClick={() => void renameManualGame()}><Pencil/>棋谱信息</button></header>
          <div className="problem-search"><Search/><input value={manualQuery} placeholder="搜索本地棋谱" onChange={(event) => setManualQuery(event.target.value)}/>{manualQuery && <button type="button" onClick={() => setManualQuery("")}><X/></button>}</div>
          <nav className="manual-folder-breadcrumbs" aria-label="本地棋谱目录路径">{manualBreadcrumbs.map((item) => <button key={item.path || "root"} className={manualFolderPath === item.path ? "active" : ""} onClick={() => setManualFolder(item.path)}>{item.label}</button>)}</nav>
          {manualFolderPath && <div className="manual-folder-actions"><button onClick={() => void renameManualFolder(manualFolderPath)}><Pencil/>重命名当前目录</button><button className="danger" onClick={() => void deleteManualFolder(manualFolderPath)}><Trash2/>删除目录</button></div>}
          <ManualFolderTree folders={manualFolders} currentPath={manualFolderPath} onSelect={setManualFolder}/>
          <div className="manual-game-list">{manualGames.length ? manualGames.map((game) => <button key={game.id} className={manualGame?.id === game.id ? "active" : ""} onClick={() => void openManualGame(game)}><b>{game.title}</b><small>{game.folderPath || "未分类"} · {game.moves.length} 手 · {new Date(game.updatedAt).toLocaleDateString("zh-CN")}</small><span><i onClick={(event) => { event.stopPropagation(); void moveManualGameToFolder(game); }}>移动</i><i onClick={(event) => { event.stopPropagation(); void deleteManualGame(game); }}>删除</i></span></button>) : <p>暂无本地棋谱。</p>}</div>
        </section>}
      </div>
      <section className="manual-panel-notice" aria-live="polite"><b>{manualGame?.title ?? "本地录谱"}</b><p>{manualNotice}</p></section>
    </aside>}
  </div>}
  {manualShareDraft && <ManualShareDialog game={manualShareDraft} onClose={() => setManualShareDraft(undefined)}/> }
  {manualSaveDraft && <ManualSaveDialog
    game={manualSaveDraft}
    folders={manualFolders}
    onSave={saveManualDetails}
    onClose={() => setManualSaveDraft(undefined)}
    onCreateFolder={async (path) => {
      await trainingStore.createManualFolder(path);
      await refreshManualLibrary();
    }}
  />}
  {manualSheet && <div className="confirm-backdrop manual-sheet-dialog" role="dialog" aria-modal="true" onMouseDown={() => { if (!manualSheetLock.current) { setManualSheetError(""); setManualSheet(undefined); } }}><section onCompositionStart={() => { manualSheetComposing.current = true; }} onCompositionEnd={() => { manualSheetComposing.current = false; }} onMouseDown={(event) => event.stopPropagation()}>
    <header><strong>{manualSheet.type === "gameInfo" ? "棋谱信息" : manualSheet.type === "folderCreate" ? (manualSheet.parent ? "新建子目录" : "新建目录") : manualSheet.type === "folderRename" ? "重命名目录" : manualSheet.type === "folderDelete" ? "删除目录" : manualSheet.type === "gameMove" ? "移动棋谱" : "删除棋谱"}</strong><button onClick={() => { if (!manualSheetLock.current) { setManualSheetError(""); setManualSheet(undefined); } }}><X/></button></header>
    {manualSheetError && <p className="manual-sheet-error" role="alert" aria-live="assertive">{manualSheetError}</p>}
    {manualSheet.type === "gameInfo" && <><label><span>标题</span><input autoFocus value={manualSheet.title} onChange={(event) => { setManualSheetError(""); setManualSheet({ ...manualSheet, title: event.target.value }); }}/></label><label><span>备注</span><textarea value={manualSheet.note} rows={3} onChange={(event) => { setManualSheetError(""); setManualSheet({ ...manualSheet, note: event.target.value }); }}/></label></>}
    {manualSheet.type === "folderCreate" && <><p>当前位置：{manualSheet.parent || "全部"}</p><label><span>{manualSheet.parent ? "子目录名称" : "目录名称"}</span><input autoFocus value={manualSheet.name} placeholder="例如：第1轮" onKeyDown={(event) => { if (isImeEnter(event, manualSheetComposing.current)) void applyManualSheet(); }} onChange={(event) => { setManualSheetError(""); setManualSheet({ ...manualSheet, name: event.target.value }); }}/></label></>}
    {manualSheet.type === "folderRename" && <><p>原目录：{manualSheet.target}</p><label><span>新目录路径</span><input autoFocus value={manualSheet.path} onKeyDown={(event) => { if (isImeEnter(event, manualSheetComposing.current)) void applyManualSheet(); }} onChange={(event) => { setManualSheetError(""); setManualSheet({ ...manualSheet, path: event.target.value }); }}/></label></>}
    {manualSheet.type === "folderDelete" && <p>删除目录「{manualSheet.target}」？目录内棋谱会移动到上级或未分类，不会删除棋谱。</p>}
    {manualSheet.type === "gameMove" && <><p>移动《{manualSheet.game.title}》</p><label><span>目标目录</span><input autoFocus value={manualSheet.folder} placeholder="留空为未分类" onChange={(event) => { setManualSheetError(""); setManualSheet({ ...manualSheet, folder: event.target.value }); }}/></label>{manualFolders.length > 0 && <div className="manual-sheet-folder-picks">{manualFolders.slice(0, 12).map((folder) => <button key={folder.path} onClick={() => { setManualSheetError(""); setManualSheet({ ...manualSheet, folder: folder.path }); }}>{folder.path}</button>)}</div>}</>}
    {manualSheet.type === "gameDelete" && <p>删除棋谱《{manualSheet.game.title}》？此操作不会影响残棋题库。</p>}
    <footer><button onClick={() => { if (!manualSheetLock.current) { setManualSheetError(""); setManualSheet(undefined); } }}>取消</button><button className={manualSheet.type === "folderDelete" || manualSheet.type === "gameDelete" ? "danger" : "primary"} disabled={manualSheetBusy} onClick={() => void applyManualSheet()}>{manualSheetBusy ? "保存中…" : manualSheet.type === "folderDelete" || manualSheet.type === "gameDelete" ? "删除" : "确定"}</button></footer>
  </section></div>}{importPanelOpen && <ImportCblPanel onBack={() => setImportPanelOpen(false)} onPick={() => input.current?.click()} onImportUrl={importCblUrl}/>} {(catalogueOpen || controlsOpen) && <button className="drawer-backdrop" aria-label="关闭抽屉" onClick={() => { setCatalogueOpen(false); setControlsOpen(false); }}/>} {deleteTarget && <div className="confirm-backdrop" onMouseDown={() => setDeleteTarget(undefined)}><section onMouseDown={(event) => event.stopPropagation()}><strong>确认删除</strong><p>{deleteTarget.type === "library" ? `删除题库《${deleteTarget.title}》及该应用内的答题记录？` : `从训练目录移除《${deleteTarget.title}》？答题记录会保留。`}</p><footer><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></footer></section></div>}{showAbout && <AboutDialog
    preferredOrientation={preferredOrientation}
    studyRuleMode={studyRuleMode}
    skinDevCommandOpen={skinDevCommandOpen}
    skinDevCommand={skinDevCommand}
    skinDevUnlocked={skinDevUnlocked}
    skinDevNotice={skinDevNotice}
    onClose={() => setShowAbout(false)}
    onOrientationChange={changeOrientation}
    onStudyRuleModeChange={(value) => void changeStudyRuleMode(value)}
    onSkinDevTap={handleSkinDevTap}
    onSkinDevCommandChange={setSkinDevCommand}
    onRunSkinDevCommand={() => void runSkinDevCommand()}
    onExportAiSkinPackage={() => void exportAiSkinPackage()}
  />}</div>;
}

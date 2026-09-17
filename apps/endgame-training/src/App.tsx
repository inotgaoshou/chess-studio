import { Activity, BookOpen, BrainCircuit, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, ClipboardCopy, Clock3, Database, Ellipsis, FilePenLine, FileUp, FlipVertical2, Lightbulb, ListRestart, Pause, Pencil, Play, Plus, RotateCcw, Search, Settings2, Square as StopIcon, Trash2, Undo2, X, Zap } from "lucide-react";
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { trainingStore } from "./store";
import type { Attempt, BoardPiece, BoardState, SolutionMove, TrainingLibrary, TrainingProblem } from "./types";
import { acceptsMove, boardAt, cancelPikafishSearch, chineseLine, hasLocalPikafish, parseCbl, queryCloudBook, queryPikafishAnalysis, queryPikafishReply, type CloudBookMove, type PikafishAnalysisLine } from "./wasm";
import { deriveTrainingFeedback, playTrainingFeedback, TRAINING_FEEDBACK_PACK, type TrainingFeedbackKind } from "./moveFeedback";
import { setPreferredOrientation, type PreferredOrientation } from "./orientation";

type Mode = "cloud" | "ai" | "solver" | "replay" | "free";
type StudyPanelTab = "engine" | "cloud";
type Square = { row: number; col: number };
type AnalysisLine = PikafishAnalysisLine & { notation: string[] };
type StudyBranch = {
  id: string;
  parentCursor: number;
  moves: string[];
  notation: string[];
  createdAt: number;
};
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
  showMoveText?: boolean;
  fenEditorExpanded?: boolean;
};
const LOCAL_PIKAFISH_AVAILABLE = hasLocalPikafish();
const STUDY_STATE_KEY = "xiangqi-training-study-state";
const modeLabel: Record<Mode, string> = { cloud: LOCAL_PIKAFISH_AVAILABLE ? "云库 + 皮卡鱼" : "云库对练", ai: "本地 AI 对练", solver: "只走解题方", replay: "双方复现", free: "自由实战" };
const fmt = (value: number) => `${String(Math.floor(value / 60000)).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}`;
const compactNumber = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);
const analysisScore = (line: AnalysisLine, scoreSide: "red" | "black") => {
  const redFactor = scoreSide === "red" ? 1 : -1;
  if (line.mate != null) {
    const redMateSide = (line.mate === 0 ? -1 : Math.sign(line.mate)) * redFactor;
    return redMateSide > 0 ? `红杀 ${Math.abs(line.mate)}` : `黑杀 ${Math.abs(line.mate)}`;
  }
  const score = Math.round((line.scoreCp ?? 0) * redFactor);
  return `红分 ${score > 0 ? "+" : ""}${score}`;
};
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
const squareName = (square: Square) => `${String.fromCharCode(97 + square.col)}${9 - square.row}`;
const iccsSquares = (move: string) => ({ from: { col: move.charCodeAt(0) - 97, row: 9 - Number(move[1]) }, to: { col: move.charCodeAt(2) - 97, row: 9 - Number(move[3]) } });
const mainline = (line: SolutionMove[]) => { const moves: string[] = []; let cursor = line[0]; while (cursor) { moves.push(cursor.iccs); cursor = cursor.children[0]; } return moves; };
const AUTO_REPLY_DELAY_MS = 650;
const STANDARD_STARTING_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const APP_VERSION = __APP_VERSION__;
const APP_BUILD_TIME = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(__APP_BUILD_TIME__));
const BOARD_ART_WIDTH = 1120;
const BOARD_ART_HEIGHT = 1240;
const QINGXIN_COLUMNS = [87, 205, 326, 443, 560, 679, 795, 915, 1031];
const QINGXIN_ROWS = [85, 201, 317, 435, 554, 680, 795, 910, 1028, 1145];
const markerCornerPath = "M -54 -54 H -25 M -54 -54 V -25 M 54 -54 H 25 M 54 -54 V -25 M -54 54 H -25 M -54 54 V 25 M 54 54 H 25 M 54 54 V 25";
const pieceCodes: Record<string, string> = {
  king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p",
};

function readStoredStudyState(): StudyStateSnapshot {
  const fallback: StudyStateSnapshot = { enabled: false, tab: "engine", startingFen: STANDARD_STARTING_FEN, moves: [], cursor: 0, branches: [], showMoveText: false, fenEditorExpanded: false };
  try {
    const raw = localStorage.getItem(STUDY_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StudyStateSnapshot>;
    const moves = Array.isArray(parsed.moves) ? parsed.moves.filter((move): move is string => typeof move === "string" && /^[a-i][0-9][a-i][0-9]$/.test(move)) : [];
    const cursor = Math.max(0, Math.min(moves.length, Math.floor(Number(parsed.cursor) || 0)));
    const tab = parsed.tab === "cloud" || parsed.tab === "engine" ? parsed.tab : "engine";
    const startingFen = typeof parsed.startingFen === "string" && parsed.startingFen.trim() ? parsed.startingFen : STANDARD_STARTING_FEN;
    const branches = Array.isArray(parsed.branches) ? parsed.branches.flatMap((branch): StudyBranch[] => {
      const value = branch as Partial<StudyBranch>;
      const branchMoves = Array.isArray(value.moves) ? value.moves.filter((move): move is string => typeof move === "string" && /^[a-i][0-9][a-i][0-9]$/.test(move)) : [];
      if (!branchMoves.length) return [];
      return [{
        id: typeof value.id === "string" && value.id ? value.id : `branch-${Date.now()}-${branchMoves.join("-")}`,
        parentCursor: Math.max(0, Math.min(moves.length, Math.floor(Number(value.parentCursor) || 0))),
        moves: branchMoves,
        notation: Array.isArray(value.notation) ? value.notation.filter((item): item is string => typeof item === "string") : branchMoves,
        createdAt: Number(value.createdAt) || Date.now(),
      }];
    }).slice(0, 20) : [];
    return { enabled: parsed.enabled === true, tab, startingFen, moves, cursor, branches, showMoveText: parsed.showMoveText === true, fenEditorExpanded: parsed.fenEditorExpanded === true };
  } catch {
    return fallback;
  }
}

function terminalResult(status: string | undefined) {
  if (status === "将死") return "绝杀（将死）";
  if (status === "困毙") return "困毙";
  return undefined;
}

function sideToMove(startingFen: string, moves: string[]) {
  const startsWithBlack = startingFen.trim().split(/\s+/)[1] === "b";
  return (moves.length % 2 === 0) === startsWithBlack ? "black" : "red";
}

function trainingPieceAsset(piece: BoardPiece) {
  const code = pieceCodes[piece.kind.toLowerCase()] ?? "p";
  return `/skins/qingxin-zhuyun/${piece.color === "red" ? "r" : "b"}${code}.png`;
}

function renderNote(value: string) {
  return value.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, index) => {
    const match = /^\[b\]([\s\S]*)\[\/b\]$/i.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  });
}

const displaySquare = (square: Square, flipped: boolean): Square => flipped ? { row: 9 - square.row, col: 8 - square.col } : square;

function BoardMarkerLayer({ selected, lastMove, flipped = false }: { selected?: Square; lastMove?: { from: Square; to: Square }; flipped?: boolean }) {
  const point = (square: Square) => { const shown = displaySquare(square, flipped); return `${QINGXIN_COLUMNS[shown.col]} ${QINGXIN_ROWS[shown.row]}`; };
  return <svg className="board-marker-layer" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
    {lastMove && <><g transform={`translate(${point(lastMove.from)})`}><path d={markerCornerPath}/></g><g transform={`translate(${point(lastMove.to)})`}><path d={markerCornerPath}/></g></>}
    {selected && <g transform={`translate(${point(selected)})`}><path d={markerCornerPath}/></g>}
  </svg>;
}

function AnalysisArrowLayer({ moves, activeIndex, flipped = false }: { moves: string[]; activeIndex: number; flipped?: boolean }) {
  const colors = ["#2f8a57", "#347da5", "#c88725", "#8b5a9f"];
  const markerPrefix = useId().replace(/:/g, "");
  const arrows = moves.flatMap((move, index) => {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) return [];
    const parsed = iccsSquares(move);
    const from = displaySquare(parsed.from, flipped);
    const to = displaySquare(parsed.to, flipped);
    const fromX = QINGXIN_COLUMNS[from.col];
    const fromY = QINGXIN_ROWS[from.row];
    const toX = QINGXIN_COLUMNS[to.col];
    const toY = QINGXIN_ROWS[to.row];
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
    const opacity = index === activeIndex ? 1 : .58;
    return [<g key={`${move}-${index}`} className="analysis-candidate-arrow" opacity={opacity} style={{ "--analysis-arrow-color": color } as CSSProperties}>
      <line className="analysis-arrow-backdrop" x1={startX} y1={startY} x2={endX} y2={endY}/>
      <line className="analysis-arrow-outline" x1={startX} y1={startY} x2={endX} y2={endY}/>
      <line className="analysis-arrow-stem" x1={startX} y1={startY} x2={endX} y2={endY} stroke={color} markerEnd={`url(#${markerPrefix}-analysis-arrow-${index})`}/>
      <circle className="analysis-arrow-label" cx={labelX} cy={labelY} r="25"/><text x={labelX} y={labelY}>{index + 1}</text>
    </g>];
  });
  return <svg className="analysis-arrow-layer" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
    <defs>{colors.map((color, index) => <marker key={color} id={`${markerPrefix}-analysis-arrow-${index}`} markerWidth="46" markerHeight="46" refX="38" refY="23" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L46 23 L0 46 Z" fill={color} fillOpacity=".82" stroke="rgba(255,255,255,.68)" strokeWidth="4" strokeLinejoin="round"/></marker>)}</defs>
    {arrows}
  </svg>;
}

function Board({ pieces, selected, lastMove, hintMove, analysisMoves = [], activeAnalysis = 0, flipped = false, feedback, riverText, riverTextColor, riverTextSize, onSquare }: { pieces: BoardPiece[]; selected?: Square; lastMove?: string; hintMove?: string; analysisMoves?: string[]; activeAnalysis?: number; flipped?: boolean; feedback?: TrainingFeedbackKind; riverText: string; riverTextColor: string; riverTextSize: number; onSquare(square: Square): void }) {
  const hint = hintMove ? iccsSquares(hintMove).from : undefined;
  const last = lastMove ? iccsSquares(lastMove) : undefined;
  const boardStyle = { backgroundImage: `url("/skins/qingxin-zhuyun/${riverText ? "board-river-blank.png" : "board.png"}")` } as CSSProperties;
  return <div className="board-shell"><div className={`xiangqi-board ${feedback ? `move-feedback ${feedback}` : ""}`} style={boardStyle} aria-label="残局棋盘">
    {riverText && <span className="river-custom-label" style={{ "--river-text-color": riverTextColor, "--river-text-size": `${riverTextSize}px` } as CSSProperties}>{riverText}</span>}
    {analysisMoves.length > 0 && <AnalysisArrowLayer moves={analysisMoves} activeIndex={activeAnalysis} flipped={flipped}/>}
    <BoardMarkerLayer selected={selected} lastMove={last} flipped={flipped}/>
    {Array.from({ length: 90 }, (_, index) => { const square = { row: Math.floor(index / 9), col: index % 9 }; const shown = displaySquare(square, flipped); const piece = pieces.find((item) => item.row === square.row && item.col === square.col); const isSelected = selected?.row === square.row && selected.col === square.col; const isLastFrom = last?.from.row === square.row && last.from.col === square.col; const isLastTo = last?.to.row === square.row && last.to.col === square.col; const highlighted = hint?.row === square.row && hint.col === square.col; const position = { "--piece-left": `${QINGXIN_COLUMNS[shown.col] / BOARD_ART_WIDTH * 100}%`, "--piece-top": `${QINGXIN_ROWS[shown.row] / BOARD_ART_HEIGHT * 100}%` } as CSSProperties; return <button key={index} style={position} className={`board-square ${isSelected ? "selected" : ""} ${isLastFrom ? "last-from" : ""} ${isLastTo ? "last-to" : ""} ${highlighted ? "hint" : ""}`} onClick={() => onSquare(square)} aria-label={`${squareName(square)}${piece ? ` ${piece.color === "red" ? "红" : "黑"}${piece.label}` : ""}`}>{piece && <img className="piece" src={trainingPieceAsset(piece)} alt={piece.label} draggable={false}/>}</button>; })}
    {feedback === "capture" && <span className="capture-feedback"><span>吃</span></span>}
    {(feedback === "check" || feedback === "checkmate" || feedback === "stalemate") && <span className={`ink-feedback ${feedback}`}><span>{TRAINING_FEEDBACK_PACK.labels[feedback]}</span></span>}
  </div></div>;
}

function AnalysisPanel({ lines, pending, activeIndex, disabled, multiPv, scoreSide, onToggle, onSelect, onMultiPvChange }: { lines: AnalysisLine[]; pending: boolean; activeIndex: number; disabled: boolean; multiPv: number; scoreSide: "red" | "black"; onToggle(): void; onSelect(index: number): void; onMultiPvChange(value: number): void }) {
  const summary = lines[0];
  const [multiPvOpen, setMultiPvOpen] = useState(false);
  const multiPvDisabled = disabled || pending;
  const summaryRedRate = redWinRate(summary, scoreSide);
  return <section className="analysis-panel">
    <header><span><BrainCircuit/><b>AI 拆棋</b><small>固定时间 2 秒</small></span><div className="analysis-header-controls"><div className="analysis-multipv-picker"><span>候选</span><button type="button" aria-haspopup="listbox" aria-expanded={multiPvOpen} disabled={multiPvDisabled} onClick={() => setMultiPvOpen((open) => !open)}>MultiPV {multiPv}<ChevronDown/></button>{multiPvOpen && !multiPvDisabled && <div className="analysis-multipv-options" role="listbox" aria-label="AI 拆棋候选数量">{[1, 2, 3, 4].map((value) => <button key={value} type="button" role="option" aria-selected={multiPv === value} className={multiPv === value ? "active" : ""} onClick={() => { setMultiPvOpen(false); onMultiPvChange(value); }}>MultiPV {value}</button>)}</div>}</div><button disabled={disabled} onClick={onToggle}>{pending ? <><StopIcon/>停止</> : <><BrainCircuit/>{lines.length ? "重新分析" : "开始分析"}</>}</button></div></header>
    {pending ? <p className="analysis-working">Pikafish 正在分析当前局面…</p> : summary ? <>
      <div className="analysis-winrate" style={{ "--red-win-rate": `${summaryRedRate}%` } as CSSProperties}><span>红 {summaryRedRate}%</span><i aria-hidden="true"><b/></i><span>黑 {100 - summaryRedRate}%</span></div>
      <div className="analysis-summary"><span>深度 {summary.depth}</span><span>节点 {compactNumber(summary.nodes)}</span><span>{compactNumber(summary.nps)}/s</span></div>
      <div className="analysis-candidates">{lines.map((line, index) => { const rate = redWinRate(line, scoreSide); return <button key={`${line.multipv}-${line.pv[0]}`} className={activeIndex === index ? "active" : ""} onClick={() => onSelect(index)}><b>{line.multipv}</b><strong>{line.notation[0] ?? line.pv[0]}</strong><em>{analysisScore(line, scoreSide)} · 红胜 {rate}%</em><span>深度 {line.depth} · 节点 {compactNumber(line.nodes)} · NPS {compactNumber(line.nps)}</span><small>{line.notation.slice(1).join(" ") || line.pv.slice(1).join(" ")}</small></button>; })}</div>
      <div className="analysis-candidate-pager" aria-label="候选线切换">{[0, 1, 2, 3].map((index) => <button key={index} className={activeIndex === index ? "active" : ""} disabled={!lines[index]} onClick={() => onSelect(index)}>{index + 1}</button>)}</div>
    </> : <p className="analysis-empty">当前局面尚未分析</p>}
  </section>;
}

function ImportCblPanel({ onBack, onPick }: { onBack(): void; onPick(): void }) {
  return <section className="import-cbl-panel" role="dialog" aria-modal="true" aria-labelledby="import-cbl-title">
    <header><button type="button" aria-label="返回棋研" onClick={onBack}><ChevronLeft/><span>返回</span></button><div><b id="import-cbl-title">导入 CBL</b><small>选择本机或网盘中的 .CBL 残局题库</small></div></header>
    <main><FileUp/><strong>导入残局题库</strong><p>点“选择 CBL 文件”会打开 Android 文件选择器；在系统选择器里可用系统返回键取消，回到这里后也可以点左上角返回。</p><button type="button" className="primary" onClick={onPick}><FileUp/>选择 CBL 文件</button></main>
  </section>;
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
  const [analysisPending, setAnalysisPending] = useState(false);
  const [trainingActiveAnalysis, setTrainingActiveAnalysis] = useState(0);
  const [studyActiveAnalysis, setStudyActiveAnalysis] = useState(0);
  const [analysisMultiPv, setAnalysisMultiPv] = useState(() => Math.max(1, Math.min(4, Number(localStorage.getItem("xiangqi-training-analysis-multipv")) || 4)));
  const [studyMode, setStudyMode] = useState(initialStudyState.enabled);
  const [studyPanelTab, setStudyPanelTab] = useState<StudyPanelTab>(initialStudyState.tab);
  const [studyStartingFen, setStudyStartingFen] = useState(initialStudyState.startingFen);
  const [studyCurrentFen, setStudyCurrentFen] = useState(initialStudyState.startingFen);
  const [studyMoves, setStudyMoves] = useState<string[]>(initialStudyState.moves);
  const [studyBranches, setStudyBranches] = useState<StudyBranch[]>(initialStudyState.branches ?? []);
  const [studyCursor, setStudyCursor] = useState(initialStudyState.cursor);
  const [studyNotation, setStudyNotation] = useState<string[]>([]);
  const [studyPieces, setStudyPieces] = useState<BoardPiece[]>([]);
  const [studySelected, setStudySelected] = useState<Square>();
  const [studyLastMove, setStudyLastMove] = useState<string>();
  const [studyNotice, setStudyNotice] = useState(initialStudyState.moves.length ? "已恢复上次自由拆棋，可继续导航、落子或分析。" : "标准局面已就绪，可自由走棋或开始分析。");
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
  const [boardFlipped, setBoardFlipped] = useState(() => localStorage.getItem("xiangqi-training-board-flipped") === "true");
  const [studyEvaluationVisible, setStudyEvaluationVisible] = useState(() => localStorage.getItem("xiangqi-training-study-evaluation") !== "false");
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [riverText, setRiverText] = useState(() => localStorage.getItem("xiangqi-training-river-text") ?? "");
  const [riverTextColor, setRiverTextColor] = useState(() => localStorage.getItem("xiangqi-training-river-text-color") ?? "#657b48");
  const [riverTextSize, setRiverTextSize] = useState(() => Number(localStorage.getItem("xiangqi-training-river-text-size")) || 29);
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

  async function refresh() { setLibraries(await trainingStore.libraries()); }
  async function resetAnalysis(workspace: "training" | "study" = studyMode ? "study" : "training", clear = true) {
    analysisGeneration.current += 1;
    setAnalysisPending(false);
    if (clear) {
      if (workspace === "study") { setStudyAnalysisLines([]); setStudyActiveAnalysis(0); }
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
  useEffect(() => {
    const generation = ++studyGeneration.current;
    const activeMoves = initialStudyState.moves.slice(0, initialStudyState.cursor);
    void Promise.all([
      boardAt(initialStudyState.startingFen, activeMoves),
      initialStudyState.moves.length ? chineseLine(initialStudyState.startingFen, initialStudyState.moves).catch(() => initialStudyState.moves) : Promise.resolve([]),
    ]).then(([state, notation]) => {
      if (generation !== studyGeneration.current) return;
      setStudyCurrentFen(state.fen);
      setStudyPieces(state.pieces);
      setStudyNotation(notation);
      setStudyLastMove(activeMoves.at(-1));
      setStudyTerminal(terminalResult(state.status));
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
      void boardAt(STANDARD_STARTING_FEN, []).then((state) => {
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
      branches: studyBranches.slice(0, 20),
      showMoveText: studyMoveTextOpen,
      fenEditorExpanded: studyFenEditorOpen,
    };
    localStorage.setItem(STUDY_STATE_KEY, JSON.stringify(snapshot));
  }, [studyMode, studyPanelTab, studyStartingFen, studyMoves, studyCursor, studyBranches, studyMoveTextOpen, studyFenEditorOpen]);
  useEffect(() => {
    void setPreferredOrientation(preferredOrientation).catch(() => {
      setNotice("无法恢复屏幕方向设置，已使用系统自动旋转。");
    });
  }, []);
  useEffect(() => { if (!startedAt) return; const timer = window.setInterval(() => setTick((value) => value + 1), 250); return () => clearInterval(timer); }, [startedAt]);
  useEffect(() => { if (!moveFeedback) return; const duration = moveFeedback === "checkmate" || moveFeedback === "stalemate" ? 3400 : moveFeedback === "check" ? 2800 : moveFeedback === "capture" ? 520 : 320; const timer = window.setTimeout(() => setMoveFeedback(undefined), duration); return () => clearTimeout(timer); }, [moveFeedback]);
  useEffect(() => { if (!demoPlaying || !problem || answerStep >= answer.length) return; const timer = window.setTimeout(() => { const next = answerStep + 1; setAnswerStep(next); void boardAt(problem.startingFen, mainline(problem.solution).slice(0, next)).then((state) => setPieces(state.pieces)); setLastMove(mainline(problem.solution)[next - 1]); if (next >= answer.length) setDemoPlaying(false); }, 750); return () => clearTimeout(timer); }, [answer, answerStep, demoPlaying, problem]);
  useEffect(() => {
    if (!studyMode || studyCloudFen === studyCurrentFen) return;
    void refreshStudyCloud(studyCurrentFen);
  }, [studyCloudFen, studyCurrentFen, studyMode]);
  useEffect(() => {
    const selector = showAbout ? ".about-dialog" : undefined;
    if (!selector) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const frame = window.requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>(selector);
      dialog?.querySelector<HTMLElement>("textarea, input, select, button, [tabindex]:not([tabindex='-1'])")?.focus();
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
      previous?.focus();
    };
  }, [showAbout]);
  useEffect(() => () => { analysisGeneration.current += 1; void cancelPikafishSearch(); }, []);

  async function importFile(file?: File) {
    if (!file) return;
    try { const bytes = new Uint8Array(await file.arrayBuffer()); const parsed = await parseCbl(bytes); const imported = await trainingStore.importLibrary(bytes, parsed); await refresh(); await selectLibrary(imported); setImportPanelOpen(false); setNotice(parsed.warnings.length ? `导入完成，跳过 ${parsed.warnings.length} 条损坏记录。` : "题库导入完成，选择题目开始训练。"); }
    catch (error) { setImportPanelOpen(true); setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  async function renderBoard(nextMoves: string[], move?: string, expectedSession = session.current) {
    if (!problem || expectedSession !== session.current) return;
    const before = pieces;
    const state = await boardAt(problem.startingFen, nextMoves);
    if (expectedSession !== session.current) return;
    setPieces(state.pieces); setMoves(nextMoves); setLastMove(move);
    if (move) {
      const feedback = deriveTrainingFeedback(before, state, move);
      setMoveFeedback(feedback);
      playTrainingFeedback(feedback);
    }
    return state;
  }
  async function startAnalysis() {
    const standalone = studyMode;
    if (!LOCAL_PIKAFISH_AVAILABLE || (standalone && studyTerminal) || (!standalone && (!problem || autoReplyPending || revealed))) return;
    const startingFen = standalone ? studyStartingFen : problem!.startingFen;
    const currentMoves = standalone ? currentStudyMoves : moves;
    const request = ++analysisGeneration.current;
    setAnalysisPending(true);
    if (standalone) { setStudyAnalysisLines([]); setStudyActiveAnalysis(0); }
    else { setTrainingAnalysisLines([]); setTrainingActiveAnalysis(0); }
    try {
      const position = await boardAt(startingFen, currentMoves);
      const result = await queryPikafishAnalysis(position.fen, 2000, analysisMultiPv);
      const translated = await Promise.all(result.lines.filter((item) => item.pv.length > 0).map(async (item) => ({ ...item, notation: await chineseLine(position.fen, item.pv).catch(() => item.pv) })));
      if (request !== analysisGeneration.current) return;
      const sorted = translated.sort((left, right) => left.multipv - right.multipv);
      if (standalone) setStudyAnalysisLines(sorted); else setTrainingAnalysisLines(sorted);
      const message = translated.length ? "AI 拆棋完成：点击候选可突出对应箭头。" : "Pikafish 没有返回可显示的候选线。";
      if (standalone) setStudyNotice(message); else setNotice(message);
    } catch (error) {
      if (request === analysisGeneration.current) {
        const message = error instanceof Error ? error.message : "AI 拆棋失败。";
        if (standalone) setStudyNotice(message); else setNotice(message);
      }
    } finally {
      if (request === analysisGeneration.current) setAnalysisPending(false);
    }
  }
  async function stopAnalysis() { await resetAnalysis(); if (studyMode) setStudyNotice("已停止 AI 拆棋。"); else setNotice("已停止 AI 拆棋。"); }
  async function changeAnalysisMultiPv(value: number) {
    if (autoReplyPending) return;
    const next = Math.max(1, Math.min(4, value));
    localStorage.setItem("xiangqi-training-analysis-multipv", String(next));
    setAnalysisMultiPv(next);
    setTrainingAnalysisLines([]); setTrainingActiveAnalysis(0);
    setStudyAnalysisLines([]); setStudyActiveAnalysis(0);
    await resetAnalysis(studyMode ? "study" : "training", false);
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
    if (pieceAtTarget?.color === movingSide) { setSelected(to); return; }
    const iccs = `${squareName(selected)}${squareName(to)}`; setSelected(undefined);
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
    if (!match) { setMistakes((value) => value + 1); setNotice("这步不在题解分支中，局面没有改变，可以继续尝试。"); return; }
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
  async function reveal() { if (!problem || ended) return; const revealSession = session.current; const activeProblem = problem; const notation = await chineseLine(activeProblem.startingFen, mainline(activeProblem.solution)); if (revealSession !== session.current) return; await finish("revealed", elapsed, revealSession); if (revealSession !== session.current) return; const initialBoard = await boardAt(activeProblem.startingFen, []); if (revealSession !== session.current) return; setAnswer(notation); setRevealed(true); setPieces(initialBoard.pieces); setMoves([]); setLastMove(undefined); setAnswerStep(0); setDemoPlaying(false); setNotice("答案已显示，可按回合演示。"); }
  async function restart() { if (!problem) return; const restartSession = session.current; const activeProblem = problem; if (!ended && (attemptStarted || mistakes || hints)) await finish("abandoned", elapsed, restartSession); if (restartSession !== session.current) return; await selectProblem(activeProblem); }
  function pause() { if (ended) return; if (startedAt) { setElapsedSaved(elapsed); setStartedAt(undefined); setNotice("已暂停，暂停时间不会计入用时。"); } else if (elapsedSaved) { setStartedAt(Date.now()); setNotice("继续作答。"); } }
  async function confirmDelete() { const target = deleteTarget; if (!target) return; setDeleteTarget(undefined); if (target.type === "library") { await trainingStore.deleteLibrary(target.id); const next = await trainingStore.libraries(); setLibraries(next); if (next[0]) await selectLibrary(next[0]); else { session.current += 1; await resetAnalysis(); setLibrary(undefined); setProblems([]); setProblem(undefined); } } else { await trainingStore.hideProblem(target.id); if (library) await selectLibrary(library); } }
  const giveHint = async () => { if (!problem || ended) return; const next = Math.min(3, hints + 1); setHints(next); const lead = line[0]?.iccs; if (next === 1) setNotice(problem.note || "先寻找将军、吃子和强制着。"); else if (!lead) setNotice("题解已完成。"); else if (next === 2) setNotice("提示：棋盘上已标出当前应走棋子。"); else { const notation = (await chineseLine(problem.startingFen, [...moves, lead])).at(-1) ?? lead; setNotice(`首着：${notation}`); } };
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
    setStudyStartingFen(state.fen);
    setStudyMoves([]);
    setStudyBranches([]);
    setStudyCursor(0);
    setStudyNotation([]);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(undefined);
    setStudyTerminal(terminalResult(state.status));
    setStudyNotice(message);
    invalidateStudyCloud(state.fen);
  }
  async function loadStudyPosition(fen: string, message: string, generation = ++studyGeneration.current) {
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const state = await boardAt(fen, []);
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
    setStudyMode(true);
    setCatalogueOpen(false);
    setControlsOpen(false);
  }
  async function closeStudyMode() {
    studyGeneration.current += 1;
    studyCloudGeneration.current += 1;
    setStudyCloudPending(false);
    await resetAnalysis("study", false);
    setStudySelected(undefined);
    setStudyMenuOpen(false);
    resetStudyMenuPanels();
    setStudyMode(false);
    if (trainingTimerWasRunning.current && problem && !ended && !revealed) setStartedAt(Date.now());
    trainingTimerWasRunning.current = false;
    const pending = pendingAutoReply.current;
    if (pending && problem?.id === pending.problemId && !ended && !revealed) {
      const resumeSession = ++session.current;
      void continueAutoReply(pending, resumeSession);
    }
  }
  async function loadCurrentProblemIntoStudy() {
    if (!problem) { setStudyNotice("请先返回训练模式选择一道残局。"); return; }
    const generation = ++studyGeneration.current;
    const activeProblem = problem;
    const activeMoves = moves;
    await resetAnalysis();
    if (!studyMode || generation !== studyGeneration.current) return;
    const position = await boardAt(activeProblem.startingFen, activeMoves);
    if (!studyMode || generation !== studyGeneration.current) return;
    commitStudyPosition(position, `已载入题局：${activeProblem.title}`);
  }
  async function undoStudyMove() {
    if (!studyCursor) return;
    const generation = ++studyGeneration.current;
    await resetAnalysis();
    if (generation !== studyGeneration.current) return;
    const nextMoves = studyMoves.slice(0, studyCursor - 1);
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, nextMoves),
      chineseLine(studyStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    setStudyMoves(nextMoves);
    setStudyCursor(nextMoves.length);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(nextMoves.at(-1));
    setStudyTerminal(terminalResult(state.status));
    setStudyNotice("已撤销一步。");
    invalidateStudyCloud(state.fen);
  }
  function rememberStudyBranch(parentCursor: number, branchMoves: string[], branchNotation: string[]) {
    if (!branchMoves.length) return;
    setStudyBranches((items) => {
      const key = `${parentCursor}:${branchMoves.join(",")}`;
      if (items.some((item) => `${item.parentCursor}:${item.moves.join(",")}` === key)) return items;
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `branch-${Date.now()}`;
      return [{ id, parentCursor, moves: branchMoves, notation: branchNotation.length ? branchNotation : branchMoves, createdAt: Date.now() }, ...items].slice(0, 20);
    });
  }
  async function adoptStudyBranch(branch: StudyBranch) {
    const generation = ++studyGeneration.current;
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const prefix = studyMoves.slice(0, Math.max(0, Math.min(branch.parentCursor, studyMoves.length)));
    const nextMoves = [...prefix, ...branch.moves];
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, nextMoves),
      chineseLine(studyStartingFen, nextMoves).catch(() => nextMoves),
    ]);
    if (generation !== studyGeneration.current) return;
    setStudyMoves(nextMoves);
    setStudyCursor(nextMoves.length);
    setStudyNotation(notation);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(nextMoves.at(-1));
    setStudyTerminal(terminalResult(state.status));
    setStudyNotice(`已切换到分支：第 ${branch.parentCursor + 1} 手 ${branch.notation[0] ?? branch.moves[0]}。`);
    invalidateStudyCloud(state.fen);
  }
  function deleteStudyBranch(id: string) {
    setStudyBranches((items) => items.filter((item) => item.id !== id));
    setStudyNotice("已移除临时分支。");
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
    if (pieceAtTarget?.color === movingSide) { setStudySelected(to); return; }
    const iccs = `${squareName(studySelected)}${squareName(to)}`;
    await playStudyMove(iccs);
  }
  async function playStudyMove(iccs: string) {
    if (studyTerminal) return;
    if (studyCursor < studyMoves.length && studyMoves[studyCursor] === iccs) {
      await navigateStudyMove(studyCursor + 1);
      return;
    }
    const movingSide = sideToMove(studyStartingFen, currentStudyMoves);
    setStudySelected(undefined);
    const generation = ++studyGeneration.current;
    await resetAnalysis();
    if (generation !== studyGeneration.current) return;
    if (!(await acceptsMove(studyStartingFen, currentStudyMoves, iccs))) {
      if (generation === studyGeneration.current) setStudyNotice("该走法不合法，局面没有改变。");
      return;
    }
    if (generation !== studyGeneration.current) return;
    const nextMoves = [...currentStudyMoves, iccs];
    if (studyCursor < studyMoves.length) rememberStudyBranch(studyCursor, studyMoves.slice(studyCursor), studyNotation.slice(studyCursor));
    const [state, notation] = await Promise.all([
      boardAt(studyStartingFen, nextMoves),
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
    const terminal = terminalResult(state.status);
    setStudyTerminal(terminal);
    setStudyNotice(terminal ? `当前局面：${terminal}。` : `${movingSide === "red" ? "红" : "黑"}方已走 ${notation.at(-1) ?? iccs}。`);
    invalidateStudyCloud(state.fen);
  }

  async function navigateStudyMove(cursor: number) {
    const nextCursor = Math.max(0, Math.min(studyMoves.length, cursor));
    if (nextCursor === studyCursor) return;
    const generation = ++studyGeneration.current;
    await resetAnalysis("study");
    if (generation !== studyGeneration.current) return;
    const nextMoves = studyMoves.slice(0, nextCursor);
    const state = await boardAt(studyStartingFen, nextMoves);
    if (generation !== studyGeneration.current) return;
    setStudyCursor(nextCursor);
    setStudyPieces(state.pieces);
    setStudySelected(undefined);
    setStudyLastMove(nextMoves.at(-1));
    setStudyTerminal(terminalResult(state.status));
    setStudyNotice(nextCursor ? `已定位到第 ${nextCursor} 手：${studyNotation[nextCursor - 1] ?? nextMoves.at(-1)}。` : "已回到起始局面。");
    invalidateStudyCloud(state.fen);
  }

  function toggleBoardFlipped() {
    const next = !boardFlipped;
    localStorage.setItem("xiangqi-training-board-flipped", String(next));
    setBoardFlipped(next);
    setStudySelected(undefined);
    setStudyNotice(next ? "棋盘已翻转为黑方视角。" : "棋盘已恢复红方视角。");
  }

  function toggleStudyEvaluation() {
    const next = !studyEvaluationVisible;
    localStorage.setItem("xiangqi-training-study-evaluation", String(next));
    setStudyEvaluationVisible(next);
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

  function runStudyMenuAction(action: "problem" | "standard" | "undo" | "copyFen" | "copyManual" | "toggleMoves" | "edit" | "flip" | "candidate" | "engine" | "cloud" | "import" | "settings") {
    if (action !== "edit" && action !== "toggleMoves") setStudyMenuOpen(false);
    if (action === "problem") void loadCurrentProblemIntoStudy();
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
  const studyPanelItems = ([["engine", "引擎", BrainCircuit], ["cloud", "云库", Database]] as const);
  const studyArrowMoves = studyPanelTab === "cloud" ? studyCloudMoves.slice(0, 4).map((item) => item.iccs) : studyAnalysisLines.map((item) => item.pv[0]);

  return <div className="training-app"><header className={`app-header ${studyMode ? "study-mode-header" : ""}`}><span><BookOpen/><strong>棋研</strong><small>{studyMode ? "自由拆棋" : library?.title ?? "本地 CBL 题库"}</small></span><div><nav className="workspace-switcher" aria-label="训练与拆棋切换"><button className={!studyMode ? "active" : ""} aria-current={!studyMode ? "page" : undefined} aria-label="题库" data-tooltip="题库" onClick={() => { if (studyMode) void closeStudyMode(); else { setCatalogueOpen((open) => !open); setControlsOpen(false); } }}><BookOpen/><span>题库</span></button><button className={studyMode ? "active" : ""} aria-current={studyMode ? "page" : undefined} aria-label="拆棋" data-tooltip="拆棋" onClick={() => { if (!studyMode) void openStudyMode(); }}><BrainCircuit/><span>拆棋</span></button></nav><button className="mobile-drawer-toggle catalogue-toggle" aria-label={catalogueOpen ? "收起题库目录" : "打开题库目录"} data-tooltip={catalogueOpen ? "收起题库目录" : "题库目录"} aria-expanded={catalogueOpen} onClick={() => { setCatalogueOpen((open) => !open); setControlsOpen(false); }}><BookOpen/><span>目录</span></button><button className="import-cbl-action" aria-label="导入 CBL" data-tooltip="导入 CBL" onClick={openImportPanel}><FileUp/><span>导入 CBL</span></button><button className="mobile-drawer-toggle controls-toggle" aria-label={controlsOpen ? "收起训练控制" : "打开训练控制"} data-tooltip={controlsOpen ? "收起训练控制" : "训练控制"} aria-expanded={controlsOpen} onClick={() => { setControlsOpen((open) => !open); setCatalogueOpen(false); }}><Clock3/><span>控制</span></button><button className="about-trigger" aria-label="关于棋研" data-tooltip="关于棋研" onClick={() => setShowAbout(true)}><CircleHelp/></button></div><input ref={input} type="file" accept=".cbl,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void importFile(file); }}/></header><div className="training-layout">
    <aside className={`catalogue ${catalogueOpen ? "drawer-open" : ""}`}><header className="catalogue-heading"><span><strong>题库目录</strong><small>{libraries.length} 本本地题库</small></span>{library && <button className="catalogue-delete" title="删除当前题库" onClick={() => setDeleteTarget({ type: "library", id: library.id, title: library.title })}><Trash2/></button>}</header><div className="library-list">{libraries.map((item) => <section key={item.id}><button className={`library-row ${expanded === item.id ? "expanded" : ""}`} onClick={() => expanded === item.id ? setExpanded(undefined) : void selectLibrary(item)}><BookOpen/><span><b>{item.title}</b><small>{item.completedCount}/{item.problemCount} 已完成</small></span>{expanded === item.id ? <ChevronDown/> : <ChevronRight/>}</button>{expanded === item.id && <div className="problem-area"><div className="filters"><div className="problem-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索残局题名或分类" aria-label="搜索残局题名或分类" autoComplete="off"/>{query && <button type="button" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery("")}><X/></button>}</div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="按残局分类筛选">{categories.map((value) => <option key={value}>{value}</option>)}</select></div>{visible.length ? visible.map((item) => <button key={item.id} className={`problem-row ${problem?.id === item.id ? "active" : ""}`} onClick={() => void selectProblem(item)}><b>{item.sourceIndex + 1}</b><span>{item.title}<small>{item.category} · {item.completedAttempts ? `累计 ${fmt(item.totalElapsedMs)}` : "未练"}</small></span></button>) : <p className="problem-empty">没有找到匹配的残局</p>}</div>}</section>)}</div></aside>
    <main className="training-stage">{problem ? <><header className="problem-heading"><small>第 {problem.sourceIndex + 1}/{problems.length} 题</small><strong>{problem.title}</strong><button title="移除当前残局" onClick={() => setDeleteTarget({ type: "problem", id: problem.id, title: problem.title })}><Trash2/></button></header><Board pieces={pieces} selected={selected} lastMove={lastMove} hintMove={hints >= 2 ? line[0]?.iccs : undefined} analysisMoves={trainingAnalysisLines.map((item) => item.pv[0])} activeAnalysis={trainingActiveAnalysis} flipped={boardFlipped} feedback={moveFeedback} riverText={riverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} onSquare={(square) => void move(square)}/><p className="board-tip">{mode === "cloud" ? "云库优先应手；未收录时由本地 Pikafish 接手。" : mode === "ai" ? "本地 Pikafish 离线应手，不访问云库。" : "选棋子，再点目标点。错误走法不会改变局面。"}</p></> : <div className="empty"><BookOpen/><strong>导入并选择一道残局</strong><span>题库和练习记录仅保存在这台手机或平板。</span></div>}</main>
    <aside className={`controls ${controlsOpen ? "drawer-open" : ""}`}>{problem ? <><section className="clock"><Clock3/><small>本题用时</small><strong>{fmt(elapsed)}</strong><span>累计用时 {fmt(problem.totalElapsedMs)}</span><button onClick={() => { setShowHistory((value) => !value); void trainingStore.attempts(problem.id).then(setAttempts); }}>记录</button></section><section className="modes">{(["cloud", ...(LOCAL_PIKAFISH_AVAILABLE ? ["ai" as const] : []), "solver", "replay", "free"] as Mode[]).map((value) => <label key={value}><input type="radio" checked={mode === value} disabled={attemptStarted || ended} onChange={() => changeMode(value)}/>{modeLabel[value]}{value === "cloud" && (LOCAL_PIKAFISH_AVAILABLE ? "（云库优先）" : "（云库应手）")}{value === "ai" && "（纯离线）"}{value === "replay" && "（按题解）"}</label>)}</section>{LOCAL_PIKAFISH_AVAILABLE && <AnalysisPanel lines={trainingAnalysisLines} pending={analysisPending && !studyMode} activeIndex={trainingActiveAnalysis} disabled={autoReplyPending || revealed || ended} multiPv={analysisMultiPv} scoreSide={sideToMove(problem.startingFen, moves)} onToggle={() => void (analysisPending ? stopAnalysis() : startAnalysis())} onSelect={setTrainingActiveAnalysis} onMultiPvChange={(value) => void changeAnalysisMultiPv(value)}/>}<section className="actions"><button className="primary" disabled={ended} onClick={() => void giveHint()}><Lightbulb/>提示 {hints}/3</button><button disabled={ended || (!startedAt && !elapsedSaved)} onClick={pause}>{startedAt ? <Pause/> : <Play/>}{startedAt ? "暂停" : "继续"}</button><button onClick={() => void restart()}><RotateCcw/>重来</button>{mode === "free" || mode === "cloud" || mode === "ai" ? <button disabled={ended} onClick={() => void finish("free_finished")}>{mode === "free" ? "结束实战" : "结束对练"}</button> : <button disabled={ended} onClick={() => void reveal()}><ListRestart/>看答案</button>}</section><section className="notice"><b>错误 {mistakes} 次</b><p>{renderNote(notice)}</p></section>{showHistory ? <section className="history"><b>答题记录</b>{attempts.length ? attempts.slice(0, 30).map((item) => <p key={item.id}><strong>{item.outcome === "completed" ? "解出" : item.outcome === "revealed" ? "看答案" : item.outcome === "free_finished" ? "实战结束" : "已放弃"}</strong><span>{modeLabel[item.mode]} · {fmt(item.elapsedMs)} · 错 {item.mistakes} · 提示 {item.hintsUsed}</span></p>) : <p>还没有答题记录</p>}</section> : revealed && <section className="answer"><header><b>题解回合</b><small>{answerStep}/{answer.length} 手</small></header>{Array.from({ length: Math.ceil(answer.length / 2) }, (_, index) => <p key={index}><b>第 {index + 1} 回合</b><span>红方 {answer[index * 2]}{answer[index * 2 + 1] ? ` · 黑方 ${answer[index * 2 + 1]}` : ""}</span></p>)}<footer><button disabled={answerStep >= answer.length} onClick={() => setDemoPlaying((value) => !value)}>{demoPlaying ? <Pause/> : <Play/>}{demoPlaying ? "暂停演示" : "演示答案"}</button><button onClick={() => { setAnswerStep(0); setDemoPlaying(false); void boardAt(problem.startingFen, []).then((state) => setPieces(state.pieces)); }}><RotateCcw/>从头</button></footer></section>}<footer className="navigate"><button disabled={currentIndex <= 0} onClick={() => void selectProblem(visible[currentIndex - 1])}><ChevronLeft/></button><button disabled={currentIndex >= visible.length - 1} onClick={() => void selectProblem(visible[currentIndex + 1])}><ChevronRight/></button></footer></> : <p>从目录选择题目。</p>}</aside>
  </div>{studyMode && <div className="study-workspace">
    <main className="study-stage"><header className="study-toolbar"><nav className="study-command-bar" aria-label="拆棋工具栏">
      <button className={studyMenuOpen ? "active" : ""} aria-label="更多功能" title="更多功能" aria-expanded={studyMenuOpen} onClick={() => setStudyMenuOpen((open) => !open)}><Ellipsis/><span>更多</span></button>
      <button aria-label="新建标准棋局" title="新建标准棋局" onClick={() => runStudyMenuAction("standard")}><Plus/><span>新局</span></button>
      <button aria-label="导入 CBL 题库" title="导入 CBL 题库" onClick={() => runStudyMenuAction("import")}><FileUp/><span>导入</span></button>
      <button aria-label="复制当前局面" title="复制当前局面" onClick={() => runStudyMenuAction("copyFen")}><ClipboardCopy/><span>复制</span></button>
      <button aria-label="编辑 FEN 局面" title="编辑 FEN 局面" onClick={() => runStudyMenuAction("edit")}><Pencil/><span>编辑</span></button>
      <button className={boardFlipped ? "active" : ""} aria-label="翻转棋盘" title="翻转棋盘" onClick={() => runStudyMenuAction("flip")}><FlipVertical2/><span>翻转</span></button>
      <button className={analysisPending ? "active" : ""} disabled={Boolean(studyTerminal)} aria-label={analysisPending ? "停止引擎分析" : "分析当前局面"} title={analysisPending ? "停止引擎分析" : "分析当前局面"} onClick={() => void (analysisPending ? stopAnalysis() : startAnalysis())}>{analysisPending ? <StopIcon/> : <Activity/>}<span>{analysisPending ? "停止" : "分析"}</span></button>
      <button className={studyPanelTab === "engine" ? "active" : ""} aria-label="打开引擎面板" title="打开引擎面板" onClick={() => setStudyPanelTab("engine")}><BrainCircuit/><span>引擎</span></button>
      {studyMenuOpen && <section className="study-menu" aria-label="拆棋功能菜单">
        <header><strong>拆棋功能</strong><small>临时拆棋，不写题解树</small></header>
        <div className="study-menu-group"><button onClick={() => runStudyMenuAction("standard")}><Plus/><span>新局</span></button><button onClick={() => runStudyMenuAction("import")}><FileUp/><span>打开题库</span></button><button className={studyMoveTextOpen ? "active" : ""} onClick={() => runStudyMenuAction("toggleMoves")}><ListRestart/><span>{studyBranches.length ? `棋谱/分支(${studyBranches.length})` : "棋谱/分支"}</span></button></div>
        <div className="study-menu-group"><button aria-label="复制当前局面" onClick={() => runStudyMenuAction("copyFen")}><ClipboardCopy/><span>复制局面</span></button><button aria-label="编辑 FEN 局面" onClick={() => runStudyMenuAction("edit")}><FilePenLine/><span>编辑局面</span></button><button className={boardFlipped ? "active" : ""} onClick={() => runStudyMenuAction("flip")}><FlipVertical2/><span>翻转棋盘</span></button></div>
        <div className="study-menu-group"><button disabled={!problem} onClick={() => runStudyMenuAction("problem")}><BookOpen/><span>当前题局</span></button><button disabled={!studyCursor} onClick={() => runStudyMenuAction("undo")}><Undo2/><span>撤销一步</span></button><button disabled={!studyAnalysisLines.length && !studyCloudMoves.length} onClick={() => runStudyMenuAction("candidate")}><Zap/><span>采用候选</span></button></div>
        <div className="study-menu-group study-menu-secondary"><button onClick={() => runStudyMenuAction("engine")}><BrainCircuit/><span>引擎分析</span></button><button onClick={() => runStudyMenuAction("cloud")}><Database/><span>云库面板</span></button><button onClick={() => runStudyMenuAction("copyManual")}><ClipboardCopy/><span>复制棋谱</span></button></div>
        {studyFenEditorOpen && <section className="study-fen-inline" aria-label="编辑拆棋局面"><header><strong>编辑 FEN</strong><button type="button" onClick={() => setStudyFenEditorOpen(false)}>收起</button></header><textarea value={studyFenDraft} rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { setStudyFenDraft(event.target.value); setStudyFenError(undefined); }}/>{studyFenError && <p className="study-fen-error">{studyFenError}</p>}<footer><button type="button" onClick={() => setStudyFenEditorOpen(false)}>取消</button><button type="button" className="primary" onClick={() => void applyStudyFen()}>载入局面</button></footer></section>}
        {studyMoveTextOpen && <section className="study-moves study-moves-inline" aria-label="棋谱与临时分支"><header><b>棋谱与分支</b><button type="button" onClick={() => void copyStudyText(studyManualText(), "文字棋谱")}><ClipboardCopy/>复制</button></header>{studyMoves.length ? <div className="study-move-text"><button className={`start ${studyCursor === 0 ? "active" : ""}`} onClick={() => void navigateStudyMove(0)}><b>起始局面</b><small>FEN</small></button>{Array.from({ length: Math.ceil(studyMoves.length / 2) }, (_, index) => { const redIndex = index * 2; const blackIndex = redIndex + 1; return <div key={index} className="study-move-round"><span>{index + 1}</span><button className={studyCursor === redIndex + 1 ? "active" : ""} disabled={!studyMoves[redIndex]} onClick={() => void navigateStudyMove(redIndex + 1)}><b>{studyNotation[redIndex] ?? studyMoves[redIndex]}</b><small>{studyMoves[redIndex]}</small></button><button className={studyCursor === blackIndex + 1 ? "active" : ""} disabled={!studyMoves[blackIndex]} onClick={() => void navigateStudyMove(blackIndex + 1)}><b>{studyNotation[blackIndex] ?? studyMoves[blackIndex]}</b><small>{studyMoves[blackIndex]}</small></button></div>; })}</div> : <p>还没有主线走法。</p>}{studyBranches.length > 0 && <div className="study-branches" aria-label="临时分支"><header><b>临时分支</b><span>{studyBranches.length} 条</span></header>{studyBranches.map((branch, index) => <div key={branch.id} className="study-branch-row"><b>{index + 1}</b><span><strong>第 {branch.parentCursor} 手后</strong><small>{branch.notation.slice(0, 4).join(" ") || branch.moves.slice(0, 4).join(" ")}</small></span><div><button type="button" onClick={() => void adoptStudyBranch(branch)}>采用</button><button type="button" aria-label="删除临时分支" onClick={() => deleteStudyBranch(branch.id)}><Trash2/></button></div></div>)}</div>}</section>}
        <label className="study-menu-check"><input type="checkbox" checked={studyEvaluationVisible} onChange={toggleStudyEvaluation}/><span>箭头提示 / 当前评估</span></label>
        <button className="study-menu-settings" onClick={() => runStudyMenuAction("settings")}><Settings2/><span>更多设置</span></button>
      </section>}
    </nav></header><section className="study-engine-strip"><div><span>深度 {studySummaryLine?.depth ?? 0}</span><span>节点 {studySummaryLine ? compactNumber(studySummaryLine.nodes) : 0}</span><span>速度 {studySummaryLine ? `${compactNumber(studySummaryLine.nps)}/s` : "0/s"}</span></div>{studyEvaluationVisible && <button className="study-evaluation-toggle" type="button" aria-label="隐藏当前评估" onClick={toggleStudyEvaluation}>当前评估 {studyEvaluationLabel}</button>}</section><Board pieces={studyPieces} selected={studySelected} lastMove={studyLastMove} analysisMoves={studyArrowMoves} activeAnalysis={studyPanelTab === "engine" ? studyActiveAnalysis : 0} flipped={boardFlipped} feedback={moveFeedback} riverText={riverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize} onSquare={(square) => void moveStudy(square)}/><footer className="study-board-status"><b>{studyScoreSide === "red" ? "红方" : "黑方"}行棋</b><span>{studyMoves.length ? `第 ${studyCursor}/${studyMoves.length} 手` : "初始局面"}</span><span>{boardFlipped ? "黑方视角" : "红方视角"}</span></footer></main>
    <aside className="study-sidebar">
      <nav className="study-move-nav" aria-label="拆棋着法导航"><button disabled={!studyCursor} aria-label="回到开始" title="回到开始" onClick={() => void navigateStudyMove(0)}><ChevronsLeft/></button><button disabled={!studyCursor} aria-label="上一步" title="上一步" onClick={() => void navigateStudyMove(studyCursor - 1)}><ChevronLeft/></button><button disabled aria-label="播放棋谱" title="播放棋谱"><Play/></button><button disabled={studyCursor >= studyMoves.length} aria-label="下一步" title="下一步" onClick={() => void navigateStudyMove(studyCursor + 1)}><ChevronRight/></button><button disabled={studyCursor >= studyMoves.length} aria-label="最后一步" title="最后一步" onClick={() => void navigateStudyMove(studyMoves.length)}><ChevronsRight/></button></nav>
      <nav className="study-panel-tabs" role="tablist" aria-label="拆棋研究面板">{studyPanelItems.map(([value, label, Icon]) => <button key={value} role="tab" aria-selected={studyPanelTab === value} className={studyPanelTab === value ? "active" : ""} onClick={() => setStudyPanelTab(value)}><Icon/><span>{label}</span></button>)}</nav>
      {studyPanelTab === "engine" && (LOCAL_PIKAFISH_AVAILABLE ? <AnalysisPanel lines={studyAnalysisLines} pending={analysisPending && studyMode} activeIndex={studyActiveAnalysis} disabled={Boolean(studyTerminal)} multiPv={analysisMultiPv} scoreSide={studyScoreSide} onToggle={() => void (analysisPending ? stopAnalysis() : startAnalysis())} onSelect={setStudyActiveAnalysis} onMultiPvChange={(value) => void changeAnalysisMultiPv(value)}/> : <section className="study-unavailable">本地 Pikafish 仅在 Android 或 iOS 版可用。</section>)}
      {studyPanelTab === "cloud" && <section className="study-cloud-panel"><header><span><Database/><b>ChessDB 云库</b></span><button disabled={studyCloudPending} onClick={() => void refreshStudyCloud()}>{studyCloudPending ? "查询中" : "刷新"}</button></header>{studyCloudPending ? <p className="study-cloud-empty">正在查询当前局面…</p> : studyCloudMoves.length ? <div className="study-cloud-list">{studyCloudMoves.map((item, index) => <button key={item.iccs} onClick={() => void playStudyMove(item.iccs)}><b>{index + 1}</b><strong>{item.notation}</strong><em>权重 {item.score}</em></button>)}</div> : <p className="study-cloud-empty">{studyCloudError ?? "当前局面暂无云库着法。"}</p>}</section>}
      <section className="study-notice"><b>局面状态</b><p>{studyNotice}</p></section>
    </aside>
    {studyMenuOpen && <button className="study-menu-scrim" aria-label="关闭拆棋菜单" onClick={() => setStudyMenuOpen(false)}/>}
  </div>}{importPanelOpen && <ImportCblPanel onBack={() => setImportPanelOpen(false)} onPick={() => input.current?.click()}/>} {(catalogueOpen || controlsOpen) && <button className="drawer-backdrop" aria-label="关闭抽屉" onClick={() => { setCatalogueOpen(false); setControlsOpen(false); }}/>} {deleteTarget && <div className="confirm-backdrop" onMouseDown={() => setDeleteTarget(undefined)}><section onMouseDown={(event) => event.stopPropagation()}><strong>确认删除</strong><p>{deleteTarget.type === "library" ? `删除题库《${deleteTarget.title}》及该应用内的答题记录？` : `从训练目录移除《${deleteTarget.title}》？答题记录会保留。`}</p><footer><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></footer></section></div>}{showAbout && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={() => setShowAbout(false)}><section className="about-dialog" onMouseDown={(event) => event.stopPropagation()}><BookOpen/><b id="about-title">棋研</b><p>本地 CBL 残局训练</p><dl><div><dt>版本</dt><dd>{APP_VERSION}</dd></div><div><dt>构建时间</dt><dd>{APP_BUILD_TIME}</dd></div>{LOCAL_PIKAFISH_AVAILABLE && <div><dt>本地 AI</dt><dd>Pikafish 2026-09-06</dd></div>}<div><dt>联系方式</dt><dd>QQ 158608262</dd></div></dl><label className="river-text-editor"><span>河界文案</span><input value={riverText} maxLength={16} placeholder="默认：楚河汉界" onChange={(event) => changeRiverText(event.target.value)}/><small>留空保留皮肤原有的楚河、汉界位置</small></label><label className="river-color-editor"><span>字体颜色</span><input type="color" value={riverTextColor} aria-label="河界字体颜色" onChange={(event) => changeRiverTextColor(event.target.value)}/></label><label className="river-size-editor"><span>字体大小 {riverTextSize}px</span><input type="range" min="16" max="42" value={riverTextSize} aria-label="河界字体大小" onChange={(event) => changeRiverTextSize(Number(event.target.value))}/></label><fieldset className="orientation-picker"><legend>屏幕方向</legend>{(["auto", "landscape", "portrait"] as PreferredOrientation[]).map((value) => <button key={value} className={preferredOrientation === value ? "active" : ""} onClick={() => changeOrientation(value)}>{value === "auto" ? "自动" : value === "landscape" ? "锁横屏" : "锁竖屏"}</button>)}</fieldset><footer><button onClick={() => setShowAbout(false)}>关闭</button></footer></section></div>}</div>;
}

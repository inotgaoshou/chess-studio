import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  FolderOpen,
  GitBranch,
  Link,
  LayoutGrid,
  ListStart,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  TrendingUp,
  Trash2,
  Zap,
} from "lucide-react";
import { chessPlatform, type AnalysisLine, type BoardState, type GameSummary, type MoveItem, type Piece } from "./platform";
import { positionEvaluation, trendPoints } from "./analysisView";


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
const analysisArrowColors = ["#53b848", "#c5438c", "#d0b52d"];

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

export default function App() {
  const [board, setBoard] = useState<BoardState>(fallback);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [reversed, setReversed] = useState(false);
  const [fenInput, setFenInput] = useState(startingFen);
  const [enginePath, setEnginePath] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisLine[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [searchMode, setSearchMode] = useState<"time" | "depth" | "infinite">("time");
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
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const boardRevision = useRef(0);
  const analysisLoadRevision = useRef(0);
  const boardRef = useRef<BoardState>(fallback);
  const analysisBusyRef = useRef(false);
  const pendingAutoAnalysis = useRef(false);

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
    try {
      localStorage.setItem("xiangqi:auto-analysis", String(autoAnalyze));
    } catch {
      // Preference persistence is optional in restricted browser contexts.
    }
  }, [autoAnalyze]);

  useEffect(() => {
    if (!autoAnalyze) return;
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
  }, [autoAnalyze, autoRetry, board.currentNode, board.fen, enginePath, online, serverUrl, token]);

  const pieceMap = useMemo(() => new Map(board.pieces.map((piece) => [`${piece.row}-${piece.col}`, piece])), [board.pieces]);
  const cells = useMemo(() => Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), []);
  const lastMove = board.history.at(-1);
  const evaluation = useMemo(() => positionEvaluation(board, analysis), [analysis, board]);
  const evaluationTrend = useMemo(() => trendPoints(evaluation?.samples ?? []), [evaluation]);
  const orderedAnalysis = useMemo(() => analysis.slice().sort((left, right) => left.multipv - right.multipv), [analysis]);
  const primaryAnalysis = orderedAnalysis[0];
  const primaryMove = primaryAnalysis?.notation?.[0] ?? primaryAnalysis?.pv[0];
  const searchLimitLabel = searchMode === "infinite"
    ? "持续分析"
    : searchMode === "depth"
      ? `固定深度 ${searchValue}`
      : `固定时间 ${(searchValue / 1000).toFixed(1)}s`;
  const analysisArrows = useMemo(() => orderedAnalysis
    .filter((line) => line.multipv <= 3 && line.pv.length > 0)
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
      const next = normalizeBoardState(await chessPlatform.playMove(iccs));
      applyBoard(next);
      setAnalysis([]);
      setNotice(`已记录 ${next.history.at(-1)?.notation ?? iccs}`);
    } catch (error) {
      setNotice(friendlyError(error));
    }
    setSelected(null);
  }

  async function createGame(fen = fenInput) {
    try {
      applyBoard(await chessPlatform.newGame(fen));
      await refreshGames();
      setSelected(null);
      setAnalysis([]);
      setNotice("已创建新棋谱");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function runAnalysis(automatic = false) {
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
      });
      if (boardRevision.current !== analyzedRevision) {
        setNotice("原局面分析已结束；当前棋盘已变化，未覆盖当前候选线");
        return;
      }
      setAnalysis(result);
      if (chessPlatform.kind === "desktop") applyBoard(await chessPlatform.initialize());
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
    try {
      const next = await chessPlatform.openGame(gameId);
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

  async function navigateTo(nodeId?: string) {
    try {
      const next = await chessPlatform.navigateTo(nodeId);
      applyBoard(next);
      setSelected(null);
      await loadSavedAnalysis(next.fen ?? board.fen);
      setNotice(nodeId ? "已切换棋谱节点" : "已回到根局面");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function saveComment() {
    if (!board.currentNode) return;
    try {
      applyBoard(await chessPlatform.updateComment(board.currentNode, comment));
      setNotice("注释已保存");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function makeMainline(nodeId: string) {
    try {
      applyBoard(await chessPlatform.setMainline(nodeId));
      setNotice("已设为主线");
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }

  async function removeNode(nodeId: string) {
    try {
      applyBoard(await chessPlatform.deleteNode(nodeId));
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
        <div className="menu-items"><span>文件</span><span>局面</span><span>棋谱</span><span>开局库</span><span>引擎</span><span>同步</span><span>设置</span><span>帮助</span></div>
        <div className="engine-chip"><Activity size={13}/><strong>Pikafish</strong><span>{chessPlatform.kind === "web" ? online ? "云端" : "离线" : enginePath ? "已就绪" : "未检测"}</span></div>
      </nav>

      <div className="actionbar">
        <button className="wide-tool" onClick={() => void createGame(startingFen)}><FolderOpen size={14}/>新建研习棋谱</button>
        <div className="tool-group">
          <button className="tool-button" title="新建棋谱" onClick={() => void createGame(startingFen)}><Plus size={17}/></button>
          <button className="tool-button" title="保存当前注释" disabled={!board.currentNode} onClick={() => void saveComment()}><Save size={16}/></button>
          <button className="tool-button" title="翻转棋盘" onClick={() => setReversed((value) => !value)}><RotateCcw size={16}/></button>
          <button className="tool-button" title="返回根局面" onClick={() => void navigateTo()}><RefreshCw size={16}/></button>
        </div>
        <div className="tool-divider" />
        <button className="mode-tool" onClick={() => void runAnalysis()} disabled={analysisBusy}><Zap size={15}/>分析当前局面</button>
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
            <label>棋谱名<input value="新建研习棋谱" readOnly /></label>
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
                    onClick={() => void selectSquare(row, col)}
                    aria-label={`${squareToIccs(row, col)}${piece ? ` ${piece.color === "red" ? "红" : "黑"}${piece.label}` : ""}`}
                  >
                    {piece && <img src={pieceAsset(piece)} alt="" draggable={false} />}
                    {isSelected && <img className="selection-mask" src="/skins/tchess/mask2.png" alt="" />}
                  </button>
                );
              })}
              {analysisArrows.length > 0 && (
                <svg className="analysis-arrows" viewBox="0 0 1120 1240" aria-hidden="true">
                  <defs>
                    {analysisArrows.map((arrow) => (
                      <marker key={arrow.rank} id={`analysis-arrowhead-${arrow.rank}`} markerWidth="48" markerHeight="48" refX="40" refY="24" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 48 24 L 0 48 z" fill={arrow.color}/>
                      </marker>
                    ))}
                  </defs>
                  {analysisArrows.map((arrow) => {
                    const labelX = arrow.from.x + (arrow.to.x - arrow.from.x) * .55;
                    const labelY = arrow.from.y + (arrow.to.y - arrow.from.y) * .55;
                    return (
                      <g key={arrow.rank} style={{ "--arrow-color": arrow.color } as CSSProperties}>
                        <line x1={arrow.from.x} y1={arrow.from.y} x2={arrow.to.x} y2={arrow.to.y} markerEnd={`url(#analysis-arrowhead-${arrow.rank})`}/>
                        <circle cx={labelX} cy={labelY} r="23"/>
                        <text x={labelX} y={labelY}>{arrow.rank}</text>
                      </g>
                    );
                  })}
                </svg>
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
                {chessPlatform.kind === "desktop" && <button className={searchMode === "infinite" ? "active" : ""} onClick={() => setSearchMode("infinite")}>持续</button>}
                <input type="number" aria-label="搜索限制" disabled={searchMode === "infinite"} min={searchMode === "depth" ? 1 : 100} max={searchMode === "depth" ? 100 : 30000} value={searchValue} onChange={(event) => setSearchValue(Number(event.target.value))}/>
              </div>
              {analysisBusy
                ? <button className="analysis-action stop" onClick={() => void stopAnalysis()} title="停止分析"><Square size={13}/><span>停止</span></button>
                : <button className="analysis-action" onClick={() => void runAnalysis()} title="分析当前局面"><Play size={14}/><span>分析</span></button>}
            </div>
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
            <div className="section-title"><strong>棋谱</strong><span>{board.history.length} 着</span></div>
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
                    <span role="cell"><i className={move.movedBy === "红方" ? "red" : "black"}/><strong>{move.notation}</strong>{move.isMainline && <small>主线</small>}</span>
                    <span role="cell" className={move.mate != null ? "mate-score" : ""}>{formatMoveScore(move)}</span>
                  </button>
              ))}
              </div>
            </div>
            {board.currentNode && (
              <div className="node-editor">
                <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="当前着法注释" />
                <button className="tool-button" title="保存注释" onClick={() => void saveComment()}><Save size={14}/></button>
                <button className="tool-button" title="设为主线" onClick={() => void makeMainline(board.currentNode!)}><ListStart size={14}/></button>
                <button className="tool-button danger" title="删除节点" onClick={() => void removeNode(board.currentNode!)}><Trash2 size={14}/></button>
              </div>
            )}
            <div className="branch-list">
              <div className="branch-heading"><strong>变招列表</strong><span>{board.branches.length}</span></div>
              {board.branches.length === 0
                ? <p className="empty-branch">在当前局面落子以建立分支</p>
                : board.branches.map((move) => (
                  <div className="branch-row" key={move.id}>
                    <button title={`${move.movedBy} · ICCS ${move.iccs}`} onClick={() => void navigateTo(move.id)}><GitBranch size={12}/><span>{move.notation}</span><small>{formatMoveScore(move)}</small></button>
                    <button className="tool-button" title="设为主线" onClick={() => void makeMainline(move.id)}><ListStart size={13}/></button>
                    <button className="tool-button danger" title="删除分支" onClick={() => void removeNode(move.id)}><Trash2 size={13}/></button>
                  </div>
                ))}
            </div>
          </section>
        </aside>
      </main>
      <nav className="mobile-nav" aria-label="移动端导航">
        <button className={mobilePanel === "board" ? "active" : ""} onClick={() => setMobilePanel("board")}><LayoutGrid size={19}/><span>棋盘</span></button>
        <button className={mobilePanel === "library" ? "active" : ""} onClick={() => setMobilePanel("library")}><BookOpen size={19}/><span>棋谱</span></button>
        <button className={mobilePanel === "analysis" ? "active" : ""} onClick={() => setMobilePanel("analysis")}><Activity size={19}/><span>分析</span></button>
        <button className={mobilePanel === "settings" ? "active" : ""} onClick={() => setMobilePanel("settings")}><Settings2 size={19}/><span>设置</span></button>
      </nav>
    </div>
  );
}

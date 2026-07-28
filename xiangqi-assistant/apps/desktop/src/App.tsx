import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, BookOpen, ChevronRight, Database, FolderOpen, Play, Plus, RefreshCw, RotateCcw, Settings2 } from "lucide-react";

type Piece = { row: number; col: number; color: "red" | "black"; kind: string; label: string };
type MoveItem = { id: string; iccs: string; comment: string; isMainline: boolean };
type BoardState = { fen: string; sideToMove: string; status: string; pieces: Piece[]; history: MoveItem[] };
type AnalysisLine = { depth?: number; scoreCp?: number; mate?: number; nps?: number; timeMs?: number; multipv: number; pv: string[] };
type SyncResult = { uploaded: number; downloaded: number; cursor: number };

const startingFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const initialPieces: Piece[] = [
  ..."车马象士将士象马车".split("").map((label, col) => ({ row: 0, col, color: "black" as const, kind: "piece", label })),
  { row: 2, col: 1, color: "black", kind: "cannon", label: "炮" }, { row: 2, col: 7, color: "black", kind: "cannon", label: "炮" },
  ...[0, 2, 4, 6, 8].map(col => ({ row: 3, col, color: "black" as const, kind: "pawn", label: "卒" })),
  ...[0, 2, 4, 6, 8].map(col => ({ row: 6, col, color: "red" as const, kind: "pawn", label: "兵" })),
  { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" }, { row: 7, col: 7, color: "red", kind: "cannon", label: "炮" },
  ..."车马相仕帅仕相马车".split("").map((label, col) => ({ row: 9, col, color: "red" as const, kind: "piece", label })),
];
const fallback: BoardState = { fen: startingFen, sideToMove: "红方", status: "进行中", pieces: initialPieces, history: [] };

function squareToIccs(row: number, col: number) { return `${String.fromCharCode(97 + col)}${9 - row}`; }

export default function App() {
  const [board, setBoard] = useState<BoardState>(fallback);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [reversed, setReversed] = useState(false);
  const [fenInput, setFenInput] = useState(startingFen);
  const [enginePath, setEnginePath] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8080");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("本地数据已保存");

  useEffect(() => { invoke<BoardState>("get_state").then(state => { setBoard(state); setFenInput(state.fen); }).catch(() => setNotice("浏览器预览模式")); }, []);
  const pieceMap = useMemo(() => new Map(board.pieces.map(piece => [`${piece.row}-${piece.col}`, piece])), [board.pieces]);
  const cells = useMemo(() => Array.from({ length: 90 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), []);

  async function selectSquare(row: number, col: number) {
    const piece = pieceMap.get(`${row}-${col}`);
    if (!selected) {
      if (piece) setSelected({ row, col });
      return;
    }
    if (piece && piece.color === pieceMap.get(`${selected.row}-${selected.col}`)?.color) { setSelected({ row, col }); return; }
    const iccs = `${squareToIccs(selected.row, selected.col)}${squareToIccs(row, col)}`;
    try {
      const next = await invoke<BoardState>("play_move", { iccs });
      setBoard(next); setFenInput(next.fen); setNotice(`已记录 ${iccs}`);
    } catch (error) { setNotice(String(error).includes("__TAURI") ? "请在桌面应用中落子" : String(error)); }
    setSelected(null);
  }

  async function createGame() {
    try { const next = await invoke<BoardState>("new_game", { fen: fenInput }); setBoard(next); setSelected(null); setAnalysis([]); setNotice("已创建新棋谱"); }
    catch (error) { setNotice(String(error).includes("__TAURI") ? "请在桌面应用中创建棋谱" : String(error)); }
  }

  async function runAnalysis() {
    if (!enginePath.trim()) { setNotice("请填写 UCI/UCCI 引擎路径"); return; }
    setBusy(true); setNotice("引擎正在计算…");
    try { const result = await invoke<AnalysisLine[]>("analyze_position", { enginePath, fen: board.fen, moveTimeMs: 1500 }); setAnalysis(result); setNotice("分析完成"); }
    catch (error) { setNotice(String(error)); }
    finally { setBusy(false); }
  }

  async function synchronize() {
    if (!token.trim()) { setNotice("请先填写登录令牌"); return; }
    setBusy(true);
    try {
      const result = await invoke<SyncResult>("sync_now", { serverUrl, token });
      setNotice(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}`);
    } catch (error) { setNotice(String(error)); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">象</div><div><strong>棋研</strong><span>XIANGQI STUDIO</span></div></div>
      <nav className="tabs"><button className="active"><BookOpen size={16}/>研习室</button><button><Database size={16}/>棋谱库</button></nav>
      <div className="top-actions"><span className="save-state"><span/> {notice}</span><button className="icon-button" title="设置"><Settings2 size={18}/></button></div>
    </header>

    <main className="workspace">
      <aside className="library-panel">
        <div className="panel-heading"><div><span className="eyebrow">本地棋库</span><h2>我的研习</h2></div><button className="icon-button" title="新建棋谱" onClick={() => { setFenInput(startingFen); void createGame(); }}><Plus size={18}/></button></div>
        <label className="search"><FolderOpen size={16}/><input placeholder="搜索棋谱" /></label>
        <div className="library-list">
          <button className="library-item active"><span className="library-icon"><BookOpen size={18}/></span><span><strong>新建研习棋谱</strong><small>刚刚编辑 · {board.history.length} 回合</small></span><ChevronRight size={16}/></button>
          <button className="library-item"><span className="library-icon muted"><Database size={18}/></span><span><strong>导入棋谱</strong><small>PGN / FEN / TXQ</small></span></button>
        </div>
        <div className="sync-box"><div><RefreshCw size={16}/><strong>个人同步</strong></div><input value={serverUrl} onChange={event => setServerUrl(event.target.value)} aria-label="同步服务地址"/><input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="登录令牌" aria-label="登录令牌"/><button onClick={() => void synchronize()} disabled={busy}>立即同步</button></div>
      </aside>

      <section className="board-section">
        <div className="board-toolbar"><div><span className={`turn-dot ${board.sideToMove === "红方" ? "red" : "black"}`}/><strong>{board.sideToMove}行棋</strong><span className="status-tag">{board.status}</span></div><div><button className="icon-button" title="翻转棋盘" onClick={() => setReversed(value => !value)}><RotateCcw size={18}/></button><button className="icon-button" title="回到初始局面" onClick={() => { setFenInput(startingFen); void createGame(); }}><RefreshCw size={18}/></button></div></div>
        <div className={`board ${reversed ? "reversed" : ""}`}>
          <div className="river"><span>楚 河</span><span>漢 界</span></div>
          {cells.map(({ row, col }) => {
            const displayRow = reversed ? 9 - row : row; const displayCol = reversed ? 8 - col : col;
            const piece = pieceMap.get(`${displayRow}-${displayCol}`); const isSelected = selected?.row === displayRow && selected?.col === displayCol;
            return <button key={`${row}-${col}`} className={`square ${isSelected ? "selected" : ""}`} onClick={() => void selectSquare(displayRow, displayCol)} aria-label={`${displayRow}-${displayCol}`}>
              {piece && <span className={`piece ${piece.color}`}>{piece.label}</span>}
            </button>;
          })}
        </div>
        <div className="fen-row"><label>FEN</label><input value={fenInput} onChange={event => setFenInput(event.target.value)} /><button onClick={() => void createGame()}>载入</button></div>
      </section>

      <aside className="analysis-panel">
        <div className="analysis-tabs"><button className="active">引擎分析</button><button>着法树</button></div>
        <section className="engine-control">
          <div className="engine-title"><span className="engine-symbol"><Activity size={18}/></span><div><strong>本地 UCI / UCCI</strong><small>{busy ? "计算中" : "待命"}</small></div></div>
          <label>引擎可执行文件<input value={enginePath} onChange={event => setEnginePath(event.target.value)} placeholder="/path/to/pikafish" /></label>
          <button className="primary" onClick={() => void runAnalysis()} disabled={busy}><Play size={16}/>{busy ? "分析中…" : "分析当前局面"}</button>
        </section>
        <section className="variations">
          <div className="section-title"><span>候选线路</span><small>MultiPV 3</small></div>
          {analysis.length === 0 ? <div className="empty-analysis"><Activity size={28}/><strong>等待分析</strong><span>配置本地引擎后分析当前局面</span></div> : analysis.map(line => <div className="pv-line" key={line.multipv}><span className="pv-rank">{line.multipv}</span><div><strong>{line.mate != null ? `杀 ${line.mate}` : `${((line.scoreCp ?? 0) / 100).toFixed(2)}`}</strong><span>{line.pv.join(" ")}</span></div><small>d{line.depth ?? "-"}</small></div>)}
        </section>
        <section className="move-tree"><div className="section-title"><span>当前主线</span><small>{board.history.length} 着</small></div>{board.history.length === 0 ? <p>落子后自动建立棋谱分支</p> : board.history.map((move, index) => <div className="move-row" key={move.id}><span>{index + 1}</span><strong>{move.iccs}</strong>{move.isMainline && <small>主线</small>}</div>)}</section>
      </aside>
    </main>
  </div>;
}

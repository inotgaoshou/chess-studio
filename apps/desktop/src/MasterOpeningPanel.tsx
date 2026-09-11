import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarDays, Database, RefreshCw, ShieldCheck, Trophy, Undo2 } from "lucide-react";
import { ReferencePositionPanel } from "./ReferencePositionPanel";
import type { PositionMoveStatDto, ReferenceGameSummaryDto } from "./platform/types";

type Props = {
  fen: string;
  enabled: boolean;
  queryMoves(fen: string): Promise<PositionMoveStatDto[]>;
  queryGames(fen: string): Promise<ReferenceGameSummaryDto[]>;
  resolveMoveFen(fen: string, iccs: string): Promise<string | undefined>;
  onPreviewMove(iccs: string, notation: string): void;
  onAddMove(iccs: string): void;
  onOpenExplorer(): void;
  onOpenGame(gameId: string): void;
};

function resultLabel(result: string) {
  return result === "1-0" ? "红胜" : result === "0-1" ? "黑胜" : result === "1/2-1/2" ? "和棋" : "结果未知";
}

function gameDateLabel(value: string) {
  return value?.trim() || "日期不详";
}

function openingLabel(game: ReferenceGameSummaryDto) {
  if (!game.openingCode) return "待分类";
  return game.openingName ? `${game.openingCode} · ${game.openingName}` : game.openingCode;
}

function playerMark(name: string, fallback: string) {
  return (name || fallback).trim().slice(0, 1) || fallback.slice(0, 1);
}

function cleanPlayerText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\^[A-Za-z]/g, "")
    .replace(/[□?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ORGANIZATION_PREFIX = /^(?:[\u4e00-\u9fffA-Za-z0-9·（）()]+?(?:大学|学院|学校|中学|棋院|俱乐部|协会|代表队|队|省|市|县|区))+/;

function personName(value: string | undefined, fallback: string) {
  const cleaned = cleanPlayerText(value || "");
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1] || fallback;
  const withoutOrganization = cleaned.replace(ORGANIZATION_PREFIX, "").trim();
  return withoutOrganization || cleaned || fallback;
}

function outcomeFromTitle(game: ReferenceGameSummaryDto) {
  const title = cleanPlayerText(game.title || "");
  const match = title.match(/^(.+?)\s*(胜|负|和)\s*(.+)$/);
  if (!match) return undefined;
  const left = personName(match[1], "红方未详");
  const result = match[2];
  const right = personName(match[3], "黑方未详");
  if (result === "胜") return `${left} 胜 ${right}`;
  if (result === "负") return `${right} 胜 ${left}`;
  return `${left} 和 ${right}`;
}

function outcomeLabel(game: ReferenceGameSummaryDto) {
  const titleOutcome = outcomeFromTitle(game);
  if (titleOutcome) return titleOutcome;
  const red = personName(game.redPlayer, "红方未详");
  const black = personName(game.blackPlayer, "黑方未详");
  if (game.result === "1-0") return `${red} 胜 ${black}`;
  if (game.result === "0-1") return `${black} 胜 ${red}`;
  if (game.result === "1/2-1/2") return `${red} 和 ${black}`;
  return `${red} 对 ${black}`;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round(value * 100 / total) : 0;
}

export function MasterOpeningPanel({ fen, enabled, queryMoves, queryGames, resolveMoveFen, onPreviewMove, onAddMove, onOpenExplorer, onOpenGame }: Props) {
  const generation = useRef(0);
  const [games, setGames] = useState<ReferenceGameSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState<string>();
  const [selectedMove, setSelectedMove] = useState<PositionMoveStatDto>();
  const [matchScope, setMatchScope] = useState("当前局面");
  const [viewMode, setViewMode] = useState<"compact" | "detail">("compact");

  useEffect(() => {
    if (!enabled) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    setSelectedMove(undefined);
    setMatchScope("当前局面");
    void queryGames(fen).then((items) => {
      if (request !== generation.current) return;
      setGames(items);
      setSelectedGameId((selected) => selected && items.some((item) => item.id === selected) ? selected : items[0]?.id);
    }).catch((cause) => {
      if (request !== generation.current) return;
      setGames([]);
      setSelectedGameId(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
  }, [enabled, fen, refresh]);

  async function focusMove(move: PositionMoveStatDto) {
    setSelectedMove(move);
    setMatchScope(`走 ${move.notation} 后`);
    onPreviewMove(move.iccs, move.notation);
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const nextFen = await resolveMoveFen(fen, move.iccs);
      if (request !== generation.current) return;
      const items = await queryGames(nextFen || fen);
      if (request !== generation.current) return;
      setGames(items);
      setSelectedGameId((selected) => selected && items.some((item) => item.id === selected) ? selected : items[0]?.id);
    } catch (cause) {
      if (request !== generation.current) return;
      setGames([]);
      setSelectedGameId(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  function resetMoveScope() {
    setSelectedMove(undefined);
    setRefresh((value) => value + 1);
  }

  if (!enabled) return null;
  const decided = selectedMove ? selectedMove.redWins + selectedMove.draws + selectedMove.blackWins : 0;
  return <aside className="master-opening-side-panel" aria-label="大师开局局面搜索">
    <section className="master-opening-panel">
      <header className="master-opening-header">
        <div>
          <span><BookOpen size={16}/><strong>大师开局</strong></span>
          <small>当前局面自动匹配本地参考实战库</small>
        </div>
        <nav>
          <button type="button" title="刷新当前局面" aria-label="刷新当前局面" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14}/></button>
          <button type="button" title="打开完整布局探索" aria-label="打开完整布局探索" onClick={onOpenExplorer}><Database size={14}/></button>
        </nav>
      </header>

      <ReferencePositionPanel
        fen={fen}
        enabled={enabled}
        query={queryMoves}
        onPreview={() => undefined}
        onAdd={onAddMove}
        onFocusMove={(move) => void focusMove(move)}
        selectedMoveIccs={selectedMove?.iccs}
        onOpenExplorer={onOpenExplorer}
        title="候选着法"
        subtitle="样本胜率"
        maxMoves={8}
        refreshToken={refresh}
        className="master-opening-moves"
      />

      <section className="master-opening-matches" aria-label="命中棋谱">
        <header>
          <span><ShieldCheck size={14}/><strong>命中棋谱</strong><small>{loading ? `${matchScope} · 查询中` : `${matchScope} · ${games.length} 条摘要`}</small></span>
          {selectedMove && <button type="button" title="回到当前局面匹配" aria-label="回到当前局面匹配" onClick={resetMoveScope}><Undo2 size={13}/>当前局面</button>}
        </header>
        {selectedMove && <div className="master-opening-selected-move">
          <span><strong>{selectedMove.notation}</strong><small>{selectedMove.samples.toLocaleString()} 局样本</small></span>
          <i className="reference-result-bar" aria-label={`红胜 ${percent(selectedMove.redWins, decided)}%，和棋 ${percent(selectedMove.draws, decided)}%，黑胜 ${percent(selectedMove.blackWins, decided)}%`}>
            <b className="red" style={{ width: `${percent(selectedMove.redWins, decided)}%` }}/>
            <b className="draw" style={{ width: `${percent(selectedMove.draws, decided)}%` }}/>
            <b className="black" style={{ width: `${percent(selectedMove.blackWins, decided)}%` }}/>
          </i>
          <em>红 {percent(selectedMove.redWins, decided)}% · 和 {percent(selectedMove.draws, decided)}% · 黑 {percent(selectedMove.blackWins, decided)}%</em>
        </div>}
        <div className="master-opening-match-toolbar">
          <span>{selectedMove ? "候选着法关联棋谱" : "当前局面关联棋谱"}</span>
          <nav aria-label="命中棋谱显示方式">
            <button type="button" className={viewMode === "detail" ? "active" : ""} onClick={() => setViewMode("detail")}>详细</button>
            <button type="button" className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")}>简洁</button>
          </nav>
        </div>
        {loading && games.length === 0 ? <p>正在匹配当前局面的实战棋谱…</p>
          : error && games.length === 0 ? <p className="error">{error}</p>
          : games.length === 0 ? <p>当前局面暂无命中棋谱；可继续走几步后自动缩小范围。</p>
          : <div className={`master-opening-game-list ${viewMode}`}>
            {games.map((game) => <button
              type="button"
              key={game.id}
              className={game.id === selectedGameId ? "active" : ""}
              onClick={() => {
                setSelectedGameId(game.id);
                onOpenGame(game.id);
              }}
              title={`${game.redPlayer || "红方"} - ${game.blackPlayer || "黑方"}`}
            >
              {viewMode === "detail" ? <>
                <i className="master-opening-versus" aria-hidden="true"><b className="red">{playerMark(game.redPlayer, "红")}</b><em>VS</em><b className="black">{playerMark(game.blackPlayer, "黑")}</b></i>
                <strong>{game.title || `${game.redPlayer || "红方"} 对 ${game.blackPlayer || "黑方"}`}</strong>
                <span>{game.redPlayer || "红方未详"} <b>{resultLabel(game.result)}</b> {game.blackPlayer || "黑方未详"} <em>{openingLabel(game)}</em></span>
                <small><Trophy size={11}/>{game.eventName || "赛事不详"}{game.roundName ? ` · ${game.roundName}` : ""}</small>
                <small><CalendarDays size={11}/>{gameDateLabel(game.gameDate)} · {game.moveCount} 手</small>
              </> : <>
                <i className="master-opening-versus compact" aria-hidden="true"><b className="red">{playerMark(game.redPlayer, "红")}</b><b className="black">{playerMark(game.blackPlayer, "黑")}</b></i>
                <strong>{outcomeLabel(game)}</strong>
              </>}
              <em className="master-opening-preview-label">查看</em>
            </button>)}
          </div>}
      </section>
    </section>
  </aside>;
}

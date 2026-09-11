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
};

function resultLabel(result: string) {
  return result === "1-0" ? "红胜" : result === "0-1" ? "黑胜" : result === "1/2-1/2" ? "和棋" : "结果未知";
}

function gameDateLabel(value: string) {
  return value?.trim() || "日期不详";
}

function openingLabel(game: ReferenceGameSummaryDto) {
  return (game.openingCode ?? game.opening) || "待分类";
}

function playerMark(name: string, fallback: string) {
  return (name || fallback).trim().slice(0, 1) || fallback.slice(0, 1);
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round(value * 100 / total) : 0;
}

export function MasterOpeningPanel({ fen, enabled, queryMoves, queryGames, resolveMoveFen, onPreviewMove, onAddMove, onOpenExplorer }: Props) {
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
        key={`${fen}:${refresh}`}
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
        {loading ? <p>正在匹配当前局面的实战棋谱…</p>
          : error ? <p className="error">{error}</p>
          : games.length === 0 ? <p>当前局面暂无命中棋谱；可继续走几步后自动缩小范围。</p>
          : <div className={`master-opening-game-list ${viewMode}`}>
            {games.map((game) => <button
              type="button"
              key={game.id}
              className={game.id === selectedGameId ? "active" : ""}
              onClick={() => setSelectedGameId(game.id)}
              title={`${game.redPlayer || "红方"} - ${game.blackPlayer || "黑方"}`}
            >
              <i className="master-opening-versus" aria-hidden="true"><b className="red">{playerMark(game.redPlayer, "红")}</b><em>VS</em><b className="black">{playerMark(game.blackPlayer, "黑")}</b></i>
              <strong>{game.title || `${game.redPlayer || "红方"} 对 ${game.blackPlayer || "黑方"}`}</strong>
              {viewMode === "detail" ? <>
                <span>{game.redPlayer || "红方未详"} <b>{resultLabel(game.result)}</b> {game.blackPlayer || "黑方未详"} <em>{openingLabel(game)}</em></span>
                <small><Trophy size={11}/>{game.eventName || "赛事不详"}{game.roundName ? ` · ${game.roundName}` : ""}</small>
                <small><CalendarDays size={11}/>{gameDateLabel(game.gameDate)} · {game.moveCount} 手</small>
              </> : <>
                <span>{game.redPlayer || "红方未详"} <b>{resultLabel(game.result)}</b> {game.blackPlayer || "黑方未详"}</span>
                <small>{openingLabel(game)} · {gameDateLabel(game.gameDate)}</small>
              </>}
              <em className="master-opening-preview-label">查看</em>
            </button>)}
          </div>}
      </section>
    </section>
  </aside>;
}

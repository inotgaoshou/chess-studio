import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarDays, Database, RefreshCw, ShieldCheck, Trophy } from "lucide-react";
import { ReferencePositionPanel } from "./ReferencePositionPanel";
import type { PositionMoveStatDto, ReferenceGameSummaryDto } from "./platform/types";

type Props = {
  fen: string;
  enabled: boolean;
  queryMoves(fen: string): Promise<PositionMoveStatDto[]>;
  queryGames(fen: string): Promise<ReferenceGameSummaryDto[]>;
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

export function MasterOpeningPanel({ fen, enabled, queryMoves, queryGames, onPreviewMove, onAddMove, onOpenExplorer }: Props) {
  const generation = useRef(0);
  const [games, setGames] = useState<ReferenceGameSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
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

  if (!enabled) return null;
  const selectedGame = games.find((game) => game.id === selectedGameId);
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
        onPreview={onPreviewMove}
        onAdd={onAddMove}
        onOpenExplorer={onOpenExplorer}
        title="候选着法"
        subtitle="样本胜率"
        maxMoves={8}
        className="master-opening-moves"
      />

      <section className="master-opening-matches" aria-label="命中棋谱">
        <header>
          <span><ShieldCheck size={14}/><strong>命中棋谱</strong><small>{loading ? "查询中" : `${games.length} 条摘要`}</small></span>
        </header>
        {loading ? <p>正在匹配当前局面的实战棋谱…</p>
          : error ? <p className="error">{error}</p>
          : games.length === 0 ? <p>当前局面暂无命中棋谱；可继续走几步后自动缩小范围。</p>
          : <div className="master-opening-game-list">
            {games.map((game) => <button
              type="button"
              key={game.id}
              className={game.id === selectedGameId ? "active" : ""}
              onClick={() => setSelectedGameId(game.id)}
              title={`${game.redPlayer || "红方"} - ${game.blackPlayer || "黑方"}`}
            >
              <strong>{game.title || `${game.redPlayer || "红方"} 对 ${game.blackPlayer || "黑方"}`}</strong>
              <span>{game.redPlayer || "红方未详"} <b>{resultLabel(game.result)}</b> {game.blackPlayer || "黑方未详"}</span>
              <small><Trophy size={11}/>{game.eventName || "赛事不详"}{game.roundName ? ` · ${game.roundName}` : ""}</small>
              <small><CalendarDays size={11}/>{gameDateLabel(game.gameDate)} · {openingLabel(game)} · {game.moveCount} 手</small>
            </button>)}
          </div>}
      </section>

      <section className="master-opening-preview" aria-label="对局台预览">
        {selectedGame ? <>
          <small>对局台待命</small>
          <strong>{selectedGame.redPlayer || "红方"} vs {selectedGame.blackPlayer || "黑方"}</strong>
          <span>{selectedGame.eventName || "赛事不详"} · {gameDateLabel(selectedGame.gameDate)} · {resultLabel(selectedGame.result)}</span>
          <em>当前先显示快速摘要；需要完整分支和注释时点右上角资料库进入完整探索。</em>
        </> : <>
          <small>对局台待命</small>
          <strong>选择命中棋谱查看摘要</strong>
          <span>这里不自动写入棋谱，也不加载完整注释树。</span>
        </>}
      </section>
    </section>
  </aside>;
}

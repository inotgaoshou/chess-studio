import { useEffect, useRef, useState } from "react";
import { BookOpen, Eye, Plus, RefreshCw } from "lucide-react";
import type { PositionMoveStatDto } from "./platform/types";

type Props = {
  fen: string;
  enabled: boolean;
  query(fen: string): Promise<PositionMoveStatDto[]>;
  onPreview(iccs: string, notation: string): void;
  onAdd(iccs: string): void;
  onOpenExplorer(): void;
  title?: string;
  subtitle?: string;
  maxMoves?: number;
  className?: string;
};

function percent(value: number, total: number) {
  return total > 0 ? Math.round(value * 100 / total) : 0;
}

export function ReferencePositionPanel({ fen, enabled, query, onPreview, onAdd, onOpenExplorer, title = "实战库", subtitle = "当前局面", maxMoves = 8, className = "" }: Props) {
  const generation = useRef(0);
  const [moves, setMoves] = useState<PositionMoveStatDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    void query(fen).then((items) => {
      if (request === generation.current) setMoves(items);
    }).catch((cause) => {
      if (request === generation.current) {
        setMoves([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
  }, [enabled, fen, refresh]);

  if (!enabled) return null;
  const opening = moves.find((move) => move.openingCode);
  return <section className={`reference-position-panel ${className}`.trim()} aria-label="当前局面实战库">
    <header>
      <span><BookOpen size={14}/><strong>{title}</strong><small>{subtitle}</small></span>
      <nav>
        <button type="button" title="刷新当前局面" aria-label="刷新当前局面" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14}/></button>
        <button type="button" title="打开布局探索" aria-label="打开布局探索" onClick={onOpenExplorer}><BookOpen size={14}/></button>
      </nav>
    </header>
    {opening && <div className="reference-position-opening"><b>局面关联 {opening.openingCode} · {opening.openingName}</b><span>样本共识 {opening.openingConfidence ?? 0}% · {moves.length} 种候选</span></div>}
    {loading ? <p>正在查询本地实战…</p> : error ? <p className="error">{error}</p> : moves.length === 0 ? <p>当前局面暂无本地实战样本。</p> : <ol>
      {moves.slice(0, maxMoves).map((move) => {
        const decided = move.redWins + move.draws + move.blackWins;
        return <li key={move.iccs}>
          <button className="reference-move-main" type="button" onClick={() => onPreview(move.iccs, move.notation)} title="临时预览，不写入棋谱">
            <strong>{move.notation}</strong><span>{move.samples.toLocaleString()} 局</span>
            {move.representativeGameTitle && <small title={move.representativeGameTitle}>代表：{move.representativeGameTitle}{move.firstYear ? ` · ${move.firstYear}${move.lastYear && move.lastYear !== move.firstYear ? `–${move.lastYear}` : ""}` : ""}</small>}
            <i className="reference-result-bar" aria-label={`红胜 ${percent(move.redWins, decided)}%，和棋 ${percent(move.draws, decided)}%，黑胜 ${percent(move.blackWins, decided)}%`}>
              <b className="red" style={{ width: `${percent(move.redWins, decided)}%` }}/>
              <b className="draw" style={{ width: `${percent(move.draws, decided)}%` }}/>
              <b className="black" style={{ width: `${percent(move.blackWins, decided)}%` }}/>
            </i>
          </button>
          <button type="button" title="临时预览" aria-label={`预览 ${move.notation}`} onClick={() => onPreview(move.iccs, move.notation)}><Eye size={14}/></button>
          <button type="button" title="加入当前棋谱" aria-label={`加入棋谱 ${move.notation}`} onClick={() => onAdd(move.iccs)}><Plus size={14}/></button>
        </li>;
      })}
    </ol>}
  </section>;
}

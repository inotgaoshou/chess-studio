import { Activity, BookOpen, Database, Settings2, TrendingUp } from "lucide-react";

export type CompactBookRow = {
  id: string;
  iccs: string;
  notation: string;
  scoreText: string;
  winRateText: string;
  source: string;
  detail?: string;
};

export type CompactEvaluationRow = {
  id: string;
  iccs?: string;
  notation: string;
  scoreText: string;
  depthText: string;
  role: string;
  disabled?: boolean;
};

type Props = {
  cloudEnabled: boolean;
  bookLoading: boolean;
  bookError?: string;
  bookRows: CompactBookRow[];
  evaluationRows: CompactEvaluationRow[];
  evaluationLabel: string;
  evaluationScore: string;
  qualityText: string;
  redShare?: number;
  depthText: string;
  timeText: string;
  onOpenSettings(): void;
  onPlayBookMove(iccs: string): void;
  onPlayEvaluationMove(iccs: string): void;
};

export function CompactReferencePanels({
  cloudEnabled,
  bookLoading,
  bookError,
  bookRows,
  evaluationRows,
  evaluationLabel,
  evaluationScore,
  qualityText,
  redShare,
  depthText,
  timeText,
  onOpenSettings,
  onPlayBookMove,
  onPlayEvaluationMove,
}: Props) {
  const blackShare = redShare == null ? undefined : 100 - redShare;
  const localBookCount = bookRows.filter((row) => row.source !== "ChessDB").length;
  const bookStatus = bookLoading
      ? "查询中"
      : bookError
        ? localBookCount ? `${localBookCount} 条 · 云库异常` : bookError
        : `${bookRows.length} 条${cloudEnabled ? "" : " · 云库关闭"}`;

  return <div className="compact-reference-stack">
    <section className="compact-reference-panel compact-book-panel" aria-label="简洁布局开局库">
      <header>
        <span><Database size={15}/><strong>开局库与云库</strong></span>
        <small>{bookStatus}</small>
        <button type="button" title="开局库与引擎设置" aria-label="开局库与引擎设置" onClick={onOpenSettings}><Settings2 size={14}/></button>
      </header>
      <div className="compact-source-status">
        <span className={bookRows.some((row) => row.source !== "ChessDB") ? "ready" : ""}><BookOpen size={12}/>本地库</span>
        <span className={cloudEnabled && !bookError ? "ready" : ""}><Database size={12}/>ChessDB</span>
      </div>
      <div className="compact-data-table compact-book-table" role="group" aria-label="开局库候选">
        <div className="compact-data-head"><span>着法</span><span>分数</span><span>胜率</span><span>来源</span></div>
        <div className="compact-data-body">
          {bookRows.map((row) => <button type="button" key={row.id} onClick={() => onPlayBookMove(row.iccs)} title={row.detail || row.source}>
            <strong>{row.notation}</strong><span>{row.scoreText}</span><span>{row.winRateText}</span><small>{row.source}</small>
          </button>)}
          {!bookLoading && bookRows.length === 0 && <div className="compact-table-empty"><BookOpen size={20}/><span>{bookError ? "云库暂时不可用" : cloudEnabled ? "当前局面暂无库着" : "当前局面暂无本地库着，ChessDB 云库未启用"}</span></div>}
        </div>
      </div>
    </section>

    <section className="compact-reference-panel compact-evaluation-panel" aria-label="简洁布局评估信息">
      <header><span><TrendingUp size={15}/><strong>评估信息</strong></span><small>{evaluationLabel}</small></header>
      <div className="compact-overview-metrics">
        <div><small>局面分</small><strong>{evaluationScore}</strong></div>
        <div><small>质量分</small><strong>{qualityText}</strong></div>
        <div><small>红方</small><strong>{redShare == null ? "--" : `${redShare.toFixed(0)}%`}</strong></div>
        <div><small>黑方</small><strong>{blackShare == null ? "--" : `${blackShare.toFixed(0)}%`}</strong></div>
        <div><small>深度</small><strong>{depthText}</strong></div>
        <div><small>耗时</small><strong>{timeText}</strong></div>
      </div>
      <div className="compact-overview-balance" aria-label={redShare == null ? "等待局势分析" : `红方占比 ${redShare.toFixed(0)}%`}><i style={{ width: `${redShare ?? 50}%` }}/></div>
      <div className="compact-data-table compact-evaluation-table" role="group" aria-label="候选着法评估">
        <div className="compact-data-head"><span>着法</span><span>分数</span><span>深度</span><span>操作</span></div>
        <div className="compact-data-body">
          {evaluationRows.map((row) => <button type="button" key={row.id} disabled={row.disabled || !row.iccs} aria-label={`走候选着法 ${row.notation}`} onClick={() => row.iccs && onPlayEvaluationMove(row.iccs)} title={`${row.role} · 点击后走棋并保存到棋谱`}>
            <strong>{row.notation}</strong><span>{row.scoreText}</span><span>{row.depthText}</span><small>走棋</small>
          </button>)}
          {evaluationRows.length === 0 && <div className="compact-table-empty"><Activity size={20}/><span>分析后显示候选评估</span></div>}
        </div>
      </div>
    </section>
  </div>;
}

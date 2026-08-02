import { useState } from "react";
import { Activity, BookOpen, ChevronLeft, ChevronRight, Database, Maximize2, Settings2, TrendingUp } from "lucide-react";

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

export type CompactEngineAnalysisRow = {
  id: string;
  iccs?: string;
  rank: number;
  sourceText?: string;
  depthText: string;
  scoreText: string;
  timeText: string;
  npsText: string;
  hfText: string;
  lineLengthText?: string;
  lineText: string;
  disabled?: boolean;
  stale?: boolean;
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
  collapsed?: boolean;
  evaluationCollapsed?: boolean;
  onOpenSettings(): void;
  onToggleCollapsed?(): void;
  onToggleEvaluationCollapsed?(): void;
  onPopOut?(): void;
  onPlayBookMove(iccs: string): void;
  onPlayEvaluationMove(iccs: string): void;
};

type EngineListProps = {
  busy: boolean;
  rows: CompactEngineAnalysisRow[];
  onPlayMove(iccs: string): void;
};

export function CompactEngineAnalysisList({ busy, rows, onPlayMove }: EngineListProps) {
  return <div className="compact-engine-analysis-list" role="table" aria-label="简洁布局引擎分析">
    <div className="compact-engine-analysis-head" role="row">
      <span role="columnheader">记录</span>
      <span role="columnheader">最近10条 · 深/分/时/NPS/HF · 后续走法</span>
    </div>
    <div className="compact-engine-analysis-body" role="rowgroup">
      {rows.map((row) => <button
        type="button"
        role="row"
        key={row.id}
        disabled={row.disabled || !row.iccs}
        className={`compact-engine-analysis-row ${row.stale ? "stale" : ""}`}
        title={row.iccs ? `点击走 ${row.lineText.split(/\s+/)[0] ?? row.iccs}` : row.lineText}
        onClick={() => row.iccs && onPlayMove(row.iccs)}
      >
        <span role="cell" className="compact-engine-rank">{row.rank}</span>
        <span role="cell" className="compact-engine-detail">
          <span className="compact-engine-metrics">
            <strong>深:{row.depthText}</strong>
            <strong>分:{row.scoreText}</strong>
            <small>时:{row.timeText}</small>
            <small>NPS:{row.npsText}</small>
            <small>HF:{row.hfText}</small>
            {row.lineLengthText && <small>后续:{row.lineLengthText}</small>}
            {row.sourceText && <small className="compact-engine-source">{row.sourceText}</small>}
          </span>
          <span className="compact-engine-line">{row.lineText}</span>
        </span>
      </button>)}
      {rows.length === 0 && <div className="compact-engine-empty">
        <Activity size={22}/><strong>{busy ? "AI 正在计算…" : "等待引擎分析"}</strong>
        <span>{busy ? "收到搜索记录后在这里显示最近 10 条深度、分数、时间、NPS 和推荐着法" : "点击上方“分析”后显示截图式引擎列表"}</span>
      </div>}
    </div>
  </div>;
}

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
  collapsed = false,
  evaluationCollapsed = false,
  onOpenSettings,
  onToggleCollapsed,
  onToggleEvaluationCollapsed,
  onPopOut,
  onPlayBookMove,
  onPlayEvaluationMove,
}: Props) {
  const [evaluationTab, setEvaluationTab] = useState<"position" | "cloud">("position");
  const blackShare = redShare == null ? undefined : 100 - redShare;
  const cloudRows = bookRows.filter((row) => row.source === "ChessDB");
  const sourceRows = cloudRows;
  const cloudScores = sourceRows.map((row) => Number(row.scoreText.replace(/[+%]/g, ""))).filter(Number.isFinite);
  const cloudWinRates = sourceRows.map((row) => Number(row.winRateText.replace("%", ""))).filter(Number.isFinite);
  const topCloudRow = sourceRows[0];
  const bestCloudScore = cloudScores.length ? Math.max(...cloudScores) : undefined;
  const averageCloudWinRate = cloudWinRates.length ? cloudWinRates.reduce((sum, value) => sum + value, 0) / cloudWinRates.length : undefined;
  const bookStatus = bookLoading
      ? "查询中"
      : bookError
        ? bookError
        : `${bookRows.length} 条${cloudEnabled ? "" : " · 云库关闭"}`;
  const bookRowTitle = (row: CompactBookRow) => [
    row.notation,
    `分数 ${row.scoreText}`,
    row.winRateText && `胜率 ${row.winRateText}`,
    row.source,
    row.detail,
  ].filter(Boolean).join(" · ");

  if (collapsed) {
    return <div className="compact-reference-stack collapsed" aria-label="云库已收起">
      <button type="button" className="compact-reference-reopen" title="展开云库" aria-label="展开云库" onClick={onToggleCollapsed}>
        <ChevronLeft size={16}/>
        <strong>云库</strong>
        <small>{bookLoading ? "查询" : bookError ? "异常" : `${bookRows.length}条`}</small>
      </button>
    </div>;
  }

  return <div className={`compact-reference-stack ${evaluationCollapsed ? "evaluation-collapsed" : ""}`}>
    <section className="compact-reference-panel compact-book-panel" aria-label="简洁布局开局库">
      <header>
        <span><Database size={15}/><strong>云库（开局库）</strong></span>
        <small>{bookStatus}</small>
        {onPopOut && <button type="button" className="compact-reference-popout" title="弹出为独立窗口，可拖到 App 外面" aria-label="弹出云库独立窗口" onClick={onPopOut}><Maximize2 size={13}/><span>弹出</span></button>}
        {onToggleCollapsed && <button type="button" title="收起云库" aria-label="收起云库" onClick={onToggleCollapsed}><ChevronRight size={14}/></button>}
        <button type="button" title="开局库与引擎设置" aria-label="开局库与引擎设置" onClick={onOpenSettings}><Settings2 size={14}/></button>
      </header>
      <div className="compact-source-status" aria-label="开局库状态">
        <span className={cloudEnabled && !bookError ? "ready" : ""}><Database size={12}/>ChessDB</span>
        <small>{cloudEnabled ? "当前版本使用 ChessDB 云库，本地库和自动出步入口暂不展示" : "云库已关闭"}</small>
      </div>
      <div className="compact-data-table compact-book-table" role="group" aria-label="开局库候选">
        <div className="compact-data-head"><span>着法</span><span>胜率</span><span>分数</span><span>来源</span></div>
        <div className="compact-data-body">
          {bookRows.map((row) => <button type="button" key={row.id} onClick={() => onPlayBookMove(row.iccs)} title={bookRowTitle(row)}>
            <strong>{row.notation}</strong><span className="book-win-rate">{row.winRateText}</span><span className="book-score">{row.scoreText}</span><small>{row.source}</small>
          </button>)}
          {!bookLoading && bookRows.length === 0 && <div className="compact-table-empty"><BookOpen size={20}/><span>{bookError ? "云库暂时不可用" : cloudEnabled ? "当前局面暂无云库着法" : "ChessDB 云库未启用"}</span></div>}
        </div>
      </div>
    </section>

    {evaluationCollapsed && onToggleEvaluationCollapsed ? <button
      type="button"
      className="compact-evaluation-reopen"
      title="展开评估信息"
      aria-label="展开评估信息"
      onClick={onToggleEvaluationCollapsed}
    >
      <TrendingUp size={15}/>
      <strong>评估信息已收起</strong>
      <small>{evaluationScore} · {depthText === "--" ? "待分析" : `深度 ${depthText}`}</small>
      <ChevronLeft size={14}/>
    </button> : <section className="compact-reference-panel compact-evaluation-panel" aria-label="简洁布局评估信息">
      <header>
        <span><TrendingUp size={15}/><strong>评估信息</strong></span>
        <small>{evaluationLabel}</small>
        {onPopOut && <button type="button" className="compact-reference-popout" title="弹出评估信息与云库独立窗口，可拖到 App 外面" aria-label="弹出评估信息独立窗口" onClick={onPopOut}><Maximize2 size={13}/><span>弹出</span></button>}
        {onToggleEvaluationCollapsed && <button type="button" title="收起评估信息" aria-label="收起评估信息" onClick={onToggleEvaluationCollapsed}><ChevronRight size={14}/></button>}
      </header>
      <div className="compact-overview-metrics">
        <div><small>局面分</small><strong>{evaluationScore}</strong></div>
        <div><small>质量分</small><strong>{qualityText}</strong></div>
        <div><small>红方</small><strong>{redShare == null ? "--" : `${redShare.toFixed(0)}%`}</strong></div>
        <div><small>黑方</small><strong>{blackShare == null ? "--" : `${blackShare.toFixed(0)}%`}</strong></div>
        <div><small>深度</small><strong>{depthText}</strong></div>
        <div><small>耗时</small><strong>{timeText}</strong></div>
      </div>
      <div className="compact-overview-balance" aria-label={redShare == null ? "等待局势分析" : `红方占比 ${redShare.toFixed(0)}%`}><i style={{ width: `${redShare ?? 50}%` }}/></div>
      <div className="compact-evaluation-tabs" aria-label="评估视图">
        <button type="button" className={evaluationTab === "position" ? "active" : ""} onClick={() => setEvaluationTab("position")}>当前局面</button>
        <button type="button" className={evaluationTab === "cloud" ? "active" : ""} onClick={() => setEvaluationTab("cloud")}>云库统计</button>
      </div>
      {evaluationTab === "position" ? <div className="compact-data-table compact-evaluation-table" role="group" aria-label="候选着法评估">
        <div className="compact-data-head"><span>着法</span><span>分数</span><span>深度</span><span>操作</span></div>
        <div className="compact-data-body">
          {evaluationRows.map((row) => <button type="button" key={row.id} disabled={row.disabled || !row.iccs} aria-label={`走候选着法 ${row.notation}`} onClick={() => row.iccs && onPlayEvaluationMove(row.iccs)} title={`${row.role} · 点击后走棋并保存到棋谱`}>
            <strong>{row.notation}</strong><span>{row.scoreText}</span><span>{row.depthText}</span><small>走棋</small>
          </button>)}
          {evaluationRows.length === 0 && <div className="compact-table-empty"><Activity size={20}/><span>分析后显示候选评估</span></div>}
        </div>
      </div> : <div className="compact-cloud-stat-view" role="group" aria-label="云库统计">
        <div className="compact-cloud-stat-grid">
          <div><small>云库候选</small><strong>{sourceRows.length}</strong></div>
          <div><small>最高分</small><strong>{bestCloudScore == null ? "--" : bestCloudScore > 0 ? `+${bestCloudScore}` : `${bestCloudScore}`}</strong></div>
          <div><small>平均胜率</small><strong>{averageCloudWinRate == null ? "--" : `${averageCloudWinRate.toFixed(0)}%`}</strong></div>
          <div><small>最佳着</small><strong>{topCloudRow?.notation ?? "--"}</strong></div>
        </div>
        <div className="compact-data-table compact-cloud-stat-table" role="group" aria-label="云库统计候选">
          <div className="compact-data-head"><span>着法</span><span>胜率</span><span>分数</span><span>来源</span></div>
          <div className="compact-data-body">
            {sourceRows.slice(0, 8).map((row) => <button type="button" key={`stat-${row.id}`} onClick={() => onPlayBookMove(row.iccs)} title={row.detail || row.source}>
              <strong>{row.notation}</strong><span className="book-win-rate">{row.winRateText}</span><span className="book-score">{row.scoreText}</span><small>{row.source}</small>
            </button>)}
            {sourceRows.length === 0 && <div className="compact-table-empty"><Database size={20}/><span>{cloudEnabled ? "暂无云库统计" : "ChessDB 云库未启用"}</span></div>}
          </div>
        </div>
      </div>}
    </section>}
  </div>;
}

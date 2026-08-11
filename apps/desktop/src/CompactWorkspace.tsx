import { useState } from "react";
import { Activity, BookOpen, ChevronLeft, ChevronRight, Database, Eye, Maximize2, Play, Settings2, TrendingUp } from "lucide-react";
import type { AnalysisLine } from "./platform";

export type CompactBookRow = {
  id: string;
  iccs: string;
  notation: string;
  scoreText: string;
  winRateText: string;
  source: string;
  detail?: string;
  advantageText?: string;
  sampleCount?: number;
  distribution?: {
    redWin: number;
    draw: number;
    blackWin: number;
  };
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

function numericScore(scoreText: string) {
  const match = scoreText.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export type CompactEngineAnalysisRow = {
  id: string;
  iccs?: string;
  analyzedFen?: string;
  line?: AnalysisLine;
  source?: {
    id: string;
    name: string;
    primary?: boolean;
  };
  rank: number;
  sourceText?: string;
  depthText: string;
  scoreText: string;
  timeText: string;
  npsText: string;
  hfText: string;
  lineLengthText?: string;
  lineText: string;
  previewActive?: boolean;
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
  onPlayMove(iccs: string, row?: CompactEngineAnalysisRow): void;
  onPreview?(row: CompactEngineAnalysisRow): void;
  onAdopt?(row: CompactEngineAnalysisRow): void;
};

export function CompactEngineAnalysisList({ busy, rows, onPlayMove, onPreview, onAdopt }: EngineListProps) {
  return <div className="compact-engine-analysis-list" role="table" aria-label="简洁布局引擎分析">
    <div className="compact-engine-analysis-head" role="row">
      <span role="columnheader">记录</span>
      <span role="columnheader">候选走法 · 深/分/时/NPS/HF · 后续PV(回合)</span>
    </div>
    <div className="compact-engine-analysis-body" role="rowgroup">
      {rows.map((row) => {
        const disabled = row.disabled || !row.iccs;
        const canPreview = !!onPreview && !!row.line?.pv.length && !row.disabled;
        const canAdopt = !!row.iccs && !row.disabled;
        const hasActions = !!onPreview || !!onAdopt;
        const moves = row.lineText.trim().split(/\s+/).filter(Boolean);
        const primaryMove = moves[0] ?? row.iccs ?? "暂无着法";
        const continuation = moves.slice(1).join(" ");
        const playTitle = row.iccs
          ? `推荐 ${row.rank}：${primaryMove} · 分 ${row.scoreText} · 深 ${row.depthText} · 用时 ${row.timeText} · NPS ${row.npsText} · HF ${row.hfText}${continuation ? ` · 后续 ${continuation}` : ""}`
          : row.lineText;
        const activateRow = () => {
          if (disabled) return;
          if (onPreview && canPreview) {
            onPreview(row);
            return;
          }
          if (row.iccs) onPlayMove(row.iccs, row);
        };
        return <div
          role="row"
          key={row.id}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          className={`compact-engine-analysis-row ${row.stale ? "stale" : ""} ${row.previewActive ? "preview-active" : ""} ${disabled ? "disabled" : ""} ${hasActions ? "has-actions" : ""}`}
          title={playTitle}
          onClick={activateRow}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            activateRow();
          }}
        >
          <span role="cell" className="compact-engine-rank">{row.rank}</span>
          <span role="cell" className="compact-engine-detail">
            <span className="compact-engine-metrics">
              <strong className="compact-engine-primary-move">{row.rank}. {primaryMove}</strong>
              <strong className="compact-engine-score">分 {row.scoreText}</strong>
              <small>深 {row.depthText}</small>
              {row.lineLengthText && <small>{row.lineLengthText}</small>}
              {row.sourceText && <small className="compact-engine-source">{row.sourceText}</small>}
            </span>
            <span className="compact-engine-line">{continuation ? `后续：${continuation}` : "后续：等待引擎返回更多变化"}</span>
          </span>
          {hasActions && <span role="cell" className="compact-engine-row-actions" onClick={(event) => event.stopPropagation()}>
            {onPreview && <button type="button" disabled={!canPreview} className="compact-engine-row-action preview" aria-label={row.previewActive ? `取消预览候选 ${row.rank}` : `预览候选 ${row.rank}`} title={row.previewActive ? "取消这条候选推演预览" : "预览这条后续推演"} onClick={() => onPreview(row)}><Eye size={12}/><span>{row.previewActive ? "取消" : "预览"}</span></button>}
            <button type="button" disabled={!canAdopt} className="compact-engine-row-action adopt" aria-label={`采用候选 ${row.rank}`} title="采用这条候选首着" onClick={() => onAdopt ? onAdopt(row) : row.iccs && onPlayMove(row.iccs, row)}><Play size={11}/><span>采用</span></button>
          </span>}
        </div>;
      })}
      {rows.length === 0 && <div className="compact-engine-empty">
        <Activity size={22}/><strong>{busy ? "AI 正在计算…" : "等待引擎分析"}</strong>
        <span>{busy ? "收到搜索结果后在这里按设置数量显示候选走法、评分和后续 PV" : "点击上方“分析”后显示截图式引擎列表"}</span>
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
  const [evaluationTab, setEvaluationTab] = useState<"position" | "book">("position");
  const blackShare = redShare == null ? undefined : 100 - redShare;
  const sourceRows = bookRows;
  const cloudScores = sourceRows.map((row) => numericScore(row.scoreText)).filter((value): value is number => Number.isFinite(value));
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
    row.advantageText,
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
        <span className={cloudEnabled && !bookError ? "ready" : ""}><Database size={12}/>云库</span>
        <span className={bookRows.some((row) => row.distribution) ? "ready" : ""}><BookOpen size={12}/>本地 XQB</span>
        <small>{bookRows.some((row) => row.distribution) ? "本地库显示胜/和/负、样本量和局面分" : cloudEnabled ? "云库显示胜率、局面分和相对首选差值" : "云库已关闭"}</small>
      </div>
      <div className="compact-data-table compact-book-table" role="group" aria-label="开局库候选">
        <div className="compact-data-head"><span>着法</span><span>胜/和/负</span><span>样本</span><span>分/差</span></div>
        <div className="compact-data-body">
          {bookRows.map((row) => <button type="button" key={row.id} onClick={() => onPlayBookMove(row.iccs)} title={bookRowTitle(row)}>
            <strong>{row.notation}</strong>
            {row.distribution ? <span className="book-distribution" aria-label={`胜 ${row.distribution.redWin}% ，和 ${row.distribution.draw}% ，负 ${row.distribution.blackWin}%`}>
              <i className="red" style={{ width: `${row.distribution.redWin}%` }}>{row.distribution.redWin}%</i><i className="draw" style={{ width: `${row.distribution.draw}%` }}>{row.distribution.draw}%</i><i className="black" style={{ width: `${row.distribution.blackWin}%` }}>{row.distribution.blackWin}%</i>
            </span> : <span className="book-win-rate">胜率 {row.winRateText}</span>}
            <span className="book-samples">{row.sampleCount?.toLocaleString() ?? "--"}</span><small className="book-advantage">{row.scoreText}{row.advantageText ? ` · ${row.advantageText}` : ""}</small>
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
        <button type="button" className={evaluationTab === "book" ? "active" : ""} onClick={() => setEvaluationTab("book")}>开局库统计</button>
      </div>
      {evaluationTab === "position" ? <div className="compact-data-table compact-evaluation-table" role="group" aria-label="候选着法评估">
        <div className="compact-data-head"><span>着法</span><span>分数</span><span>深度</span><span>操作</span></div>
        <div className="compact-data-body">
          {evaluationRows.map((row) => <button type="button" key={row.id} disabled={row.disabled || !row.iccs} aria-label={`走候选着法 ${row.notation}`} onClick={() => row.iccs && onPlayEvaluationMove(row.iccs)} title={`${row.role} · 点击后走棋并保存到棋谱`}>
            <strong>{row.notation}</strong><span>{row.scoreText}</span><span>{row.depthText}</span><small>走棋</small>
          </button>)}
          {evaluationRows.length === 0 && <div className="compact-table-empty"><Activity size={20}/><span>分析后显示候选评估</span></div>}
        </div>
      </div> : <div className="compact-cloud-stat-view" role="group" aria-label="开局库统计">
        <div className="compact-cloud-stat-grid">
          <div><small>开局库候选</small><strong>{sourceRows.length}</strong></div>
          <div><small>最高分</small><strong>{bestCloudScore == null ? "--" : bestCloudScore > 0 ? `+${bestCloudScore}` : `${bestCloudScore}`}</strong></div>
          <div><small>平均胜率</small><strong>{averageCloudWinRate == null ? "--" : `${averageCloudWinRate.toFixed(0)}%`}</strong></div>
          <div><small>最佳着</small><strong>{topCloudRow?.notation ?? "--"}</strong></div>
        </div>
        <div className="compact-data-table compact-cloud-stat-table" role="group" aria-label="开局库统计候选">
          <div className="compact-data-head"><span>着法</span><span>胜/和/负</span><span>样本</span><span>分/差</span></div>
          <div className="compact-data-body">
            {sourceRows.slice(0, 8).map((row) => <button type="button" key={`stat-${row.id}`} onClick={() => onPlayBookMove(row.iccs)} title={row.detail || row.source}>
              <strong>{row.notation}</strong>
              {row.distribution ? <span className="book-distribution" aria-label={`胜 ${row.distribution.redWin}% ，和 ${row.distribution.draw}% ，负 ${row.distribution.blackWin}%`}><i className="red" style={{ width: `${row.distribution.redWin}%` }}/><i className="draw" style={{ width: `${row.distribution.draw}%` }}/><i className="black" style={{ width: `${row.distribution.blackWin}%` }}/></span> : <span className="book-win-rate">胜率 {row.winRateText}</span>}
              <span className="book-samples">{row.sampleCount?.toLocaleString() ?? "--"}</span><small className="book-advantage">{row.scoreText}{row.advantageText ? ` · ${row.advantageText}` : ""}</small>
            </button>)}
            {sourceRows.length === 0 && <div className="compact-table-empty"><Database size={20}/><span>{cloudEnabled ? "暂无开局库统计" : "ChessDB 云库未启用"}</span></div>}
          </div>
        </div>
      </div>}
    </section>}
  </div>;
}

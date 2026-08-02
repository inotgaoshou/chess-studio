import type { PointerEvent } from "react";
import type { AnalysisLine, Side } from "./platform";
import { ChevronDown, ChevronRight, Eye, Maximize2, Play } from "lucide-react";
import { redAnalysisScoreText } from "./analysisView";

export type EngineComparisonGroup = {
  id: string;
  name: string;
  lines: AnalysisLine[];
  error?: string;
  primary: boolean;
};

type Props = {
  busy: boolean;
  collapsed?: boolean;
  compact?: boolean;
  disabled?: boolean;
  divergencesOnly?: boolean;
  fen: string;
  groups: EngineComparisonGroup[];
  sideToMove: Side;
  onCollapsedChange?(collapsed: boolean): void;
  onClose?(): void;
  onDragEnd?(event: PointerEvent<HTMLElement>): void;
  onDragMove?(event: PointerEvent<HTMLElement>): void;
  onDragStart?(event: PointerEvent<HTMLElement>): void;
  onPopOut?(): void;
  onPlay(line: AnalysisLine, engine: EngineComparisonGroup): void;
  onPreview(line: AnalysisLine, engine: EngineComparisonGroup): void;
};

function lineText(line: AnalysisLine) {
  const moves = line.notation?.length ? line.notation : line.pv;
  return moves.length ? moves.join(" ") : "暂无推荐着法";
}

function lineMoves(line?: AnalysisLine) {
  if (!line) return [];
  return line.notation?.length ? line.notation : line.pv;
}

function formatNps(value?: number) {
  if (!value) return "--";
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
}

function formatTime(value?: number) {
  if (value == null) return "--";
  return `${(value / 1000).toFixed(1)}s`;
}

function compactConsensus(groups: EngineComparisonGroup[]) {
  const available = groups.map((group) => group.lines.find((line) => line.multipv === 1)).filter((line): line is AnalysisLine => !!line?.pv[0]);
  if (available.length === 0) return "等待引擎返回";
  if (available.length < groups.length) return "部分引擎计算中";
  const firstMoves = new Set(available.map((line) => line.pv[0]));
  if (firstMoves.size === 1) return groups.length === 2 ? "两个引擎一致" : `${available.length} 个引擎一致`;
  return "引擎首着有分歧";
}

function redScoreCp(line: AnalysisLine, sideToMove: Side) {
  if (line.scoreCp == null || line.mate != null) return undefined;
  return line.scoreCp * (sideToMove === "红方" ? 1 : -1);
}

function agreementLabel(groups: EngineComparisonGroup[], rank: number, sideToMove: Side) {
  const available = groups.map((group) => group.lines.find((line) => line.multipv === rank)).filter((line): line is AnalysisLine => !!line?.pv[0]);
  if (available.length === 0) return "等待候选";
  if (available.length < groups.length) return "部分引擎尚未返回";
  const firstMoves = new Set(available.map((line) => line.pv[0]));
  if (firstMoves.size > 1) return "引擎分歧";
  const pvKeys = new Set(available.map((line) => line.pv.join(" ")));
  const scores = available.map((line) => redScoreCp(line, sideToMove)).filter((score): score is number => score != null);
  const scoreSummary = scores.length === available.length
    ? (() => {
      const gap = Math.round(Math.max(...scores) - Math.min(...scores));
      if (gap <= 50) return `评分接近（差 ${gap} 分）`;
      if (gap <= 200) return `评分有差异（差 ${gap} 分）`;
      return `评分差距较大（差 ${gap} 分）`;
    })()
    : "评分尺度待对照";
  return `${pvKeys.size > 1 ? "首着一致 · 后续不同" : "首着与变化一致"} · ${scoreSummary}`;
}

export function hasEngineDivergence(groups: EngineComparisonGroup[], sideToMove: Side) {
  const maxRank = Math.max(0, ...groups.map((group) => Math.max(0, ...group.lines.map((line) => line.multipv))));
  return Array.from({ length: maxRank }, (_, index) => index + 1)
    .some((rank) => agreementLabel(groups, rank, sideToMove).includes("分歧"));
}

export function MultiEngineComparison({ busy, collapsed = false, compact = false, disabled = false, divergencesOnly = false, fen, groups, sideToMove, onCollapsedChange, onClose, onDragEnd, onDragMove, onDragStart, onPopOut, onPlay, onPreview }: Props) {
  if (groups.length < 2) return null;
  const primary = groups.find((group) => group.primary) ?? groups[0];
  const firstRankState = agreementLabel(groups, 1, sideToMove);
  const maxRank = Math.max(1, ...groups.map((group) => Math.max(0, ...group.lines.map((line) => line.multipv))));
  const ranks = Array.from({ length: maxRank }, (_, index) => index + 1);
  const divergentRanks = ranks.filter((rank) => agreementLabel(groups, rank, sideToMove).includes("分歧"));
  const visibleRanks = divergencesOnly ? divergentRanks : ranks;
  const pending = groups.filter((group) => !group.error && group.lines.length === 0);
  const summary = groups.some((group) => group.error)
    ? "部分引擎失败"
    : pending.length > 0
      ? "部分引擎尚未返回"
      : firstRankState;
  const statusClass = summary.includes("分歧") ? "divergent" : summary.includes("一致") ? "agreed" : "pending";
  const headerActions = <div className="multi-engine-header-actions">
    <span className={statusClass}>{summary}</span>
    {onPopOut && divergentRanks.length > 0 && <button type="button" className="multi-engine-tool" title="单独弹出存在分歧的候选" aria-label="弹出引擎分歧" onClick={onPopOut}><Maximize2 size={12}/><em>分歧</em></button>}
    {onCollapsedChange && <button type="button" className="multi-engine-tool" title={collapsed ? "展开多引擎对照" : "收起多引擎对照"} aria-label={collapsed ? "展开多引擎对照" : "收起多引擎对照"} onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<em>{collapsed ? "展开" : "收起"}</em></button>}
  </div>;

  if (collapsed) {
    return <section className={`multi-engine-comparison ${compact ? "compact" : ""} collapsed`} aria-label="多引擎走法对照">
      <header>
        <div>
          <strong>多引擎对照</strong>
          <small>{compact ? "已收起 · 展开查看各引擎首着 / 分数 / 主变" : groups.map((group) => `${group.name}${group.primary ? "（主）" : ""}`).join(" · ")}</small>
        </div>
        {headerActions}
      </header>
    </section>;
  }

  if (compact) {
    const firstLines = groups.map((engine) => ({ engine, line: engine.lines.find((candidate) => candidate.multipv === 1) }));
    const bestLine = primary.lines.find((candidate) => candidate.multipv === 1) ?? firstLines.find((item) => item.line)?.line;
    const bestMove = bestLine?.notation?.[0] ?? bestLine?.pv[0] ?? "--";
    const maxDepth = Math.max(0, ...firstLines.map((item) => item.line?.depth ?? 0));
    const maxTime = Math.max(0, ...firstLines.map((item) => item.line?.timeMs ?? 0));
    const maxNps = Math.max(0, ...firstLines.map((item) => item.line?.nps ?? 0));
    const detailMoves = lineMoves(bestLine).slice(0, 5);
    return <section className="multi-engine-comparison compact" aria-label="多引擎走法对照">
      <header>
        <div>
          <strong>引擎分析</strong>
          <small>深{maxDepth || "--"} · 时间 {maxTime ? formatTime(maxTime) : "--"} · NPS {maxNps ? formatNps(maxNps) : "--"}</small>
        </div>
        {headerActions}
      </header>
      <section className="compact-engine-recommendation">
        <small>推荐</small>
        <strong>⭐ {bestMove}</strong>
        <span className={summary.includes("分歧") ? "divergent" : summary.includes("一致") ? "agreed" : "pending"}>{compactConsensus(groups)}</span>
      </section>
      <div className="compact-engine-card-grid">
        {firstLines.map(({ engine, line }, engineIndex) => {
          const lineLabel = line?.notation?.[0] ?? line?.pv[0] ?? "--";
          return <article className={`compact-engine-mini-card ${engine.primary ? "primary" : ""} engine-${engineIndex % 4}`} key={engine.id}>
            <header><strong title={engine.name}>{engine.name}</strong><span>{engine.primary ? "主" : "次"}</span></header>
            {engine.error
              ? <em className="error">{engine.error}</em>
              : !line
                ? <em>{busy ? "计算中" : "暂无候选"}</em>
                : <>
                  <b className="compact-engine-score">{redAnalysisScoreText(line, sideToMove)}</b>
                  <small>深{line.depth ?? "--"} · {formatTime(line.timeMs)} · {formatNps(line.nps)}</small>
                  <strong className="compact-engine-first-move">{lineLabel}</strong>
                  <details>
                    <summary>主线</summary>
                    <p title={lineText(line)}>{lineText(line)}</p>
                  </details>
                  <footer>
                    <button type="button" disabled={disabled || line.pv.length === 0} onClick={() => onPreview(line, engine)}><Eye size={12}/>预览</button>
                    <button type="button" disabled={disabled || line.pv.length === 0} onClick={() => onPlay(line, engine)}><Play size={11}/>采用</button>
                  </footer>
                </>}
          </article>;
        })}
      </div>
      <section className="compact-engine-variation-detail">
        <strong>变化详情</strong>
        {detailMoves.length > 0
          ? <ol>{detailMoves.map((move, index) => <li key={`${move}-${index}`}><span>{index + 1}.</span>{move}</li>)}</ol>
          : <p>{busy ? "正在等待主线返回" : "暂无变化详情"}</p>}
      </section>
    </section>;
  }

  return <section className={`multi-engine-comparison ${compact ? "compact" : ""} ${divergencesOnly ? "divergences-only" : ""}`} aria-label={divergencesOnly ? "引擎分歧对照" : "多引擎走法对照"}>
    <header
      className={onDragStart ? "multi-engine-drag-handle" : undefined}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
    >
      <div>
        <strong>{divergencesOnly ? "引擎分歧" : "多引擎对照"}</strong>
        <small>{divergencesOnly ? `仅显示 ${visibleRanks.length} 个首着不同的候选` : groups.map((group) => `${group.name}${group.primary ? "（主）" : ""}`).join(" · ")}</small>
      </div>
      {onClose ? <div className="multi-engine-header-actions"><button type="button" className="multi-engine-tool" title="关闭引擎分歧" aria-label="关闭引擎分歧" onClick={onClose}>关闭</button></div> : headerActions}
    </header>
    {!compact && <p className="multi-engine-note">分数已统一为红方视角；不同引擎评分尺度不同，仅用于观察方向与分歧，不自动判定优劣。</p>}
    <div className="multi-engine-rows">
      {visibleRanks.map((rank) => {
        const state = agreementLabel(groups, rank, sideToMove);
        return <section className="multi-engine-row" key={rank}>
          <header><b>候选 {rank}</b><small className={state.includes("分歧") ? "divergent" : state.includes("一致") ? "agreed" : "pending"}>{state}</small></header>
          <div className="multi-engine-cards">
            {groups.map((engine, engineIndex) => {
              const line = engine.lines.find((candidate) => candidate.multipv === rank);
              const role = engine.primary ? "主引擎" : "对比引擎";
              return <article className={`multi-engine-card ${engine.primary ? "primary" : ""} engine-${engineIndex % 4}`} key={`${rank}-${engine.id}`}>
                <header><span>{role}</span><strong>{engine.name}</strong></header>
                {engine.error
                  ? <p className="engine-comparison-error">{engine.error}</p>
                  : !line
                    ? <p className="engine-comparison-waiting">{busy ? "正在计算" : "暂无候选"}</p>
                    : <>
                      <div className="engine-comparison-metrics"><b>{line.notation?.[0] ?? line.pv[0] ?? "--"}</b><span>红分 {redAnalysisScoreText(line, sideToMove)}</span><span>深度 {line.depth ?? "--"}</span><span>共 {line.notation?.length || line.pv.length} 步</span></div>
                      <p title={lineText(line)}>{lineText(line)}</p>
                      <footer>
                        <button type="button" disabled={disabled || line.pv.length === 0} onClick={() => onPreview(line, engine)}><Eye size={13}/>预览</button>
                        <button type="button" disabled={disabled || line.pv.length === 0} onClick={() => onPlay(line, engine)}><Play size={12}/>采用</button>
                      </footer>
                    </>}
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
    {!compact && <small className="multi-engine-default">默认箭头、局面总评、人机和报告仍采用主引擎：{primary.name}</small>}
  </section>;
}

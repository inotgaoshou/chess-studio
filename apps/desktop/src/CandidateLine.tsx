import type { CSSProperties } from "react";
import { ChevronDown, Eye, Play } from "lucide-react";
import { pvMoveRows } from "./analysisView";
import type { AnalysisLine, PreviewLineStep, Side } from "./platform";
import type { CandidateCoachInsight } from "./coachInsights";
import { CANDIDATE_PREVIEW_HALF_MOVES, DEFAULT_CANDIDATE_LINE_MOVES, MAX_CANDIDATE_LINE_MOVES, MIN_CANDIDATE_LINE_MOVES, candidatePreviewLengthText } from "./candidatePreview";

type Props = {
  color: string;
  fen: string;
  line: AnalysisLine;
  coach?: CandidateCoachInsight;
  scoreText?: string;
  sideToMove: Side;
  disabled?: boolean;
  stale?: boolean;
  visibleMoveCount?: number;
  preview?: { activeStep: number; steps: PreviewLineStep[] };
  onPlay(iccs: string, analyzedFen: string): void;
  onPreview(line: AnalysisLine, analyzedFen: string): void;
  onPreviewStep?(step: number): void;
};

function formatNps(value?: number) {
  if (!value) return "-";
  return value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(Math.round(value));
}

function scoreTone(score?: string) {
  if (!score || score === "--" || score === "0") return "neutral";
  return score.startsWith("-") || score.startsWith("被杀") ? "black" : "red";
}

export function CandidateLine({ color, fen, line, coach, scoreText, sideToMove, disabled = false, stale = false, visibleMoveCount = DEFAULT_CANDIDATE_LINE_MOVES, preview, onPlay, onPreview, onPreviewStep }: Props) {
  const continuationLimit = Math.max(MIN_CANDIDATE_LINE_MOVES, Math.min(MAX_CANDIDATE_LINE_MOVES, Math.trunc(visibleMoveCount) || DEFAULT_CANDIDATE_LINE_MOVES));
  const rows = pvMoveRows(line, sideToMove, fen);
  const coachFollowUp = coach?.followUp.slice(0, CANDIDATE_PREVIEW_HALF_MOVES) ?? [];
  const coachRows = coach ? pvMoveRows({ multipv: line.multipv, pv: coachFollowUp, notation: coach.usesIccs ? [] : coachFollowUp }, sideToMove, fen) : [];
  const firstNotation = line.notation?.[0] ?? line.pv[0];
  const candidateLabel = line.multipv === 1 ? "主候选" : line.multipv === 2 ? "备选比较" : "变招研究";
  const canPreview = line.pv.length > 0;
  const compactLine = (coach?.followUp?.length ? coach.followUp : line.notation?.length ? line.notation : line.pv)
    .slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
  const previewActive = !!preview?.steps.length;
  const continuationStart = previewActive ? preview.activeStep : 0;
  const continuationMoves = previewActive
    ? preview.steps.slice(continuationStart, continuationStart + continuationLimit).map((step, offset) => ({
      index: continuationStart + offset,
      notation: step.notation,
      movedBy: step.movedBy,
    }))
    : compactLine.slice(0, continuationLimit).map((notation, index) => ({
      index,
      notation,
      movedBy: (index % 2 === 0 ? sideToMove : sideToMove === "红方" ? "黑方" : "红方") as Side,
    }));
  const continuationPlaceholders = Math.max(0, continuationLimit - continuationMoves.length);
  const coachSummary = coach?.possibility ?? `${candidateLabel}：点击预览后在棋盘手动查看后续变化。`;
  const continuationScore = scoreText && scoreText !== "--" ? scoreText : undefined;
  const continuationScoreTitle = continuationScore
    ? `候选线路根局面分 ${continuationScore}；Pikafish 单条 PV 不包含后续每个节点的独立复算分`
    : undefined;
  return <article className={`pv-line ${stale ? "stale" : ""} ${previewActive ? "preview-active" : ""}`} style={{ "--pv-color": color } as CSSProperties} title={`ICCS: ${line.pv.join(" ")}`}>
    <div className="pv-card-header pv-engine-header">
      <div className="pv-title">
        <span className="pv-rank">{line.multipv}</span>
        <div>
          <div className="pv-engine-stats" aria-label={`候选 ${line.multipv} 实时引擎指标`}>
            <strong className="pv-engine-move">着法 {line.multipv}：</strong>
            <span>深度 <b>{line.depth ?? "-"}</b></span>
            <span className="score">红分 <b>{scoreText ?? "--"}</b></span>
            <span>耗时 <b>{((line.timeMs ?? 0) / 1000).toFixed(1)}s</b></span>
            <span>NPS <b>{formatNps(line.nps)}</b></span>
          </div>
          <small>{firstNotation ?? "暂无着法"} · {candidateLabel} · {sideToMove}行棋{stale ? " · 旧候选" : ""}</small>
        </div>
      </div>
    </div>
    {compactLine.length > 0 && <div className={`pv-continuation-text ${previewActive ? "preview-active" : ""}`} aria-label={`候选 ${line.multipv} 后续走法`} title={candidatePreviewLengthText(compactLine.length)}>
      <header>
        <strong>{previewActive ? "当前与后续" : "后续走法"}</strong>
        <span>{previewActive ? `${preview.activeStep + 1}/${preview.steps.length}` : `先看 ${Math.min(continuationLimit, compactLine.length)} 步`}</span>
      </header>
      <div className="pv-continuation-moves">
        {continuationMoves.map((move, offset) => {
          const side = move.movedBy === "红方" ? "red" : "black";
          const content = <><i className={side}/><small>{move.index + 1}</small><b>{move.notation}</b>{continuationScore && <em className={`pv-step-score ${scoreTone(continuationScore)}`} title={continuationScoreTitle} aria-label={`线路分 ${continuationScore}`}>{continuationScore}</em>}</>;
          return previewActive
            ? <button key={`${line.multipv}-preview-${move.index}-${move.notation}`} type="button" className={offset === 0 ? "current" : ""} aria-current={offset === 0 ? "step" : undefined} aria-label={`第 ${move.index + 1} 步，${move.movedBy}，${move.notation}`} onClick={() => onPreviewStep?.(move.index)}>{content}</button>
            : <span key={`${line.multipv}-quick-${move.index}-${move.notation}`}>{content}</span>;
        })}
        {Array.from({ length: continuationPlaceholders }, (_, index) => <span className="placeholder-slot" aria-hidden="true" key={`${line.multipv}-placeholder-${index}`}><i/><small>0</small><b>占位</b></span>)}
      </div>
      <p>{previewActive
        ? continuationStart >= preview.steps.length - 1 ? "已到线路末端" : "点击任一步可切换预览局面"
        : candidatePreviewLengthText(compactLine.length)}</p>
    </div>}
    <div className="pv-main-row">
      <div className="pv-quick-read">
        <div className="pv-meta" aria-label={`候选 ${line.multipv} 引擎信息`}>
          <span>PV {line.pv.length}</span>
          {stale && <span>更新中</span>}
          {coach?.shortLine && <span>短线</span>}
          {coach?.usesIccs && <span>ICCS</span>}
        </div>
        <p>{coachSummary}</p>
      </div>
      <div className="pv-actions">
        <button type="button" disabled={disabled || !canPreview} className="pv-preview-button" aria-label={`预览候选 ${line.multipv}`} onClick={() => onPreview(line, fen)}><Eye size={14}/><span>预览</span></button>
        {firstNotation && line.pv[0] && <button type="button" disabled={disabled} className="pv-play-button" aria-label={`走候选着法 ${firstNotation}`} onClick={() => onPlay(line.pv[0], fen)}><Play size={13}/><span>走棋</span></button>}
      </div>
    </div>
    {coach && <details className="pv-coach-details">
      <summary><ChevronDown size={13}/>私教讲解 / 10回合表</summary>
      <section className="pv-coach" aria-label={`候选线路 ${line.multipv} 私教讲解`}>
        <div className="pv-coach-grid">
          <div><small>思路</small><span>{coach.intent}</span></div>
          <div><small>可能性</small><span>{coach.possibility}</span></div>
          <div><small>风险</small><span>{coach.risk}</span></div>
        </div>
        {coachRows.length === 0
          ? <p>当前深度暂未返回可推演线路。</p>
          : <div className="pv-table pv-coach-table" role="table" aria-label={`候选线路 ${line.multipv} 10回合推演`}>
            <div className="pv-table-head" role="row"><span>回合</span><span>红方</span><span>黑方</span></div>
            {coachRows.map((row, rowIndex) => <div className="pv-move-row" role="row" key={`${line.multipv}-coach-${row.number}-${rowIndex}`}>
              <span>{row.number}</span>
              <span>{row.red ?? ""}</span>
              <span>{row.black ?? ""}</span>
            </div>)}
          </div>}
      </section>
    </details>}
    <details className="pv-full-line">
      <summary><ChevronDown size={13}/>完整 PV 表</summary>
      <div className="pv-table" role="table" aria-label={`候选线路 ${line.multipv}`}>
        <div className="pv-table-head" role="row"><span>回合</span><span>红方</span><span>黑方</span></div>
        {rows.map((row, rowIndex) => <div className="pv-move-row" role="row" key={`${line.multipv}-${row.number}-${rowIndex}`}>
          <span>{row.number}</span>
          <span>{row.red ?? ""}</span>
          <span>{row.black ?? ""}</span>
        </div>)}
      </div>
    </details>
    {!firstNotation && <p>暂无候选着法</p>}
  </article>;
}

import type { CSSProperties } from "react";
import { ChevronDown, Eye, Play } from "lucide-react";
import { pvMoveRows } from "./analysisView";
import type { AnalysisLine, Side } from "./platform";
import type { CandidateCoachInsight } from "./coachInsights";
import { CANDIDATE_PREVIEW_HALF_MOVES, candidatePreviewLengthText } from "./candidatePreview";

type Props = {
  color: string;
  fen: string;
  line: AnalysisLine;
  coach?: CandidateCoachInsight;
  scoreText?: string;
  sideToMove: Side;
  disabled?: boolean;
  stale?: boolean;
  onPlay(iccs: string, analyzedFen: string): void;
  onPreview(line: AnalysisLine, analyzedFen: string): void;
};

function formatNps(value?: number) {
  if (!value) return "-";
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1_000)}K`;
}

export function CandidateLine({ color, fen, line, coach, scoreText, sideToMove, disabled = false, stale = false, onPlay, onPreview }: Props) {
  const rows = pvMoveRows(line, sideToMove, fen);
  const coachFollowUp = coach?.followUp.slice(0, CANDIDATE_PREVIEW_HALF_MOVES) ?? [];
  const coachRows = coach ? pvMoveRows({ multipv: line.multipv, pv: coachFollowUp, notation: coach.usesIccs ? [] : coachFollowUp }, sideToMove, fen) : [];
  const firstNotation = line.notation?.[0] ?? line.pv[0];
  const candidateLabel = line.multipv === 1 ? "主候选" : line.multipv === 2 ? "备选比较" : "变招研究";
  const canPreview = line.pv.length > 0;
  const compactLine = (coach?.followUp?.length ? coach.followUp : line.notation?.length ? line.notation : line.pv)
    .slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
  const coachSummary = coach?.possibility ?? `${candidateLabel}：点击预览后在棋盘手动查看后续变化。`;
  return <article className={`pv-line ${stale ? "stale" : ""}`} style={{ "--pv-color": color } as CSSProperties} title={`ICCS: ${line.pv.join(" ")}`}>
    <div className="pv-card-header">
      <div className="pv-title">
        <span className="pv-rank">{line.multipv}</span>
        <div>
          <strong>候选 {line.multipv} · {firstNotation ?? "暂无着法"}</strong>
          <small>{candidateLabel} · {sideToMove}行棋{stale ? " · 旧候选" : ""}</small>
        </div>
      </div>
      <div className="pv-score-stack">
        <strong>{scoreText ?? "--"}</strong>
        <small>深度 {line.depth ?? "-"} · {((line.timeMs ?? 0) / 1000).toFixed(1)}s</small>
      </div>
    </div>
    <div className="pv-main-row">
      <div className="pv-quick-read">
        <div className="pv-meta" aria-label={`候选 ${line.multipv} 引擎信息`}>
          <span>NPS {formatNps(line.nps)}</span>
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
    {compactLine.length > 0 && <div className="pv-continuation-strip" aria-label={`候选 ${line.multipv} 10回合快览`} title={candidatePreviewLengthText(compactLine.length)}>
      <strong>10回合</strong>
      {compactLine.map((move, index) => <span key={`${line.multipv}-quick-${index}-${move}`}>{index + 1}. {move}</span>)}
      {compactLine.length < CANDIDATE_PREVIEW_HALF_MOVES && <small>{candidatePreviewLengthText(compactLine.length)}</small>}
    </div>}
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

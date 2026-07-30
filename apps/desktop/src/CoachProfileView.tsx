import { BarChart3, X } from "lucide-react";
import { calculateGameReport } from "./analysisView";
import type { GameReportDatasetDto, ReportPhase } from "./platform";

type Props = { reports: GameReportDatasetDto[]; onClose(): void };
const phases: Array<[ReportPhase, string]> = [["opening", "开局"], ["middle", "中局"], ["endgame", "残局"]];

export function CoachProfileView({ reports, onClose }: Props) {
  const games = reports.map(calculateGameReport);
  const moves = games.flatMap((game) => game.moves);
  const effective = moves.filter((move) => move.score != null);
  const average = (items: typeof effective) => items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : undefined;
  const red = effective.filter((move) => move.movedBy === "红方");
  const black = effective.filter((move) => move.movedBy === "黑方");
  const mateOpportunities = effective.filter((move) => move.missedMate).length;
  const enough = reports.length >= 3 && effective.length >= 20;
  return <div className="report-dialog-backdrop" role="presentation">
    <section className="report-dialog coach-profile-dialog" role="dialog" aria-modal="true" aria-label="AI 私教棋力档案">
      <header><div><strong>AI 私教 · 棋力档案</strong><small>仅统计本机已完成整局分析的棋谱</small></div><nav><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={17}/></button></nav></header>
      <div className="report-dialog-scroll coach-profile-content">
        {!enough && <div className="stale-report">样本不足：至少需要 3 局且 20 个有效着法，当前结果仅作趋势参考。</div>}
        <section className="report-meta-grid"><div><small>已分析对局</small><strong>{reports.length}</strong></div><div><small>有效着法</small><strong>{effective.length}</strong></div><div><small>综合准确度</small><strong>{average(effective) ?? "--"}</strong></div><div><small>漏杀机会</small><strong>{mateOpportunities}</strong></div></section>
        <section className="side-score-grid"><article className="red"><div><small>执红准确度</small></div><strong>{average(red) ?? "--"}</strong><span>有效着法 {red.length}</span></article><article className="black"><div><small>执黑准确度</small></div><strong>{average(black) ?? "--"}</strong><span>有效着法 {black.length}</span></article></section>
        <section className="phase-scores"><header><span>专项</span><span>准确度</span><span>有效着法</span></header>{phases.map(([phase, label]) => { const list = effective.filter((move) => move.phase === phase); return <div key={phase}><strong>{label}</strong><span>{average(list) ?? "--"}</span><span>{list.length}</span></div>; })}<div><strong>将杀</strong><span>{mateOpportunities ? `${Math.max(0, 100 - mateOpportunities * 10)}%` : "--"}</span><span>漏杀 {mateOpportunities}</span></div></section>
        <section className="coach-insights"><header><div><BarChart3 size={15}/><strong>专项建议</strong></div></header><p>{effective.length === 0 ? "先完成一局整局分析后，私教会生成针对性的提升建议。" : `优先提升 ${phases.map(([phase, label]) => ({ label, score: average(effective.filter((move) => move.phase === phase)) ?? 0 })).sort((a, b) => a.score - b.score)[0]?.label ?? "基础"} 阶段；复盘低质量着法并用候选线路复走。`}</p></section>
      </div>
    </section>
  </div>;
}

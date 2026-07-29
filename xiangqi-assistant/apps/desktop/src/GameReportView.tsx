import { useEffect, useMemo, useRef } from "react";
import { Activity, Download, GitFork, X } from "lucide-react";
import { CoachRadar } from "./CoachRadar";
import type { GameReportPresentationDto, QualityGrade, ReportPhase } from "./platform";

const phaseLabels: Record<ReportPhase, string> = { opening: "开局", middle: "中局", endgame: "残局" };

function GradeBadge({ grade, missedMate = false }: { grade?: QualityGrade; missedMate?: boolean }) {
  if (!grade) return <span className="quality-grade empty">--</span>;
  return <span className={`quality-grade grade-${grade}`}>{grade}{missedMate && <em>漏杀</em>}</span>;
}

function signedPawnScore(scoreCp: number) {
  const score = (scoreCp / 100).toFixed(2);
  return scoreCp > 0 ? `+${score}` : score;
}

function ReportTrend({ report }: { report: GameReportPresentationDto }) {
  const geometry = useMemo(() => {
    if (report.trend.length === 0) return undefined;
    const width = 760;
    const height = 180;
    const values = report.trend.map((sample) => Math.max(-1000, Math.min(1000, sample.scoreCp)));
    const points = values.map((value, index) => ({
      ...report.trend[index],
      x: report.trend.length === 1 ? width / 2 : index * width / (report.trend.length - 1),
      y: height / 2 - value / 1000 * (height / 2 - 12),
    }));
    return { width, height, points, path: points.map((point) => `${point.x},${point.y}`).join(" ") };
  }, [report.trend]);
  if (!geometry) return <div className="report-trend-empty">暂无可绘制的局势数据</div>;
  return <section className="report-trend" aria-labelledby="report-trend-title">
    <header><strong id="report-trend-title">局势走势</strong><small>红方视角 · +10.00 至 -10.00</small></header>
    <svg viewBox={`-10 -10 ${geometry.width + 20} ${geometry.height + 20}`} role="img" aria-label="整局局势分数走势图">
      <line className="trend-zero" x1="0" y1={geometry.height / 2} x2={geometry.width} y2={geometry.height / 2}/>
      <polyline points={geometry.path}/>
      {geometry.points.map((point, index) => <circle key={`${point.nodeId ?? "root"}-${index}`} cx={point.x} cy={point.y} r="4"><title>{point.label}：{(point.scoreCp / 100).toFixed(2)}</title></circle>)}
    </svg>
  </section>;
}

export type GameReportViewProps = {
  report: GameReportPresentationDto;
  currentNode?: string;
  disabled?: boolean;
  onNavigate(nodeId: string): void;
  onStudy(nodeId: string): void;
};

export function GameReportView({ report, currentNode, disabled = false, onNavigate, onStudy }: GameReportViewProps) {
  return <div className="game-report-document">
    {report.stale && <div className="stale-report">线路已变化，此报告已过期</div>}
    <div className="side-score-grid">
      {([report.red, report.black] as const).map((side) => <article className={side.side === "红方" ? "red" : "black"} key={side.side}>
        <div><small>{side.side}综合评分</small><GradeBadge grade={side.grade}/></div>
        <strong>{side.overall ?? "--"}</strong>
        <span>优 {side.counts.excellent} · 良 {side.counts.good} · 中 {side.counts.average}</span>
        <span>差 {side.counts.poor} · 错 {side.counts.error}{side.counts.missedMate ? ` · 漏杀 ${side.counts.missedMate}` : ""}</span>
      </article>)}
    </div>
    <section className="coach-summary-grid">
      {([report.red, report.black] as const).map((side) => <article className={side.side === "红方" ? "red" : "black"} key={side.side}>
        <header><strong>{side.side}私教总结</strong><GradeBadge grade={side.coachQuality === "样本不足" ? undefined : side.coachQuality}/></header>
        <p>{side.coachSummary}</p>
      </article>)}
    </section>
    <CoachRadar red={report.red} black={report.black}/>
    <ReportTrend report={report}/>
    <section className="phase-scores">
      <header><span>阶段</span><span>红方</span><span>黑方</span></header>
      {(["opening", "middle", "endgame"] as const).map((phase) => <div key={phase}>
        <strong>{phaseLabels[phase]}</strong>
        <span>{report.red.phases[phase] ?? "--"}<GradeBadge grade={report.red.phaseGrades[phase]}/></span>
        <span>{report.black.phases[phase] ?? "--"}<GradeBadge grade={report.black.phaseGrades[phase]}/></span>
      </div>)}
    </section>
    <section className="report-issues">
      <header><strong>关键问题着法</strong><span>{report.issues.length}</span></header>
      {report.issues.length === 0
        ? <p>当前线路没有达到“差”或“错”的着法。</p>
        : report.issues.map((move, index) => <div key={move.nodeId} className={`report-issue-row ${currentNode === move.nodeId ? "active" : ""}`}>
          <button className="report-issue-location" aria-label={`定位${move.notation}`} disabled={disabled} onClick={() => onNavigate(move.nodeId)}>
            <span>{index + 1}</span><i className={move.movedBy === "红方" ? "red" : "black"}/><strong>{move.notation}</strong>
            <span className="report-issue-score"><small>局面 {signedPawnScore(move.redScoreCp)} · 变化 {signedPawnScore(move.deltaCp)}</small><em>{move.movedBy}损失 {move.lossCp}cp · 质量 {move.score}分</em></span>
            <GradeBadge grade={move.grade} missedMate={move.missedMate}/>
          </button>
          <button className="coach-study-action" disabled={disabled} title={`回到 ${move.notation} 之前推演`} onClick={() => onStudy(move.nodeId)}><GitFork size={13}/>推演</button>
        </div>)}
    </section>
    <section className="score-standards">
      <header><strong>评分标准</strong><small>质量分与五档等级的统一对应关系</small></header>
      <div className="quality-standard-table" role="table" aria-label="质量评分等级">
        {report.standards.map((standard) => <div role="row" key={standard.grade}><GradeBadge grade={standard.grade}/><strong>{standard.qualityRange}</strong><span>{standard.description}</span></div>)}
      </div>
      <div className="score-standard-notes">
        <p><strong>局面分：</strong>Pikafish 的 centipawn（cp）优劣值，正数表示红方占优，负数表示黑方占优。</p>
        <p><strong>质量分：</strong>该着相对引擎评价造成的局面损失折算为 0-100 分；综合分是一方所有有效着法质量分的平均值。</p>
        <p>{report.disclaimer}</p>
      </div>
    </section>
  </div>;
}

type DialogProps = GameReportViewProps & {
  exporting: boolean;
  onClose(): void;
  onExport(): void;
  onRegenerate(): void;
};

export function GameReportDialog({ report, exporting, onClose, onExport, onRegenerate, onNavigate, onStudy, currentNode }: DialogProps) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const exportingRef = useRef(exporting);
  onCloseRef.current = onClose;
  exportingRef.current = exporting;
  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exportingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", keydown);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", keydown);
      previouslyFocused.current?.focus();
    };
  }, []);

  const navigate = (nodeId: string) => { onClose(); onNavigate(nodeId); };
  const study = (nodeId: string) => { onClose(); onStudy(nodeId); };
  return <div className="report-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) onClose(); }}>
    <section ref={dialogRef} className="report-dialog" role="dialog" aria-modal="true" aria-label={`${report.title}整局分析报告`} aria-busy={exporting} tabIndex={-1}>
      <header>
        <div><strong>{report.title}</strong><small>整局分析报告 · {new Date(report.generatedAt).toLocaleString()}</small></div>
        <nav aria-label="报告操作">
          <button disabled={exporting} onClick={onRegenerate}><Activity size={15}/>重新分析</button>
          <button className="primary" disabled={exporting} onClick={onExport}><Download size={15}/>{exporting ? "正在导出" : "导出 PDF"}</button>
          <button className="icon-button" aria-label="关闭报告" disabled={exporting} onClick={onClose}><X size={17}/></button>
        </nav>
      </header>
      <div className="report-dialog-scroll"><GameReportView report={report} currentNode={currentNode} disabled={exporting} onNavigate={navigate} onStudy={study}/></div>
    </section>
  </div>;
}

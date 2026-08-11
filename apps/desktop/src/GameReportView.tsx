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
  const score = Math.round(scoreCp);
  return score > 0 ? `+${score}` : `${score}`;
}

function styleRankText(rank?: number) {
  return rank ? `MultiPV 第 ${rank}` : "未进入 MultiPV";
}

function styleSourceText(hint: NonNullable<GameReportPresentationDto["issues"][number]["masterStyleHints"]>[number]) {
  return [hint.eventName, hint.gameDate, `第 ${hint.ply} 手`].filter(Boolean).join(" · ");
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
    const lines = points.slice(1).flatMap((point, index) => {
      const prev = points[index];
      const prevValue = prev.scoreCp;
      const nextValue = point.scoreCp;
      if ((prevValue >= 0 && nextValue >= 0) || (prevValue <= 0 && nextValue <= 0)) {
        return [{ from: prev, to: point, side: prevValue >= 0 || nextValue >= 0 ? "red" : "black" }];
      }
      const ratio = Math.abs(prevValue) / (Math.abs(prevValue) + Math.abs(nextValue));
      const zero = {
        ...point,
        x: prev.x + (point.x - prev.x) * ratio,
        y: height / 2,
        scoreCp: 0,
      };
      return [
        { from: prev, to: zero, side: prevValue > 0 ? "red" : "black" },
        { from: zero, to: point, side: nextValue > 0 ? "red" : "black" },
      ];
    });
    const ticks = [
      { label: "+1000", value: 1000 },
      { label: "+500", value: 500 },
      { label: "0", value: 0 },
      { label: "-500", value: -500 },
      { label: "-1000", value: -1000 },
    ].map((tick) => ({
      ...tick,
      y: height / 2 - tick.value / 1000 * (height / 2 - 12),
    }));
    return { width, height, points, lines, ticks };
  }, [report.trend]);
  if (!geometry) return <div className="report-trend-empty">暂无可绘制的局势数据</div>;
  return <section className="report-trend" aria-labelledby="report-trend-title">
    <header><strong id="report-trend-title">局势走势</strong><small>红方视角 · 原始 cp · ±50 为均势区</small></header>
    <svg viewBox={`-10 -10 ${geometry.width + 20} ${geometry.height + 20}`} role="img" aria-label="整局局势分数走势图">
      <rect className="trend-equal-band" x="0" y={geometry.height / 2 - 4.2} width={geometry.width} height="8.4"/>
      {geometry.ticks.map((tick) => <g key={tick.label}>
        <line className={`trend-grid-line ${tick.value === 0 ? "zero-tick" : ""}`} x1="0" y1={tick.y} x2={geometry.width} y2={tick.y}/>
        <text x="4" y={tick.y - 3}>{tick.label}</text>
      </g>)}
      <line className="trend-zero" x1="0" y1={geometry.height / 2} x2={geometry.width} y2={geometry.height / 2}/>
      {geometry.lines.map((line, index) => <line key={index} className={`trend-segment ${line.side}`} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y}/>)}
      {geometry.points.map((point, index) => <circle key={`${point.nodeId ?? "root"}-${index}`} cx={point.x} cy={point.y} r="4"><title>{point.label}：{signedPawnScore(point.scoreCp)}</title></circle>)}
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
  const recommendationLabel = report.analysisDepth ? `深度${report.analysisDepth}推荐` : "AI推荐";
  return <div className="game-report-document">
    {report.stale && <div className="stale-report">线路已变化，此报告已过期</div>}
    <section className="report-meta-grid">
      <div><small>复盘档位</small><strong>{report.analysisDepth ? `深度 ${report.analysisDepth} · 强大师参考` : "旧版分析配置"}</strong></div>
      <div><small>引擎</small><strong>{report.engineLabel}</strong></div>
      <div><small>总耗时</small><strong>{(report.totalElapsedMs / 1000).toFixed(1)}s</strong></div>
      <div><small>缓存</small><strong>{report.cachedPositions}</strong></div>
      <div><small>开局识别</small><strong>{report.openingSummary?.name ?? "未命中"}</strong></div>
      <div><small>官着</small><strong>{report.openingSummary?.officialMoves ?? 0}</strong></div>
    </section>
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
    <section className="coach-insights">
      <header>
        <div><strong>私教建议与变招命名</strong><small>{report.coachInsights.branchName}</small></div>
        <span>规则型 AI 讲解</span>
      </header>
      <p>{report.coachInsights.branchPurpose}</p>
      <div className="coach-insight-columns">
        <article>
          <strong>布局弱点与解决方案</strong>
          <ul>{report.coachInsights.weaknessFixes.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article>
          <strong>多分支复盘方法</strong>
          <ul>{report.coachInsights.studyPlan.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
      </div>
      <details>
        <summary>分支/分表命名建议</summary>
        <ul>{report.coachInsights.namingTips.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
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
            <span className="report-issue-score"><small>局面 {signedPawnScore(move.redScoreCp)} · 变化 {signedPawnScore(move.deltaCp)}{move.opening ? ` · 官着 ${move.opening.name}` : ""}</small><em>{move.movedBy}损失 {move.lossCp}cp · 质量 {move.score}分{move.bestNotation ? ` · ${recommendationLabel} ${move.bestNotation}` : ""}</em></span>
            <GradeBadge grade={move.grade} missedMate={move.missedMate}/>
          </button>
          <button className="coach-study-action" disabled={disabled} title={`回到 ${move.notation} 之前推演`} onClick={() => onStudy(move.nodeId)}><GitFork size={13}/>推演</button>
          <div className="report-issue-coach">
            <p><strong>目的</strong>{move.coach.intent}</p>
            <p><strong>弱点</strong>{move.coach.weakness}</p>
            <p><strong>方案</strong>{move.coach.solution}</p>
          </div>
          {!!move.masterStyleHints?.length && <div className="report-issue-master-style">
            <strong>赵鑫鑫风格启发</strong>
            {move.masterStyleHints.slice(0, 2).map((hint) => <article key={hint.sampleId}>
              <header>
                <span>{hint.confidence === "exact" ? "相同局面" : "相似参考"}</span>
                <em>{hint.playerName}公开棋谱曾走 {hint.playedMove} · {styleRankText(hint.playedMoveRank)}</em>
              </header>
              <p>{hint.reason}；{styleSourceText(hint) || hint.sourceTitle}</p>
              {!!hint.theoryCards.length && <ul>
                {hint.theoryCards.slice(0, 2).map((card) => <li key={card.id}>棋理依据：{card.title}{card.sourceBook ? `（${card.sourceBook}${card.sourcePageStart ? ` p.${card.sourcePageStart}` : ""}）` : ""}</li>)}
              </ul>}
            </article>)}
          </div>}
        </div>)}
    </section>
    <section className="score-standards">
      <header><strong>评分标准</strong><small>质量分与五档等级的统一对应关系</small></header>
      <div className="quality-standard-table" role="table" aria-label="质量评分等级">
        {report.standards.map((standard) => <div role="row" key={standard.grade}><GradeBadge grade={standard.grade}/><strong>{standard.qualityRange}</strong><span>{standard.description}</span></div>)}
      </div>
      <div className="score-standard-notes">
        <p><strong>局面分：</strong>Pikafish 的 centipawn（cp）优劣值，正数表示红方占优，负数表示黑方占优。</p>
        <p><strong>换算参考：</strong>{report.scoreGuide.map((item) => `${item.scoreCp}≈${item.label}`).join("；")}。</p>
        <p><strong>官着：</strong>开局阶段的人类经典布局着法，本应用只标记名称与来源，不改变 Pikafish 质量分。</p>
        <p><strong>质量分：</strong>该着相对引擎评价造成的局面损失折算为 0-100 分；与首选分差在 50cp 以内视为计算误差，按 100 分处理。综合分是一方所有有效着法质量分的平均值。</p>
        <p><strong>100分：</strong>表示在当前分析深度下几乎没有局面损失，可视为本应用定义的“特级大师级准确度”，不代表官方棋力认证。</p>
        <p><strong>复盘档位：</strong>深度 24 可作为更稳健的强大师参考；实际效果受 Pikafish 版本、NNUE、线程和机器性能影响。</p>
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

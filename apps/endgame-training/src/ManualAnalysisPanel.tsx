import { RefreshCw } from "lucide-react";
import { moveNotationLabel } from "./moveNotation";
import type { ManualAiMode } from "./manualAiMode";

type Candidate = {
  multipv: number; pv: string[]; notation: string[]; depth: number;
  scoreLabel: string; metricsLabel: string;
};

export function ManualAnalysisPanel({ mode, lines, pending, suspended, terminal, error, activeIndex, multiPv, moveTimeSec, onSelect, onPreview, onMultiPvChange, onMoveTimeChange, onRefresh }: {
  mode: ManualAiMode; lines: Candidate[]; pending: boolean; suspended: boolean;
  terminal: boolean; error?: string; activeIndex: number; multiPv: number; moveTimeSec: number;
  onSelect(index: number): void; onPreview(index: number): void;
  onMultiPvChange(value: number): void; onMoveTimeChange(value: number): void; onRefresh(): void;
}) {
  return <section className="manual-engine-panel" aria-label="录谱引擎分析" aria-busy={pending}>
    <div className="manual-engine-settings">
      <label>候选<select aria-label="候选数量" value={multiPv} onChange={event => onMultiPvChange(Number(event.target.value))}>{[1,2,3,4].map(value => <option key={value} value={value}>{value} 条</option>)}</select></label>
      <label>用时<select aria-label="分析用时" value={moveTimeSec} onChange={event => onMoveTimeChange(Number(event.target.value))}>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label>
      <button type="button" aria-label="重新分析当前局面" disabled={mode === "disabled" || terminal || suspended || pending} onClick={onRefresh}><RefreshCw/>重算</button>
    </div>
    <div className="manual-engine-lines">
      {mode === "disabled" ? <p className="manual-engine-message">AI 已禁用，点击底部 AI 按钮开启局势分析。</p>
        : terminal ? <p className="manual-engine-message">当前棋局已结束。</p>
        : error ? <p className="manual-engine-message" role="alert">{error}<button type="button" disabled={suspended} onClick={onRefresh}>重试</button></p>
        : suspended ? <p className="manual-engine-message">当前分析已暂停，返回后继续。</p>
        : mode === "evaluation" ? <p className="manual-engine-message">仅显示局势与计算信息，切换为 AI 提示可查看推荐走法。</p>
        : pending ? <p className="manual-engine-message">正在分析当前局面…</p>
        : !lines.length ? <p className="manual-engine-message">当前局面暂无候选走法。</p>
        : lines.slice(0, multiPv).map((line, index) => <div className="manual-engine-candidate" key={`${line.multipv}:${line.pv[0]}`}>
          <button type="button" className={`analysis-candidate-select ${activeIndex === index ? "active" : ""}`} aria-pressed={activeIndex === index} aria-label={`候选 ${index + 1}：${moveNotationLabel(line.notation[0])}`} onClick={() => onSelect(index)}>
            <span className="manual-candidate-score"><b>{index + 1}</b><em>{line.scoreLabel}</em><small>深度 {line.depth}</small></span>
            <span className="manual-candidate-line"><strong>{moveNotationLabel(line.notation[0])}</strong><span>{line.notation.slice(1).map(moveNotationLabel).join(" ")}</span><small>{line.metricsLabel}</small></span>
          </button>
          <button type="button" className="manual-candidate-preview" disabled={!line.pv.length} onClick={() => onPreview(index)}>小棋盘</button>
        </div>)}
    </div>
  </section>;
}

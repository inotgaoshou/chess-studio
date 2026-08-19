import { Activity, BookOpen, ChevronDown, ClipboardList, Database, Eye, Play, Route } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CompactBookRow, CompactEngineAnalysisRow } from "./CompactWorkspace";

type Props = {
  analysisBusy: boolean;
  analysisStale: boolean;
  analysisDisabled: boolean;
  analysisConfigText: string;
  analysisHint?: string;
  engineRows: CompactEngineAnalysisRow[];
  bookRows: CompactBookRow[];
  bookLoading: boolean;
  bookError?: string;
  bookSideToMove?: "红方" | "黑方";
  manual: ReactNode;
  onRunAnalysis(): void;
  onFocusCandidate(row: CompactEngineAnalysisRow): void;
  onPreviewCandidate(row: CompactEngineAnalysisRow): void;
  onPlayCandidate(row: CompactEngineAnalysisRow): void;
  onFocusBookMove(iccs: string): void;
  onPlayBookMove(iccs: string): void;
};

export function MobileStudyPanel({
  analysisBusy,
  analysisStale,
  analysisDisabled,
  analysisConfigText,
  analysisHint,
  engineRows,
  bookRows,
  bookLoading,
  bookError,
  bookSideToMove = "红方",
  manual,
  onRunAnalysis,
  onFocusCandidate,
  onPreviewCandidate,
  onPlayCandidate,
  onFocusBookMove,
  onPlayBookMove,
}: Props) {
  const [tab, setTab] = useState<"engine" | "book" | "manual">("engine");
  const tabIds = ["engine", "book", "manual"] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : event.key === "Home" ? -current
          : event.key === "End" ? tabIds.length - 1 - current
            : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (current + direction + tabIds.length) % tabIds.length;
    setTab(tabIds[next]);
    tabRefs.current[next]?.focus();
  }
  return <section className="mobile-study-panel" aria-label="移动端研究面板">
    <div className="mobile-study-tabs" role="tablist" aria-label="移动端研究页签">
      {([
        ["engine", "引擎", Activity],
        ["book", "云库", Database],
        ["manual", "棋谱", ClipboardList],
      ] as const).map(([id, label, Icon], index) => <button
        key={id}
        ref={(element) => { tabRefs.current[index] = element; }}
        type="button"
        role="tab"
        id={`mobile-study-tab-${id}`}
        aria-controls={`mobile-study-panel-${id}`}
        aria-selected={tab === id}
        tabIndex={tab === id ? 0 : -1}
        className={tab === id ? "active" : ""}
        onClick={() => setTab(id)}
        onKeyDown={(event) => moveTab(event, index)}
      ><Icon size={15}/>{label}</button>)}
    </div>

    {tab === "engine" && <div id="mobile-study-panel-engine" aria-labelledby="mobile-study-tab-engine" className="mobile-study-content mobile-engine-content" role="tabpanel">
      <header>
        <span><Activity size={15}/><strong>{analysisBusy ? "Pikafish 正在计算" : analysisStale ? "候选更新中" : "引擎推荐"}</strong><small>{analysisConfigText}</small></span>
        <button type="button" disabled={!analysisBusy && analysisDisabled} onClick={onRunAnalysis}>{analysisBusy ? "停止" : "分析"}</button>
      </header>
      {engineRows.length ? engineRows.slice(0, 4).map((row) => {
        const notation = row.line?.notation?.[0] ?? row.iccs ?? "等待着法";
        const moves = row.line?.notation?.length ? row.line.notation : row.line?.pv ?? [];
        const continuation = moves.slice(1).join(" ");
        const canPreview = !!row.line?.pv.length && !row.disabled;
        const disabled = row.disabled || !row.iccs;
        return <article key={row.id} className={`mobile-study-engine-row ${row.previewActive ? "active" : ""}`}>
          <button type="button" className="mobile-study-engine-main" disabled={disabled} onClick={() => onFocusCandidate(row)} title="在棋盘上显示这条候选 PV 走子路线">
            <b>{row.rank}</b>
            <span>
              <strong>{notation}</strong>
              <small>深 {row.depthText} · 红分 {row.scoreText} · {row.timeText} · NPS {row.npsText}</small>
              <em>{row.sourceText ?? "云端 Pikafish"}{row.stale ? " · 候选已过期" : ""}</em>
            </span>
          </button>
          <div className="mobile-study-engine-actions">
            <button type="button" className="mobile-study-preview" aria-label={row.previewActive ? `取消预览候选 ${row.rank}` : `预览候选 ${row.rank}`} title={row.previewActive ? "取消候选线路预览" : "在棋盘上推演这条候选线路"} disabled={!canPreview} onClick={() => onPreviewCandidate(row)}><Eye size={15}/></button>
            <button type="button" className="mobile-study-adopt" aria-label={`采用候选 ${row.rank}`} title="采用这条候选的第一着" disabled={disabled} onClick={() => onPlayCandidate(row)}><Play size={15}/></button>
          </div>
          {continuation && <details className="mobile-study-pv" onToggle={(event) => { if (event.currentTarget.open) onFocusCandidate(row); }}>
            <summary><ChevronDown size={13}/>后续 PV <span>{moves.length} 步</span></summary>
            <p>{continuation}</p>
          </details>}
        </article>;
      }) : <div className="mobile-study-empty"><Activity size={21}/><span>{analysisBusy ? "正在搜索推荐着法…" : analysisHint ?? "点击分析，候选着法会显示为棋盘连线。"}</span></div>}
    </div>}

    {tab === "book" && <div id="mobile-study-panel-book" aria-labelledby="mobile-study-tab-book" className="mobile-study-content mobile-book-content" role="tabpanel">
      <div className="mobile-study-book-head"><span>着法</span><span>胜/和/负</span><span>{bookSideToMove}评分</span></div>
      {bookRows.map((row) => <button key={row.id} type="button" className="mobile-study-book-row" onClick={() => onPlayBookMove(row.iccs)}>
        <strong>{row.notation}</strong><span>{`胜率 ${row.winRateText}`}</span><span>{row.scoreText}</span>
      </button>)}
      {!bookLoading && bookRows.length === 0 && <div className="mobile-study-empty"><Database size={21}/><span>{bookError ?? "当前局面暂无云库着法。"}</span></div>}
    </div>}

    <div id="mobile-study-panel-manual" aria-labelledby="mobile-study-tab-manual" className="mobile-study-content mobile-manual-content" role="tabpanel" hidden={tab !== "manual"}>
      <header><span><ClipboardList size={15}/><strong>棋谱与变例</strong></span><Route size={15}/></header>
      {manual}
    </div>
  </section>;
}

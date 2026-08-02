import { ChevronDown, ChevronRight, Copy, Download, GitBranch, ListStart, MessageSquare, Sparkles, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildBranchComparisonModel,
  buildManualBranchTreeModel,
  sideClass,
  type ManualBranchTreeRow,
  type ManualViewMode,
  type MoveQuality,
} from "./manualTrackModel";
import type { ManualTreeNode, MoveItem, PreviewLineStep } from "./platform";
import { CANDIDATE_PREVIEW_HALF_MOVES } from "./candidatePreview";

type Props = {
  nodes: ManualTreeNode[];
  history: MoveItem[];
  currentNode?: string;
  viewMode: ManualViewMode;
  editing: boolean;
  qualityByMoveId: ReadonlyMap<string, MoveQuality>;
  formatScore(move: MoveItem): string;
  onNavigate(nodeId?: string): void;
  onViewModeChange(mode: ManualViewMode): void;
  onMakeMainline(nodeId: string): void;
  onRemove(nodeId: string): void;
  onExportLine?(contents: string): Promise<string | undefined>;
  previewBranch?: ManualPreviewBranch;
  previewBranches?: ManualPreviewBranch[];
};

export type ManualPreviewBranch = {
  sourceEngineName?: string;
  engineNames?: string[];
  scoreTexts?: string[];
  merged?: boolean;
  label?: string;
  rank: number;
  firstMove: string;
  activeStep: number;
  steps: PreviewLineStep[];
};

type ManualLineScoreOptions = {
  qualityByMoveId?: ReadonlyMap<string, MoveQuality>;
  formatScore?: (move: MoveItem) => string;
};

type ManualLineMove = {
  move: MoveItem;
  score: string;
  quality?: MoveQuality;
};

type ManualLineRow = {
  turn: number;
  red?: ManualLineMove;
  black?: ManualLineMove;
};

function scoreForLineMove(move: MoveItem, options: ManualLineScoreOptions) {
  const quality = options.qualityByMoveId?.get(move.id);
  if (quality?.score != null) return `${quality.grade ?? ""}${quality.score}分`;
  return options.formatScore?.(move) || "暂无评分";
}

export function buildHistoryLineRows(history: MoveItem[], options: ManualLineScoreOptions = {}) {
  const rows: ManualLineRow[] = [];
  for (let index = 0; index < history.length; index += 2) {
    const red = history[index];
    const black = history[index + 1];
    rows.push({
      turn: Math.floor(index / 2) + 1,
      red: red ? { move: red, quality: options.qualityByMoveId?.get(red.id), score: scoreForLineMove(red, options) } : undefined,
      black: black ? { move: black, quality: options.qualityByMoveId?.get(black.id), score: scoreForLineMove(black, options) } : undefined,
    });
  }
  return rows;
}

function formatLineMoveText(item?: ManualLineMove) {
  if (!item) return "";
  return `${item.move.notation}${item.score ? `（${item.score}）` : ""}`;
}

export function formatHistoryLine(history: MoveItem[], options: ManualLineScoreOptions = {}) {
  return buildHistoryLineRows(history, options).map((row) => `${row.turn}. ${formatLineMoveText(row.red)}${row.black ? `  ${formatLineMoveText(row.black)}` : ""}`.trim());
}

function downloadManualLineText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return filename;
}

export function ManualLineDialog({ history, currentLabel, qualityByMoveId, formatScore, onClose, onExportLine }: {
  history: MoveItem[];
  currentLabel?: string;
  qualityByMoveId?: ReadonlyMap<string, MoveQuality>;
  formatScore?: (move: MoveItem) => string;
  onClose(): void;
  onExportLine?(contents: string): Promise<string | undefined>;
}) {
  const [exporting, setExporting] = useState(false);
  const rows = buildHistoryLineRows(history, { qualityByMoveId, formatScore });
  const lines = formatHistoryLine(history, { qualityByMoveId, formatScore });
  const text = [
    "从开始到当前局面",
    currentLabel ? `当前：${currentLabel} · 第 ${history.length} 着` : `共 ${history.length} 着`,
    "",
    ...lines,
  ].join("\n").trim();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  async function copy() {
    await navigator.clipboard?.writeText(text);
  }
  async function exportText() {
    if (!text || exporting) return;
    setExporting(true);
    try {
      if (onExportLine) {
        await onExportLine(text);
      } else if (typeof document !== "undefined") {
        downloadManualLineText("当前局面完整棋谱.txt", text);
      }
    } finally {
      setExporting(false);
    }
  }
  const dialog = <div className="manual-line-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="manual-line-dialog" role="dialog" aria-modal="true" aria-label="当前局面完整棋谱">
      <header>
        <div><strong>从开始到当前局面</strong><small>{currentLabel ? `当前：${currentLabel} · 第 ${history.length} 着` : `共 ${history.length} 着`}</small></div>
        <nav>
          <button type="button" disabled={!text} onClick={() => void copy()}><Copy size={14}/>复制</button>
          <button type="button" className="manual-line-download" title="下载当前棋谱文本" disabled={!text || exporting} onClick={() => void exportText()}><Download size={14}/>{exporting ? "下载中" : "下载"}</button>
          <button type="button" className="manual-line-close" onClick={onClose} aria-label="关闭完整棋谱"><X size={15}/>关闭</button>
        </nav>
      </header>
      <div className="manual-line-dialog-body">
        {rows.length === 0
          ? <p>当前还在开始局面，暂无历史着法。</p>
          : <ol>
            {rows.map((row) => <li key={row.turn} className="manual-line-row">
              <span className="manual-line-turn">{row.turn}.</span>
              <span className="manual-line-side red">红</span>
              {row.red
                ? <span className="manual-line-move"><strong>{row.red.move.notation}</strong><em className={row.red.quality?.grade ? `grade-${row.red.quality.grade}` : ""}>{row.red.score}</em></span>
                : <span className="manual-line-move empty">--</span>}
              <span className="manual-line-side black">黑</span>
              {row.black
                ? <span className="manual-line-move"><strong>{row.black.move.notation}</strong><em className={row.black.quality?.grade ? `grade-${row.black.quality.grade}` : ""}>{row.black.score}</em></span>
                : <span className="manual-line-move empty">--</span>}
            </li>)}
          </ol>}
      </div>
    </section>
  </div>;
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

function BranchTreeRow({ row, editing, onNavigate, onMakeMainline, onRemove, onToggleFork, onCompare }: {
  row: ManualBranchTreeRow;
  editing: boolean;
  onNavigate(nodeId: string): void;
  onMakeMainline(nodeId: string): void;
  onRemove(nodeId: string): void;
  onToggleFork(nodeId: string, expanded: boolean): void;
  onCompare(forkNodeId: string, branchId: string): void;
}) {
  const meta = [
    row.quality?.grade && row.quality.score != null ? `${row.quality.grade}${row.quality.score}` : undefined,
    !row.quality?.grade && row.score ? row.score : undefined,
    row.mainline ? "主线" : "分支",
    row.engineSource ? `对比 ${row.engineSource}` : undefined,
    row.move.comment ? "有注释" : undefined,
  ].filter(Boolean);

  return <div
    className={[
      "manual-branch-tree-row",
      row.active ? "active" : "",
      row.onRoute ? "on-route" : "",
      row.dimmed ? "dimmed" : "",
      row.mainline ? "mainline" : "variation",
    ].filter(Boolean).join(" ")}
    data-node-id={row.nodeId}
    data-current-node={row.active ? "true" : undefined}
    data-depth={row.depth}
  >
    <span className="manual-branch-tree-turn" title={`第 ${row.fullmove} 回合，第 ${row.ply + 1} 个半回合`}>
      {row.move.movedBy === "红方" ? `${row.fullmove}.` : "…"}
    </span>
    <span className="manual-branch-tree-gutter" aria-hidden="true" style={{ "--depth": row.depth } as CSSProperties}>
      {Array.from({ length: row.depth }, (_, index) => <i key={index} className={row.ancestorContinues[index] ? "continues" : ""}/>)}
      <em className={row.isLastSibling ? "last" : "mid"}/>
      <b className={sideClass(row.move.movedBy)}/>
    </span>
    <div className="manual-branch-tree-content">
      <div className="manual-branch-tree-main">
        {row.expandable
          ? <button
            type="button"
            className="manual-branch-toggle"
            onClick={() => onToggleFork(row.nodeId, row.expanded)}
            title={row.expanded ? `收起 ${row.branchCount} 条变化` : `展开 ${row.branchCount} 条变化`}
            aria-label={row.expanded ? `收起 ${row.branchCount} 条变化` : `展开 ${row.branchCount} 条变化`}
          >
            {row.expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
            <span>{row.expanded ? "▼" : "▶"} {row.branchCount}条变化</span>
          </button>
          : <span className="manual-branch-toggle placeholder" aria-hidden="true"/>}
        <button
          type="button"
          className="manual-branch-move"
          onClick={() => onNavigate(row.nodeId)}
          title={`${row.move.movedBy} · ${row.label} · ${row.score || "暂无评分"}`}
        >
          <strong>{row.label}</strong>
        </button>
        {row.quality?.grade && <em className={`move-quality-mini grade-${row.quality.grade}`}>{row.quality.grade}</em>}
        {row.move.comment && <MessageSquare className="comment-marker" size={12}/>}
        {row.active && <em className="manual-current-node-badge">当前局面</em>}
      </div>
      <div className="manual-branch-tree-meta">
        {meta.map((item) => <span key={item}>{item}</span>)}
        {row.hiddenBranchCount > 0 && <span>另有 {row.hiddenBranchCount} 条</span>}
        {row.branchPreview.map((branch) => <button type="button" key={branch.nodeId} onClick={() => onCompare(row.nodeId, branch.nodeId)} title={`对比 ${branch.notation}`}>
          对比 {branch.notation}<small>{branch.score}</small>
        </button>)}
      </div>
      {editing && <div className="manual-branch-tree-actions">
        {!row.move.isMainline && <button type="button" title="设为主线" onClick={() => onMakeMainline(row.nodeId)}><ListStart size={12}/>主线</button>}
        <button type="button" className="danger" title="删除分支及其后续" onClick={() => onRemove(row.nodeId)}><Trash2 size={12}/>删除</button>
      </div>}
    </div>
    <span className="manual-branch-tree-score" title="评分（红方视角）">{row.score}</span>
  </div>;
}

function PreviewBranches({ previews }: { previews: ManualPreviewBranch[] }) {
  if (previews.length === 0) return null;
  return <section className="manual-preview-branch" aria-label="AI 推荐虚线预测分支" data-current-node="true">
    <header>
      <span><Sparkles size={12}/>虚线预测</span>
      <strong>{previews.length > 1 ? `AI推荐 · ${previews.length} 条引擎分支` : previews[0].label ?? `${previews[0].sourceEngineName ?? previews[0].engineNames?.join(" / ") ?? "AI"} · 候选${previews[0].rank}`}</strong>
      <em>未保存</em>
    </header>
    <div className="manual-preview-branch-root">
      <span className="manual-preview-current-dot" aria-hidden="true"/>
      <b>当前局面</b>
      <small>只显示在棋谱树，不写入 SQLite，不生成真实变招</small>
    </div>
    {previews.map((preview, previewIndex) => {
      const visibleSteps = preview.steps.slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
      const label = preview.label ?? (preview.merged
        ? `AI推荐 · ${preview.engineNames?.length ?? 1}个引擎一致`
        : `AI推荐 · ${preview.sourceEngineName ?? preview.engineNames?.join(" / ") ?? "AI"}`);
      const scoreSummary = preview.scoreTexts?.length ? preview.scoreTexts.join(" · ") : undefined;
      return <div className="manual-preview-branch-group" key={`${label}-${preview.firstMove}-${previewIndex}`}>
        <div className="manual-preview-branch-line">
          <span className="manual-preview-fork" aria-hidden="true">{previewIndex === previews.length - 1 ? "└──" : "├──"}</span>
          <div className="manual-preview-ai-label">
            <strong>{label}</strong>
            <small>{scoreSummary ? `首着 ${preview.firstMove} · ${scoreSummary}` : `首着 ${preview.firstMove}`}</small>
          </div>
        </div>
        <ol className="manual-preview-branch-steps">
          {visibleSteps.map((step, index) => <li
            className={index === preview.activeStep ? "active" : ""}
            key={`${step.notation}-${index}`}
          >
            <span className={`manual-preview-side-dot ${step.movedBy === "红方" ? "red" : "black"}`} aria-hidden="true"/>
            <b>{index + 1}.</b>
            <strong>{step.notation}</strong>
            <small>{step.movedBy.replace("方", "")} · {step.status}</small>
          </li>)}
        </ol>
      </div>
    })}
  </section>;
}

export function ManualTrackView({ nodes, history, currentNode, viewMode, editing, qualityByMoveId, formatScore, onNavigate, onViewModeChange, onMakeMainline, onRemove, onExportLine, previewBranch, previewBranches }: Props) {
  const [expandedForks, setExpandedForks] = useState<Set<string>>(() => new Set());
  const [collapsedForks, setCollapsedForks] = useState<Set<string>>(() => new Set());
  const [comparison, setComparison] = useState<{ forkNodeId: string; branchId: string }>();
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildManualBranchTreeModel(nodes, history, currentNode, {
    collapsed: collapsedForks,
    expanded: expandedForks,
    qualityByMoveId,
    formatScore,
    previewLimit: 3,
  }), [collapsedForks, currentNode, expandedForks, formatScore, history, nodes, qualityByMoveId]);
  const comparisonModel = comparison
    ? buildBranchComparisonModel(comparison.forkNodeId, comparison.branchId, nodes, { formatScore, qualityByMoveId })
    : undefined;
  const activePreviewBranches = previewBranches ?? (previewBranch ? [previewBranch] : []);
  const activePreviewKey = activePreviewBranches.map((preview) => `${preview.label ?? preview.sourceEngineName ?? ""}:${preview.activeStep}:${preview.steps.length}`).join("|");
  const hasActiveRow = model.rows.some((row) => row.active);

  useEffect(() => {
    const target = listRef.current?.querySelector<HTMLElement>(activePreviewBranches.length > 0 ? ".manual-preview-branch" : '[data-current-node="true"]');
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [activePreviewBranches.length, activePreviewKey, currentNode, model.rows.length]);

  function toggleFork(nodeId: string, expanded: boolean) {
    setExpandedForks((current) => {
      const next = new Set(current);
      if (expanded) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    setCollapsedForks((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return next;
    });
  }

  function compareOrExpand(forkNodeId: string, branchId: string) {
    setExpandedForks((current) => {
      const next = new Set(current);
      next.add(forkNodeId);
      return next;
    });
    setCollapsedForks((current) => {
      const next = new Set(current);
      next.delete(forkNodeId);
      return next;
    });
    setComparison({ forkNodeId, branchId });
  }

  return <div className="manual-track-view manual-branch-tree-view" aria-label="分支树棋谱">
    <header className="manual-track-toolbar">
      <button className={`manual-track-root ${!currentNode ? "active" : ""}`} type="button" onClick={() => onNavigate()}><GitBranch size={12}/>开始局面</button>
      <div className="manual-view-switch" role="tablist" aria-label="棋谱显示方式">
        <button type="button" className={viewMode === "track" ? "active" : ""} onClick={() => onViewModeChange("track")}>分支树</button>
        <button type="button" className={viewMode === "tree" ? "active" : ""} onClick={() => onViewModeChange("tree")}>传统树</button>
      </div>
      <span className="manual-branch-score-caption">评分：红方视角</span>
    </header>
    <div className="manual-track-breadcrumb" title={model.breadcrumb.join(" › ")}>
      {model.breadcrumb.length ? model.breadcrumb.map((item, index) => <span key={`${item}-${index}`}>{item}</span>) : <span>尚未走棋</span>}
    </div>
    <div className="manual-branch-tree-list" role="tree" aria-label="高级分支树棋谱" ref={listRef}>
      {model.rows.length === 0
        ? <>
          <div className="manual-track-empty">暂无棋谱，走棋后会显示主线和分支树。</div>
          {activePreviewBranches.length > 0 && <PreviewBranches previews={activePreviewBranches}/>}
        </>
        : model.rows.map((row) => <Fragment key={row.key}>
          <BranchTreeRow
            editing={editing}
            row={row}
            onCompare={compareOrExpand}
            onMakeMainline={onMakeMainline}
            onNavigate={onNavigate}
            onRemove={onRemove}
            onToggleFork={toggleFork}
          />
          {activePreviewBranches.length > 0 && row.active && <PreviewBranches previews={activePreviewBranches}/>}
        </Fragment>)}
      {activePreviewBranches.length > 0 && model.rows.length > 0 && !hasActiveRow && <PreviewBranches previews={activePreviewBranches}/>}
    </div>
    {model.current && <footer className="manual-track-current">
      <strong>当前：{model.current.move.notation}</strong>
      <span>{model.current.move.movedBy.replace("方", "")} · {model.current.score || "--"} · {model.current.mainline ? "主" : "变"}</span>
      <button type="button" className="manual-line-open" aria-label="完整棋谱" onClick={() => setLineDialogOpen(true)} disabled={history.length === 0}><span className="full">完整棋谱</span><span className="short">棋谱</span></button>
    </footer>}
    {comparisonModel && <section className="manual-branch-comparison" aria-label="分支对比">
      <header><strong>分支对比：{comparisonModel.forkLabel}</strong><button type="button" onClick={() => setComparison(undefined)}>关闭</button></header>
      <div className="manual-branch-compare-head"><span>步</span><span>主线</span><span>所选变化</span></div>
      {comparisonModel.rows.slice(0, 8).map((row) => <div className="manual-branch-compare-row" key={row.index}>
        <span>{row.index}</span>
        <button type="button" disabled={!row.mainline} onClick={() => row.mainline && onNavigate(row.mainline.nodeId)}>{row.mainline ? `${row.mainline.notation} ${row.mainline.score}` : "--"}</button>
        <button type="button" disabled={!row.variation} onClick={() => row.variation && onNavigate(row.variation.nodeId)}>{row.variation ? `${row.variation.notation} ${row.variation.score}` : "--"}</button>
      </div>)}
    </section>}
    {lineDialogOpen && <ManualLineDialog
      currentLabel={model.current?.move.notation}
      formatScore={formatScore}
      history={history}
      onClose={() => setLineDialogOpen(false)}
      onExportLine={onExportLine}
      qualityByMoveId={qualityByMoveId}
    />}
  </div>;
}

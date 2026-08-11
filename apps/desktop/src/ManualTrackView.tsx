import { BookOpen, ChevronDown, ChevronRight, Copy, Download, Image as ImageIcon, ListStart, MessageSquare, Sparkles, Swords, Trash2, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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
import { BranchSelector } from "./BranchSelector";
import { flyknifeMarker, hasReviewMarker } from "./reviewMarker";
import type { ManualTreeNode, MoveItem, PreviewLineStep } from "./platform";
import { CANDIDATE_PREVIEW_HALF_MOVES } from "./candidatePreview";
import { formatStrategyInsightText, type StrategyInsight, type TheoryPrincipleCard } from "./strategyInsights";

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
  bestMoveHint?: BestMoveHint;
  onStartBestMovePractice?(): void;
  toolbarExtra?: ReactNode;
  strategyInsight?: StrategyInsight;
  previewBranch?: ManualPreviewBranch;
  previewBranches?: ManualPreviewBranch[];
  onToggleCurrentMoveMarker?(): Promise<void> | void;
};

export type BestMoveHint = {
  bestMove?: string;
  bestMoveText?: string;
  topMoves: Array<{ iccs: string; text?: string; rank: number }>;
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

function theorySourceLabel(card: TheoryPrincipleCard) {
  if (card.source.course) {
    return `${card.source.label} · ${card.source.course} · ${card.source.episode ?? ""}${card.source.timecode ? ` · ${card.source.timecode}` : ""}`;
  }
  if (card.source.book) {
    const pages = card.source.pageStart ? ` · p.${card.source.pageStart}${card.source.pageEnd && card.source.pageEnd !== card.source.pageStart ? `-${card.source.pageEnd}` : ""}` : "";
    return `${card.source.label} · ${card.source.book}${pages}`;
  }
  return `${card.source.label} · ${card.source.review}`;
}

const strategyPhaseLabels = { opening: "开局", middle: "中局", endgame: "残局" } as const;
const strategyTabLabels = { overview: "总览", opening: "开局", middle: "中局", endgame: "残局", evidence: "依据" } as const;
const strategyCheckStatusLabels = { ok: "较稳", watch: "关注", risk: "风险" } as const;

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

export type OpeningPlan = {
  title: string;
  core: string;
  principles: string[];
  risks: string[];
  advice: string;
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

/** A readable opening outline derived from recorded moves, never an engine verdict. */
export function buildOpeningPlan(history: MoveItem[]): OpeningPlan {
  const redMoves = history.filter((move) => move.movedBy === "红方").map((move) => move.notation);
  const blackMoves = history.filter((move) => move.movedBy === "黑方").map((move) => move.notation);
  const hasCentralCannon = redMoves.includes("炮二平五");
  const hasCounterCannon = blackMoves.includes("炮8平5");
  const hasDoubleHorse = redMoves.includes("马二进三") && redMoves.includes("马八进七");
  const pawnMoves = redMoves.filter((move) => move.startsWith("兵"));
  const hasSpacePawns = pawnMoves.some((move) => move.startsWith("兵三")) || pawnMoves.some((move) => move.startsWith("兵七"));
  const hasActiveBlackRook = blackMoves.some((move) => move === "车4进7" || move === "车1平6" || /^车[14].*进[5-9]/.test(move));

  if (hasCentralCannon && hasCounterCannon) {
    return {
      title: hasDoubleHorse ? "中炮对中炮，抢先展开的主动布局" : "中炮对中炮，以中路为骨架的对攻布局",
      core: "先用中炮控制中线，再完成车马炮展开；兵线前推不是单独抢兵，而是为车马炮打开进攻线路并争取先手。",
      principles: [
        hasDoubleHorse ? "双马先出，优先解决子力协调，再决定从中路还是兵线突破。" : "先补足马、车的出动，让中炮的控制力有后续子力支援。",
        hasSpacePawns ? "三兵、七兵前进，目的是限制对方马位并形成可供车马进入的空间。" : "兵线暂未形成突破点，应避免只靠中炮单兵深入。",
        "理想联动是中炮牵制中路，车二参与横向或纵向施压，马负责前哨与战术点。",
      ],
      risks: [
        hasActiveBlackRook ? "黑方双车已有活跃反击路线，红方若只继续推兵，后方和底线可能先承受压力。" : "对攻局中不能只看自己的展开，要持续留意黑方车马对中路和底线的反击。",
        "空间优势必须转化为子力进入；没有车马炮跟进的兵线前推，会留下兵根和王翼空隙。",
      ],
      advice: "下一阶段遵循“先接住对方反击，再组织联动突破”：优先让车二参加中路或七路争夺，确认黑车的侵入路线被限制后，再用炮五、马和兵线制造连续先手。",
    };
  }

  return {
    title: "以子力展开和中心控制为先",
    core: "开局的底层逻辑是先完成子力协调、控制中心，再把空间优势转化为可持续的进攻线路。",
    principles: [
      "优先让马、车、炮各有合理位置，避免单一子力过早深入。",
      "兵线前进用于限制对方子力和打开线路，需要车马炮跟进才会形成真实攻势。",
      "进攻前先确认己方将帅安全和对方的反击子力。",
    ],
    risks: ["没有形成子力联动前，持续抢攻容易给对方留下先手反击。"],
    advice: "继续记录几回合后可结合当前分支和引擎主变，进一步判断最合适的突破一路。",
  };
}

function downloadManualLineText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadManualLineBlob(filename, blob);
  return filename;
}

function downloadManualLineBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

export function buildManualLineImageSvg(rows: ManualLineRow[], currentLabel: string | undefined, moveCount: number, strategy?: StrategyInsight) {
  const width = 1400;
  const headerHeight = 128;
  const rowHeight = 88;
  const insightHeight = strategy ? 102 : 0;
  const height = headerHeight + Math.max(1, rows.length) * rowHeight + insightHeight + 30;
  const moveCell = (item: ManualLineMove | undefined, side: "red" | "black", x: number) => {
    if (!item) return `<text x="${x}" y="50" class="empty">--</text>`;
    const score = escapeSvgText(item.score || "暂无评分");
    return `<circle cx="${x}" cy="43" r="20" class="side ${side}"/><text x="${x}" y="49" text-anchor="middle" class="side-label">${side === "red" ? "红" : "黑"}</text><text x="${x + 42}" y="49" class="move">${escapeSvgText(item.move.notation)}</text><rect x="${x + 176}" y="23" width="104" height="40" rx="20" class="score-pill"/><text x="${x + 228}" y="49" text-anchor="middle" class="score">${score}</text>`;
  };
  const body = rows.length === 0
    ? `<text x="${width / 2}" y="${headerHeight + 54}" text-anchor="middle" class="empty">当前还在开始局面，暂无历史着法。</text>`
    : rows.map((row, index) => {
      const y = headerHeight + index * rowHeight;
      return `<g transform="translate(24 ${y})"><rect width="1352" height="72" rx="12" class="row"/><text x="24" y="45" class="turn">${row.turn}.</text>${moveCell(row.red, "red", 108)}${moveCell(row.black, "black", 726)}</g>`;
    }).join("");
  const insight = strategy ? `<g transform="translate(24 ${headerHeight + Math.max(1, rows.length) * rowHeight + 4})"><rect width="1352" height="82" rx="12" class="insight"/><text x="20" y="28" class="insight-title">${escapeSvgText(`${strategy.phaseLabel}思路 · ${strategy.compact.principleTitle}`)}</text><text x="20" y="53" class="insight-text">${escapeSvgText(strategy.compact.conclusion)}</text><text x="20" y="74" class="insight-risk">风险：${escapeSvgText(strategy.compact.risk)}</text></g>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>.canvas{fill:#f6fbff}.header{fill:#f1f9ff}.title{fill:#193f62;font:700 30px 'PingFang SC','Microsoft YaHei',sans-serif}.subtitle{fill:#6f8ca3;font:500 20px 'PingFang SC','Microsoft YaHei',sans-serif}.row{fill:#f8fcff;stroke:#d6e5f2;stroke-width:2}.turn{fill:#6b89a2;font:700 22px 'PingFang SC','Microsoft YaHei',sans-serif}.move{fill:#193f62;font:700 25px 'PingFang SC','Microsoft YaHei',sans-serif}.side-label{fill:#fff;font:700 18px 'PingFang SC','Microsoft YaHei',sans-serif}.side.red{fill:#e4514d}.side.black{fill:#3269a7}.score-pill{fill:#ecfaef;stroke:#62bb86;stroke-width:2}.score{fill:#24834f;font:700 19px 'PingFang SC','Microsoft YaHei',sans-serif}.empty{fill:#94a9ba;font:500 22px 'PingFang SC','Microsoft YaHei',sans-serif}.insight{fill:#f1fbf5;stroke:#b9dfc9;stroke-width:2}.insight-title{fill:#24724a;font:700 19px 'PingFang SC','Microsoft YaHei',sans-serif}.insight-text{fill:#39566f;font:500 16px 'PingFang SC','Microsoft YaHei',sans-serif}.insight-risk{fill:#8b5d26;font:500 15px 'PingFang SC','Microsoft YaHei',sans-serif}</style><rect class="canvas" width="100%" height="100%"/><rect class="header" width="100%" height="${headerHeight}"/><text x="36" y="52" class="title">从开始到当前局面</text><text x="36" y="90" class="subtitle">${escapeSvgText(currentLabel ? `当前：${currentLabel} · 第 ${moveCount} 着` : `共 ${moveCount} 着`)}</text>${body}${insight}</svg>`;
}

export function ManualLineDialog({ history, currentLabel, currentMove, qualityByMoveId, formatScore, strategyInsight, bestMoveHint, onStartBestMovePractice, onToggleCurrentMoveMarker, onClose, onExportLine }: {
  history: MoveItem[];
  currentLabel?: string;
  currentMove?: MoveItem;
  qualityByMoveId?: ReadonlyMap<string, MoveQuality>;
  formatScore?: (move: MoveItem) => string;
  strategyInsight?: StrategyInsight;
  bestMoveHint?: BestMoveHint;
  onStartBestMovePractice?(): void;
  onToggleCurrentMoveMarker?(): Promise<void> | void;
  onClose(): void;
  onExportLine?(contents: string): Promise<string | undefined>;
}) {
  const [exporting, setExporting] = useState(false);
  const [activeView, setActiveView] = useState<"moves" | "image" | "plan">("moves");
  const [planView, setPlanView] = useState<"overview" | "opening" | "middle" | "endgame" | "evidence">("overview");
  const [bestMoveRevealed, setBestMoveRevealed] = useState(false);
  const [markerBusy, setMarkerBusy] = useState(false);
  const rows = buildHistoryLineRows(history, { qualityByMoveId, formatScore });
  const lines = formatHistoryLine(history, { qualityByMoveId, formatScore });
  const openingPlan = useMemo(() => buildOpeningPlan(history), [history]);
  const text = [
    "从开始到当前局面",
    currentLabel ? `当前：${currentLabel} · 第 ${history.length} 着` : `共 ${history.length} 着`,
    "",
    ...lines,
    "",
    strategyInsight ? formatStrategyInsightText(strategyInsight) : [
      "开局思路（根据走法自动归纳，非引擎结论）", openingPlan.title, `底层逻辑：${openingPlan.core}`,
      ...openingPlan.principles.map((item) => `- ${item}`), "风险：", ...openingPlan.risks.map((item) => `- ${item}`), `建议：${openingPlan.advice}`,
    ].join("\n"),
  ].join("\n").trim();
  const imageSvg = useMemo(() => buildManualLineImageSvg(rows, currentLabel, history.length, strategyInsight), [currentLabel, history.length, rows, strategyInsight]);
  const imageUrl = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(imageSvg)}`, [imageSvg]);
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
  function downloadImage() {
    if (!rows.length || typeof document === "undefined") return;
    downloadManualLineBlob("当前局面完整棋谱.svg", new Blob([imageSvg], { type: "image/svg+xml;charset=utf-8" }));
  }
  function startBestMovePractice() {
    onStartBestMovePractice?.();
    onClose();
  }
  async function toggleCurrentMoveMarker() {
    if (!onToggleCurrentMoveMarker || markerBusy) return;
    setMarkerBusy(true);
    try {
      await onToggleCurrentMoveMarker();
    } finally {
      setMarkerBusy(false);
    }
  }
  const bestMoveLabel = bestMoveHint?.bestMoveText || bestMoveHint?.bestMove || strategyInsight?.engine.pv[0];
  const bestMoveNeedsAnalysis = !bestMoveLabel;
  const phaseView = planView === "opening" || planView === "middle" || planView === "endgame" ? planView : undefined;
  const dialog = <div className="manual-line-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="manual-line-dialog" role="dialog" aria-modal="true" aria-label="当前局面完整棋谱">
      <header>
        <div><strong>从开始到当前局面</strong><small>{currentLabel ? `当前：${currentLabel} · 第 ${history.length} 着` : `共 ${history.length} 着`}</small></div>
        <nav>
          <button type="button" disabled={!text} onClick={() => void copy()}><Copy size={14}/>复制</button>
          <button type="button" className={activeView === "moves" ? "active" : ""} onClick={() => setActiveView("moves")}>走法</button>
          <button type="button" className={activeView === "plan" ? "active" : ""} onClick={() => setActiveView("plan")}><BookOpen size={14}/>思路</button>
          <button type="button" className={activeView === "image" ? "active" : ""} disabled={!rows.length} onClick={() => setActiveView("image")}><ImageIcon size={14}/>棋谱图</button>
          <button type="button" className="manual-line-download" title={activeView === "image" ? "下载当前棋谱图片" : "下载当前棋谱文本（含开局思路）"} disabled={activeView === "image" ? !rows.length : !text || exporting} onClick={() => activeView === "image" ? downloadImage() : void exportText()}><Download size={14}/>{activeView === "image" ? "下载图片" : exporting ? "下载中" : "下载"}</button>
          <button type="button" className="manual-line-close" onClick={onClose} aria-label="关闭完整棋谱"><X size={15}/>关闭</button>
        </nav>
      </header>
      <div className="manual-line-dialog-body">
        {activeView === "image"
          ? <figure className="manual-line-image-preview"><img src={imageUrl} alt="当前局面完整棋谱图片"/><figcaption>图片包含当前线路及每步评分，可直接下载分享。</figcaption></figure>
          : activeView === "plan"
            ? strategyInsight ? <section className="manual-strategy-insight" aria-label="三阶段思路分析">
              <nav className="manual-strategy-tabs" aria-label="思路查看范围">
                {(["overview", "opening", "middle", "endgame", "evidence"] as const).map((view) => <button key={view} type="button" className={planView === view ? "active" : ""} onClick={() => setPlanView(view)}>{strategyTabLabels[view]}</button>)}
              </nav>
              {planView === "overview" && <>
                <div className="manual-strategy-overview">
                  <div><b>当前结论</b><p>{strategyInsight.overview.conclusion}</p></div>
                  <div className="manual-strategy-mark-card"><b>问题着数</b><p>{strategyInsight.overview.moveRefs.join(" / ")}</p>{currentMove && onToggleCurrentMoveMarker && <button type="button" disabled={markerBusy} onClick={() => void toggleCurrentMoveMarker()}>{hasReviewMarker(currentMove.comment) ? "取消复盘标记" : "标记当前着法"}</button>}</div>
                  <div><b>推荐关注</b><p className="manual-strategy-focus">{strategyInsight.overview.focus.map((item) => <span key={item}>{item}</span>)}</p></div>
                  <div><b>本手风险</b><p>{strategyInsight.overview.risk}</p></div>
                </div>
                <div className="manual-strategy-coach-actions">
                  <button type="button" onClick={() => setBestMoveRevealed(true)}><Sparkles size={13}/>提示正着</button>
                  <button type="button" disabled={!bestMoveHint?.bestMove || !onStartBestMovePractice} onClick={startBestMovePractice}><ListStart size={13}/>尝试正着</button>
                  <p>{bestMoveNeedsAnalysis
                    ? "请先完成当前局面分析，再提示或尝试正着。"
                    : bestMoveRevealed
                      ? <>正着提示：<strong>{bestMoveLabel}</strong>{bestMoveHint?.bestMove && bestMoveHint.bestMoveText && bestMoveHint.bestMoveText !== bestMoveHint.bestMove ? <span>（{bestMoveHint.bestMove}）</span> : null}</>
                      : `先自己想一手；需要时点“提示正着”，或点“尝试正着”回到棋盘练习。${bestMoveHint?.topMoves.length ? `本次按 Top-${bestMoveHint.topMoves.length} 判断。` : ""}`}</p>
                </div>
                <div className="manual-strategy-block"><b>局面事实</b><ul>{strategyInsight.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>
              </>}
              {phaseView && <>
                <p className="manual-strategy-phase-note">{phaseView === strategyInsight.phase ? `当前处于${strategyInsight.phaseLabel}，这些是本手优先核验项。` : `当前不处于${strategyPhaseLabels[phaseView]}，这里用于复盘该阶段是否埋下问题。`}</p>
                <div className="manual-strategy-block checks">
                  <b>{strategyPhaseLabels[phaseView]}核验清单</b>
                  <ul>{strategyInsight.stageGuides[phaseView].checks.map((item) => <li key={item.label} className={`manual-strategy-check ${item.status}`}><span>{item.label}</span><em>{strategyCheckStatusLabels[item.status]}</em><small>着数：{item.moveRefs.join(" / ")}</small><p>{item.text}</p></li>)}</ul>
                </div>
                <div className="manual-strategy-block plan">
                  <b>{strategyPhaseLabels[phaseView]}计划模板</b>
                  <p><strong>目标：</strong>{strategyInsight.stageGuides[phaseView].goal}</p>
                  <p><strong>防范：</strong>{strategyInsight.stageGuides[phaseView].guard}</p>
                  <p><strong>验证：</strong>{strategyInsight.stageGuides[phaseView].verify}</p>
                </div>
                <div className="manual-strategy-block">
                  <b>相关短原则卡</b>
                  {strategyInsight.stageGuides[phaseView].principles.map((card) => <article key={card.id}><strong>{card.title}</strong><small>{theorySourceLabel(card)}</small><p>{card.summary}</p><em>适用：{card.appliesWhen}</em><em>风险：{card.risk}</em></article>)}
                </div>
              </>}
              {planView === "evidence" && <>
                <div className={`manual-strategy-engine ${strategyInsight.engine.status}`}>
                  <b>Pikafish证据 · {strategyInsight.evidence.pikafish.label} · 置信度{strategyInsight.evidence.pikafish.confidence}</b>
                  <p>{strategyInsight.evidence.pikafish.summary}</p>
                  {strategyInsight.evidence.pikafish.details.map((detail) => <small key={detail}>{detail}</small>)}
                </div>
                <div className="manual-strategy-block">
                  <b>赵鑫鑫棋理卡</b>
                  {strategyInsight.evidence.theoryCards.length
                    ? strategyInsight.evidence.theoryCards.map(({ card, reason, confidence }) => <article key={card.id}><strong>{card.title}<span>置信度{confidence}</span></strong><small>{theorySourceLabel(card)}</small><p>{card.summary}</p><em>{reason}</em><em>适用：{card.appliesWhen}</em><em>风险：{card.risk}</em></article>)
                    : <p className="manual-strategy-empty">当前没有命中已确认短原则卡，不强行套棋理。</p>}
                </div>
                <div className="manual-strategy-block">
                  <b>大师类似棋谱</b>
                  {strategyInsight.evidence.masterGames.length
                    ? strategyInsight.evidence.masterGames.map((item) => <article key={`${item.playerName}-${item.playedMove}-${item.sourceTitle}`}><strong>{item.playerName} 实战 {item.playedMove}<span>置信度{item.confidence}</span></strong><small>{item.sourceTitle}</small><p>{item.reason}</p></article>)
                    : <p className="manual-strategy-empty">当前未命中相同/相似的大师公开棋谱样本。</p>}
                </div>
                <div className="manual-strategy-block confidence">
                  <b>综合置信度：{strategyInsight.evidence.confidence}</b>
                  <ul>{strategyInsight.evidence.confidenceReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </div>
              </>}
            </section> : <section className="manual-opening-plan" aria-label="开局思路"><header><small>根据当前棋谱自动归纳</small><strong>{openingPlan.title}</strong></header><div className="manual-opening-plan-core"><b>底层逻辑</b><p>{openingPlan.core}</p></div><div><b>执行路径</b><ol>{openingPlan.principles.map((item) => <li key={item}>{item}</li>)}</ol></div><div><b>需要防范</b><ul>{openingPlan.risks.map((item) => <li key={item}>{item}</li>)}</ul></div><footer><b>下一步建议</b><p>{openingPlan.advice}</p></footer></section>
          : rows.length === 0
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

function BranchTreeRow({ row, editing, onNavigate, onMakeMainline, onRemove, onToggleFork, onCompare, activePath }: {
  row: ManualBranchTreeRow;
  editing: boolean;
  onNavigate(nodeId: string): void;
  onMakeMainline(nodeId: string): void;
  onRemove(nodeId: string): void;
  onToggleFork(nodeId: string, expanded: boolean): void;
  onCompare(forkNodeId: string, branchId: string): void;
  activePath: ReadonlySet<string>;
}) {
  const flyknife = flyknifeMarker(row.move.comment);
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
    <button
      type="button"
      className="manual-branch-tree-turn"
      onClick={() => onNavigate(row.nodeId)}
      title={`跳转到第 ${row.fullmove} 回合，第 ${row.ply + 1} 个半回合`}
      aria-label={`跳转到第 ${row.fullmove} 回合，第 ${row.ply + 1} 个半回合：${row.label}`}
    >
      {row.move.movedBy === "红方" ? `${row.fullmove}.` : "…"}
    </button>
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
        {flyknife && <em className="manual-flyknife-marker" title={flyknife.intent || `${flyknife.label}飞刀标注`}><Swords size={11}/>飞刀 · {flyknife.label}</em>}
        {row.active && <em className="manual-current-node-badge">当前局面</em>}
      </div>
      <div className="manual-branch-tree-meta">
        {meta.map((item) => <span key={item}>{item}</span>)}
        {row.hiddenBranchCount > 0 && <span>另有 {row.hiddenBranchCount} 条</span>}
        {row.branchPreview.map((branch) => <button type="button" key={branch.nodeId} onClick={() => onCompare(row.nodeId, branch.nodeId)} title={`对比 ${branch.notation}`}>
          对比 {branch.notation}<small>{branch.score}</small>
        </button>)}
      </div>
      {row.branchChoices.length > 1 && <BranchSelector
        branches={row.branchChoices.map((branch) => ({
          id: branch.nodeId,
          isMainline: branch.mainline,
          notation: branch.notation,
          score: branch.score,
        }))}
        currentBranchId={row.branchChoices.find((branch) => activePath.has(branch.nodeId))?.nodeId}
        onNavigate={onNavigate}
      />}
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

export function ManualTrackView({ nodes, history, currentNode, viewMode, editing, qualityByMoveId, formatScore, onNavigate, onViewModeChange, onMakeMainline, onRemove, onExportLine, bestMoveHint, onStartBestMovePractice, onToggleCurrentMoveMarker, toolbarExtra, strategyInsight, previewBranch, previewBranches }: Props) {
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
  const activePath = useMemo(() => new Set(history.map((move) => move.id)), [history]);

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
      <div className="manual-view-switch" role="tablist" aria-label="棋谱显示方式">
        <button type="button" className={viewMode === "track" ? "active" : ""} onClick={() => onViewModeChange("track")}>分支树</button>
        <button type="button" className={viewMode === "tree" ? "active" : ""} onClick={() => onViewModeChange("tree")}>传统树</button>
      </div>
      {toolbarExtra}
      <span className="manual-branch-score-caption">评分：红方视角</span>
    </header>
    <div className="manual-track-breadcrumb" title={model.breadcrumb.join(" › ")}>
      {model.breadcrumb.length ? model.breadcrumb.map((item, index) => <span key={`${item}-${index}`}>{item}</span>) : <span>尚未走棋</span>}
    </div>
    {nodes.length > 1 && <div className="manual-branch-tree-root-selector">
      <BranchSelector
        branches={nodes.map((node) => ({
          id: node.move.id,
          isMainline: node.move.isMainline,
          notation: node.move.notation,
          score: qualityByMoveId.get(node.move.id)?.score != null
            ? `${qualityByMoveId.get(node.move.id)?.score}分`
            : formatScore(node.move),
        }))}
        currentBranchId={nodes.find((node) => activePath.has(node.move.id))?.move.id}
        label="开局变招"
        onNavigate={onNavigate}
      />
    </div>}
    <div className="manual-branch-tree-list" role="tree" aria-label="高级分支树棋谱" ref={listRef}>
      {model.rows.length === 0
        ? <>
          <div className="manual-track-empty">暂无棋谱，走棋后会显示主线和分支树。</div>
          {activePreviewBranches.length > 0 && <PreviewBranches previews={activePreviewBranches}/>}
        </>
        : model.rows.map((row) => <Fragment key={row.key}>
          <BranchTreeRow
            activePath={activePath}
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
      bestMoveHint={bestMoveHint}
      currentLabel={model.current?.move.notation}
      currentMove={history.at(-1)}
      formatScore={formatScore}
      history={history}
      onClose={() => setLineDialogOpen(false)}
      onExportLine={onExportLine}
      onStartBestMovePractice={onStartBestMovePractice}
      onToggleCurrentMoveMarker={onToggleCurrentMoveMarker}
      qualityByMoveId={qualityByMoveId}
      strategyInsight={strategyInsight}
    />}
  </div>;
}

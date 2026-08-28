import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, BookOpen, Brain, CheckCircle2, ChevronRight, ClipboardPaste, ClipboardList, Download, Eye, FileText, FolderArchive, GitFork, Heart, Image, Lightbulb, Play, Plus, RefreshCw, Swords, X } from "lucide-react";
import type { AnalysisLine, BoardState, GameReportPresentationDto, GameReportProgressDto, GameSummary, LibraryFolder, ReportIssuePresentationDto, Side, TrainingGenerationResultDto, TrainingTaskDto } from "./platform/types";
import { buildReviewModel, signedCp } from "./reviewModel";
import { EvaluationTrendChart, redAdvantageLabel } from "./EvaluationTrendChart";
import { buildMoveThought, type MoveThought } from "./moveThoughtModel";
import { ReviewGameLibrary } from "./ReviewGameLibrary";

type InsightTab = "engine" | "report" | "trend" | "issues" | "training";
type MoveScope = "issues" | "all";

export type ReviewWorkspaceProps = {
  board: BoardState;
  report?: GameReportPresentationDto;
  reportBusy: boolean;
  reportExporting: boolean;
  reportProgress?: GameReportProgressDto;
  engineReady: boolean;
  libraryFolder?: string;
  playedAt?: string;
  libraryFolders: LibraryFolder[];
  games?: GameSummary[];
  libraryOpen?: boolean;
  onLibraryOpenChange?(open: boolean): void;
  favorite: boolean;
  libraryTags: string[];
  flyknifePlanCount: number;
  trainingTasks: TrainingTaskDto[];
  trainingGenerating: boolean;
  trainingGeneration?: TrainingGenerationResultDto;
  analysisConfig: { reportDepth: number; multipv: number; threads: number; hashMb: number };
  positionAnalysis: AnalysisLine[];
  positionAnalysisBusy: boolean;
  positionAnalysisError?: string;
  positionAnalysisFen?: string;
  engineHintRequest: number;
  showMoveThoughts?: boolean;
  onMoveThoughtVisibilityChange?(visible: boolean): void;
  onClose(): void;
  onNavigate(nodeId?: string): void;
  onGenerateReport(): void;
  onCancelReport(): void;
  onExportReport(): void;
  onOpenReport(): void;
  onImport(): void;
  onImportScreenshot(): void;
  onPaste(): void;
  onManualRecord(): void;
  onOpenGame?(gameId: string): void;
  onShareGame?(gameId: string): Promise<void>;
  onRefreshLibrary?(): Promise<void>;
  onDeleteGames?(gameIds: string[]): Promise<void>;
  onSaveLibrary(folder: string | undefined, favorite: boolean, tags: string[]): Promise<boolean>;
  onOpenFlyknife(): void;
  onGenerateTraining(): Promise<void>;
  onOpenTraining(): void;
  onCompleteTraining(taskId: string, completed: boolean): void;
  onStudyIssue(nodeId: string): void;
  onStartU10?(nodeId?: string): void;
  onRunPositionAnalysis(): void;
};

const insightTabs: Array<[InsightTab, string]> = [
  ["engine", "引擎提示"],
  ["report", "整局报告"],
  ["trend", "局势趋势"],
  ["issues", "关键着法"],
  ["training", "训练"],
];

function scoreDisplay(score?: number) {
  return score == null ? "--" : `${Math.round(score)}分`;
}

function issueTone(issue?: ReportIssuePresentationDto) {
  if (!issue) return "normal";
  if (issue.missedMate) return "missed";
  return issue.grade === "错" || issue.grade === "差" ? "bad" : "normal";
}

function sideClass(side: Side) {
  return side === "红方" ? "red" : "black";
}

function engineScore(line: AnalysisLine) {
  if (line.mate != null) return `杀 ${line.mate}`;
  if (line.scoreCp == null) return "--";
  return `${line.scoreCp > 0 ? "+" : ""}${line.scoreCp}`;
}

function flyknifeRouteMeta(comment: string) {
  if (!comment.startsWith("飞刀方案：") && !comment.includes("【飞刀标注】")) return undefined;
  const field = (name: string) => comment.split("\n").find((line) => line.startsWith(`${name}：`))?.slice(name.length + 1).trim();
  const stage = field("阶段");
  const stepLabel = stage === "setup" ? "设局" : stage === "lure" ? "中刀条件" : stage === "knife" ? "飞刀" : stage === "bestDefense" ? "最佳防守" : undefined;
  const risk = field("风险") ?? "";
  const mainline = field("主变");
  const label = risk.startsWith("实战可用") ? "已验证飞刀"
    : risk.startsWith("反击候选") ? "反击候选"
      : risk.startsWith("局面强招") ? "局面强招"
        : "飞刀研究";
  return {
    label: stepLabel ?? label,
    intent: field("意图") ?? (mainline ? `意图：${mainline}` : risk || "已保存飞刀线路，可查看节点注释了解详情。"),
  };
}

function ThoughtDetails({ thought, compact = false }: { thought: MoveThought; compact?: boolean }) {
  return <div className={compact ? "review-thought-details compact" : "review-thought-details"}>
    <p><strong>目的</strong><span>{thought.purpose}</span></p>
    <p><strong>风险</strong><span>{thought.risk}</span></p>
    <p><strong>建议</strong><span>{thought.nextAction}</span></p>
    {thought.comparison && <p className="review-thought-compare"><strong>比较</strong><span>{thought.comparison}</span></p>}
    {thought.confidenceNote && <small>{thought.confidenceNote}</small>}
  </div>;
}

function ReviewTrendChart({ report, currentNode, onNavigate }: { report?: GameReportPresentationDto; currentNode?: string; onNavigate(nodeId?: string): void }) {
  if (!report?.trend.length) return <div className="review-empty"><BarChart3 size={25}/><strong>等待整局报告</strong><span>生成报告后会显示每个关键节点的红黑优劣变化。</span></div>;
  return <section className="review-trend"><EvaluationTrendChart points={report.trend} currentNode={currentNode} onNavigate={(nodeId) => onNavigate(nodeId)} height={190} ariaLabel="复盘局势趋势图"/></section>;
}

function IssueCard({ issue, index, active, expanded, engineExpanded, analysisDepth, onNavigate, onToggleExplanation, onToggleEngine, onStartU10, onStudy }: {
  issue: ReportIssuePresentationDto;
  index: number;
  active: boolean;
  expanded: boolean;
  engineExpanded: boolean;
  analysisDepth?: number;
  onNavigate(): void;
  onToggleExplanation(): void;
  onToggleEngine(): void;
  onStartU10(): void;
  onStudy(): void;
}) {
  const lossPawns = (issue.lossCp / 100).toFixed(1);
  return <article className={`review-issue-card ${active ? "active" : ""}`}>
    <button type="button" className="review-issue-main" onClick={onNavigate}>
      <span>{index + 1}</span><strong>实战：{issue.notation}</strong>
      <small>{issue.missedMate ? "错过了直接取胜机会" : `${issue.grade}招 · 这步损失约 ${lossPawns} 兵`}</small>
      <small className="review-issue-position">走后：{redAdvantageLabel(issue.redScoreCp)}</small>
      {issue.bestNotation && <small className="review-issue-recommendation">建议先走：{issue.bestNotation}</small>}
    </button>
    <div className="review-issue-actions"><button type="button" aria-expanded={expanded} onClick={onToggleExplanation}>{expanded ? "收起原因" : "查看原因"}</button><button type="button" onClick={onStartU10}><Brain size={12}/>开始拆棋</button><button type="button" onClick={onStudy}><GitFork size={12}/>自由推演</button></div>
    {expanded && <div className="review-issue-coach"><p><strong>为什么</strong>{issue.coach.weakness}</p><p><strong>怎么改</strong>{issue.coach.solution}</p>{issue.bestNotation && <p><strong>推荐变化</strong>{issue.bestNotation}{issue.pvNotation?.length ? ` · ${issue.pvNotation.slice(0, 8).join(" ")}` : ""}</p>}<button type="button" className="review-engine-expand" aria-expanded={engineExpanded} onClick={onToggleEngine}>{engineExpanded ? "收起引擎详情" : "查看引擎详情"}</button>{engineExpanded && <p className="review-issue-engine-details">原始局面分：{signedCp(issue.redScoreCp)} cp · 本步损失：{issue.lossCp} cp · 分析深度：{analysisDepth ?? "--"}{issue.pvNotation?.length ? ` · 完整推荐线：${issue.pvNotation.join(" ")}` : ""}</p>}</div>}
  </article>;
}

export function ReviewWorkspace({
  board, report, reportBusy, reportExporting, reportProgress, engineReady, libraryFolder, playedAt, libraryFolders, games = [], libraryOpen: controlledLibraryOpen, onLibraryOpenChange, favorite, libraryTags, flyknifePlanCount, trainingTasks, trainingGenerating, trainingGeneration, analysisConfig,
  positionAnalysis, positionAnalysisBusy, positionAnalysisError, positionAnalysisFen, engineHintRequest, showMoveThoughts: controlledShowMoveThoughts, onMoveThoughtVisibilityChange,
  onClose, onNavigate, onGenerateReport, onCancelReport, onExportReport, onOpenReport, onImport, onImportScreenshot, onPaste, onManualRecord, onOpenGame, onShareGame, onRefreshLibrary, onDeleteGames, onSaveLibrary, onOpenFlyknife, onGenerateTraining, onOpenTraining, onCompleteTraining, onStudyIssue, onStartU10, onRunPositionAnalysis,
}: ReviewWorkspaceProps) {
  const [tab, setTab] = useState<InsightTab>("report");
  const [moveScope, setMoveScope] = useState<MoveScope>("issues");
  const [issueSide, setIssueSide] = useState<"red" | "black">("red");
  const [expandedIssue, setExpandedIssue] = useState<string>();
  const [expandedEngineLine, setExpandedEngineLine] = useState<string>();
  const [expandedEngineIssue, setExpandedEngineIssue] = useState<string>();
  const [showInsights, setShowInsights] = useState(false);
  const [internalShowMoveThoughts, setInternalShowMoveThoughts] = useState(true);
  const [expandedThoughtMove, setExpandedThoughtMove] = useState<string>();
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveEditorOpen, setArchiveEditorOpen] = useState(false);
  const [archiveFolderDraft, setArchiveFolderDraft] = useState(libraryFolder ?? "");
  const [archiveTagsInput, setArchiveTagsInput] = useState(libraryTags.join(", "));
  const [archiveFavoriteDraft, setArchiveFavoriteDraft] = useState(favorite);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveSaveFailed, setArchiveSaveFailed] = useState(false);
  const [internalLibraryOpen, setInternalLibraryOpen] = useState(false);
  const libraryOpen = controlledLibraryOpen ?? internalLibraryOpen;
  const setLibraryOpen = (open: boolean) => {
    if (controlledLibraryOpen == null) setInternalLibraryOpen(open);
    onLibraryOpenChange?.(open);
  };
  const [workflowFocus, setWorkflowFocus] = useState<string>();
  const showMoveThoughts = controlledShowMoveThoughts ?? internalShowMoveThoughts;
  useEffect(() => {
    if (engineHintRequest === 0) return;
    setShowInsights(true);
    setTab("engine");
  }, [engineHintRequest]);
  // The backend returns the selected path and its continuation separately. Keep both
  // visible while browsing an earlier node so navigation never looks like deletion.
  const documentBoard = useMemo(() => ({ ...board, history: [...board.history, ...board.continuation] }), [board]);
  const hasRecordedMoves = documentBoard.history.length > 0;
  const reportReady = hasRecordedMoves && Boolean(report && !report.stale);
  const activeReport = reportReady ? report : undefined;
  const model = useMemo(() => buildReviewModel(documentBoard, activeReport), [documentBoard, activeReport]);
  const issueIds = useMemo(() => new Set(activeReport?.issues.map((issue) => issue.nodeId) ?? []), [activeReport]);
  const currentIssue = activeReport?.issues.find((issue) => issue.nodeId === board.currentNode);
  const thoughtByMoveId = useMemo(() => new Map(model.moveRows.map((row) => [row.move.id, buildMoveThought(row.move, row.issue)])), [model.moveRows]);
  const currentMoveId = board.currentNode ?? board.history.at(-1)?.id;
  const currentThoughtRow = currentMoveId ? model.moveRows.find((row) => row.move.id === currentMoveId) : undefined;
  const currentThought = currentMoveId ? thoughtByMoveId.get(currentMoveId) : undefined;
  const moveRows = moveScope === "issues" && activeReport ? model.moveRows.filter((row) => issueIds.has(row.move.id)) : model.moveRows;
  const moveRounds = useMemo(() => {
    const rounds = new Map<number, typeof moveRows>();
    for (const row of moveRows) {
      const round = Math.ceil(row.index / 2);
      const entries = rounds.get(round) ?? [];
      entries.push(row);
      rounds.set(round, entries);
    }
    return [...rounds.entries()].map(([number, rows]) => ({ number, rows }));
  }, [moveRows]);
  const issueRows = issueSide === "red" ? model.redIssues : model.blackIssues;
  const archived = hasRecordedMoves && Boolean(libraryFolder);
  const archivePreset = !hasRecordedMoves && Boolean(libraryFolder);
  const parsedArchiveTags = archiveTagsInput.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  const savedTags = libraryTags.join("\u0000");
  const archiveDirty = archiveFolderDraft !== (libraryFolder ?? "") || archiveFavoriteDraft !== favorite || parsedArchiveTags.join("\u0000") !== savedTags;
  const archiveStatus = !hasRecordedMoves
    ? archivePreset ? `待录谱 · 预设归档：${libraryFolder}（录入后确认）` : "待录谱 · 未设置预设归档"
    : archived ? `${libraryFolder} · 已归档` : "待确认归档";
  const reviewState = !hasRecordedMoves ? "等待录谱" : reportBusy ? "报告生成中" : report?.stale ? "报告需更新" : reportReady ? "报告已生成" : "待分析";
  const headerStatus = [archiveStatus, playedAt?.trim() ? `对局时间 ${playedAt.trim()}` : "", `当前 ${model.currentMoveLabel}`, reviewState].filter(Boolean).join(" · ");
  useEffect(() => {
    if (archiveEditorOpen && archiveDirty) return;
    setArchiveFolderDraft(libraryFolder ?? "");
    setArchiveTagsInput(libraryTags.join(", "));
    setArchiveFavoriteDraft(favorite);
  }, [libraryFolder, favorite, savedTags, archiveEditorOpen, archiveDirty, libraryTags]);
  const guide = !hasRecordedMoves
    ? { step: "录谱", title: "先录入一盘棋", detail: "导入棋谱文件、从剪贴板一键录入、识别天天象棋截图，或从标准局面开始手动录谱。" }
    : !archived
      ? { step: "归档", title: "为这盘棋归档", detail: "选择复盘文件夹，之后可按赛事、布局或训练主题查找。" }
      : !reportReady
        ? { step: "整局报告", title: report?.stale ? "棋谱已改动，需要重新分析" : "生成整局报告", detail: "由你主动启动；报告会分析当前棋谱结构和引擎配置。" }
        : currentIssue
          ? { step: "引导拆棋", title: "先独立拆解当前问题", detail: `从 ${currentIssue.notation} 之前的局面开始，先隐藏引擎答案完成威胁、候选着和 4–8 个半回合计算。` }
          : trainingTasks.length === 0
          ? { step: "训练", title: "从关键失误生成训练", detail: "把当前报告中的问题着法转成可完成的复练任务。" }
          : { step: "训练", title: "继续训练与总结", detail: `本局已有 ${trainingTasks.length} 个训练任务，可完成复练并记录总结。` };
  const workflow = [
    { label: "录谱", complete: hasRecordedMoves },
    { label: "归档", complete: archived },
    { label: "整局报告", complete: reportReady, stale: Boolean(report?.stale) },
    { label: "飞刀", complete: flyknifePlanCount > 0 },
    { label: "训练", complete: trainingTasks.length > 0 },
  ];
  function jumpNextIssue() {
    const issues = activeReport?.issues ?? [];
    if (issues.length === 0) return;
    const currentIndex = issues.findIndex((issue) => issue.nodeId === board.currentNode);
    const next = issues[(currentIndex + 1 + issues.length) % issues.length];
    setIssueSide(next.movedBy === "红方" ? "red" : "black");
    setExpandedIssue(next.nodeId);
    onNavigate(next.nodeId);
  }
  function openIssue(issue: ReportIssuePresentationDto) {
    setTab("issues");
    setIssueSide(issue.movedBy === "红方" ? "red" : "black");
    setExpandedIssue(issue.nodeId);
    onNavigate(issue.nodeId);
  }
  async function saveArchive() {
    if (!archiveDirty || archiveSaving) return;
    setArchiveSaving(true);
    setArchiveSaveFailed(false);
    const saved = await onSaveLibrary(archiveFolderDraft || undefined, archiveFavoriteDraft, parsedArchiveTags);
    setArchiveSaving(false);
    if (saved) {
      setArchiveEditorOpen(false);
      setArchiveExpanded(false);
    }
    else setArchiveSaveFailed(true);
  }
  function closeArchiveEditor() {
    if (archiveDirty && !window.confirm("归档资料尚未保存，确定放弃本次修改吗？")) return;
    setArchiveFolderDraft(libraryFolder ?? "");
    setArchiveTagsInput(libraryTags.join(", "));
    setArchiveFavoriteDraft(favorite);
    setArchiveSaveFailed(false);
    setArchiveEditorOpen(false);
  }
  function openArchiveEditor() {
    setArchiveExpanded(true);
    setArchiveEditorOpen(true);
  }
  function closeReview() {
    if (archiveDirty && !window.confirm("归档资料尚未保存，确定返回研究模式吗？")) return;
    onClose();
  }
  async function generateTraining() {
    await onGenerateTraining();
    setTab("training");
  }
  function setMoveThoughtVisibility(visible: boolean) {
    if (controlledShowMoveThoughts == null) setInternalShowMoveThoughts(visible);
    onMoveThoughtVisibilityChange?.(visible);
    if (!visible) setExpandedThoughtMove(undefined);
  }
  function selectWorkflowStep(label: string) {
    setWorkflowFocus(label);
    if (label === "录谱") {
      if (!hasRecordedMoves) onManualRecord();
      else onNavigate(undefined);
      return;
    }
    if (label === "归档") {
      if (hasRecordedMoves) setArchiveExpanded((expanded) => !expanded);
      return;
    }
    if (label === "整局报告") {
      setTab("report");
      return;
    }
    if (label === "飞刀") {
      onOpenFlyknife();
      return;
    }
    setTab("training");
  }

  return <section className={`review-workbench ${showInsights ? "insight-open" : ""}`} aria-label="整局复盘工作台">
    <header className="review-workbench-header">
      <div className="review-workbench-title">
        <span>整局复盘</span>
        <h2 title={model.title}>{model.title}</h2>
        <small title={headerStatus}>{headerStatus}</small>
      </div>
      <ol className="review-header-workflow" aria-label="复盘进度">{workflow.map((item, index) => <li key={item.label} className={`${item.complete ? "complete" : ""} ${(workflowFocus ?? guide.step) === item.label ? "current" : ""} ${item.stale ? "stale" : ""}`}><button type="button" aria-label={item.label} title={`打开${item.label}`} onClick={() => selectWorkflowStep(item.label)}><i>{item.complete ? <CheckCircle2 size={12}/> : index + 1}</i><span>{item.label}</span></button></li>)}</ol>
      <div className="review-workbench-header-actions">
        <button type="button" className="review-workbench-library" onClick={() => setLibraryOpen(true)}><BookOpen size={15}/>棋谱库</button>
        <button type="button" className="review-workbench-thoughts" aria-pressed={showMoveThoughts} onClick={() => setMoveThoughtVisibility(!showMoveThoughts)}><Lightbulb size={15}/>{showMoveThoughts ? "隐藏思路" : "显示思路"}</button>
        <button type="button" className="review-workbench-insights" aria-label="查看复盘洞察" title="查看复盘洞察" onClick={() => setShowInsights((open) => !open)}><Eye size={15}/>洞察</button>
        <button type="button" className="review-workbench-close" aria-label="返回研究模式" title="返回研究模式" onClick={closeReview}><X size={17}/></button>
      </div>
    </header>
    <section className="review-route" aria-label="复盘路线">
      <section className="review-guide-card" aria-label="当前复盘步骤">
        <small>当前步骤 · {guide.step}</small><strong>{guide.title}</strong><p>{guide.detail}</p>
        {!hasRecordedMoves ? <div className="review-guide-actions"><button type="button" className="primary" onClick={onImport}><FileText size={13}/>导入棋谱</button><button type="button" onClick={onImportScreenshot}><Image size={13}/>导入截图识别</button><button type="button" onClick={onPaste}><ClipboardPaste size={13}/>一键录入</button><button type="button" onClick={onManualRecord}><Plus size={13}/>手动录谱</button></div>
          : !archived ? <div className="review-guide-actions"><button type="button" className="primary" onClick={openArchiveEditor}><FolderArchive size={13}/>编辑并保存归档</button></div>
            : !reportReady ? <div className="review-guide-actions"><button type="button" className="primary" disabled={!engineReady || reportBusy} onClick={onGenerateReport}><Activity size={13}/>{report?.stale ? "重新生成报告" : "生成整局报告"}</button><button type="button" onClick={onOpenFlyknife}><Swords size={13}/>手动设计飞刀</button>{reportBusy && <button type="button" className="danger" onClick={onCancelReport}><RefreshCw size={13}/>取消</button>}</div>
              : currentIssue ? <div className="review-guide-actions"><button type="button" className="primary" onClick={() => onStartU10?.(currentIssue.nodeId)}><Brain size={13}/>引导拆棋</button><button type="button" onClick={onOpenFlyknife}><Swords size={13}/>设计飞刀</button><button type="button" disabled={trainingGenerating} onClick={() => void generateTraining()}><ClipboardList size={13}/>{trainingGenerating ? "生成中" : "生成训练任务"}</button></div>
                : trainingTasks.length === 0 ? <div className="review-guide-actions"><button type="button" className="primary" disabled={trainingGenerating} onClick={() => void generateTraining()}><ClipboardList size={13}/>{trainingGenerating ? "生成中" : "生成训练任务"}</button><button type="button" onClick={onOpenFlyknife}><Swords size={13}/>设计飞刀</button></div>
              : <div className="review-guide-actions"><button type="button" className="primary" onClick={onOpenTraining}><Play size={13}/>打开训练与总结</button><button type="button" onClick={onOpenFlyknife}><Swords size={13}/>设计飞刀</button></div>}
      </section>
      {hasRecordedMoves && <section className="review-record-tools" aria-label="录谱与截图工具">
        <span>录谱工具</span>
        <div>
          <button type="button" onClick={onImportScreenshot}><Image size={13}/>导入截图识别</button>
          <button type="button" onClick={onManualRecord}><Plus size={13}/>新建手动录谱</button>
        </div>
        <small>将新建独立棋谱，当前复盘不会被覆盖。</small>
      </section>}
      {showMoveThoughts && hasRecordedMoves && currentThoughtRow && currentThought && <section className="review-current-thought-card" aria-label="当前着法思路">
        <header>
          <div><small>当前着法思路 · {currentThought.sourceLabel}</small><strong>第 {currentThoughtRow.index} 着 · {currentThoughtRow.move.movedBy} {currentThoughtRow.move.notation}</strong></div>
          <button type="button" onClick={() => setMoveThoughtVisibility(false)}>隐藏</button>
        </header>
        <ThoughtDetails thought={currentThought}/>
      </section>}
      {hasRecordedMoves && <section className={`review-archive-card ${archiveExpanded ? "expanded" : "collapsed"} ${archiveEditorOpen ? "editing" : ""}`} aria-label="棋谱归档资料">
        <header><div><strong>归档资料</strong><small>{archived ? "已保存" : "待确认"} · {libraryFolder || "未分类"}{favorite ? " · 已收藏" : ""}{libraryTags.length ? ` · ${libraryTags.join("、")}` : ""}</small></div><div className="review-archive-header-actions"><button type="button" onClick={() => setArchiveExpanded((expanded) => !expanded)}>{archiveExpanded ? "收起" : "展开"}</button><button type="button" onClick={openArchiveEditor}>编辑归档</button></div></header>
        {archiveExpanded && !archiveEditorOpen && <><small className="review-archive-location">本机保存：Application Support/cn.xiangqi.studio/xiangqi.sqlite3</small><div className="review-archive-summary"><span>{libraryFolder || "未分类"}</span>{favorite && <span className="favorite"><Heart size={12} fill="currentColor"/>已收藏</span>}{libraryTags.map((tag) => <em key={tag}>{tag}</em>)}</div></>}
        {archiveEditorOpen && <><div className="review-archive-fields"><label>文件夹<select aria-label="归档文件夹" value={archiveFolderDraft} onChange={(event) => setArchiveFolderDraft(event.target.value)}><option value="">未分类</option>{libraryFolders.map((folder) => <option key={folder.name} value={folder.name}>{folder.name}</option>)}</select></label><label>标签<input aria-label="归档标签" value={archiveTagsInput} placeholder="赛事、后手、中炮" onChange={(event) => setArchiveTagsInput(event.target.value)} /></label></div>
          <div className="review-archive-tools"><button type="button" className={archiveFavoriteDraft ? "active" : ""} onClick={() => setArchiveFavoriteDraft((value) => !value)}><Heart size={13} fill={archiveFavoriteDraft ? "currentColor" : "none"}/>{archiveFavoriteDraft ? "已收藏" : "收藏"}</button><button type="button" onClick={closeArchiveEditor}>取消</button><button type="button" disabled={!archiveDirty || archiveSaving} onClick={() => void saveArchive()}>{archiveSaving ? "保存中" : "保存归档"}</button></div>{archiveDirty && <small className="review-archive-dirty">未保存的修改</small>}{archiveSaveFailed && <small className="review-archive-error">保存失败，草稿已保留，请重试。</small>}</>}
      </section>}
      <div className="review-config" aria-label="整局分析配置"><span>深度 {analysisConfig.reportDepth}</span><span>PV {analysisConfig.multipv}</span><span>{analysisConfig.threads} 线程</span><span>Hash {analysisConfig.hashMb} MB</span></div>
      <section className="review-move-list" aria-label="复盘棋谱路线">
        <header><strong>棋谱路线</strong><div role="group" aria-label="棋谱范围"><button type="button" className={moveScope === "all" ? "active" : ""} title="浏览完整棋谱，不删除后续着法" onClick={() => setMoveScope("all")}>完整棋谱</button><button type="button" className={moveScope === "issues" ? "active" : ""} disabled={!activeReport} onClick={() => setMoveScope("issues")}>关键着法</button></div></header>
        {moveRounds.length === 0 ? <div className="review-route-empty"><FolderArchive size={21}/><span>{activeReport ? "没有需要重点复盘的失误，可查看完整棋谱。" : "生成整局报告后会在这里列出关键着法。"}</span></div>
          : moveRounds.map((round) => <article className="review-route-round" key={round.number} aria-label={`第 ${round.number} 回合`}><span className="review-route-round-number">{round.number}</span><div>{round.rows.map((row) => {
            const scoreText = row.scoreText === "---" ? "待分析" : row.scoreText;
            const detail = `${row.move.movedBy} · ${scoreText}${row.issue ? ` · 损失 ${row.issue.lossCp}cp` : ""}`;
            const flyknife = flyknifeRouteMeta(row.move.comment);
            const thought = thoughtByMoveId.get(row.move.id);
            const thoughtExpanded = expandedThoughtMove === row.move.id;
            return <div className={`review-route-entry ${thoughtExpanded ? "expanded" : ""}`} key={row.move.id}>
              <button aria-label={`${row.move.movedBy} ${row.move.notation}`} className={`review-route-move ${row.move.movedBy === "红方" ? "red" : "black"} ${flyknife ? "has-flyknife" : ""} ${thought ? "has-thought" : ""} ${board.currentNode === row.move.id ? "active" : ""} ${issueTone(row.issue)}`} type="button" onClick={() => row.issue ? openIssue(row.issue) : onNavigate(row.move.id)}>
                <div className="review-route-move-main"><strong title={row.move.notation}>{row.move.notation}</strong><small title={detail}>{scoreText}{row.issue ? ` · 损失 ${row.issue.lossCp}cp` : ""}</small></div>
                {flyknife && <div className="review-route-flyknife" title={flyknife.intent}><Swords size={12}/><b>{flyknife.label}</b><small>{flyknife.intent}</small></div>}
                <em>{row.issue?.missedMate ? "漏杀" : row.quality ?? "记录"}</em>
              </button>
              {showMoveThoughts && thought && <button type="button" className="review-route-thought-toggle" aria-expanded={thoughtExpanded} aria-label={`${thoughtExpanded ? "收起" : "展开"}第 ${row.index} 着思路`} title={`${row.move.notation}：${thought.purpose}`} onClick={() => setExpandedThoughtMove(thoughtExpanded ? undefined : row.move.id)}>思路</button>}
              {showMoveThoughts && thoughtExpanded && thought && <div className="review-route-thought" aria-label={`${row.move.notation} 的着法思路`}>
                <ThoughtDetails thought={thought} compact/>
              </div>}
            </div>;
          })}</div></article>)}
      </section>
    </section>
    <section className="review-insights" aria-label="复盘洞察">
      <nav className="review-insight-tabs" role="tablist" aria-label="复盘洞察分页">{insightTabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {reportBusy && <div className="review-progress" aria-live="polite"><span>报告生成中 {reportProgress?.completed ?? 0}/{reportProgress?.total ?? "--"}</span><progress max={Math.max(1, reportProgress?.total ?? 1)} value={reportProgress?.completed ?? 0}/></div>}
      {report?.stale && <div className="review-stale">棋谱或引擎配置已变化，旧报告不会作为当前结果显示。请重新生成整局报告。</div>}
      <div className="review-insight-body">
        {tab === "engine" && <section className="review-engine-hints" role="tabpanel" aria-label="当前局面引擎提示">
          <header><div><strong>当前局面引擎提示</strong><small>{positionAnalysisBusy ? "Pikafish 正在计算候选着…" : positionAnalysisFen === board.fen ? `${board.sideToMove}行棋 · MultiPV ${Math.max(1, positionAnalysis.length)}` : "点击分析获取当前局面建议"}</small></div><button type="button" className="primary" disabled={positionAnalysisBusy || !board.playable} onClick={onRunPositionAnalysis}>{positionAnalysisBusy ? "分析中…" : "分析当前局面"}</button></header>
          {!engineReady ? <div className="review-empty"><Activity size={25}/><strong>尚未配置 Pikafish</strong><span>请先在引擎设置中选择可用引擎，再获取当前局面的候选着法。</span></div>
            : positionAnalysisBusy ? <div className="review-empty"><Activity size={25}/><strong>正在分析当前局面</strong><span>候选着法会在引擎返回后显示。</span></div>
              : positionAnalysisError ? <div className="review-empty"><Activity size={25}/><strong>引擎提示获取失败</strong><span>{positionAnalysisError}</span><button type="button" onClick={onRunPositionAnalysis}>重新分析</button></div>
                : positionAnalysisFen !== board.fen || positionAnalysis.length === 0 ? <div className="review-empty"><Activity size={25}/><strong>还没有当前局面提示</strong><span>点击“分析当前局面”，查看最佳着法和候选变化。</span><button type="button" onClick={onRunPositionAnalysis}>开始分析</button></div>
                  : <div className="review-engine-lines">{positionAnalysis.map((line) => {
                    const lineKey = `${line.multipv}-${line.pv[0] ?? "empty"}`;
                    const moves = line.notation?.join(" ") || line.pv.join(" ");
                    const expanded = expandedEngineLine === lineKey;
                    return <article key={lineKey}>
                      <div><b>推荐 {line.multipv} · {line.notation?.[0] ?? line.pv[0] ?? "暂无着法"}</b><strong>{engineScore(line)}</strong></div>
                      <p className="review-engine-verdict">{line.scoreCp == null ? "引擎正在补充局面判断" : redAdvantageLabel(line.scoreCp)}</p>
                      <p className={`review-engine-pv ${expanded ? "expanded" : ""}`}>{moves || "暂未返回后续着法"}</p>
                      {moves && <button type="button" className="review-engine-expand" aria-expanded={expanded} onClick={() => setExpandedEngineLine(expanded ? undefined : lineKey)}>{expanded ? "收起线路" : "展开完整线路"}</button>}
                      <small className="review-engine-details">引擎详情：深度 {line.depth ?? "--"} · 评分 {engineScore(line)} · MultiPV {line.multipv}</small>
                    </article>;
                  })}</div>}
        </section>}
        {tab === "report" && <section className="review-report" role="tabpanel">{!activeReport ? <div className="review-empty"><Activity size={25}/><strong>{report?.stale ? "报告需要重新生成" : "尚未生成整局报告"}</strong><span>报告完成后可查看红黑评分、阶段表现、关键失误与学习建议。</span><button type="button" className="primary" disabled={!engineReady || reportBusy || !hasRecordedMoves} onClick={onGenerateReport}>生成整局报告</button></div> : <><div className="review-scorebar">{([model.red, model.black] as const).map((side) => <article className={sideClass(side.side)} key={side.side}><small>{side.side} · {side.player}</small><strong>{side.overall}</strong><span>{side.phaseText}</span><em>{side.issues} 个失误 · 漏杀 {side.missedMate}</em></article>)}</div><div className="review-report-meta"><span>引擎：{activeReport.engineLabel || "Pikafish"}</span><span>深度：{activeReport.analysisDepth ?? "--"}</span><span>耗时：{(activeReport.totalElapsedMs / 1000).toFixed(1)}s</span><span>缓存：{activeReport.cachedPositions}</span></div><section className="review-phase-table" aria-label="阶段评分">{(["opening", "middle", "endgame"] as const).map((phase) => <div key={phase}><strong>{phase === "opening" ? "开局" : phase === "middle" ? "中局" : "残局"}</strong><span className="red">{scoreDisplay(activeReport.red.phases[phase])}</span><span className="black">{scoreDisplay(activeReport.black.phases[phase])}</span></div>)}</section><section className="review-coach"><strong>{activeReport.coachInsights.branchName}</strong><p>{activeReport.coachInsights.branchPurpose}</p><ul>{activeReport.coachInsights.studyPlan.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></section><div className="review-report-actions"><button type="button" onClick={onOpenReport}><Eye size={13}/>完整报告</button><button type="button" disabled={reportExporting} onClick={onExportReport}><Download size={13}/>{reportExporting ? "导出中" : "PDF"}</button></div></>}</section>}
        {tab === "trend" && <ReviewTrendChart report={activeReport} currentNode={board.currentNode} onNavigate={onNavigate}/>}
        {tab === "issues" && <section className="review-issues" role="tabpanel">{!activeReport ? <div className="review-empty"><GitFork size={25}/><strong>等待关键着法</strong><span>生成报告后会按红黑双方整理失误与推荐着法。</span></div> : <><div className="review-issue-switch" role="group" aria-label="选择问题方"><button type="button" className={issueSide === "red" ? "active red" : ""} onClick={() => setIssueSide("red")}>红方 {model.redIssues.length}</button><button type="button" className={issueSide === "black" ? "active black" : ""} onClick={() => setIssueSide("black")}>黑方 {model.blackIssues.length}</button><button type="button" disabled={model.issueCount === 0} onClick={jumpNextIssue}>下一个问题<ChevronRight size={12}/></button></div>{issueRows.length === 0 ? <div className="review-empty"><ClipboardList size={22}/><strong>暂无明显问题</strong><span>当前分析深度下，这一方没有差招、错招或漏杀。</span></div> : issueRows.map((issue, index) => <IssueCard key={issue.nodeId} issue={issue} index={index} active={board.currentNode === issue.nodeId} expanded={expandedIssue === issue.nodeId} engineExpanded={expandedEngineIssue === issue.nodeId} analysisDepth={activeReport.analysisDepth} onNavigate={() => { setExpandedIssue(issue.nodeId); onNavigate(issue.nodeId); }} onToggleExplanation={() => setExpandedIssue(expandedIssue === issue.nodeId ? undefined : issue.nodeId)} onToggleEngine={() => setExpandedEngineIssue(expandedEngineIssue === issue.nodeId ? undefined : issue.nodeId)} onStartU10={() => onStartU10?.(issue.nodeId)} onStudy={() => onStudyIssue(issue.nodeId)}/>)}</>}</section>}
        {tab === "training" && <section className="review-training" role="tabpanel"><header><strong>本局训练</strong><button type="button" onClick={onOpenTraining}>训练与总结</button></header><aside className="review-training-explainer" aria-label="训练生成规则"><strong>这几题怎样选出来？</strong><span><b>关键复练</b>：本着使己方局面下降至少 0.80 分。</span><span><b>巩固复练</b>：没有严重失误时，从下降 0.30–0.79 分的着法中选最多 3 题。</span><small>1. 点`开始拆棋`，回到该错误着之前的局面；2. 先独立推演，答案保持隐藏；3. 提交后核对，再勾选完成。</small></aside>{trainingGeneration && <p className="review-training-result">{trainingGeneration.criticalCount > 0 ? `已生成 ${trainingGeneration.criticalCount} 个关键复练任务。` : trainingGeneration.reinforcementCount > 0 ? `本局没有严重失误，已生成 ${trainingGeneration.reinforcementCount} 个巩固训练。` : "当前报告没有可训练节点。"}</p>}{!activeReport ? <div className="review-empty"><ClipboardList size={25}/><strong>先生成整局报告</strong><span>训练任务只从当前有效报告生成，避免复练过期局面。</span></div> : trainingTasks.length === 0 ? <div className="review-empty"><ClipboardList size={25}/><strong>还没有训练任务</strong><span>会优先生成关键失误；若没有严重失误，则生成轻度巩固训练。</span><button type="button" className="primary" disabled={trainingGenerating} onClick={() => void generateTraining()}>{trainingGenerating ? "生成中" : "生成训练任务"}</button></div> : <div className="review-training-list">{trainingTasks.map((task) => <article key={task.id}><label><input type="checkbox" checked={Boolean(task.completedAt)} onChange={(event) => onCompleteTraining(task.id, event.target.checked)}/><span><strong>{task.taskType === "reinforcement" ? "巩固" : "关键"} · {task.title}</strong><small>{task.detail}</small></span></label><button type="button" onClick={() => onStartU10?.(task.nodeId)}><Brain size={13}/>开始拆棋</button></article>)}</div>}</section>}
      </div>
    </section>
    {libraryOpen && <ReviewGameLibrary games={games} folders={libraryFolders} onOpen={(gameId) => onOpenGame?.(gameId)} onShare={onShareGame} onDelete={onDeleteGames} onChanged={onRefreshLibrary} onClose={() => setLibraryOpen(false)}/>}
  </section>;
}

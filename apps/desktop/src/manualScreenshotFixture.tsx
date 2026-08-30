import React from "react";
import { createRoot } from "react-dom/client";
import { DesktopDialogs } from "./DesktopDialogs";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { TheoryLibraryView } from "./TheoryLibraryView";
import { U10TrainingDialog } from "./U10TrainingDialog";
import { UserManualDialog } from "./UserManualDialog";
import { BUILTIN_ENGINE_PATH, FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST } from "./platform";
import type { BoardState, DailyTrainingPlan, DesktopPreferencesDto, GameReportPresentationDto, GuidedAnalysisStart, GuidedAnalysisSubmissionResult, LearningProfile, OpeningRepertoire, Piece, SyncAccountDto, TheoryLibraryDto, WeeklyLearningReport } from "./platform";
import "./styles.css";
import userManualMarkdown from "../../../docs/USER_MANUAL.zh-CN.md?raw";

const noop = () => undefined;
const asyncNoop = async () => undefined;
const scene = new URLSearchParams(window.location.search).get("scene") ?? "review";

const preferences: DesktopPreferencesDto = {
  enginePath: BUILTIN_ENGINE_PATH, threads: 4, hashMb: 512, multipv: 3, candidateLineMoves: 16,
  searchMode: "depth", searchValue: 24, moveTimeMs: 1000, ponder: false, autoAnalyze: false,
  libraryCollapsed: false, candidateRailCollapsed: false, analysisPanelCollapsed: false, evaluationCollapsed: true,
  branchArrowColor: "#2f80ed", analysisEngineMode: "single", parallelEngineIds: [], workspacePanel: "moves",
  layoutMode: "compact", manualViewMode: "track", colorTheme: "light", boardSkin: "default", pieceSkin: "default",
  reportDepth: 22, builtinOpeningBookEnabled: true, activeBuiltinOpeningBookId: "learning-top3",
  ruleMode: "domestic2020", cloudBookEnabled: true, cloudBookUrl: "https://www.chessdb.cn/chessdb.php",
  serverUrl: "http://127.0.0.1:8080",
};
const account: SyncAccountDto = { serverUrl: preferences.serverUrl, status: "unbound" };

const piece = (row: number, col: number, color: Piece["color"], kind: string, label: string): Piece => ({ row, col, color, kind, label });
const pieces: Piece[] = [
  piece(0, 0, "black", "rook", "车"), piece(0, 1, "black", "horse", "马"), piece(0, 2, "black", "elephant", "象"), piece(0, 3, "black", "advisor", "士"), piece(0, 4, "black", "king", "将"), piece(0, 5, "black", "advisor", "士"), piece(0, 6, "black", "elephant", "象"), piece(0, 7, "black", "horse", "马"), piece(0, 8, "black", "rook", "车"),
  piece(2, 1, "black", "cannon", "炮"), piece(2, 7, "black", "cannon", "炮"), piece(3, 0, "black", "pawn", "卒"), piece(3, 2, "black", "pawn", "卒"), piece(3, 4, "black", "pawn", "卒"), piece(3, 6, "black", "pawn", "卒"), piece(3, 8, "black", "pawn", "卒"),
  piece(9, 0, "red", "rook", "车"), piece(9, 1, "red", "horse", "马"), piece(9, 2, "red", "elephant", "相"), piece(9, 3, "red", "advisor", "仕"), piece(9, 4, "red", "king", "帅"), piece(9, 5, "red", "advisor", "仕"), piece(9, 6, "red", "elephant", "相"), piece(9, 7, "red", "horse", "马"), piece(9, 8, "red", "rook", "车"),
  piece(7, 1, "red", "cannon", "炮"), piece(7, 7, "red", "cannon", "炮"), piece(6, 0, "red", "pawn", "兵"), piece(6, 2, "red", "pawn", "兵"), piece(6, 4, "red", "pawn", "兵"), piece(6, 6, "red", "pawn", "兵"), piece(6, 8, "red", "pawn", "兵"),
];

const board: BoardState = {
  fen: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1",
  rootSideToMove: "红方", sideToMove: "黑方", status: "对局进行中", pieces,
  history: [{ id: "move-1", iccs: "h2e2", notation: "炮二平五", movedBy: "红方", from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, scoreCp: -165, comment: "", isMainline: true }],
  continuation: [{ id: "move-2", iccs: "h9g7", notation: "马8进7", movedBy: "黑方", from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, scoreCp: -120, comment: "", isMainline: true }],
  branches: [], currentNode: "move-1", title: "U10 脱敏示例棋谱", note: "红方：小棋手\n黑方：训练对手\n结果：*", playable: true,
};

const side = (name: "红方" | "黑方") => ({
  side: name, overall: name === "红方" ? 76 : 84, grade: name === "红方" ? "良" : "优",
  phases: { opening: name === "红方" ? 72 : 87, middle: name === "红方" ? 79 : 82, endgame: undefined },
  phaseGrades: { opening: name === "红方" ? "良" : "优", middle: "良", endgame: undefined },
  counts: { excellent: 5, good: 3, average: 1, poor: name === "红方" ? 1 : 0, error: 0, missedMate: 0 },
  coachQuality: name === "红方" ? "良" : "优", coachSummary: `${name}需要继续检查对方反击。`,
  dimensions: { opening: 78, middle: 82, endgame: undefined, accuracy: 80, stability: 76 },
} as const);

const report: GameReportPresentationDto = {
  title: board.title, generatedAt: "2026-08-11T08:00:00Z", stale: false, analysisDepth: 22, engineLabel: "Pikafish",
  totalElapsedMs: 18600, cachedPositions: 8, red: side("红方"), black: side("黑方"),
  coachInsights: { branchName: "中炮开局复盘", branchPurpose: "先检查对方强制反击，再比较出子次序。", namingTips: [], weaknessFixes: [], studyPlan: ["先独立列出三种候选", "复算对方最强反击", "三天后无提示复测"] },
  trend: [{ label: "初始局面", scoreCp: 0 }, { label: "炮二平五", scoreCp: -165, nodeId: "move-1", deltaCp: -165 }],
  issues: [{ nodeId: "move-1", notation: "炮二平五", movedBy: "红方", lossCp: 165, score: 42, grade: "中", missedMate: false, redScoreCp: -165, deltaCp: -165, bestNotation: "马二进三", pvNotation: ["马二进三", "马8进7", "车一平二"], coach: { intent: "立即控制中路。", weakness: "没有先比较对方反击。", solution: "先出马并检查强制着。", branchPlan: "保存推荐变例。" } }],
  standards: [], scoreGuide: [], disclaimer: "脱敏示例",
};

const profile: LearningProfile = { id: "default", childName: "小棋手", level: "全国少年赛", ageGroup: "U10", sessionMinutes: 40, coachMode: "家长陪练", cycleWeeks: 12, personalRatio: 60, thematicRatio: 40, currentWeek: 4, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-11T00:00:00Z" };
const guidedStart: GuidedAnalysisStart = { session: { id: "session-1", gameId: "game-1", problemNodeId: "move-1", reportSignature: "manual-fixture", fen: board.fen, phase: "opening", status: "thinking", answerHidden: true, startedAt: new Date().toISOString() }, board };
const guidedResult: GuidedAnalysisSubmissionResult = {
  session: { ...guidedStart.session, status: "submitted", answerHidden: false, submittedAt: new Date().toISOString() },
  result: { sessionId: "session-1", resultKind: "direction", resultLabel: "方向正确", score: 78, chosenRank: 2, missedCounterplay: false, scoreCp: 85, lines: [
    { multipv: 1, depth: 22, scoreCp: 118, pv: ["h0g2", "h9g7", "i0h0"], notation: ["马二进三", "马8进7", "车一平二"] },
    { multipv: 2, depth: 22, scoreCp: 85, pv: ["h2e2", "h9g7", "h0g2"], notation: ["炮二平五", "马8进7", "马二进三"] },
    { multipv: 3, depth: 21, scoreCp: 52, pv: ["b0c2", "b9c7"], notation: ["马八进七", "马2进3"] },
  ], theorySignals: ["开局", "子力协调", "最差子"], trainingAdvice: "方向正确；下次先比较出马与中炮的次序，并补算对方最强反击。" },
};

const dailyPlan: DailyTrainingPlan = { date: "2026-08-11", week: 4, phaseTitle: "强制着与候选着", totalMinutes: 40, personalRatio: 60, thematicRatio: 40, segments: [
  { key: "endgame-foundation", title: "残局打底", minutes: 10, targetTags: ["残局打底", "残局处理"], completionHint: "先说胜和判断，再走第一步。", items: [{ source: "内置专题", title: "车兵优势转化", minutes: 10, due: false }] },
  { key: "tactical-scan", title: "战术漏算", minutes: 8, targetTags: ["战术漏算"], completionHint: "扫完双方强制着。", items: [{ source: "内置专题", title: "先扫将军、吃子、捉双", minutes: 8, due: false }] },
  { key: "guided-analysis", title: "引导拆棋", minutes: 12, targetTags: ["候选着计算", "深度复盘"], completionHint: "走一思三，推演 2-8 个半回合。", items: [{ taskId: "t1", source: "个人棋谱", title: "复测上周漏算反击题", minutes: 12, due: true }] },
  { key: "opening-system", title: "开局体系", minutes: 7, targetTags: ["专属布局"], completionHint: "只复盘一条主线和一个备选。", items: [{ source: "学习开局库", title: "中炮开局第 9 回合", minutes: 7, due: false }] },
  { key: "training-note", title: "训练笔记", minutes: 3, targetTags: ["心态管理"], completionHint: "写一个状态标签。", items: [{ source: "家长陪练", title: "孩子复述漏算原因", minutes: 3, due: false }] },
] };
const weeklyReport: WeeklyLearningReport = { weekStart: "2026-08-05", weekEnd: "2026-08-11", attempts: 9, averageScore: 82, hintFreeRate: 78, averageSeconds: 168, masteredTasks: 3, resultCounts: { correct: 4, direction: 3, missedCounterplay: 2 }, weakTags: ["漏算反击", "候选着"], parentSummary: "本周列候选的习惯更稳定，但快棋时仍会漏掉对方先手。", nextFocus: "每题先口述对方全部将军，再开始计算自己的候选着。" };
const repertoire: OpeningRepertoire = { sampledGames: 16, red: [{ name: "仙人指路", games: 5 }, { name: "中炮", games: 4 }], black: [{ name: "卒底炮", games: 4 }, { name: "屏风马", games: 3 }], enoughData: true, note: "已按最近 16 盘比赛棋谱归纳红黑常用体系。" };

const theoryLibrary: TheoryLibraryDto = { downloadingFiles: 0, lessons: [{ id: 1, phase: "opening", courseName: "U10 原创棋理", title: "开局协调", sourcePath: "bundled", fingerprint: "fixture", transcriptionStatus: "complete", scannedAt: "2026-08-11T00:00:00Z" }], cards: [
  { id: 1, externalId: "u10-opening-coordinate", lessonId: 1, phase: "opening", title: "先出动强子，再重复走子", summary: "开局优先让马炮进入有效位置，并保持两翼协调。", appliesWhen: "开局前 12 回合仍有马炮未出动。", risk: "存在强制战术时先算战术。", reviewStatus: "approved", courseName: "U10 原创棋理", lessonTitle: "开局协调", sourceBook: "随包原创卡", tags: ["开局", "子力协调", "最差子"], engineCorrelations: ["development"], origin: "bundled", version: 2, userModified: false, matchPenalty: 0, needsRecheck: false },
  { id: 2, lessonId: 1, phase: "opening", title: "攻中路前检查将门", summary: "准备进攻前，先确认对方下一步的所有将军。", appliesWhen: "中路线路开始打开。", risk: "确认无直接威胁后继续出子。", reviewStatus: "pending", courseName: "本地课程", lessonTitle: "王安全", tags: ["王安全", "反击检查"], engineCorrelations: [], origin: "user", version: 1, userModified: false, matchPenalty: 0, needsRecheck: false },
] };

function Callouts({ points }: { points: Array<[number, number, number]> }) {
  return <div className="manual-callouts" aria-hidden="true">{points.map(([number, left, top]) => <b key={number} style={{ left: `${left}%`, top: `${top}%` }}>{number}</b>)}</div>;
}

function U10Scene() {
  return <U10TrainingDialog start={guidedStart} profile={profile} dailyPlan={dailyPlan} weeklyReport={weeklyReport} repertoire={repertoire} busy={false} onClose={noop} onCancel={noop} onPreview={async () => []} onParseChineseLine={async () => ({ moves: [], steps: [] })} pieceAsset={() => "/skins/default/rk.png"} boardAsset="/skins/default/board.png" onSubmit={async () => guidedResult} onSaveProfile={noop} onSaveVariation={asyncNoop}/>;
}

function DailyWeeklyScene() {
  return <div className="manual-dual-shot">
    <section className="u10-plan-view"><header><div><strong>今日 40 分钟</strong><small>特级大师训练法 · 每周复盘闭环</small></div><span>第 4 周 · 强制着与候选着</span></header><div className="u10-plan-timeline">{dailyPlan.segments.map((segment, index) => <article key={segment.key}><i>{index + 1}</i><div><strong>{segment.title}<em>{segment.minutes} 分钟</em></strong><div className="u10-tags">{segment.targetTags.map((tag) => <span key={tag}>{tag}</span>)}</div><p><span>{segment.items[0].source}</span>{segment.items[0].title}{segment.items[0].due && <b>今天到期</b>}</p><small>{segment.completionHint}</small></div></article>)}</div></section>
    <section className="u10-report-view"><header><strong>家长周报</strong><small>{weeklyReport.weekStart} 至 {weeklyReport.weekEnd}</small></header><div className="u10-report-metrics"><article><b>{weeklyReport.attempts}</b><span>本周作答</span></article><article><b>{weeklyReport.averageScore}</b><span>平均分</span></article><article><b>{weeklyReport.hintFreeRate}%</b><span>无提示完成</span></article><article><b>{weeklyReport.masteredTasks}</b><span>已掌握</span></article></div><p>{weeklyReport.parentSummary}</p><aside><strong>下周重点</strong>{weeklyReport.nextFocus}</aside><div className="u10-tags">{weeklyReport.weakTags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>
  </div>;
}

function Fixture() {
  if (scene === "manual") return <UserManualDialog appVersion="1.2.0" markdown={userManualMarkdown} onClose={noop}/>;
  if (scene === "engine" || scene === "engine-bottom") return <><DesktopDialogs dialog="engine" preferences={preferences} account={account} trainingTasks={[]} studySessions={[]} builtinOpeningBookManifest={{ ...FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST, vkeyVerification: { ...FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST.vkeyVerification, status: "verified", note: "vkey 已验证" } }} busy={false} onClose={noop} onChooseEngine={async () => undefined} onSaveEngine={asyncNoop} onSaveSync={asyncNoop} onUnbindSync={asyncNoop} onAuthenticate={asyncNoop} onRedeemSubscription={asyncNoop} onGenerateTraining={asyncNoop} onSaveStudy={asyncNoop} onAnalyzeStudy={asyncNoop} onCompleteTraining={asyncNoop}/><Callouts points={scene === "engine" ? [[1, 29, 17], [2, 63, 44], [3, 36, 85], [4, 79, 85]] : [[1, 29, 20], [2, 28, 37], [3, 33, 70], [4, 66, 82]]}/></>;
  if (scene === "review") return <><ReviewWorkspace board={board} report={report} reportBusy={false} reportExporting={false} engineReady libraryFolder="比赛复盘" libraryFolders={[{ name: "比赛复盘", system: true, gameCount: 1 }]} favorite libraryTags={["省赛", "中炮"]} flyknifePlanCount={0} trainingTasks={[]} trainingGenerating={false} analysisConfig={{ reportDepth: 22, multipv: 3, threads: 4, hashMb: 512 }} positionAnalysis={[]} positionAnalysisBusy={false} engineHintRequest={0} onClose={noop} onNavigate={noop} onMakeMainline={noop} onReorderBranches={noop} onRemoveBranch={noop} onGenerateReport={noop} onCancelReport={noop} onExportReport={noop} onOpenReport={noop} onImport={noop} onImportScreenshot={noop} onPaste={noop} onManualRecord={noop} onSaveLibrary={async () => true} onOpenFlyknife={noop} onGenerateTraining={asyncNoop} onOpenTraining={noop} onCompleteTraining={noop} onStudyIssue={noop} onStartU10={noop} onRunPositionAnalysis={noop}/><Callouts points={[[1, 47, 5], [2, 13, 84], [3, 22, 40], [4, 69, 12]]}/></>;
  if (scene === "theory") return <div className="fixture-panel"><TheoryLibraryView library={theoryLibrary} busy={false} onScan={noop} onCreateCard={noop} onReviewCard={noop} onFeedbackCard={noop}/><Callouts points={[[1, 18, 22], [2, 18, 28], [3, 18, 33], [4, 18, 48]]}/></div>;
  if (scene === "daily") return <><DailyWeeklyScene/><Callouts points={[[1, 7, 19], [2, 28, 9], [3, 43, 24], [4, 75, 25], [5, 72, 67]]}/></>;
  return <><U10Scene/><Callouts points={scene === "u10-before" ? [[1, 34, 14], [2, 26, 55], [3, 67, 30], [4, 67, 54], [5, 67, 80]] : scene === "u10-after" ? [[1, 60, 15], [2, 62, 27], [3, 82, 39], [4, 61, 57], [5, 80, 82]] : [[1, 50, 37], [2, 42, 43], [3, 33, 59], [4, 58, 59], [5, 72, 72]]}/></>;
}

createRoot(document.getElementById("root")!).render(<div className={`app-shell theme-light layout-compact manual-capture-root manual-scene-${scene}`}><Fixture/></div>);

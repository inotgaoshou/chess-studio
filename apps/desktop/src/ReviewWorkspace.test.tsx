import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardState, GameReportPresentationDto, LibraryFolder, ReportSidePresentationDto, TrainingTaskDto } from "./platform/types";
import { ReviewWorkspace } from "./ReviewWorkspace";

afterEach(cleanup);

const board: BoardState = {
  fen: "fen-2",
  rootSideToMove: "红方",
  sideToMove: "黑方",
  status: "对局进行中",
  pieces: [],
  history: [{
    id: "move-1",
    iccs: "h2e2",
    notation: "炮二平五",
    movedBy: "红方",
    from: { row: 7, col: 1 },
    to: { row: 7, col: 4 },
    scoreCp: 20,
    comment: "",
    isMainline: true,
  }],
  continuation: [],
  branches: [],
  title: "测试棋局",
  note: "红方：小红\n黑方：小黑\n结果：*",
  playable: true,
};

const emptyBoard: BoardState = { ...board, history: [], currentNode: undefined };
const earlierNodeBoard: BoardState = {
  ...board,
  currentNode: "move-1",
  continuation: [{
    id: "move-2", iccs: "h9g7", notation: "马8进7", movedBy: "黑方",
    from: { row: 2, col: 7 }, to: { row: 0, col: 6 }, scoreCp: 12, comment: "", isMainline: true,
  }],
};

const side = (name: "红方" | "黑方"): ReportSidePresentationDto => ({
  side: name,
  overall: 88,
  grade: "优",
  phases: { opening: 90, middle: 86, endgame: undefined },
  phaseGrades: { opening: "优", middle: "优", endgame: undefined },
  counts: { excellent: 2, good: 1, average: 0, poor: 1, error: 0, missedMate: 0 },
  coachQuality: "优",
  coachSummary: `${name}表现稳定。`,
  dimensions: { opening: 90, middle: 86, endgame: undefined, accuracy: 88, stability: 80 },
});

const report: GameReportPresentationDto = {
  title: "测试棋局",
  generatedAt: "2026-08-01T00:00:00Z",
  stale: false,
  analysisDepth: 26,
  engineLabel: "Pikafish",
  totalElapsedMs: 1500,
  cachedPositions: 2,
  red: side("红方"),
  black: side("黑方"),
  coachInsights: {
    branchName: "中炮开局复盘",
    branchPurpose: "比较实战和推荐线。",
    namingTips: [],
    weaknessFixes: [],
    studyPlan: ["先看最大转折", "再推演推荐线"],
  },
  trend: [{ label: "初始局面", scoreCp: 0 }, { label: "炮二平五", scoreCp: -240, nodeId: "move-1", deltaCp: -240 }],
  issues: [{
    nodeId: "move-1",
    notation: "炮二平五",
    movedBy: "红方",
    lossCp: 420,
    score: 20,
    grade: "差",
    missedMate: false,
    redScoreCp: -240,
    deltaCp: -420,
    bestNotation: "马二进三",
    pvNotation: ["马二进三", "马8进7"],
    coach: {
      intent: "想快速抢中路。",
      weakness: "出子节奏偏慢。",
      solution: "优先出马再组织进攻。",
      branchPlan: "建立推荐变招。",
    },
  }],
  standards: [],
  scoreGuide: [],
  disclaimer: "测试",
};

const folders: LibraryFolder[] = [{ name: "比赛复盘", system: true, gameCount: 1 }];
const trainingTask: TrainingTaskDto = {
  id: "task-1",
  gameId: "game-1",
  nodeId: "move-1",
  title: "复练中路出子",
  detail: "从炮二平五前重新选择着法。",
  taskType: "critical",
  createdAt: "2026-08-01T00:00:00Z",
};

function renderWorkspace(overrides: Partial<Parameters<typeof ReviewWorkspace>[0]> = {}) {
  const props: Parameters<typeof ReviewWorkspace>[0] = {
    board,
    report,
    reportBusy: false,
    reportExporting: false,
    engineReady: true,
    libraryFolder: "比赛复盘",
    libraryFolders: folders,
    favorite: false,
    libraryTags: ["后手"],
    flyknifePlanCount: 0,
    trainingTasks: [],
    trainingGenerating: false,
    analysisConfig: { reportDepth: 22, multipv: 3, threads: 4, hashMb: 512 },
    positionAnalysis: [],
    positionAnalysisBusy: false,
    positionAnalysisFen: undefined,
    engineHintRequest: 0,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onGenerateReport: vi.fn(),
    onCancelReport: vi.fn(),
    onExportReport: vi.fn(),
    onOpenReport: vi.fn(),
    onImport: vi.fn(),
    onImportScreenshot: vi.fn(),
    onPaste: vi.fn(),
    onManualRecord: vi.fn(),
    onSaveLibrary: vi.fn().mockResolvedValue(true),
    onOpenFlyknife: vi.fn(),
    onGenerateTraining: vi.fn().mockResolvedValue(undefined),
    onOpenTraining: vi.fn(),
    onCompleteTraining: vi.fn(),
    onStudyIssue: vi.fn(),
    onRunPositionAnalysis: vi.fn(),
    ...overrides,
  };
  render(<ReviewWorkspace {...props}/>);
  return props;
}

describe("ReviewWorkspace", () => {
  it("opens current-position engine hints and runs the requested analysis", async () => {
    const props = renderWorkspace({ engineHintRequest: 1 });
    expect(await screen.findByText("当前局面引擎提示")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "分析当前局面" }));
    expect(props.onRunPositionAnalysis).toHaveBeenCalledOnce();
  });

  it("renders a dedicated review route and report insight", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: /炮二平五/ })).toBeTruthy();
    expect(screen.getByText("整局复盘")).toBeTruthy();
    expect(screen.getByLabelText("复盘进度")).toBeTruthy();
    expect(within(screen.getByLabelText("复盘路线")).queryByText("录谱")).toBeNull();
    expect(screen.getByLabelText("复盘洞察")).toBeTruthy();
    expect(screen.queryByLabelText("棋谱播放控制")).toBeNull();
    expect(screen.getAllByText("88分").length).toBeGreaterThan(0);
  });

  it("shows the current move thought card from report coaching", () => {
    renderWorkspace();
    const card = screen.getByLabelText("当前着法思路");
    expect(within(card).getByText(/第 1 着 · 红方 炮二平五/)).toBeTruthy();
    expect(within(card).getByText("目的")).toBeTruthy();
    expect(within(card).getByText("风险")).toBeTruthy();
    expect(within(card).getByText("建议")).toBeTruthy();
    expect(within(card).getByText("想快速抢中路。")).toBeTruthy();
    expect(within(card).getByText("出子节奏偏慢。")).toBeTruthy();
    expect(within(card).getByText("可比较：实战「炮二平五」 vs 推荐「马二进三」")).toBeTruthy();
  });

  it("prefers manual purpose comments over report coaching", () => {
    renderWorkspace({
      board: {
        ...board,
        history: [{
          ...board.history[0],
          comment: "意图：先抢中路牵制黑方马炮\n风险：左翼出子可能偏慢\n计划：补马再出车",
        }],
      },
    });
    const card = screen.getByLabelText("当前着法思路");
    expect(within(card).getByText("当前着法思路 · 人工注释")).toBeTruthy();
    expect(within(card).getByText("先抢中路牵制黑方马炮")).toBeTruthy();
    expect(within(card).getByText("左翼出子可能偏慢")).toBeTruthy();
    expect(within(card).getByText("补马再出车")).toBeTruthy();
    expect(within(card).queryByText("想快速抢中路。")).toBeNull();
  });

  it("can hide and restore move thoughts without leaving expanded row details visible", async () => {
    renderWorkspace();
    expect(screen.getByLabelText("当前着法思路")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开第 1 着思路" }));
    expect(screen.getByLabelText("炮二平五 的着法思路")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "隐藏思路" }));
    expect(screen.queryByLabelText("当前着法思路")).toBeNull();
    expect(screen.queryByLabelText("炮二平五 的着法思路")).toBeNull();
    expect(screen.queryByRole("button", { name: /展开 .* 思路/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "显示思路" }));
    expect(screen.getByLabelText("当前着法思路")).toBeTruthy();
    expect(screen.queryByLabelText("炮二平五 的着法思路")).toBeNull();
  });

  it("keeps the full review title available when the header is visually compact", () => {
    const longTitle = "张国凤 柳大华 2004年第01届常家庄园杯全国冠军混双赛";
    renderWorkspace({ board: { ...board, title: longTitle } });
    const title = document.querySelector(".review-workbench-title strong");
    expect(title?.textContent).toContain("张国凤 柳大华");
    expect(title?.getAttribute("title")).toBe(longTitle);
  });

  it("shows generate CTA when report is missing", async () => {
    const props = renderWorkspace({ report: undefined });
    await userEvent.click(screen.getByRole("tab", { name: "整局报告" }));
    await userEvent.click(screen.getAllByRole("button", { name: "生成整局报告" })[0]);
    expect(props.onGenerateReport).toHaveBeenCalledOnce();
  });

  it("keeps report generation unavailable until an engine is configured", () => {
    renderWorkspace({ report: undefined, engineReady: false });
    expect(screen.getAllByRole<HTMLButtonElement>("button", { name: "生成整局报告" })[0].disabled).toBe(true);
  });

  it("offers cancellation while a report is running", async () => {
    const props = renderWorkspace({ report: undefined, reportBusy: true });
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onCancelReport).toHaveBeenCalledOnce();
  });

  it("keeps a new game with its default folder in the recording stage", async () => {
    const props = renderWorkspace({ board: emptyBoard, report: undefined });
    expect(screen.getByText(/待录谱 · 预设归档：比赛复盘（录入后确认）/)).toBeTruthy();
    expect(screen.queryByText("归档资料")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "导入棋谱" }));
    await userEvent.click(screen.getByRole("button", { name: "导入截图识别" }));
    await userEvent.click(screen.getByRole("button", { name: "一键录入" }));
    await userEvent.click(screen.getByRole("button", { name: "手动录谱" }));
    expect(props.onImport).toHaveBeenCalledOnce();
    expect(props.onImportScreenshot).toHaveBeenCalledOnce();
    expect(props.onPaste).toHaveBeenCalledOnce();
    expect(props.onManualRecord).toHaveBeenCalledOnce();
  });

  it("confirms the default archive after the first recorded move", () => {
    renderWorkspace({ report: undefined });
    expect(screen.getByText(/比赛复盘 · 已归档/)).toBeTruthy();
    expect(screen.getByLabelText("棋谱归档资料")).toBeTruthy();
    expect(screen.getByText(/已保存 · 比赛复盘 · 后手/)).toBeTruthy();
    expect(screen.queryByText(/Application Support/)).toBeNull();
  });

  it("keeps archive details collapsed by default and expands them on demand", async () => {
    renderWorkspace();
    const archive = screen.getByLabelText("棋谱归档资料");
    expect(within(archive).getByRole("button", { name: "展开" })).toBeTruthy();
    expect(within(archive).queryByText(/Application Support/)).toBeNull();
    await userEvent.click(within(archive).getByRole("button", { name: "展开" }));
    expect(within(archive).getByRole("button", { name: "收起" })).toBeTruthy();
    expect(within(archive).getByText(/Application Support/)).toBeTruthy();
    expect(within(archive).getByText("后手")).toBeTruthy();
  });

  it("keeps screenshot import and manual recording tools visible after a game has moves", async () => {
    const props = renderWorkspace();
    const tools = screen.getByLabelText("录谱与截图工具");
    expect(within(tools).getByRole("button", { name: "导入截图识别" })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: "新建手动录谱" })).toBeTruthy();
    expect(screen.getByText("将新建独立棋谱，当前复盘不会被覆盖。")).toBeTruthy();
    await userEvent.click(within(tools).getByRole("button", { name: "导入截图识别" }));
    await userEvent.click(within(tools).getByRole("button", { name: "新建手动录谱" }));
    expect(props.onImportScreenshot).toHaveBeenCalledOnce();
    expect(props.onManualRecord).toHaveBeenCalledOnce();
  });

  it("navigates from trend points", async () => {
    const props = renderWorkspace();
    await userEvent.click(screen.getByRole("tab", { name: "局势趋势" }));
    expect(document.querySelector(".evaluation-trend .trend-path")).toBeTruthy();
    expect(document.querySelector(".evaluation-trend circle.turning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /炮二平五，黑方优势 -240 cp，关键转折，点击跳转/ }));
    expect(props.onNavigate).toHaveBeenCalledWith("move-1");
  });

  it("groups issues by side and explains the learning conclusion before engine details", async () => {
    const props = renderWorkspace();
    await userEvent.click(screen.getByRole("tab", { name: "关键着法" }));
    expect(screen.getByRole("button", { name: /红方 1/ })).toBeTruthy();
    expect(screen.getByText("差招 · 这步损失约 4.2 兵")).toBeTruthy();
    expect(screen.getByText("走后：黑方优势 -240 cp")).toBeTruthy();
    expect(screen.getByText("建议先走：马二进三")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查看原因" }));
    expect(screen.getAllByText("出子节奏偏慢。").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "查看引擎详情" }));
    expect(screen.getByText(/原始局面分：-240 cp · 本步损失：420 cp/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /推演/ }));
    expect(props.onStudyIssue).toHaveBeenCalledWith("move-1");
  });

  it("keeps a long candidate line readable and expands it on demand", async () => {
    renderWorkspace({
      engineHintRequest: 1,
      positionAnalysisFen: board.fen,
      positionAnalysis: [{ multipv: 1, depth: 24, scoreCp: 174, notation: ["马三进四", "炮8进三", "马九进七", "车三平二", "车4退2", "马九进八"], pv: ["g0f2"] }],
    });
    expect(await screen.findByText("红方优势 +174 cp")).toBeTruthy();
    expect(screen.getByText("马三进四 炮8进三 马九进七 车三平二 车4退2 马九进八")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开完整线路" }));
    expect(screen.getByRole("button", { name: "收起线路" })).toBeTruthy();
  });

  it("shows archive controls for an unarchived game", async () => {
    const props = renderWorkspace({ libraryFolder: undefined });
    await userEvent.click(screen.getByRole("button", { name: "编辑归档" }));
    await userEvent.selectOptions(screen.getByLabelText("归档文件夹"), "比赛复盘");
    await userEvent.click(screen.getByRole("button", { name: "收藏" }));
    expect(props.onSaveLibrary).not.toHaveBeenCalled();
    expect(screen.getByText("未保存的修改")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "保存归档" }));
    expect(props.onSaveLibrary).toHaveBeenCalledWith("比赛复盘", true, ["后手"]);
  });

  it("keeps archived tag edits as a draft until saving", async () => {
    const props = renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "编辑归档" }));
    const tags = screen.getByLabelText("归档标签");
    await userEvent.clear(tags);
    await userEvent.type(tags, "省赛, 中炮");
    expect(props.onSaveLibrary).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "保存归档" }));
    expect(props.onSaveLibrary).toHaveBeenLastCalledWith("比赛复盘", false, ["省赛", "中炮"]);
  });

  it("switches from key moves to the full move list", async () => {
    renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    expect(screen.getByRole("button", { name: /炮二平五/ })).toBeTruthy();
  });

  it("expands a thought explanation for an individual route move", async () => {
    renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "展开第 1 着思路" }));
    const thought = screen.getByLabelText("炮二平五 的着法思路");
    expect(within(thought).getByText("想快速抢中路。")).toBeTruthy();
    expect(within(thought).getByText("优先出马再组织进攻。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "收起第 1 着思路" }));
    expect(screen.queryByLabelText("炮二平五 的着法思路")).toBeNull();
  });

  it("keeps later moves visible when browsing an earlier move in the full score", async () => {
    const props = renderWorkspace({ board: earlierNodeBoard });
    const scope = screen.getByLabelText("棋谱范围");
    expect(within(scope).getAllByRole("button").map((button) => button.textContent)).toEqual(["完整棋谱", "关键着法"]);
    await userEvent.click(within(scope).getByRole("button", { name: "完整棋谱" }));
    const round = screen.getByLabelText("第 1 回合");
    expect(within(round).getByRole("button", { name: "红方 炮二平五" })).toBeTruthy();
    const later = within(round).getByRole("button", { name: "黑方 马8进7" });
    expect(later).toBeTruthy();
    await userEvent.click(later);
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith("move-2");
    expect(screen.getByRole("button", { name: /炮二平五/ })).toBeTruthy();
  });

  it("marks saved flyknife routes with their intent without expanding ordinary moves", () => {
    const flyknifeBoard = {
      ...board,
      history: [{ ...board.history[0], comment: "飞刀方案：测试红方飞刀\n执方：红方\n诱导：h9g7\n主变：马8进7 炮二平五 马2进3\n最佳防守：马2进3\n风险：实战可用：对常见应手形成主动攻势。" }],
    };
    renderWorkspace({ board: flyknifeBoard });

    expect(screen.getByText("已验证飞刀")).toBeTruthy();
    expect(screen.getByText("意图：马8进7 炮二平五 马2进3")).toBeTruthy();
    expect(screen.getByLabelText("复盘棋谱路线").querySelector(".review-route-move")?.className).toContain("has-flyknife");
  });

  it("uses flyknife intent in the current move thought card when no active report is available", () => {
    const flyknifeBoard = {
      ...board,
      history: [{ ...board.history[0], comment: "飞刀方案：测试红方飞刀\n意图：诱导黑方补右马后抢中路\n最佳防守：马2进3\n风险：反击候选需要复核。" }],
    };
    renderWorkspace({ board: flyknifeBoard, report: undefined });
    const card = screen.getByLabelText("当前着法思路");
    expect(within(card).getByText("当前着法思路 · 飞刀标注")).toBeTruthy();
    expect(within(card).getByText("诱导黑方补右马后抢中路")).toBeTruthy();
    expect(within(card).getByText("反击候选需要复核。")).toBeTruthy();
  });

  it("falls back to lightweight move thought hints before analysis", () => {
    renderWorkspace({ report: undefined });
    const card = screen.getByLabelText("当前着法思路");
    expect(within(card).getByText("当前着法思路 · 轻量提示")).toBeTruthy();
    expect(within(card).getByText("等待分析后可判断这步的目的和改进方向。")).toBeTruthy();
    expect(within(card).getByText("未分析时显示的是规则化轻量提示，生成整局报告后会更准确。")).toBeTruthy();
  });

  it("does not render stale report scores, trend or export actions", () => {
    renderWorkspace({ report: { ...report, stale: true } });
    expect(screen.getByText("棋谱或引擎配置已变化，旧报告不会作为当前结果显示。请重新生成整局报告。")).toBeTruthy();
    expect(screen.queryByText("中炮开局复盘")).toBeNull();
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
  });

  it("makes flyknife the primary action for the current report issue", async () => {
    const props = renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "设计飞刀" }));
    expect(props.onOpenFlyknife).toHaveBeenCalledOnce();
  });

  it("marks the flyknife stage complete when this game has a saved plan", () => {
    renderWorkspace({ flyknifePlanCount: 1 });
    const stage = within(screen.getByLabelText("复盘进度")).getByText("飞刀").closest("li");
    expect(stage?.className).toContain("complete");
  });

  it("opens the flyknife laboratory and training insight from the top workflow", async () => {
    const props = renderWorkspace();
    const workflow = screen.getByLabelText("复盘进度");
    await userEvent.click(within(workflow).getByRole("button", { name: "飞刀" }));
    expect(props.onOpenFlyknife).toHaveBeenCalledOnce();
    await userEvent.click(within(workflow).getByRole("button", { name: "训练" }));
    expect(screen.getByRole("tab", { name: "训练" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the persisted report and exports only an active report", async () => {
    const props = renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "完整报告" }));
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(props.onOpenReport).toHaveBeenCalledOnce();
    expect(props.onExportReport).toHaveBeenCalledOnce();
  });

  it("opens training and records a completed task", async () => {
    const onStartU10 = vi.fn();
    const props = renderWorkspace({ trainingTasks: [trainingTask], onStartU10 });
    await userEvent.click(screen.getByRole("tab", { name: "训练" }));
    expect(screen.getByText("这几题怎样选出来？")).toBeTruthy();
    expect(screen.getByText(/本着使己方局面下降至少 0.80 分/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "开始拆棋" }));
    expect(onStartU10).toHaveBeenCalledWith("move-1");
    await userEvent.click(screen.getByRole("checkbox", { name: /复练中路出子/ }));
    expect(props.onCompleteTraining).toHaveBeenCalledWith("task-1", true);
  });

  it("switches to training after generating and shows a reinforcement result", async () => {
    const props = renderWorkspace({
      trainingGeneration: { tasks: [], criticalCount: 0, reinforcementCount: 2 },
    });
    await userEvent.click(screen.getByRole("button", { name: "生成训练任务" }));
    expect(props.onGenerateTraining).toHaveBeenCalledOnce();
    expect(screen.getByText("本局没有严重失误，已生成 2 个巩固训练。")).toBeTruthy();
  });
});

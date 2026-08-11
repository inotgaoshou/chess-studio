import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualTrackView } from "./ManualTrackView";
import type { ManualTreeNode, MoveItem, PreviewLineStep, Side } from "./platform";
import { buildStrategyInsight } from "./strategyInsights";

afterEach(cleanup);

function move(id: string, notation: string, movedBy: Side, isMainline = true): MoveItem {
  return { id, notation, movedBy, iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "", isMainline };
}

function previewStep(notation: string, movedBy: Side): PreviewLineStep {
  return {
    fen: "preview fen",
    from: { row: 9, col: 1 },
    movedBy,
    notation,
    pieces: [],
    status: "正常",
    to: { row: 7, col: 2 },
  };
}

function renderTrack(options: {
  bestMoveHint?: Parameters<typeof ManualTrackView>[0]["bestMoveHint"];
  onExportLine?: (contents: string) => Promise<string | undefined>;
  onStartBestMovePractice?: () => void;
  previewBranch?: Parameters<typeof ManualTrackView>[0]["previewBranch"];
  previewBranches?: Parameters<typeof ManualTrackView>[0]["previewBranches"];
  strategyInsight?: Parameters<typeof ManualTrackView>[0]["strategyInsight"];
} = {}) {
  const red = move("r1", "马八进七", "红方");
  const black = move("b1", "马8进7", "黑方");
  const main = move("r2", "车九平八", "红方");
  const branch = move("v1", "炮2平5", "红方", false);
  const nodes: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: main, children: [] }, { move: branch, children: [] }] }] }];
  const onNavigate = vi.fn();
  const onViewModeChange = vi.fn();
  render(<ManualTrackView
    bestMoveHint={options.bestMoveHint}
    currentNode="b1"
    editing={false}
    formatScore={() => "+0.23"}
    history={[red, black]}
    nodes={nodes}
    onMakeMainline={vi.fn()}
    onNavigate={onNavigate}
    onRemove={vi.fn()}
    onExportLine={options.onExportLine}
    onStartBestMovePractice={options.onStartBestMovePractice}
    onViewModeChange={onViewModeChange}
    previewBranch={options.previewBranch}
    previewBranches={options.previewBranches}
    strategyInsight={options.strategyInsight}
    qualityByMoveId={new Map([["b1", { score: 88, grade: "优" }]])}
    viewMode="track"
  />);
  return { onNavigate, onViewModeChange };
}

describe("ManualTrackView", () => {
  it("navigates moves and switches between track and tree modes", () => {
    const { onNavigate, onViewModeChange } = renderTrack();

    fireEvent.click(screen.getByTitle("黑方 · 马8进7 · 88分"));
    expect(onNavigate).toHaveBeenCalledWith("b1");
    expect(screen.getByText("当前局面")).toBeTruthy();
    expect(screen.getByText("分支树")).toBeTruthy();
    fireEvent.click(screen.getByText("传统树"));
    expect(onViewModeChange).toHaveBeenCalledWith("tree");
  });

  it("navigates to a node when its move number is clicked", () => {
    const { onNavigate } = renderTrack();

    fireEvent.click(screen.getByRole("button", { name: "跳转到第 1 回合，第 2 个半回合：马8进7" }));

    expect(onNavigate).toHaveBeenCalledWith("b1");
  });

  it("opens a branch comparison from the branch preview", () => {
    renderTrack();

    fireEvent.click(screen.getByTitle("对比 炮2平5"));
    expect(screen.getByText("分支对比：马8进7")).toBeTruthy();
    expect(screen.getAllByText(/车九平八/).length).toBeGreaterThan(0);
  });

  it("switches a branch from its dropdown without changing the mainline", () => {
    const { onNavigate } = renderTrack();

    fireEvent.change(screen.getByLabelText("变招选择"), { target: { value: "v1" } });

    expect(onNavigate).toHaveBeenCalledWith("v1");
    expect(screen.getByRole("option", { name: /A · 主线 · 车九平八/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /B · 炮2平5/ })).toBeTruthy();
  });

  it("toggles fork expansion without navigating", () => {
    const { onNavigate } = renderTrack();

    fireEvent.click(screen.getByLabelText("收起 1 条变化"));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText("炮2平5")).toBeNull();
    fireEvent.click(screen.getByLabelText("展开 1 条变化"));
    expect(screen.getByText("炮2平5")).toBeTruthy();
  });

  it("opens the current line dialog from start to the current position", () => {
    renderTrack();

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));

    const dialog = screen.getByRole("dialog", { name: "当前局面完整棋谱" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("从开始到当前局面")).toBeTruthy();
    expect(within(dialog).getByText("马八进七")).toBeTruthy();
    expect(within(dialog).getByText("+0.23")).toBeTruthy();
    expect(within(dialog).getByText("马8进7")).toBeTruthy();
    expect(within(dialog).getByText("优88分")).toBeTruthy();
  });

  it("shows a directly viewable chess record image", () => {
    renderTrack();

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    fireEvent.click(screen.getByRole("button", { name: "棋谱图" }));

    expect(screen.getByRole("img", { name: "当前局面完整棋谱图片" }).getAttribute("src")).toContain("data:image/svg+xml");
    expect(screen.getByRole("button", { name: "下载图片" })).toBeTruthy();
  });

  it("shows opening logic and includes it in the exported text", async () => {
    const onExportLine = vi.fn().mockResolvedValue("/tmp/当前局面棋谱.txt");
    renderTrack({ onExportLine });

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    fireEvent.click(screen.getByRole("button", { name: "思路" }));
    expect(screen.getByRole("region", { name: "开局思路" })).toBeTruthy();
    expect(screen.getByText("以子力展开和中心控制为先")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(onExportLine).toHaveBeenCalledTimes(1));
    expect(onExportLine.mock.calls[0][0]).toContain("开局思路（根据走法自动归纳，非引擎结论）");
    expect(onExportLine.mock.calls[0][0]).toContain("底层逻辑：");
  });

  it("shows overview, phase checks, evidence, and exports the coach-style insight", async () => {
    const onExportLine = vi.fn().mockResolvedValue("/tmp/当前局面棋谱.txt");
    const strategyInsight = buildStrategyInsight({
      sideToMove: "红方", ply: 8, phase: "opening", pieces: [], history: ["炮二平五"],
      analysis: { multipv: 1, depth: 16, scoreCp: 20, notation: ["马二进三", "马8进7"], pv: ["b0c2", "b9c7"] }, engineName: "Pikafish",
    });
    renderTrack({ onExportLine, strategyInsight });

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    fireEvent.click(screen.getByRole("button", { name: "思路" }));
    expect(screen.getByRole("region", { name: "三阶段思路分析" })).toBeTruthy();
    expect(screen.getByText("当前结论")).toBeTruthy();
    expect(screen.getByText("问题着数")).toBeTruthy();
    expect(screen.getByText(/第 8 着/)).toBeTruthy();
    expect(screen.getByText("推荐关注")).toBeTruthy();
    expect(screen.getByText("本手风险")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开局" }));
    expect(screen.getByText("是否命中布局体系")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中局" }));
    expect(screen.getByText("候选着漏算")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "残局" }));
    expect(screen.getByText("兵卒效率")).toBeTruthy();
    expect(screen.getByText("残局计划模板")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "依据" }));
    expect(screen.getByText(/Pikafish证据/)).toBeTruthy();
    expect(screen.getByText("赵鑫鑫棋理卡")).toBeTruthy();
    expect(screen.getByText("大师类似棋谱")).toBeTruthy();
    expect(screen.getByText(/综合置信度/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(onExportLine).toHaveBeenCalledTimes(1));
    expect(onExportLine.mock.calls[0][0]).toContain("总览");
    expect(onExportLine.mock.calls[0][0]).toContain("问题着数：第 8 着");
    expect(onExportLine.mock.calls[0][0]).toContain("Pikafish证据");
    expect(onExportLine.mock.calls[0][0]).toContain("综合置信度");
  });

  it("reveals the best move hint without playing and starts best-move practice on request", () => {
    const onStartBestMovePractice = vi.fn();
    const strategyInsight = buildStrategyInsight({
      sideToMove: "红方", ply: 8, phase: "opening", pieces: [], history: ["炮二平五"],
      analysis: { multipv: 1, depth: 16, scoreCp: 20, notation: ["马二进三", "马8进7"], pv: ["b0c2", "b9c7"] }, engineName: "Pikafish",
    });
    renderTrack({
      bestMoveHint: { bestMove: "b0c2", bestMoveText: "马二进三", topMoves: [{ iccs: "b0c2", text: "马二进三", rank: 1 }, { iccs: "h2e2", text: "炮二平五", rank: 2 }] },
      onStartBestMovePractice,
      strategyInsight,
    });

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    fireEvent.click(screen.getByRole("button", { name: "思路" }));
    expect(screen.getByRole("button", { name: "提示正着" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "尝试正着" })).toBeTruthy();
    expect(screen.queryByText(/正着提示/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "提示正着" }));
    expect(screen.getByText(/正着提示/)).toBeTruthy();
    expect(screen.getByText("马二进三")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "尝试正着" }));

    expect(onStartBestMovePractice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "当前局面完整棋谱" })).toBeNull();
  });

  it("exports the current line with per-move scores", async () => {
    const onExportLine = vi.fn().mockResolvedValue("/tmp/当前局面棋谱.txt");
    renderTrack({ onExportLine });

    fireEvent.click(screen.getByRole("button", { name: "完整棋谱" }));
    fireEvent.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(onExportLine).toHaveBeenCalledTimes(1));
    expect(onExportLine.mock.calls[0][0]).toContain("马八进七（+0.23）");
    expect(onExportLine.mock.calls[0][0]).toContain("马8进7（优88分）");
  });

  it("renders candidate preview as a virtual dashed AI branch without navigation", () => {
    const { onNavigate } = renderTrack({
      previewBranch: {
        activeStep: 1,
        firstMove: "马八进七",
        rank: 1,
        sourceEngineName: "Pikafish",
        steps: [previewStep("马八进七", "红方"), previewStep("炮2平3", "黑方")],
      },
    });

    expect(screen.getByRole("region", { name: "AI 推荐虚线预测分支" })).toBeTruthy();
    expect(screen.getByText("虚线预测")).toBeTruthy();
    expect(screen.getByText("AI推荐 · Pikafish")).toBeTruthy();
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(screen.getByText("炮2平3")).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("renders multiple engine preview branches and merged agreement labels without navigation", () => {
    const { onNavigate } = renderTrack({
      previewBranches: [
        {
          activeStep: 0,
          engineNames: ["Pikafish", "Fairy"],
          firstMove: "马八进七",
          label: "AI推荐 · 2个引擎一致（主 + 1对比）",
          merged: true,
          rank: 1,
          scoreTexts: ["Pikafish +39 深22", "Fairy +41 深19"],
          steps: [previewStep("马八进七", "红方"), previewStep("炮2平3", "黑方")],
        },
        {
          activeStep: 0,
          engineNames: ["Cyclone"],
          firstMove: "炮二平五",
          label: "AI推荐 · Cyclone",
          rank: 2,
          scoreTexts: ["Cyclone +28 深18"],
          steps: [previewStep("炮二平五", "红方")],
        },
      ],
    });

    expect(screen.getByText("AI推荐 · 2 条引擎分支")).toBeTruthy();
    expect(screen.getByText("AI推荐 · 2个引擎一致（主 + 1对比）")).toBeTruthy();
    expect(screen.getByText("AI推荐 · Cyclone")).toBeTruthy();
    expect(screen.getByText(/Pikafish \+39 深22/)).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

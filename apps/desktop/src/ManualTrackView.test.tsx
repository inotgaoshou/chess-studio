import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualTrackView } from "./ManualTrackView";
import type { ManualTreeNode, MoveItem, PreviewLineStep, Side } from "./platform";

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
  onExportLine?: (contents: string) => Promise<string | undefined>;
  previewBranch?: Parameters<typeof ManualTrackView>[0]["previewBranch"];
  previewBranches?: Parameters<typeof ManualTrackView>[0]["previewBranches"];
} = {}) {
  const red = move("r1", "马八进七", "红方");
  const black = move("b1", "马8进7", "黑方");
  const main = move("r2", "车九平八", "红方");
  const branch = move("v1", "炮2平5", "红方", false);
  const nodes: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: main, children: [] }, { move: branch, children: [] }] }] }];
  const onNavigate = vi.fn();
  const onViewModeChange = vi.fn();
  render(<ManualTrackView
    currentNode="b1"
    editing={false}
    formatScore={() => "+0.23"}
    history={[red, black]}
    nodes={nodes}
    onMakeMainline={vi.fn()}
    onNavigate={onNavigate}
    onRemove={vi.fn()}
    onExportLine={options.onExportLine}
    onViewModeChange={onViewModeChange}
    previewBranch={options.previewBranch}
    previewBranches={options.previewBranches}
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

  it("opens a branch comparison from the branch preview", () => {
    renderTrack();

    fireEvent.click(screen.getByTitle("对比 炮2平5"));
    expect(screen.getByText("分支对比：马8进7")).toBeTruthy();
    expect(screen.getAllByText(/车九平八/).length).toBeGreaterThan(0);
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
          label: "AI推荐 · 2个引擎一致",
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
    expect(screen.getByText("AI推荐 · 2个引擎一致")).toBeTruthy();
    expect(screen.getByText("AI推荐 · Cyclone")).toBeTruthy();
    expect(screen.getByText(/Pikafish \+39 深22/)).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameReportPresentationDto, ReportSidePresentationDto } from "./platform";
import { GameReportDialog } from "./GameReportView";

afterEach(cleanup);

const side = (name: "红方" | "黑方"): ReportSidePresentationDto => ({
  side: name,
  overall: 86,
  grade: "优",
  phases: { opening: 90, middle: 82, endgame: undefined },
  phaseGrades: { opening: "优", middle: "优", endgame: undefined },
  counts: { excellent: 3, good: 1, average: 0, poor: 0, error: 1, missedMate: 1 },
  coachQuality: "优",
  coachSummary: `${name}整体表现优秀。`,
  dimensions: { opening: 90, middle: 82, endgame: undefined, accuracy: 86, stability: 80 },
});

const report: GameReportPresentationDto = {
  title: "测试棋局",
  generatedAt: "2026-07-29T08:30:00Z",
  stale: true,
  analysisDepth: 20,
  engineLabel: "Pikafish",
  totalElapsedMs: 2000,
  cachedPositions: 1,
  openingSummary: { code: "R01", name: "中炮局", officialMoves: 1, source: "内置开局库" },
  red: side("红方"),
  black: side("黑方"),
  coachInsights: {
    branchName: "中炮局-第1着-红方修正炮二平五",
    branchPurpose: "这条线路用于比较实战着与推荐线的进攻思路。",
    namingTips: ["主线保存实战。", "变招A/B用于比较不同候选着法。"],
    weaknessFixes: ["红方开局阶段优先完成出子。", "黑方中局阶段先补防再反击。"],
    studyPlan: ["先定位最大转折。", "再建立推荐变招分支。"],
  },
  trend: [{ label: "炮二平五", scoreCp: 20, nodeId: "move-1" }],
  issues: [{
    nodeId: "move-1",
    notation: "炮二平五",
    movedBy: "红方",
    lossCp: 500,
    score: 14,
    grade: "错",
    missedMate: true,
    redScoreCp: -240,
    deltaCp: -500,
    coach: {
      intent: "走前已有强制杀棋。",
      weakness: "本着后红方视角变化 -500。",
      solution: "优先试走推荐线。",
      branchPlan: "建立变招分支。",
    },
  }],
  standards: [
    { grade: "优", qualityRange: "80-100 分", description: "接近最佳" },
    { grade: "良", qualityRange: "60-79 分", description: "质量良好" },
    { grade: "中", qualityRange: "40-59 分", description: "可以改进" },
    { grade: "差", qualityRange: "20-39 分", description: "明显失误" },
    { grade: "错", qualityRange: "0-19 分", description: "严重错误" },
  ],
  scoreGuide: [{ scoreCp: 1000, label: "约一车" }],
  disclaimer: "不等同于天天象棋内部算法。",
};

describe("GameReportDialog", () => {
  it("shows the full report and closes with Escape", () => {
    const onClose = vi.fn();
    render(<GameReportDialog report={report} exporting={false} onClose={onClose} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);

    expect(screen.getByRole("dialog", { name: "测试棋局整局分析报告" })).toBeTruthy();
    expect(screen.getByText("线路已变化，此报告已过期")).toBeTruthy();
    expect(screen.getByText("私教建议与变招命名")).toBeTruthy();
    expect(screen.getByText("中炮局-第1着-红方修正炮二平五")).toBeTruthy();
    expect(screen.getByRole("table", { name: "质量评分等级" }).textContent).toContain("优80-100 分");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("prevents duplicate exports while exporting", () => {
    render(<GameReportDialog report={report} exporting onClose={vi.fn()} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);
    expect((screen.getByRole("button", { name: "正在导出" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes from the backdrop and close button, then restores focus", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(<GameReportDialog report={report} exporting={false} onClose={onClose} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);
    const backdrop = view.container.querySelector<HTMLElement>(".report-dialog-backdrop")!;

    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "关闭报告" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes and navigates when a critical move is selected", async () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<GameReportDialog report={report} exporting={false} onClose={onClose} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={onNavigate} onStudy={vi.fn()}/>);

    await userEvent.click(screen.getByRole("button", { name: /定位炮二平五/ }));
    expect(onNavigate).toHaveBeenCalledWith("move-1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes and enters variation study from a critical move", async () => {
    const onClose = vi.fn();
    const onStudy = vi.fn();
    render(<GameReportDialog report={report} exporting={false} onClose={onClose} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={onStudy}/>);

    await userEvent.click(screen.getByRole("button", { name: "推演" }));
    expect(onStudy).toHaveBeenCalledWith("move-1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows raw position change separately from move quality", () => {
    render(<GameReportDialog report={report} exporting={false} onClose={vi.fn()} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);

    expect(screen.getByText("局面 -240 · 变化 -500")).toBeTruthy();
    expect(screen.getByText("红方损失 500cp · 质量 14分")).toBeTruthy();
  });
});

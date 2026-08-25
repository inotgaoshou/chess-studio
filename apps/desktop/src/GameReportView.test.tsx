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
    score: 0,
    grade: "错",
    missedMate: true,
    redScoreCp: -240,
    deltaCp: -500,
    masterStyleHints: [{
      sampleId: "sample-1",
      profileId: "zhao-style",
      playerName: "赵鑫鑫",
      confidence: "exact",
      reason: "完全相同 FEN 的公开棋谱实战参考",
      sourceTitle: "赵鑫鑫 先胜 某棋手",
      eventName: "测试赛事",
      gameDate: "2026-01-01",
      ply: 12,
      phase: "opening",
      beforeFen: "fen-a",
      playedMove: "h2e2",
      playedMoveRank: 1,
      playedMoveInTopn: true,
      bestMove: "h2e2",
    bestScoreCp: 36,
      theoryCards: [{ id: 1, title: "布局阶段先协调强子", summary: "开局应优先让车马炮形成配合。", sourceBook: "赵鑫鑫布局棋理", sourcePageStart: 12 }],
    }],
    trainingTags: ["专属布局", "战术漏算", "深度复盘"],
    reviewPrompt: "复盘时先重扫双方将军、吃子、捉双，再核对主变。",
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
  it("shows the full report and closes with Escape", async () => {
    const onClose = vi.fn();
    render(<GameReportDialog report={report} exporting={false} onClose={onClose} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);

    expect(screen.getByRole("dialog", { name: "测试棋局整局分析报告" })).toBeTruthy();
    expect(screen.getByText("线路已变化，此报告已过期")).toBeTruthy();
    expect(screen.getByText("私教建议与变招命名")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查看原因" }));
    expect(screen.getByText("赵鑫鑫风格启发")).toBeTruthy();
    expect(screen.getByText(/赵鑫鑫公开棋谱曾走 h2e2/)).toBeTruthy();
    expect(screen.getByText(/棋理依据：布局阶段先协调强子/)).toBeTruthy();
    expect(screen.getByLabelText("炮二平五训练法归因").textContent).toContain("战术漏算");
    expect(screen.getByText(/复盘时先重扫/)).toBeTruthy();
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

    await userEvent.click(screen.getByRole("button", { name: "自由推演" }));
    expect(onStudy).toHaveBeenCalledWith("move-1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps child-friendly issue summaries ahead of expandable engine data", async () => {
    render(<GameReportDialog report={report} exporting={false} onClose={vi.fn()} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={vi.fn()} onStudy={vi.fn()}/>);

    expect(screen.getByText("走后：黑方优势 -240 cp")).toBeTruthy();
    expect(screen.getByText("错过直接取胜机会")).toBeTruthy();
    expect(screen.queryByText(/原始局面分：-240 cp/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "查看原因" }));
    await userEvent.click(screen.getByRole("button", { name: "查看引擎详情" }));
    expect(screen.getByText(/原始局面分：-240 cp · 本步损失：500 cp/)).toBeTruthy();
  });

  it("uses the shared smooth trend chart and navigates from its current point", async () => {
    const onNavigate = vi.fn();
    render(<GameReportDialog report={report} exporting={false} onClose={vi.fn()} onExport={vi.fn()} onRegenerate={vi.fn()} onNavigate={onNavigate} onStudy={vi.fn()} currentNode="move-1"/>);

    expect(document.querySelector(".report-trend .trend-path")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /炮二平五，局面接近均势，点击跳转/ }));
    expect(onNavigate).toHaveBeenCalledWith("move-1");
  });
});

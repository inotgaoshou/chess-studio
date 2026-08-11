import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactEngineAnalysisList, CompactReferencePanels } from "./CompactWorkspace";

afterEach(cleanup);

describe("CompactReferencePanels", () => {
  const common = {
    cloudEnabled: true,
    bookLoading: false,
    bookRows: [{ id: "cloud-h2e2", iccs: "h2e2", notation: "马二进三", scoreText: "红优 +18", winRateText: "52%", source: "ChessDB", advantageText: "首选" }],
    evaluationRows: [{ id: "pv-1", iccs: "h2e2", notation: "马二进三", scoreText: "+20", depthText: "20", role: "首选" }],
    evaluationLabel: "红方稍优",
    evaluationScore: "+20",
    qualityText: "96 优",
    redShare: 52,
    depthText: "20",
    timeText: "1.5s",
    onOpenSettings: vi.fn(),
    onPlayBookMove: vi.fn(),
    onPlayEvaluationMove: vi.fn(),
  };

  it("keeps the book and evaluation dashboards visible together", () => {
    render(<CompactReferencePanels {...common}/>);
    expect(screen.getByRole("region", { name: "简洁布局开局库" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "简洁布局评估信息" })).toBeTruthy();
    expect(screen.getByText("96 优")).toBeTruthy();
  });

  it("routes book and engine candidate moves through the supplied handlers", () => {
    const onPlayBookMove = vi.fn();
    const onPlayEvaluationMove = vi.fn();
    render(<CompactReferencePanels {...common} onPlayBookMove={onPlayBookMove} onPlayEvaluationMove={onPlayEvaluationMove}/>);
    const moveButtons = screen.getAllByRole("button", { name: /马二进三/ });
    fireEvent.click(moveButtons[0]);
    fireEvent.click(moveButtons[1]);
    expect(onPlayBookMove).toHaveBeenCalledWith("h2e2");
    expect(onPlayEvaluationMove).toHaveBeenCalledWith("h2e2");
  });

  it("shows a useful empty state when cloud book is disabled", () => {
    render(<CompactReferencePanels {...common} cloudEnabled={false} bookRows={[]}/>);
    expect(screen.getByText("ChessDB 云库未启用")).toBeTruthy();
    expect(screen.getByText("0 条 · 云库关闭")).toBeTruthy();
  });

  it("shows local book win/draw/loss distribution and sample count without inventing cloud details", () => {
    render(<CompactReferencePanels
      {...common}
      cloudEnabled={false}
      bookRows={[{
        id: "xqb-h2e2",
        iccs: "h2e2",
        notation: "马二进三",
        scoreText: "红优 +12",
        winRateText: "54%",
        source: "本地 XQB",
        sampleCount: 71368,
        distribution: { redWin: 36, draw: 32, blackWin: 32 },
      }]}
    />);

    expect(screen.getByText("1 条 · 云库关闭")).toBeTruthy();
    expect(screen.getAllByText("本地 XQB").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("胜 36% ，和 32% ，负 32%")).toBeTruthy();
    expect(screen.getByText("71,368")).toBeTruthy();
    expect(screen.getByText("红优 +12")).toBeTruthy();
  });

  it("shows cloud statistics as a real switchable evaluation view", () => {
    render(<CompactReferencePanels
      {...common}
      bookRows={[
        { id: "cloud-h2e2", iccs: "h2e2", notation: "马二进三", scoreText: "红优 +18", winRateText: "52%", source: "ChessDB", advantageText: "差 14" },
        { id: "cloud-b2e2", iccs: "b2e2", notation: "炮八平五", scoreText: "红优 +32", winRateText: "57%", source: "ChessDB", advantageText: "首选" },
      ]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "开局库统计" }));
    expect(screen.getByText("开局库候选")).toBeTruthy();
    expect(screen.getByText("最高分")).toBeTruthy();
    expect(screen.getByTitle(/炮八平五/).textContent).toContain("红优 +32");
    expect(screen.getByTitle(/马二进三/).textContent).toContain("差 14");
    expect(screen.getByText("55%")).toBeTruthy();
  });

  it("can collapse the compact cloud book column", () => {
    const onToggleCollapsed = vi.fn();
    render(<CompactReferencePanels {...common} collapsed onToggleCollapsed={onToggleCollapsed}/>);
    fireEvent.click(screen.getByRole("button", { name: "展开云库" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "简洁布局评估信息" })).toBeNull();
  });
});

describe("CompactEngineAnalysisList", () => {
  it("shows direct recommendation rows without noisy metric blocks", () => {
    const onPlayMove = vi.fn();
    render(<CompactEngineAnalysisList
      busy={false}
      rows={[{
        id: "pv-1",
        iccs: "h2e2",
        rank: 1,
        depthText: "44",
        scoreText: "+31",
        timeText: "13.8s",
        npsText: "4504K",
        hfText: "21%",
        lineLengthText: "1.5/8回合",
        lineText: "马八进七 炮9平7 车三平四",
      }]}
      onPlayMove={onPlayMove}
    />);

    expect(screen.getByText("1. 马八进七")).toBeTruthy();
    expect(screen.getByText("分 +31")).toBeTruthy();
    expect(screen.getByText("深 44")).toBeTruthy();
    expect(screen.getByText("1.5/8回合")).toBeTruthy();
    expect(screen.getByText("后续：炮9平7 车三平四")).toBeTruthy();
    expect(screen.queryByText("NPS:4504K")).toBeNull();
    expect(screen.queryByText("HF:21%")).toBeNull();
    expect(screen.queryByText(/私教讲解/)).toBeNull();
    expect(screen.queryByText(/完整 PV/)).toBeNull();

    fireEvent.click(screen.getByRole("row", { name: /马八进七/ }));
    expect(onPlayMove).toHaveBeenCalledWith("h2e2", expect.objectContaining({ id: "pv-1" }));
  });

  it("shows preview and adopt actions on each engine candidate row", () => {
    const onPreview = vi.fn();
    const onAdopt = vi.fn();
    render(<CompactEngineAnalysisList
      busy={false}
      rows={[{
        id: "pv-1",
        iccs: "h2e2",
        analyzedFen: "position-fen",
        line: { depth: 30, scoreCp: 23, multipv: 1, notation: ["炮二平五", "马8进7"], pv: ["h2e2", "h9g7"] },
        source: { id: "primary", name: "Pikafish", primary: true },
        rank: 1,
        previewActive: true,
        depthText: "30",
        scoreText: "+23",
        timeText: "35.1s",
        npsText: "7.0M",
        hfText: "83%",
        lineLengthText: "1/8回合",
        lineText: "炮二平五 马8进7",
      }]}
      onPlayMove={vi.fn()}
      onPreview={onPreview}
      onAdopt={onAdopt}
    />);

    expect(screen.getByRole("row", { name: /炮二平五/ }).className).toContain("preview-active");
    fireEvent.click(screen.getByRole("row", { name: /炮二平五/ }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "pv-1", analyzedFen: "position-fen" }));

    fireEvent.click(screen.getByRole("button", { name: "取消预览候选 1" }));
    expect(onPreview).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(onAdopt).toHaveBeenCalledWith(expect.objectContaining({ id: "pv-1", iccs: "h2e2" }));
  });
});

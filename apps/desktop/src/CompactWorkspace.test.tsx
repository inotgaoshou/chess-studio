import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactEngineAnalysisList, CompactReferencePanels } from "./CompactWorkspace";

afterEach(cleanup);

describe("CompactReferencePanels", () => {
  const common = {
    cloudEnabled: true,
    bookLoading: false,
    bookRows: [{ id: "cloud-h2e2", iccs: "h2e2", notation: "马二进三", scoreText: "+18", winRateText: "52%", source: "ChessDB" }],
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
    expect(screen.getByText("当前局面暂无本地库着，ChessDB 云库未启用")).toBeTruthy();
    expect(screen.getByText("0 条 · 云库关闭")).toBeTruthy();
  });

  it("keeps local book results available when ChessDB is disabled", () => {
    render(<CompactReferencePanels
      {...common}
      cloudEnabled={false}
      bookRows={[{ id: "xqb-h2e2", iccs: "h2e2", notation: "马二进三", scoreText: "+12", winRateText: "54%", source: "本地 XQB" }]}
    />);

    expect(screen.getByText("1 条 · 云库关闭")).toBeTruthy();
    expect(screen.getByText("本地 XQB")).toBeTruthy();
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
  it("shows compact TCHESS-style engine metrics without coach or PV detail blocks", () => {
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
        lineText: "马八进七 炮9平7 车三平四",
      }]}
      onPlayMove={onPlayMove}
    />);

    expect(screen.getByText("深度:44")).toBeTruthy();
    expect(screen.getByText("分:+31")).toBeTruthy();
    expect(screen.getByText("NPS:4504K")).toBeTruthy();
    expect(screen.getByText("HF:21%")).toBeTruthy();
    expect(screen.queryByText(/私教讲解/)).toBeNull();
    expect(screen.queryByText(/完整 PV/)).toBeNull();

    fireEvent.click(screen.getByRole("row", { name: /马八进七/ }));
    expect(onPlayMove).toHaveBeenCalledWith("h2e2");
  });
});

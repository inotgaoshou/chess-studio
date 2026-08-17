import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileStudyPanel } from "./MobileStudyPanel";

afterEach(cleanup);

const engineRow = {
  id: "line-1",
  rank: 1,
  iccs: "h2e2",
  depthText: "20",
  scoreText: "+0.32",
  timeText: "1.0s",
  npsText: "100K",
  hfText: "--",
  lineText: "炮二平五 马8进7",
  line: { multipv: 1, pv: ["h2e2", "h9g7"], notation: ["炮二平五", "马8进7"] },
};

describe("MobileStudyPanel", () => {
  it("switches between engine, opening book, and manual tabs", () => {
    render(<MobileStudyPanel analysisBusy={false} analysisStale={false} analysisDisabled={false} analysisConfigText="MultiPV 3 · 深度 20" engineRows={[engineRow]} bookRows={[{ id: "book-1", iccs: "h2e2", notation: "炮二平五", scoreText: "2999", winRateText: "51%", source: "本地库" }]} bookLoading={false} manual={<p>棋谱内容</p>} onRunAnalysis={vi.fn()} onFocusCandidate={vi.fn()} onPreviewCandidate={vi.fn()} onPlayCandidate={vi.fn()} onFocusBookMove={vi.fn()} onPlayBookMove={vi.fn()}/>);
    expect(screen.getByText("炮二平五")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "开局库" }));
    expect(screen.getByText("51%")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "棋谱" }));
    expect(screen.getByText("棋谱内容")).toBeTruthy();
  });

  it("focuses and adopts an engine candidate through separate actions", () => {
    const onFocusCandidate = vi.fn();
    const onPreviewCandidate = vi.fn();
    const onPlayCandidate = vi.fn();
    render(<MobileStudyPanel analysisBusy={false} analysisStale={false} analysisDisabled={false} analysisConfigText="MultiPV 3 · 深度 20" engineRows={[engineRow]} bookRows={[]} bookLoading={false} manual={null} onRunAnalysis={vi.fn()} onFocusCandidate={onFocusCandidate} onPreviewCandidate={onPreviewCandidate} onPlayCandidate={onPlayCandidate} onFocusBookMove={vi.fn()} onPlayBookMove={vi.fn()}/>);
    fireEvent.click(screen.getByText("炮二平五"));
    fireEvent.click(screen.getByRole("button", { name: "预览候选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(onFocusCandidate).toHaveBeenCalledWith(engineRow);
    expect(onPreviewCandidate).toHaveBeenCalledWith(engineRow);
    expect(onPlayCandidate).toHaveBeenCalledWith(engineRow);
    expect(screen.getByText("深 20 · 红分 +0.32 · 1.0s · NPS 100K")).toBeTruthy();
    fireEvent.click(screen.getByText("后续 PV"));
    expect(screen.getByText("马8进7")).toBeTruthy();
  });

  it("previews and adopts opening-book moves through separate actions", () => {
    const onFocusBookMove = vi.fn();
    const onPlayBookMove = vi.fn();
    render(<MobileStudyPanel analysisBusy={false} analysisStale={false} analysisDisabled={false} analysisConfigText="MultiPV 3 · 深度 20" engineRows={[]} bookRows={[{ id: "book-1", iccs: "h2e2", notation: "炮二平五", scoreText: "2999", winRateText: "51%", source: "本地库" }]} bookLoading={false} manual={null} onRunAnalysis={vi.fn()} onFocusCandidate={vi.fn()} onPreviewCandidate={vi.fn()} onPlayCandidate={vi.fn()} onFocusBookMove={onFocusBookMove} onPlayBookMove={onPlayBookMove}/>);
    fireEvent.click(screen.getByRole("tab", { name: "开局库" }));
    fireEvent.click(screen.getByText("炮二平五"));
    fireEvent.click(screen.getByRole("button", { name: "采用开局库着法 炮二平五" }));
    expect(onFocusBookMove).toHaveBeenCalledWith("h2e2");
    expect(onPlayBookMove).toHaveBeenCalledWith("h2e2");
  });

  it("shows cloud guidance and disables analysis when cloud access is unavailable", () => {
    render(<MobileStudyPanel analysisBusy={false} analysisStale={false} analysisDisabled analysisConfigText="MultiPV 5 · 固定深度 20" analysisHint="请在功能菜单的云端分析中登录。" engineRows={[]} bookRows={[]} bookLoading={false} manual={null} onRunAnalysis={vi.fn()} onFocusCandidate={vi.fn()} onPreviewCandidate={vi.fn()} onPlayCandidate={vi.fn()} onFocusBookMove={vi.fn()} onPlayBookMove={vi.fn()}/>);
    expect(screen.getByText("请在功能菜单的云端分析中登录。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "分析" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("MultiPV 5 · 固定深度 20")).toBeTruthy();
  });

  it("moves between tabs with arrow keys", () => {
    render(<MobileStudyPanel analysisBusy={false} analysisStale={false} analysisDisabled={false} analysisConfigText="MultiPV 3 · 固定深度 20" engineRows={[]} bookRows={[]} bookLoading={false} manual={<p>棋谱内容</p>} onRunAnalysis={vi.fn()} onFocusCandidate={vi.fn()} onPreviewCandidate={vi.fn()} onPlayCandidate={vi.fn()} onFocusBookMove={vi.fn()} onPlayBookMove={vi.fn()}/>);
    const engine = screen.getByRole("tab", { name: "引擎" });
    engine.focus();
    fireEvent.keyDown(engine, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "开局库" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "开局库" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "棋谱" }).getAttribute("aria-selected")).toBe("true");
  });
});

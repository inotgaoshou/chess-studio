import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidatePreviewSteps } from "./CandidatePreviewSteps";
import type { PreviewLineStep } from "./platform";

afterEach(cleanup);

function step(notation: string, movedBy: "红方" | "黑方"): PreviewLineStep {
  return {
    fen: `${notation}-fen`,
    notation,
    movedBy,
    from: { row: 0, col: 0 },
    to: { row: 1, col: 0 },
    pieces: [],
    status: "进行中",
  };
}

describe("CandidatePreviewSteps", () => {
  it("marks every move with its red or black side", () => {
    render(<CandidatePreviewSteps
      activeStep={0}
      onSelect={vi.fn()}
      steps={[step("炮二平五", "红方"), step("马8进7", "黑方")]}
    />);

    expect(screen.getByRole("button", { name: "第 1 步，红方，炮二平五" }).classList.contains("side-red")).toBe(true);
    expect(screen.getByRole("button", { name: "第 2 步，黑方，马8进7" }).classList.contains("side-black")).toBe(true);
    expect(screen.getByText("红")).toBeTruthy();
    expect(screen.getByText("黑")).toBeTruthy();
  });

  it("scrolls the active move into view with nearest positioning", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const steps = [step("炮二平五", "红方"), step("马8进7", "黑方"), step("马二进三", "红方")];
    const view = render(<CandidatePreviewSteps activeStep={0} onSelect={vi.fn()} steps={steps}/>);
    scrollIntoView.mockClear();

    view.rerender(<CandidatePreviewSteps activeStep={2} onSelect={vi.fn()} steps={steps}/>);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "nearest", inline: "nearest" });
    expect(screen.getByRole("button", { name: "第 3 步，红方，马二进三" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "第 3 步，红方，马二进三" }).querySelector(".preview-step-active-mark")).toBeTruthy();
  });

  it("jumps to the selected preview move", () => {
    const onSelect = vi.fn();
    render(<CandidatePreviewSteps
      activeStep={0}
      onSelect={onSelect}
      steps={[step("炮二平五", "红方"), step("马8进7", "黑方")]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "第 2 步，黑方，马8进7" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

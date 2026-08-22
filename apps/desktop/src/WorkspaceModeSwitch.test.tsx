import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceModeSwitch, type WorkspaceMode } from "./WorkspaceModeSwitch";

afterEach(cleanup);

function Harness() {
  const [mode, setMode] = useState<WorkspaceMode>("review");
  const [layout, setLayout] = useState<"studio" | "compact">("compact");
  return <WorkspaceModeSwitch active={mode} platformKind="desktop" engineReady={false} syncSignedIn={false} linkSupported={true} layoutMode={layout} onChange={setMode} onLayoutChange={setLayout}/>;
}

describe("WorkspaceModeSwitch", () => {
  it("keeps review as the default and exposes the three task-oriented modes", () => {
    render(<Harness/>);
    expect(screen.getByRole("group", { name: "工作模式" }).className).toContain("workspace-mode-menu");
    expect(screen.getByRole("button", { name: "复盘" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    expect(screen.getByRole("button", { name: "研究" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "研究布局" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "简洁" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("需配置引擎")).toBeTruthy();
  });

  it("closes the research layout menu after selection, outside click, or Escape", () => {
    const onChange = vi.fn();
    const onLayoutChange = vi.fn();
    render(<WorkspaceModeSwitch active="research" platformKind="desktop" engineReady={true} syncSignedIn={true} linkSupported={true} layoutMode="studio" onChange={onChange} onLayoutChange={onLayoutChange}/>);

    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    fireEvent.click(screen.getByRole("button", { name: "简洁" }));
    expect(onLayoutChange).toHaveBeenCalledWith("compact");
    expect(screen.queryByRole("region", { name: "研究布局" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "研究布局" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "研究布局" })).toBeNull();
  });

  it("does not expose desktop-only modes in the Web shell", () => {
    render(<WorkspaceModeSwitch active="review" platformKind="web" engineReady={false} syncSignedIn={false} linkSupported={false} layoutMode="compact" onChange={() => undefined} onLayoutChange={() => undefined}/>);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("Web 端仅提供离线棋谱、基础变例与待同步操作")).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceTabs, type WorkspacePanel } from "./WorkspaceTabs";

afterEach(cleanup);

function Harness() {
  const [active, setActive] = useState<WorkspacePanel>("moves");
  return <WorkspaceTabs active={active} onChange={setActive}/>;
}

describe("WorkspaceTabs", () => {
  it("shows the five stable workspace pages and switches by click", () => {
    render(<Harness/>);
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: "报告" }));
    expect(screen.getByRole("tab", { name: "报告" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "棋谱" }).getAttribute("aria-selected")).toBe("false");
  });

  it("supports arrow, home and end keyboard navigation", () => {
    render(<Harness/>);
    fireEvent.keyDown(screen.getByRole("tab", { name: "棋谱" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "分析" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "分析" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "报告" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "报告" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "棋谱" }).getAttribute("aria-selected")).toBe("true");
  });
});

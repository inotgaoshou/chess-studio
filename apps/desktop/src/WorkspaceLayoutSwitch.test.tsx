import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayoutSwitch } from "./WorkspaceLayoutSwitch";

afterEach(cleanup);

describe("WorkspaceLayoutSwitch", () => {
  it("shows the persisted mode and switches to compact layout", () => {
    const onChange = vi.fn();
    render(<WorkspaceLayoutSwitch mode="studio" onChange={onChange}/>);

    expect(screen.getByRole("button", { name: "专业" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "简洁" }));
    expect(onChange).toHaveBeenCalledWith("compact");
  });

  it("marks compact layout as selected", () => {
    render(<WorkspaceLayoutSwitch mode="compact" onChange={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "简洁" }).classList.contains("active")).toBe(true);
  });
});

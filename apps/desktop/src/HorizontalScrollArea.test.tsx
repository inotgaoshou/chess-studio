import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HorizontalScrollArea } from "./HorizontalScrollArea";

afterEach(cleanup);

describe("HorizontalScrollArea", () => {
  it("offers visible slide controls and keeps vertical-wheel horizontal scrolling", async () => {
    render(<HorizontalScrollArea ariaLabel="全部变招" className="branch-map-scroll" showButtons><span>分支 1</span><span>分支 4</span></HorizontalScrollArea>);
    const scrollArea = screen.getByLabelText("全部变招");
    const scrollBy = vi.fn();
    Object.defineProperty(scrollArea, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(scrollArea, "scrollBy", { configurable: true, value: scrollBy });

    await userEvent.click(screen.getByRole("button", { name: "向右滑动变招" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 216, behavior: "smooth" });
    fireEvent.wheel(scrollArea, { deltaY: 90, deltaX: 0 });
    expect(scrollArea.scrollLeft).toBe(90);
  });
});

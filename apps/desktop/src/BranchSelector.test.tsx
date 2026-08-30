import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchSelector } from "./BranchSelector";

afterEach(cleanup);

describe("BranchSelector", () => {
  it("numbers mainline and sibling variations in board-arrow order", () => {
    render(<BranchSelector
      branches={[
        { id: "main", notation: "兵五进一", isMainline: true },
        { id: "route-1", notation: "马八进七", isMainline: false },
        { id: "route-2", notation: "车二平三", isMainline: false },
        { id: "route-3", notation: "炮八进四", isMainline: false },
      ]}
      currentBranchId="main"
      onNavigate={vi.fn()}
    />);

    expect([...screen.getByLabelText("变招选择").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "1 · 主线 · 兵五进一",
      "2 · 马八进七",
      "3 · 车二平三",
      "4 · 炮八进四",
    ]);
  });
});

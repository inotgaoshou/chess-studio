import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PracticeOpeningStatus } from "../src/PracticeOpeningStatus";

const props = { busy: true, message: "", title: "下一题", phase: "准备棋盘", onRetry: vi.fn(), onCancel: vi.fn() };
afterEach(() => vi.useRealTimers());

it("fast question switches never flash an opening overlay", () => {
  vi.useFakeTimers();
  const ui = render(<PracticeOpeningStatus {...props}/>);
  expect(screen.queryByLabelText("打开题目")).toBeNull();
  act(() => vi.advanceTimersByTime(200));
  ui.rerender(<PracticeOpeningStatus {...props} busy={false}/>);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByLabelText("打开题目")).toBeNull();
});

it("slow openings still offer cancel, and failure immediately offers retry", () => {
  vi.useFakeTimers();
  const ui = render(<PracticeOpeningStatus {...props}/>);
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  ui.rerender(<PracticeOpeningStatus {...props} busy={false} message="打开超时"/>);
  expect(screen.getByRole("alert").textContent).toBe("打开超时");
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  ui.rerender(<PracticeOpeningStatus {...props}/>);
  expect(screen.queryByRole("status")).toBeNull();
});

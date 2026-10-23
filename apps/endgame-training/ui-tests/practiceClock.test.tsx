import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePracticeClock } from "../src/usePracticeClock";

describe("active practice timing", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.spyOn(performance, "now").mockImplementation(() => now);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });

  it("starts after readiness, displays thinking time and excludes pending AI/network work", () => {
    const clock = renderHook(({ active }) => usePracticeClock(active), { initialProps: { active: false } });
    now = 5_000;
    expect(clock.result.current.readElapsed()).toBe(0);
    clock.rerender({ active: true });
    now += 4_000;
    act(() => vi.advanceTimersByTime(250));
    expect(clock.result.current.elapsed).toBe(4_000);
    const readFromAsyncCallback = clock.result.current.readElapsed;
    clock.rerender({ active: false });
    now += 15_000;
    expect(readFromAsyncCallback()).toBe(4_000);
    clock.rerender({ active: true });
    now += 2_000;
    expect(readFromAsyncCallback()).toBe(6_000);
  });

  it("pauses synchronously on background, resumes only in foreground, then freezes on completion", () => {
    const clock = renderHook(({ active }) => usePracticeClock(active), { initialProps: { active: true } });
    now = 3_000;
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    now += 120_000;
    expect(clock.result.current.readElapsed()).toBe(3_000);
    expect(clock.result.current.running).toBe(false);
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    now += 1_000;
    clock.rerender({ active: false });
    now += 30_000;
    expect(clock.result.current.readElapsed()).toBe(4_000);
  });

  it("preserves manual pause, resets per question and restores saved time without wall-clock drift", () => {
    const clock = renderHook(({ active }) => usePracticeClock(active), { initialProps: { active: true } });
    now = 2_000;
    act(() => clock.result.current.stop());
    clock.rerender({ active: false });
    clock.rerender({ active: true });
    now += 4_000;
    expect(clock.result.current.readElapsed()).toBe(2_000);
    act(() => clock.result.current.reset(9_000));
    vi.spyOn(Date, "now").mockReturnValue(1);
    now += 3_000;
    expect(clock.result.current.readElapsed()).toBe(12_000);
    act(() => clock.result.current.reset());
    now += 1_000;
    expect(clock.result.current.readElapsed()).toBe(1_000);
    const read = clock.result.current.readElapsed;
    clock.unmount();
    now += 10_000;
    expect(read()).toBe(1_000);
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePageVisible, usePositionAnalysis } from "../src/usePositionAnalysis";

afterEach(() => { vi.useRealTimers(); });
it("debounces moves and ignores obsolete results even when a provider ignores abort", async () => {
  vi.useFakeTimers();
  const jobs: { signal: AbortSignal; finish(value: string): void }[] = [];
  const analyze = vi.fn((signal: AbortSignal) => new Promise<string>(finish => jobs.push({signal,finish})));
  const hook = renderHook(({positionKey}) => usePositionAnalysis({positionKey,enabled:true,suspended:false,analyze}), {initialProps:{positionKey:"red"}});
  await act(async () => { vi.advanceTimersByTime(299); }); expect(analyze).not.toHaveBeenCalled();
  hook.rerender({positionKey:"black"});
  await act(async () => { vi.advanceTimersByTime(300); }); expect(jobs).toHaveLength(1);
  hook.rerender({positionKey:"branch"}); expect(jobs[0].signal.aborted).toBe(true);
  await act(async () => { jobs[0].finish("old"); vi.advanceTimersByTime(300); });
  expect(hook.result.current.value).toBeUndefined(); expect(jobs).toHaveLength(2);
  await act(async () => { jobs[1].finish("new"); });
  expect(hook.result.current.value).toBe("new");
});
it("pauses for another engine owner, resumes once, and does not loop on completion or failure", async () => {
  vi.useFakeTimers();
  const analyze=vi.fn().mockResolvedValueOnce("ready").mockRejectedValueOnce(new Error("offline")).mockResolvedValue("retry");
  const hook=renderHook(({suspended,enabled})=>usePositionAnalysis({positionKey:"same",enabled,suspended,analyze}),{initialProps:{suspended:false,enabled:true}});
  await act(async()=>{vi.advanceTimersByTime(300);}); expect(hook.result.current.value).toBe("ready");
  await act(async()=>{vi.advanceTimersByTime(2000);}); expect(analyze).toHaveBeenCalledTimes(1);
  hook.rerender({suspended:true,enabled:true});
  hook.rerender({suspended:false,enabled:true});
  await act(async()=>{vi.advanceTimersByTime(300);}); expect(hook.result.current.error).toBe("offline");
  await act(async()=>{vi.advanceTimersByTime(2000);}); expect(analyze).toHaveBeenCalledTimes(2);
  act(()=>hook.result.current.refresh()); await act(async()=>{vi.advanceTimersByTime(300);}); expect(hook.result.current.value).toBe("retry");
  hook.rerender({suspended:false,enabled:false}); expect(hook.result.current.value).toBeUndefined();
});
it("cancels pending debounce on disable and refreshes for calculation parameters",async()=>{
  vi.useFakeTimers();const analyze=vi.fn().mockResolvedValue("result");
  const hook=renderHook(({positionKey,enabled})=>usePositionAnalysis({positionKey,enabled,suspended:false,analyze}),{initialProps:{positionKey:"fen:3:2",enabled:true}});
  hook.rerender({positionKey:"fen:3:2",enabled:false});await act(async()=>{vi.advanceTimersByTime(1000);});expect(analyze).not.toHaveBeenCalled();
  hook.rerender({positionKey:"fen:4:1",enabled:true});await act(async()=>{vi.advanceTimersByTime(300);});expect(analyze).toHaveBeenCalledTimes(1);
  hook.rerender({positionKey:"fen:4:2",enabled:true});expect(hook.result.current.value).toBeUndefined();await act(async()=>{vi.advanceTimersByTime(300);});expect(analyze).toHaveBeenCalledTimes(2);
});
it("tracks native page hiding and visibility restoration",()=>{
  const hook=renderHook(()=>usePageVisible());expect(hook.result.current).toBe(true);
  act(()=>window.dispatchEvent(new Event("pagehide")));expect(hook.result.current).toBe(false);
  act(()=>window.dispatchEvent(new Event("pageshow")));expect(hook.result.current).toBe(true);
  act(()=>document.dispatchEvent(new Event("pause")));expect(hook.result.current).toBe(false);
  act(()=>document.dispatchEvent(new Event("resume")));expect(hook.result.current).toBe(true);
});

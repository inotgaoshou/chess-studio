import { afterEach, expect, it, vi } from "vitest";
import { retryOpeningRead } from "../src/openingRead";
afterEach(()=>vi.useRealTimers());
it("retries transient reads once and reports the retry phase",async()=>{
 const read=vi.fn().mockRejectedValueOnce(Object.assign(new Error("busy"),{status:503})).mockResolvedValue("ready"),phase=vi.fn();
 expect(await retryOpeningRead(read,new AbortController().signal,phase)).toBe("ready");expect(read).toHaveBeenCalledTimes(2);expect(phase).toHaveBeenCalledOnce();
});
it("does not retry permission or missing-content failures",async()=>{
 const error=Object.assign(new Error("forbidden"),{status:403}),read=vi.fn().mockRejectedValue(error);
 await expect(retryOpeningRead(read,new AbortController().signal,vi.fn())).rejects.toBe(error);expect(read).toHaveBeenCalledOnce();
});
it("accepts a slow valid response without cancelling or restarting it",async()=>{
 vi.useFakeTimers();const read=vi.fn(()=>new Promise(resolve=>setTimeout(()=>resolve("ready"),7000)));
 const result=retryOpeningRead(read,new AbortController().signal,vi.fn());
 await vi.advanceTimersByTimeAsync(7001);expect(await result).toBe("ready");expect(read).toHaveBeenCalledOnce();
});
it("bounds a hung transport even if it ignores abort",async()=>{
 vi.useFakeTimers();const read=vi.fn(()=>new Promise(()=>{}));const result=retryOpeningRead(read,new AbortController().signal,vi.fn());
 const assertion=expect(result).rejects.toThrow("读取题目超时");await vi.advanceTimersByTimeAsync(15001);await assertion;expect(read).toHaveBeenCalledOnce();
});
it("cancellation never retries or accepts a late response",async()=>{
 const controller=new AbortController(),read=vi.fn(()=>new Promise(()=>{}));const result=retryOpeningRead(read,controller.signal,vi.fn());controller.abort();
 await expect(result).rejects.toHaveProperty("name","AbortError");expect(read).toHaveBeenCalledOnce();
});

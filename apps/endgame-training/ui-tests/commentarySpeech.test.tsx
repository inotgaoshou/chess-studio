import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => native }));
afterEach(() => vi.resetModules());

it("stopping while native stop is pending cannot resurrect obsolete speech", async () => {
  let finish!: () => void;
  native.stop.mockReset(); native.speak.mockReset();
  native.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const { speakCommentary, stopCommentarySpeech } = await import("../src/commentarySpeech");
  const pending = speakCommentary("旧局面", 1);
  await vi.waitFor(() => expect(native.stop).toHaveBeenCalledTimes(1));
  const stopped = stopCommentarySpeech(); finish();
  await Promise.all([pending, stopped]);
  expect(native.speak).not.toHaveBeenCalled();
});

it("only the latest voice starts when two reads overlap during asynchronous stop", async () => {
  let finish!: () => void;
  native.stop.mockReset(); native.speak.mockReset();
  native.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  native.speak.mockResolvedValue({});
  const { speakCommentary } = await import("../src/commentarySpeech");
  const old = speakCommentary("旧局面", 1);
  await vi.waitFor(() => expect(native.stop).toHaveBeenCalledTimes(1));
  const latest = speakCommentary("新局面", 1.2);
  finish(); await Promise.all([old, latest]);
  expect(native.speak).toHaveBeenCalledTimes(1);
  expect(native.speak).toHaveBeenCalledWith({ text: "新局面", rate: 1.2 });
});

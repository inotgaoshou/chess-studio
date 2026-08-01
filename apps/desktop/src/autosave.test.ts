import { describe, expect, it, vi } from "vitest";
import { AutosaveOperationQueue, autosaveLabel, type AutosaveState } from "./autosave";

describe("autosave state", () => {
  it.each<[AutosaveState, string]>([
    [{ status: "draft" }, "本地草稿"],
    [{ status: "saving" }, "保存中"],
    [{ status: "saved" }, "已保存"],
    [{ status: "error", message: "disk full" }, "保存失败，点击重试"],
  ])("renders $status as a visible local-save status", (state, label) => {
    expect(autosaveLabel(state)).toBe(label);
  });
});

describe("AutosaveOperationQueue", () => {
  it("reports saving and saved around a successful operation", async () => {
    const states: AutosaveState[] = [];
    const queue = new AutosaveOperationQueue((state) => states.push(state), String);

    await expect(queue.enqueue(async () => "saved board")).resolves.toBe("saved board");
    expect(states).toEqual([{ status: "saving" }, { status: "saved" }]);
  });

  it("keeps a failed operation available until retry succeeds", async () => {
    const states: AutosaveState[] = [];
    let attempts = 0;
    const queue = new AutosaveOperationQueue((state) => states.push(state), () => "磁盘不可写");

    await expect(queue.enqueue(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
      return "restored board";
    })).rejects.toThrow("disk full");
    await expect(queue.retry()).resolves.toBe("restored board");

    expect(attempts).toBe(2);
    expect(states).toEqual([
      { status: "saving" },
      { status: "error", message: "磁盘不可写" },
      { status: "saving" },
      { status: "saved" },
    ]);
  });

  it("pauses later operations until the failed save is retried", async () => {
    const states: AutosaveState[] = [];
    let diskWritable = false;
    const queue = new AutosaveOperationQueue((state) => states.push(state), () => "磁盘不可写");
    const failedWrite = async () => {
      if (!diskWritable) throw new Error("disk full");
      return "first operation restored";
    };

    await expect(queue.enqueue(failedWrite)).rejects.toThrow("disk full");
    const laterOperation = vi.fn(async () => "later operation");
    await expect(queue.enqueue(laterOperation)).rejects.toThrow("请先重试失败的本地保存");
    expect(laterOperation).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: "error", message: "磁盘不可写" });

    diskWritable = true;
    await expect(queue.retry()).resolves.toBe("first operation restored");
    expect(states.at(-1)).toEqual({ status: "saved" });
    await expect(queue.enqueue(laterOperation)).resolves.toBe("later operation");
    expect(laterOperation).toHaveBeenCalledOnce();
  });
});

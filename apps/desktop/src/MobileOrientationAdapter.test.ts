import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ set: vi.fn(), isNative: vi.fn(() => true) }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: native.isNative },
  registerPlugin: () => ({ set: native.set }),
}));
import { setPreferredOrientation } from "../../endgame-training/src/orientation";
afterEach(() => { vi.clearAllMocks(); native.isNative.mockReturnValue(true); });

describe("native screen orientation bridge", () => {
  it("accepts Android's successful resolve without a payload", async () => {
    native.set.mockResolvedValueOnce(undefined);
    await expect(setPreferredOrientation("landscape")).resolves.toEqual({ requiresPhysicalRotation: false });
    expect(native.set).toHaveBeenCalledWith({ orientation: "landscape" });
  });
  it("preserves the iOS physical rotation response", async () => {
    native.set.mockResolvedValueOnce({ requiresPhysicalRotation: true });
    await expect(setPreferredOrientation("portrait")).resolves.toEqual({ requiresPhysicalRotation: true });
  });
  it("propagates a native rejection for the settings error display", async () => {
    native.set.mockRejectedValueOnce(new Error("系统未允许切换"));
    await expect(setPreferredOrientation("portrait")).rejects.toThrow("系统未允许切换");
  });
});

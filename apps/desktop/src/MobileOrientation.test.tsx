import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenOrientation } from "../../endgame-training/src/useScreenOrientation";
import { setPreferredOrientation } from "../../endgame-training/src/orientation";

vi.mock("../../endgame-training/src/orientation", () => ({ setPreferredOrientation: vi.fn() }));
const setOrientation = vi.mocked(setPreferredOrientation);
beforeEach(() => {
  localStorage.clear();
  setOrientation.mockReset().mockResolvedValue({ requiresPhysicalRotation: false });
});
afterEach(cleanup);

describe("mobile orientation preferences", () => {
  it("restores the saved native direction on launch", async () => {
    localStorage.setItem("xiangqi-training-orientation", "portrait");
    const { result } = renderHook(useScreenOrientation);
    await waitFor(() => expect(result.current.orientationPending).toBe(false));
    expect(setOrientation).toHaveBeenCalledExactlyOnceWith("portrait");
    expect(result.current.preferredOrientation).toBe("portrait");
  });

  it("blocks rapid duplicate requests and persists only after native success", async () => {
    const { result } = renderHook(useScreenOrientation);
    await waitFor(() => expect(result.current.orientationPending).toBe(false));
    let complete!: (value: { requiresPhysicalRotation: boolean }) => void;
    setOrientation.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let request!: Promise<void>;
    act(() => {
      request = result.current.changeOrientation("landscape");
      void result.current.changeOrientation("portrait");
    });
    expect(result.current.orientationPending).toBe(true);
    expect(setOrientation).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("xiangqi-training-orientation")).toBe("auto");
    await act(async () => { complete({ requiresPhysicalRotation: false }); await request; });
    expect(localStorage.getItem("xiangqi-training-orientation")).toBe("landscape");
    expect(result.current.orientationPending).toBe(false);
  });

  it("keeps the last successful preference on failure and permits retry", async () => {
    const { result } = renderHook(useScreenOrientation);
    await waitFor(() => expect(result.current.orientationPending).toBe(false));
    setOrientation.mockRejectedValueOnce(new Error("系统拒绝了方向请求"));
    await act(() => result.current.changeOrientation("portrait"));
    expect(result.current.orientationError).toContain("系统拒绝了方向请求");
    expect(result.current.preferredOrientation).toBe("auto");
    expect(localStorage.getItem("xiangqi-training-orientation")).toBe("auto");
    await act(() => result.current.changeOrientation("portrait"));
    expect(result.current.orientationError).toBe("");
    expect(result.current.preferredOrientation).toBe("portrait");
  });
});

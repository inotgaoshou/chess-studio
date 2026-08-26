import { afterEach, describe, expect, it, vi } from "vitest";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.unstubAllEnvs();
  vi.resetModules();
});

function stubMobileMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(max-width: 640px) and (orientation: portrait)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe("mobileEnvironment", () => {
  it("uses the mobile workbench when running in the native mobile shell", async () => {
    vi.stubEnv("VITE_XIANGQI_MOBILE", "1");
    stubMobileMedia(false);
    const { isMobileBuild, shouldUseMobileWorkbench } = await import("./mobileEnvironment");

    expect(isMobileBuild).toBe(true);
    expect(shouldUseMobileWorkbench()).toBe(true);
  });

  it("falls back to the narrow portrait media query for normal web builds", async () => {
    stubMobileMedia(true);
    const { isMobileBuild, shouldUseMobileWorkbench } = await import("./mobileEnvironment");

    expect(isMobileBuild).toBe(false);
    expect(shouldUseMobileWorkbench()).toBe(true);
  });
});

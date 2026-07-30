import { afterEach, describe, expect, it, vi } from "vitest";
import { contrastRatio, defaultColorTheme, initialColorTheme, themePalettes } from "./theme";

afterEach(() => vi.unstubAllGlobals());

describe("defaultColorTheme", () => {
  it("defaults desktop applications to dark", () => {
    expect(defaultColorTheme("desktop", true)).toBe("dark");
  });

  it("defaults portrait phone web applications to light", () => {
    expect(defaultColorTheme("web", true)).toBe("light");
  });

  it("keeps the dense web layout dark outside portrait phone sizing", () => {
    expect(defaultColorTheme("web", false)).toBe("dark");
  });

  it("uses the same initial theme resolver for bootstrapping and React state", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(initialColorTheme("web", true)).toBe("light");
    localStorage.setItem("xiangqi:color-theme", "dark");
    expect(initialColorTheme("web", true)).toBe("dark");
  });
});

describe("theme contrast", () => {
  it.each(Object.entries(themePalettes))("keeps %s normal text at WCAG AA contrast", (_name, palette) => {
    const surfaces = [palette["surface-0"], palette["surface-1"], palette["surface-2"], palette["surface-3"]];
    for (const text of [palette["text-primary"], palette["text-secondary"], palette["text-muted"]]) {
      for (const surface of surfaces) expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

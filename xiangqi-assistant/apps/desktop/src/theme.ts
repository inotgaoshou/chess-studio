import type { DesktopPreferencesDto } from "./platform";

export type ColorTheme = DesktopPreferencesDto["colorTheme"];

export const themePalettes = {
  dark: {
    "surface-0": "#151a18", "surface-1": "#202724", "surface-2": "#28312d", "surface-3": "#323d38",
    "surface-input": "#181e1c", "surface-active": "#385045",
    "text-primary": "#f1f5f2", "text-secondary": "#c4cdc8", "text-muted": "#9da9a2", "text-disabled": "#7d8982",
    border: "#4c5852", "border-strong": "#65716b", accent: "#72c493", "accent-surface": "#355a47",
    red: "#ed7770", "red-soft": "#f2a09b", "black-side": "#76b6dd", warning: "#e4b663",
  },
  light: {
    "surface-0": "#e8edea", "surface-1": "#ffffff", "surface-2": "#f3f6f4", "surface-3": "#e1e8e4",
    "surface-input": "#ffffff", "surface-active": "#d8eadf",
    "text-primary": "#17211c", "text-secondary": "#3e4b44", "text-muted": "#58665e", "text-disabled": "#78857e",
    border: "#bdc8c1", "border-strong": "#98a79f", accent: "#26794e", "accent-surface": "#d5eadf",
    red: "#b83d38", "red-soft": "#9d302c", "black-side": "#23658c", warning: "#8b610d",
  },
} as const;

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

export function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
}

export function applyColorTheme(theme: ColorTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  for (const [name, value] of Object.entries(themePalettes[theme])) root.style.setProperty(`--${name}`, value);
}

export function defaultColorTheme(kind: "desktop" | "web", phonePortrait: boolean): ColorTheme {
  return kind === "web" && phonePortrait ? "light" : "dark";
}

export function storedWebColorTheme(fallback: ColorTheme): ColorTheme {
  try {
    const stored = localStorage.getItem("xiangqi:color-theme");
    return stored === "light" || stored === "dark" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function initialColorTheme(kind: "desktop" | "web", phonePortrait = typeof window !== "undefined" && window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches) {
  const fallback = defaultColorTheme(kind, phonePortrait);
  return kind === "web" ? storedWebColorTheme(fallback) : fallback;
}

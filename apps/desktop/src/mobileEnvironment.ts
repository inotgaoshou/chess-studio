export const isMobileBuild = import.meta.env.VITE_XIANGQI_MOBILE === "1";

export function mobileWorkbenchMediaQuery() {
  return window.matchMedia("(max-width: 640px) and (orientation: portrait)");
}

export function shouldUseMobileWorkbench() {
  return isMobileBuild || mobileWorkbenchMediaQuery().matches;
}

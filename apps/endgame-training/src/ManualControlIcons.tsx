import type { ManualAiMode } from "./manualAiMode";

/** Shared recording/analysis glyphs follow the reference eye and chart-lens symbols. */
export function ManualAiIcon({ mode }: { mode: ManualAiMode }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-manual-icon={`ai-${mode}`}>
    {mode === "hints" && <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.1" opacity=".65"/>}
    <path d="M2 12C4.4 7.8 7.7 5.7 12 5.7S19.6 7.8 22 12c-2.4 4.2-5.7 6.3-10 6.3S4.4 16.2 2 12Z" fill="currentColor"/>
    <circle cx="12" cy="12" r="4" fill="var(--manual-icon-cutout, #f3f8f0)"/>
    <circle cx="12" cy="12" r="2.15" fill="currentColor"/>
    {mode === "disabled" && <>
      <path d="m4 20 16-16" stroke="var(--manual-icon-cutout, #f3f8f0)" strokeWidth="4" strokeLinecap="round"/>
      <path d="m4 20 16-16" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/>
    </>}
  </svg>;
}

export function ManualAnalysisIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true" data-manual-icon="analysis">
    <circle cx="10.5" cy="10.5" r="8" strokeWidth="1.7"/>
    <path d="m16.4 16.4 5 5" strokeWidth="2"/>
    <path d="M7 12.5v-3m3.5 3V7m3.5 5.5v-7" strokeWidth="2.2"/>
  </svg>;
}

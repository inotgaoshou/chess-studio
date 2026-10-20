import { withRequestDeadline } from "./requestDeadline";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
export function PracticeOpeningStatus({ busy, message, title, phase, onRetry, onCancel }: {
  busy: boolean; message: string; title: string; phase: string; onRetry(): void; onCancel(): void;
}) {
  if (!busy && !message) return null;
  return <section className="practice-opening-status" aria-label="打开题目">
    {busy ? <p role="status"><LoaderCircle className="spinning"/>正在打开{title ? `《${title}》` : "练习"}…<small>{phase}</small></p> : <p role="alert">{message}</p>}
    <div>{!busy && <button type="button" className="practice-opening-retry" onClick={onRetry}><RotateCcw/>重试</button>}<button type="button" onClick={onCancel}><X/>取消</button></div>
  </section>;
}

// Diagnostics contain stage names and duration only, never account data, FEN or tokens.
export const openingTimings: Array<{ operation: number; phase: string; elapsedMs: number; ok: boolean }> = [];
let activeOperation: number | undefined;
export function setActiveOpening(operation?: number) { activeOperation = operation; }
export function measureActiveOpening<T>(phase: string, work: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  return activeOperation === undefined ? work() : measureOpening(activeOperation, phase, work, signal ?? undefined);
}
export async function measureOpening<T>(operation: number, phase: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const start = performance.now(); let ok = false;
  try { const result = await (signal ? withRequestDeadline(work, signal) : work()); ok = true; return result; }
  finally {
    openingTimings.push({ operation, phase, elapsedMs: Math.round(performance.now() - start), ok });
    if (openingTimings.length > 100) openingTimings.shift();
  }
}

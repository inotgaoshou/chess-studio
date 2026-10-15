import { useLayoutEffect } from "react";

type LeaveState = { dirty: boolean; busy: boolean };
const LEAVE_EVENT = "qixi-checkin-before-leave";
export function canLeaveCheckin(): boolean {
  const states: LeaveState[] = [];
  window.dispatchEvent(new CustomEvent<LeaveState[]>(LEAVE_EVENT, { detail: states }));
  if (states.some(state => state.busy)) return false;
  return !states.some(state => state.dirty) || window.confirm("尚有未保存的打卡修改或未发送留言，确定离开并放弃这些内容？");
}
export function useCheckinLeaveGuard(dirty: boolean, busy: boolean) {
  useLayoutEffect(() => {
    const collect = (event: Event) => (event as CustomEvent<LeaveState[]>).detail.push({ dirty, busy });
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener(LEAVE_EVENT, collect); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener(LEAVE_EVENT, collect); window.removeEventListener("beforeunload", unload); };
  }, [dirty, busy]);
}
export type CheckinPosition = { x: number; y: number; ancestors: { element: HTMLElement; x: number; y: number }[] };
export function captureCheckinPosition(element: HTMLElement | null | undefined): CheckinPosition {
  const ancestors: CheckinPosition["ancestors"] = [];
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    ancestors.push({ element: parent, x: parent.scrollLeft, y: parent.scrollTop });
  }
  return { x: window.scrollX, y: window.scrollY, ancestors };
}
export function focusCheckin(element: HTMLElement | null | undefined, position?: CheckinPosition) {
  requestAnimationFrame(() => {
    element?.focus({ preventScroll: true });
    if (position) {
      for (const saved of position.ancestors) {
        if (saved.element.isConnected) { saved.element.scrollLeft = saved.x; saved.element.scrollTop = saved.y; }
      }
      window.scrollTo(position.x, position.y);
    } else element?.scrollIntoView?.({ block: "start", behavior: "auto" });
  });
}

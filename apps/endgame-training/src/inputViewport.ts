import { Capacitor } from "@capacitor/core";
import { Keyboard, type KeyboardInfo } from "@capacitor/keyboard";

/** One visible area for native resize, iOS viewport pan, and browser keyboards. */
export function installInputViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  let frame = 0;
  let baselineHeight = window.innerHeight;
  let baselineWidth = window.innerWidth;
  let nativeOpen: boolean | undefined;
  let keyboardHeight = 0;
  const focusedInput = () => {
    const element = document.activeElement;
    return element instanceof HTMLElement && element.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([readonly]), textarea:not([readonly]), [contenteditable=true]") ? element : undefined;
  };
  const revealInput = () => {
    const input = focusedInput();
    if (!input) return;
    const visibleTop = viewport?.offsetTop ?? 0;
    const visibleHeight = Number.parseFloat(root.style.getPropertyValue("--input-viewport-height"));
    // Scroll the form, not the document: document scrolling makes iOS pan again.
    for (let parent = input.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
      const field = input.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      const areaTop = Math.max(bounds.top, visibleTop);
      const areaBottom = Math.min(bounds.bottom, visibleTop + visibleHeight);
      const margin = Math.max(0, Math.min(12, (areaBottom - areaTop - field.height) / 2));
      const top = areaTop + margin;
      const bottom = areaBottom - margin;
      if (bottom <= top) continue;
      if (field.height > bottom - top || field.top < top) parent.scrollTop += field.top - top;
      else if (field.bottom > bottom) parent.scrollTop += field.bottom - bottom;
    }
  };
  const update = () => {
    cancelAnimationFrame(frame);
    // A rotation establishes a new height baseline; an IME resize does not.
    if (Math.abs(window.innerWidth - baselineWidth) > 80) {
      baselineWidth = window.innerWidth;
      baselineHeight = window.innerHeight + (nativeOpen ? keyboardHeight : 0);
    }
    const measuredHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
    if (!nativeOpen) baselineHeight = Math.max(baselineHeight, window.innerHeight);
    const keyboardOpen = nativeOpen ?? (Boolean(focusedInput()) && baselineHeight - measuredHeight > 100);
    // Native resize may already exclude the IME. Take the smaller height,
    // never subtract the keyboard from an already resized WebView.
    const height = keyboardOpen && keyboardHeight > 0
      ? Math.min(measuredHeight, Math.max(0, baselineHeight - keyboardHeight)) : measuredHeight;
    root.classList.toggle("keyboard-open", keyboardOpen);
    root.classList.toggle("keyboard-short", keyboardOpen && height < 200);
    root.style.setProperty("--input-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    root.style.setProperty("--input-viewport-height", `${height}px`);
    if (!keyboardOpen) return;
    // Give both the root and the dialog's flex/grid children time to resize.
    frame = requestAnimationFrame(() => {
      revealInput();
      frame = requestAnimationFrame(revealInput);
    });
  };
  const observer = new ResizeObserver(update);
  const observeInput = () => {
    observer.disconnect();
    const input = focusedInput();
    if (input) {
      observer.observe(input);
      for (let parent = input.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) observer.observe(parent);
      }
    }
    update();
  };
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", observeInput);
  document.addEventListener("focusout", () => requestAnimationFrame(observeInput));
  document.addEventListener("input", update);
  document.addEventListener("selectionchange", update);
  document.addEventListener("compositionend", update);
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.getPlatform() === "ios") {
      // Keep Return for multiline input; the system accessory's Done button
      // ends editing without submitting the form or changing wizard steps.
      void Keyboard.setAccessoryBarVisible({ isVisible: true })
        .catch(() => console.warn("系统键盘完成入口未能启用"));
    }
    const show = ({ keyboardHeight: height }: KeyboardInfo) => { nativeOpen = true; keyboardHeight = height; update(); };
    const hide = () => { nativeOpen = false; keyboardHeight = 0; baselineHeight = window.innerHeight; update(); };
    void Promise.all([
      Keyboard.addListener("keyboardWillShow", show), Keyboard.addListener("keyboardDidShow", show),
      Keyboard.addListener("keyboardDidHide", hide),
    ]).catch(() => { nativeOpen = undefined; update(); });
  }
  update();
}

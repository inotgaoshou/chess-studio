import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function installWebViewZoomGuards() {
  if (typeof window === "undefined") return;

  let lastTouchEnd = 0;
  const preventGestureZoom = (event: Event) => event.preventDefault();
  const preventDoubleTapZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
      return;
    }
    const now = Date.now();
    if (now - lastTouchEnd <= 320) event.preventDefault();
    lastTouchEnd = now;
  };

  document.addEventListener("gesturestart", preventGestureZoom, { passive: false });
  document.addEventListener("gesturechange", preventGestureZoom, { passive: false });
  document.addEventListener("gestureend", preventGestureZoom, { passive: false });
  document.addEventListener("touchend", preventDoubleTapZoom, { passive: false });
}

installWebViewZoomGuards();

createRoot(document.getElementById("root")!).render(<App/>);

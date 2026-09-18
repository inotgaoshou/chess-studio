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

function installDeviceLayoutClasses() {
  if (typeof window === "undefined") return;

  const update = () => {
    const userAgent = navigator.userAgent;
    const isPhoneUa = /iPhone|iPod|Android.*Mobile/i.test(userAgent);
    const shortestScreenSide = Math.min(window.screen.width, window.screen.height);
    const visualWidth = window.visualViewport?.width ?? window.innerWidth;
    const visualHeight = window.visualViewport?.height ?? window.innerHeight;
    const isLikelyPhone = isPhoneUa || shortestScreenSide <= 600 || Math.min(visualWidth, visualHeight) <= 600;
    const isLikelyTablet = !isLikelyPhone && navigator.maxTouchPoints > 0;

    document.documentElement.classList.toggle("phone-webview", isLikelyPhone);
    document.documentElement.classList.toggle("tablet-webview", isLikelyTablet);
    document.documentElement.classList.toggle("touch-webview", navigator.maxTouchPoints > 0);
    document.documentElement.style.setProperty("--app-viewport-width", `${visualWidth}px`);
    document.documentElement.style.setProperty("--app-viewport-height", `${visualHeight}px`);
  };

  update();
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
}

installWebViewZoomGuards();
installDeviceLayoutClasses();

createRoot(document.getElementById("root")!).render(<App/>);

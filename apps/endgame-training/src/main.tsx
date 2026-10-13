import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { installInputViewport } from "./inputViewport";

function installWebViewZoomGuards() {
  if (typeof window === "undefined") return;

  const preventGestureZoom = (event: Event) => event.preventDefault();

  document.addEventListener("gesturestart", preventGestureZoom, { passive: false });
  document.addEventListener("gesturechange", preventGestureZoom, { passive: false });
  document.addEventListener("gestureend", preventGestureZoom, { passive: false });
}

function installDeviceLayoutClasses() {
  if (typeof window === "undefined") return;

  const update = () => {
    const userAgent = navigator.userAgent;
    const isPhoneUa = /iPhone|iPod|Android.*Mobile/i.test(userAgent);
    const shortestScreenSide = Math.min(window.screen.width, window.screen.height);
    const visualWidth = window.visualViewport?.width ?? window.innerWidth;
    const visualHeight = window.visualViewport?.height ?? window.innerHeight;
    // Keyboard height is not a device-size signal: a tablet remains a tablet.
    const isLikelyPhone = isPhoneUa || shortestScreenSide <= 600;
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
installInputViewport();

createRoot(document.getElementById("root")!).render(<App/>);

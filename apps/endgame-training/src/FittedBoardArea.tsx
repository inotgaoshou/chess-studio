import { useLayoutEffect, useRef, type ReactNode } from "react";

// iOS 15 has no container query units. Measure the remaining grid cell instead
// of falling back to a full-width board that extends below the toolbar.
export function FittedBoardArea({ className, children, suspended = false, alignment = "center" }: { className: string; children: ReactNode; suspended?: boolean; alignment?: "center" | "top" }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (suspended) return;
    const node = element.current!;
    const fit = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) {
        // Leave room for the board frame and piece shadows at the viewport edge.
        const availableWidth = Math.max(0, width - 16);
        const availableHeight = Math.max(0, height - (alignment === "top" ? 12 : 28));
        node.style.setProperty("--fitted-board-width", `${Math.min(availableWidth, availableHeight * 1120 / 1240, 760)}px`);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [suspended, alignment]);
  return <div className={className} ref={element} data-board-alignment={alignment} style={alignment === "top" ? { alignItems:"start" } : undefined}>{children}</div>;
}

import { useLayoutEffect, useRef, type ReactNode } from "react";

// iOS 15 has no container query units. Measure the remaining grid cell instead
// of falling back to a full-width board that extends below the toolbar.
export function FittedBoardArea({ className, children, suspended = false }: { className: string; children: ReactNode; suspended?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (suspended) return;
    const node = element.current!;
    const fit = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) node.style.setProperty("--fitted-board-width", `${Math.min(width, height * 1120 / 1240, 760)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [suspended]);
  return <div className={className} ref={element}>{children}</div>;
}

import { useLayoutEffect, useRef, type ReactNode } from "react";

// iOS 15 has no container query units. Measure the remaining grid cell instead
// of falling back to a full-width board that extends below the toolbar.
export function FittedBoardArea({ className, children }: { className: string; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
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
  }, []);
  return <div className={className} ref={element}>{children}</div>;
}

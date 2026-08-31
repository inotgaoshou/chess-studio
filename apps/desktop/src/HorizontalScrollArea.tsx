import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type ReactNode, type WheelEvent } from "react";

type HorizontalScrollAreaProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  showButtons?: boolean;
};

export function HorizontalScrollArea({ ariaLabel, children, className, showButtons = false }: HorizontalScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slide = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * Math.max(180, scrollRef.current.clientWidth * .72), behavior: "smooth" });
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.currentTarget.scrollLeft += event.deltaY;
    event.preventDefault();
  };
  const content = <div ref={scrollRef} className={className} tabIndex={0} aria-label={ariaLabel} onWheel={handleWheel}>{children}</div>;

  if (!showButtons) return content;
  return <div className="horizontal-scroll-area">
    <button type="button" className="branch-map-slide" aria-label="向左滑动变招" title="向左滑动" onClick={() => slide(-1)}><ChevronLeft size={15}/></button>
    {content}
    <button type="button" className="branch-map-slide" aria-label="向右滑动变招" title="向右滑动" onClick={() => slide(1)}><ChevronRight size={15}/></button>
  </div>;
}

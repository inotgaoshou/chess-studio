import { useId, useMemo, useState } from "react";

export type EvaluationTrendDatum = {
  label: string;
  scoreCp: number;
  nodeId?: string;
  deltaCp?: number;
};

type Props = {
  points: EvaluationTrendDatum[];
  currentNode?: string;
  onNavigate?(nodeId: string): void;
  className?: string;
  height?: number;
  ariaLabel?: string;
};

function signedCp(scoreCp: number) {
  const rounded = Math.round(scoreCp);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function redAdvantageLabel(scoreCp: number) {
  if (Math.abs(scoreCp) <= 50) return "局面接近均势";
  const side = scoreCp > 0 ? "红方" : "黑方";
  return `${side}优势 ${signedCp(scoreCp)} cp`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const slopes = points.map((point, index) => {
    if (index === 0) return (points[1].y - point.y) / (points[1].x - point.x);
    if (index === points.length - 1) return (point.y - points[index - 1].y) / (point.x - points[index - 1].x);
    const before = (point.y - points[index - 1].y) / (point.x - points[index - 1].x);
    const after = (points[index + 1].y - point.y) / (points[index + 1].x - point.x);
    // A zero tangent at a turning point prevents a smooth curve from overshooting it.
    if (before * after <= 0) return 0;
    return Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
  });
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const distance = point.x - previous.x;
    return `${path} C ${previous.x + distance / 3} ${previous.y + slopes[index] * distance / 3}, ${point.x - distance / 3} ${point.y - slopes[index + 1] * distance / 3}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

export function EvaluationTrendChart({ points, currentNode, onNavigate, className = "", height = 180, ariaLabel = "整局局势走势图" }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const clipId = useId().replace(/:/g, "");
  const geometry = useMemo(() => {
    const width = 720;
    const top = 16;
    const bottom = height - 18;
    const middle = (top + bottom) / 2;
    const values = points.map((point) => Math.max(-1000, Math.min(1000, point.scoreCp)));
    const chartPoints = values.map((value, index) => ({
      ...points[index],
      x: values.length === 1 ? width / 2 : index * width / (values.length - 1),
      y: middle - value / 1000 * (middle - top),
    }));
    return { width, top, bottom, middle, chartPoints, path: smoothPath(chartPoints) };
  }, [height, points]);

  if (points.length === 0) return null;
  const activeIndex = hoveredIndex ?? geometry.chartPoints.findIndex((point) => point.nodeId === currentNode);
  const active = geometry.chartPoints[activeIndex >= 0 ? activeIndex : geometry.chartPoints.length - 1];
  const delta = activeIndex > 0 ? active.scoreCp - geometry.chartPoints[activeIndex - 1].scoreCp : undefined;

  return <div className={`evaluation-trend ${className}`.trim()}>
    <svg viewBox={`0 0 ${geometry.width} ${height}`} role="img" aria-label={ariaLabel}>
      <defs>
        <clipPath id={`${clipId}-red`}><rect x="0" y={geometry.top - 4} width={geometry.width} height={geometry.middle - geometry.top + 4}/></clipPath>
        <clipPath id={`${clipId}-black`}><rect x="0" y={geometry.middle} width={geometry.width} height={geometry.bottom - geometry.middle + 4}/></clipPath>
      </defs>
      <rect className="trend-equal-band" x="0" y={geometry.middle - 4} width={geometry.width} height="8"/>
      <line className="trend-grid" x1="0" y1={geometry.top} x2={geometry.width} y2={geometry.top}/>
      <line className="trend-grid" x1="0" y1={geometry.middle} x2={geometry.width} y2={geometry.middle}/>
      <line className="trend-grid" x1="0" y1={geometry.bottom} x2={geometry.width} y2={geometry.bottom}/>
      <path className="trend-path red" d={geometry.path} clipPath={`url(#${clipId}-red)`}/>
      <path className="trend-path black" d={geometry.path} clipPath={`url(#${clipId}-black)`}/>
      {geometry.chartPoints.map((point, index) => {
        const current = point.nodeId === currentNode;
        const hovered = index === hoveredIndex;
        const delta = point.deltaCp ?? (index > 0 ? point.scoreCp - geometry.chartPoints[index - 1].scoreCp : 0);
        const turning = Math.abs(delta) >= 120;
        return <circle key={`${point.nodeId ?? "root"}-${index}`} className={`${current ? "current" : ""} ${hovered ? "hovered" : ""} ${turning ? "turning" : ""}`.trim()} cx={point.x} cy={point.y} r={current || hovered || turning ? 5 : 2.5} role={point.nodeId ? "button" : undefined} tabIndex={point.nodeId ? 0 : undefined} aria-label={point.nodeId ? `${point.label}，${redAdvantageLabel(point.scoreCp)}${turning ? "，关键转折" : ""}，点击跳转` : undefined} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(undefined)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(undefined)} onClick={() => point.nodeId && onNavigate?.(point.nodeId)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && point.nodeId) onNavigate?.(point.nodeId); }}>
          <title>{point.label}：{redAdvantageLabel(point.scoreCp)}</title>
        </circle>;
      })}
      {active && <><line className="trend-current-line" x1={active.x} y1={geometry.top} x2={active.x} y2={geometry.bottom}/><circle className="trend-current-node" cx={active.x} cy={active.y} r="3.5"/></>}
    </svg>
    <div className="evaluation-trend-summary"><span>红方视角</span><strong>{active.label} · {redAdvantageLabel(active.scoreCp)}</strong><span>{delta == null ? "起始局面" : `较上一手 ${delta > 0 ? "红方" : "黑方"}获益 ${Math.abs(Math.round(delta))} cp`}</span></div>
  </div>;
}

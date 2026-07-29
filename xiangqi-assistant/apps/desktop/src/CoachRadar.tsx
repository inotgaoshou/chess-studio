import type { CoachDimensions, CoachProfile } from "./analysisView";

const dimensions: Array<{ key: keyof CoachDimensions; label: string }> = [
  { key: "opening", label: "开局" },
  { key: "middle", label: "中局" },
  { key: "endgame", label: "残局" },
  { key: "accuracy", label: "精准" },
  { key: "stability", label: "稳定" },
];

function point(index: number, value: number, radius = 62) {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / dimensions.length;
  const distance = radius * Math.max(0, Math.min(100, value)) / 100;
  return `${120 + Math.cos(angle) * distance},${78 + Math.sin(angle) * distance}`;
}

export function radarPolygon(values: CoachDimensions) {
  const fallback = values.accuracy ?? 0;
  return dimensions.map(({ key }, index) => point(index, values[key] ?? fallback)).join(" ");
}

export function CoachRadar({ red, black }: { red: CoachProfile; black: CoachProfile }) {
  return <section className="coach-radar" aria-labelledby="coach-radar-title">
    <header>
      <div><strong id="coach-radar-title">五维对局质量</strong><small>应用自有可解释评分</small></div>
      <div className="coach-radar-legend"><span className="red">红方</span><span className="black">黑方</span></div>
    </header>
    <svg viewBox="0 0 240 156" role="img" aria-label="红黑双方开局、中局、残局、精准度和稳定性五维对比">
      {[20, 40, 60, 80, 100].map((value) => <polygon className="radar-grid" key={value} points={dimensions.map((_, index) => point(index, value)).join(" ")}/>) }
      {dimensions.map(({ label }, index) => {
        const [x, y] = point(index, 116).split(",");
        return <g key={label}><line className="radar-axis" x1="120" y1="78" x2={point(index, 100).split(",")[0]} y2={point(index, 100).split(",")[1]}/><text x={x} y={y} textAnchor="middle" dominantBaseline="middle">{label}</text></g>;
      })}
      <polygon className="radar-data black" points={radarPolygon(black.dimensions)}/>
      <polygon className="radar-data red" points={radarPolygon(red.dimensions)}/>
    </svg>
    <div className="coach-dimension-table" role="table" aria-label="五维评分明细">
      <div role="row"><span>维度</span><span>红方</span><span>黑方</span></div>
      {dimensions.map(({ key, label }) => <div role="row" key={key}><strong>{label}</strong><span>{red.dimensions[key] ?? "--"}</span><span>{black.dimensions[key] ?? "--"}</span></div>)}
    </div>
  </section>;
}

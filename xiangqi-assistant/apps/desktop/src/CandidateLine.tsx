import type { CSSProperties } from "react";
import { Play } from "lucide-react";
import { pvMoveRows } from "./analysisView";
import type { AnalysisLine, Side } from "./platform";

type Props = {
  color: string;
  fen: string;
  line: AnalysisLine;
  scoreText?: string;
  sideToMove: Side;
  onPlay(iccs: string, analyzedFen: string): void;
};

function formatNps(value?: number) {
  if (!value) return "-";
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1_000)}K`;
}

export function CandidateLine({ color, fen, line, scoreText, sideToMove, onPlay }: Props) {
  const rows = pvMoveRows(line, sideToMove, fen);
  const firstNotation = line.notation?.[0] ?? line.pv[0];
  return <article className="pv-line" style={{ "--pv-color": color } as CSSProperties} title={`ICCS: ${line.pv.join(" ")}`}>
    <div className="pv-meta">
      <span className="pv-rank">{line.multipv}</span>
      <strong>{scoreText ?? "--"}</strong>
      <span>深度 {line.depth ?? "-"}</span>
      <span>NPS {formatNps(line.nps)}</span>
      <span>{((line.timeMs ?? 0) / 1000).toFixed(1)}s</span>
    </div>
    <div className="pv-table" role="table" aria-label={`候选线路 ${line.multipv}`}>
      <div className="pv-table-head" role="row"><span>回合</span><span>红方</span><span>黑方</span></div>
      {rows.map((row, rowIndex) => <div className="pv-move-row" role="row" key={`${line.multipv}-${row.number}-${rowIndex}`}>
        <span>{row.number}</span>
        <span>{row.red && rowIndex === 0 && sideToMove === "红方"
          ? <button aria-label={`走候选着法 ${row.red}`} onClick={() => onPlay(line.pv[0], fen)}><Play size={12}/>{row.red}</button>
          : row.red ?? ""}</span>
        <span>{row.black && rowIndex === 0 && sideToMove === "黑方"
          ? <button aria-label={`走候选着法 ${row.black}`} onClick={() => onPlay(line.pv[0], fen)}><Play size={12}/>{row.black}</button>
          : row.black ?? ""}</span>
      </div>)}
    </div>
    {!firstNotation && <p>暂无候选着法</p>}
  </article>;
}

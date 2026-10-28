import { fenCells, LABELS } from "./authoringDomain";
const cols = [83, 213, 330, 444, 559, 675, 789, 906, 1035],
  rows = [82, 192, 306, 425, 546, 676, 791, 909, 1023, 1136];
export function AuthoringBoard({
  fen,
  flipped = false,
  selected,
  uncertain = [],
  onSquare,
  label = "题目棋盘",
}: {
  fen: string;
  flipped?: boolean;
  selected?: number;
  uncertain?: number[];
  onSquare?(index: number): void;
  label?: string;
}) {
  let cells: string[];
  try {
    cells = fenCells(fen);
  } catch {
    cells = Array(90).fill("");
  }
  return (
    <svg
      className="authoring-board"
      viewBox="0 0 1120 1240"
      role={onSquare ? "group" : "img"}
      aria-label={label}
    >
      <image
        href="/skins/qingxin-zhuyun/board.png"
        width="1120"
        height="1240"
      />
      {cells.map((code, i) => {
        const index = flipped ? 89 - i : i,
          x = cols[index % 9],
          y = rows[Math.floor(index / 9)];
        return (
          <g
            key={i}
            role={onSquare ? "button" : undefined}
            tabIndex={onSquare ? 0 : undefined}
            aria-label={`${Math.floor(i / 9) + 1}行${(i % 9) + 1}列${LABELS[code] || "空位"}`}
            onClick={() => onSquare?.(i)}
            onKeyDown={(e) => {
              if (onSquare && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSquare(i);
              }
            }}
          >
            <circle
              cx={x}
              cy={y}
              r="57"
              fill="transparent"
              stroke={
                selected === i
                  ? "#397958"
                  : uncertain.includes(i)
                    ? "#e68a25"
                    : "none"
              }
              strokeWidth="7"
            />
            {code && (
              <image
                href={`/skins/qingxin-zhuyun/${code === code.toUpperCase() ? "r" : "b"}${code.toLowerCase()}.png`}
                x={x - 54}
                y={y - 54}
                width="108"
                height="108"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

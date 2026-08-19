/**
 * Canonical geometry for the bundled 1120 x 1240 xiangqi board artwork.
 *
 * Board state coordinates use row 0..9 from the black side and col 0..8 from
 * left to right. Presentation code may flip those coordinates, but it must
 * always obtain the result here so pieces, markers and hit areas remain on
 * the same intersections.
 */
export type BoardSquare = { row: number; col: number };

export const BOARD_ART_WIDTH = 1120;
export const BOARD_ART_HEIGHT = 1240;
export const BOARD_INTERSECTION_ORIGIN = 80;
export const BOARD_INTERSECTION_STEP = 120;

// The main board uses a 120 x 120 hit cell centred on each intersection.
// Its first cell starts at (20, 20), while its centre is (80, 80).
export const BOARD_CELL_ORIGIN = BOARD_INTERSECTION_ORIGIN - BOARD_INTERSECTION_STEP / 2;
export const BOARD_CELL_WIDTH = BOARD_INTERSECTION_STEP;
export const BOARD_CELL_HEIGHT = BOARD_INTERSECTION_STEP;
/** The main board renders the artwork inside each 120px cell with a 7% inset. */
export const BOARD_PIECE_SCALE = 0.86;
export const BOARD_PIECE_DIAMETER = BOARD_CELL_WIDTH * BOARD_PIECE_SCALE;
export const BOARD_INTERSECTION_COUNT_ROWS = 10;
export const BOARD_INTERSECTION_COUNT_COLS = 9;

export type BoardPoint = { x: number; y: number };
export type BoardPercentPosition = { left: string; top: string };
export type BoardGeometrySkin = "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun";

type BoardIntersectionLayout = {
  columns: readonly number[];
  rows: readonly number[];
};

// Each bundled board artwork has its own hand-drawn grid. Keep the measured
// intersections here rather than stretching the visual marker to a guessed
// 120px grid. The fallback below preserves the generic-board geometry.
const BOARD_INTERSECTION_LAYOUTS: Readonly<Record<BoardGeometrySkin, BoardIntersectionLayout>> = {
  default: {
    columns: [75, 197, 318, 439, 559, 681, 800, 923, 1044],
    rows: [67, 188, 309, 431, 552, 679, 800, 920, 1044, 1168],
  },
  hongmu: {
    columns: [78, 195, 314, 435, 557, 679, 801, 921, 1045],
    rows: [74, 192, 314, 436, 557, 679, 801, 923, 1045, 1168],
  },
  jingdian: {
    columns: [82, 203, 324, 444, 562, 685, 801, 924, 1040],
    rows: [82, 198, 321, 440, 559, 683, 800, 918, 1038, 1166],
  },
  xinghe: {
    columns: [65, 196, 319, 441, 559, 680, 801, 924, 1045],
    rows: [67, 196, 319, 437, 558, 678, 798, 917, 1041, 1170],
  },
  "qingxin-zhuyun": {
    columns: [87, 205, 326, 443, 560, 679, 795, 915, 1031],
    rows: [85, 201, 317, 435, 554, 680, 795, 910, 1028, 1145],
  },
};

function boardIntersectionLayout(skin?: string): BoardIntersectionLayout | undefined {
  return skin && skin in BOARD_INTERSECTION_LAYOUTS
    ? BOARD_INTERSECTION_LAYOUTS[skin as BoardGeometrySkin]
    : undefined;
}

export function boardSkinFromAssetPath(boardAsset?: string): BoardGeometrySkin | undefined {
  const skin = boardAsset?.match(/\/skins\/(default|hongmu|jingdian|xinghe|qingxin-zhuyun)\/board\.png(?:[?#].*)?$/)?.[1];
  return boardIntersectionLayout(skin) ? skin as BoardGeometrySkin : undefined;
}

export function boardDisplaySquare(square: BoardSquare, reversed = false): BoardSquare {
  return reversed
    ? { row: BOARD_INTERSECTION_COUNT_ROWS - 1 - square.row, col: BOARD_INTERSECTION_COUNT_COLS - 1 - square.col }
    : square;
}

/**
 * View coordinates are the inverse of display coordinates. The transform is
 * intentionally its own inverse, but this named entry point keeps click
 * handling from depending on that implementation detail.
 */
export function boardCanonicalSquare(square: BoardSquare, reversed = false): BoardSquare {
  return boardDisplaySquare(square, reversed);
}

export function boardIntersectionPoint(square: BoardSquare, reversed = false, skin?: string): BoardPoint {
  const display = boardDisplaySquare(square, reversed);
  const layout = boardIntersectionLayout(skin);
  return {
    x: layout?.columns[display.col] ?? BOARD_INTERSECTION_ORIGIN + display.col * BOARD_INTERSECTION_STEP,
    y: layout?.rows[display.row] ?? BOARD_INTERSECTION_ORIGIN + display.row * BOARD_INTERSECTION_STEP,
  };
}

export function boardIntersectionStyle(square: BoardSquare, reversed = false, skin?: string): BoardPercentPosition {
  const point = boardIntersectionPoint(square, reversed, skin);
  return {
    left: `${point.x / BOARD_ART_WIDTH * 100}%`,
    top: `${point.y / BOARD_ART_HEIGHT * 100}%`,
  };
}

/**
 * Position for the main-board 120 x 120 button cell. Its centre is exactly
 * the same canonical intersection used by mini-board pieces and markers.
 */
export function boardCellStyle(square: BoardSquare, reversed = false, skin?: string): BoardPercentPosition {
  const point = boardIntersectionPoint(square, reversed, skin);
  return {
    left: `${(point.x - BOARD_CELL_WIDTH / 2) / BOARD_ART_WIDTH * 100}%`,
    top: `${(point.y - BOARD_CELL_HEIGHT / 2) / BOARD_ART_HEIGHT * 100}%`,
  };
}

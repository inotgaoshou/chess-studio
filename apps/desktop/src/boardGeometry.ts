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
export const MAIN_BOARD_ART_INSET_X = 0;
export const MAIN_BOARD_ART_INSET_Y = 0;

export type BoardPoint = { x: number; y: number };
export type BoardPercentPosition = { left: string; top: string };
export type BoardGeometrySkin =
  | "default"
  | "hongmu"
  | "jingdian"
  | "xinghe"
  | "qingxin-zhuyun"
  | "skin-bb439484"
  | "skin-8b6b4eeb"
  | "skin-8871865b"
  | "skin-efb016e6"
  | "skin-f71dbfdb"
  | "skin-a84084f7"
  | "skin-a48d1624"
  | "skin-ca04de9d"
  | "skin-da64d5ba"
  | "skin-bad031d6";

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
    columns: [83, 213, 330, 444, 559, 675, 789, 906, 1035],
    rows: [82, 192, 306, 425, 546, 676, 791, 909, 1023, 1136],
  },
  "skin-bb439484": {
    columns: [83, 203, 324, 442, 561, 678, 796, 913, 1034],
    rows: [82, 200, 317, 433, 554, 679, 793, 910, 1027, 1148],
  },
  "skin-8b6b4eeb": {
    columns: [79, 197, 314, 434, 556, 675, 796, 914, 1040],
    rows: [64, 189, 304, 419, 537, 655, 769, 886, 1002, 1135],
  },
  "skin-8871865b": {
    columns: [85, 206, 323, 442, 558, 677, 796, 911, 1033],
    rows: [79, 197, 318, 436, 559, 685, 801, 920, 1040, 1163],
  },
  "skin-efb016e6": {
    columns: [83, 205, 327, 444, 558, 678, 796, 913, 1034],
    rows: [82, 199, 316, 433, 554, 679, 796, 911, 1028, 1148],
  },
  "skin-f71dbfdb": {
    columns: [83, 206, 327, 444, 558, 678, 794, 913, 1034],
    rows: [82, 200, 317, 432, 555, 679, 796, 909, 1028, 1148],
  },
  "skin-a84084f7": {
    columns: [91, 204, 323, 442, 559, 676, 795, 912, 1039],
    rows: [78, 195, 311, 426, 547, 677, 795, 913, 1032, 1153],
  },
  "skin-a48d1624": {
    columns: [83, 205, 326, 443, 558, 678, 794, 913, 1034],
    rows: [82, 200, 316, 435, 555, 680, 793, 911, 1028, 1148],
  },
  "skin-ca04de9d": {
    columns: [83, 206, 327, 443, 561, 679, 793, 913, 1034],
    rows: [82, 199, 318, 433, 556, 679, 793, 909, 1028, 1148],
  },
  "skin-da64d5ba": {
    columns: [83, 206, 327, 444, 558, 678, 796, 913, 1034],
    rows: [82, 199, 315, 433, 553, 679, 794, 908, 1027, 1148],
  },
  "skin-bad031d6": {
    columns: [63, 191, 309, 431, 551, 671, 790, 908, 1026],
    rows: [69, 187, 309, 432, 556, 673, 793, 919, 1042, 1169],
  },
};

function boardIntersectionLayout(skin?: string): BoardIntersectionLayout | undefined {
  return skin && skin in BOARD_INTERSECTION_LAYOUTS
    ? BOARD_INTERSECTION_LAYOUTS[skin as BoardGeometrySkin]
    : undefined;
}

export function boardSkinFromAssetPath(boardAsset?: string): BoardGeometrySkin | undefined {
  const skin = boardAsset?.match(/\/skins\/([^/]+)\/board\.png(?:[?#].*)?$/)?.[1];
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

function insetMainBoardPoint(point: BoardPoint): BoardPoint {
  return {
    x: MAIN_BOARD_ART_INSET_X + point.x * (BOARD_ART_WIDTH - MAIN_BOARD_ART_INSET_X * 2) / BOARD_ART_WIDTH,
    y: MAIN_BOARD_ART_INSET_Y + point.y * (BOARD_ART_HEIGHT - MAIN_BOARD_ART_INSET_Y * 2) / BOARD_ART_HEIGHT,
  };
}

export function mainBoardIntersectionPoint(square: BoardSquare, reversed = false, skin?: string): BoardPoint {
  return insetMainBoardPoint(boardIntersectionPoint(square, reversed, skin));
}

export function mainBoardIntersectionStyle(square: BoardSquare, reversed = false, skin?: string): BoardPercentPosition {
  const point = mainBoardIntersectionPoint(square, reversed, skin);
  return {
    left: `${point.x / BOARD_ART_WIDTH * 100}%`,
    top: `${point.y / BOARD_ART_HEIGHT * 100}%`,
  };
}

export function mainBoardCellStyle(square: BoardSquare, reversed = false, skin?: string): BoardPercentPosition {
  const point = mainBoardIntersectionPoint(square, reversed, skin);
  return {
    left: `${(point.x - BOARD_CELL_WIDTH / 2) / BOARD_ART_WIDTH * 100}%`,
    top: `${(point.y - BOARD_CELL_HEIGHT / 2) / BOARD_ART_HEIGHT * 100}%`,
  };
}

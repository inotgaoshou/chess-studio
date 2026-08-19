import { useId, useRef, type CSSProperties } from "react";
import type { Piece, Side } from "./platform";
import {
  BOARD_ART_HEIGHT,
  BOARD_ART_WIDTH,
  BOARD_INTERSECTION_COUNT_COLS,
  BOARD_INTERSECTION_COUNT_ROWS,
  BOARD_INTERSECTION_ORIGIN,
  BOARD_INTERSECTION_STEP,
  BOARD_PIECE_DIAMETER,
  boardIntersectionPoint,
  boardIntersectionStyle,
  boardSkinFromAssetPath,
} from "./boardGeometry";

// Keep these exports stable for board consumers and existing tests. The
// implementation lives in boardGeometry so every board uses one coordinate
// system rather than silently recreating it.
export {
  BOARD_ART_HEIGHT,
  BOARD_ART_WIDTH,
  BOARD_INTERSECTION_ORIGIN,
  BOARD_INTERSECTION_STEP,
  boardIntersectionPoint,
  boardIntersectionStyle,
} from "./boardGeometry";

export type LinkMiniArrow = {
  rank: number;
  color: string;
  iccs?: string;
  notation?: string;
  from: { row: number; col: number };
  to: { row: number; col: number };
};

type Props = {
  pieces: Piece[];
  arrows: LinkMiniArrow[];
  lastMove?: {
    from: { row: number; col: number };
    to: { row: number; col: number };
    notation?: string;
    movedBy?: Side;
  };
  sideToMove?: Side;
  reversed?: boolean;
  presentation?: "link" | "preview";
  markerStyle?: "arrow" | "corner" | "tiantian";
  /** A selected source square is rendered above pieces without implying a move. */
  selectedSquare?: { row: number; col: number };
  /** Keeps the embedded board understandable when it is used outside link/flyknife views. */
  boardAriaLabel?: string;
  pieceAsset(piece: Piece): string;
  boardAsset?: string;
  pieceScale?: number;
  markerScale?: number;
  arrowVisualScale?: number;
  /** Interactive training boards can opt out of the transient piece tween. */
  animateMoves?: boolean;
};

type RenderedMiniPiece = Piece & {
  renderKey: string;
  shouldAnimateMove?: boolean;
  moveFrom?: { row: number; col: number };
};
type CapturedMiniPiece = Piece & { renderKey: string };
type MovingMiniPiece = Piece & {
  renderKey: string;
  baseRenderKey: string;
  moveFrom: { row: number; col: number };
};
type ReconcileOptions = { stabilizeLinkedMove?: boolean };

const LINK_MINI_MOVE_ANIMATION_MS = 320;

const shortenLine = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  padding: number,
) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= padding * 2) return { from, to };
  const offsetX = dx / length * padding;
  const offsetY = dy / length * padding;
  return {
    from: { x: from.x + offsetX, y: from.y + offsetY },
    to: { x: to.x - offsetX, y: to.y - offsetY },
  };
};

const lineLength = (from: { x: number; y: number }, to: { x: number; y: number }) => (
  Math.hypot(to.x - from.x, to.y - from.y)
);

const candidateArrowPadding = (from: { x: number; y: number }, to: { x: number; y: number }) => (
  // Keep the stem anchored to the same intersections as the pieces. A large
  // trim creates a visible gap on the enlarged flyknife preview board.
  clamp(lineLength(from, to) * .055, 4, 8.5)
);

const lastMoveTargetRingRadius = 37.5;
const cornerMarkerSize = 54;
const cornerMarkerArm = 25;

const pieceStyle = (position: { x: number; y: number }, scale: number) => ({
  left: `${position.x / BOARD_ART_WIDTH * 100}%`,
  top: `${position.y / BOARD_ART_HEIGHT * 100}%`,
  width: `${BOARD_PIECE_DIAMETER * scale / BOARD_ART_WIDTH * 100}%`,
});

const movingPieceStyle = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  scale: number,
) => ({
  ...pieceStyle(to, scale),
  "--link-mini-move-from-left": `${from.x / BOARD_ART_WIDTH * 100}%`,
  "--link-mini-move-from-top": `${from.y / BOARD_ART_HEIGHT * 100}%`,
  "--link-mini-move-to-left": `${to.x / BOARD_ART_WIDTH * 100}%`,
  "--link-mini-move-to-top": `${to.y / BOARD_ART_HEIGHT * 100}%`,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const arrowLabelPoint = (
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    x: clamp(from.x + dx * .55, 130, 990),
    y: clamp(from.y + dy * .55, 130, 1110),
  };
};

const cornerPath = (size: number, arm: number) => (
  `M ${-size} ${-size} H ${-arm} M ${-size} ${-size} V ${-arm} `
  + `M ${size} ${-size} H ${arm} M ${size} ${-size} V ${-arm} `
  + `M ${-size} ${size} H ${-arm} M ${-size} ${size} V ${arm} `
  + `M ${size} ${size} H ${arm} M ${size} ${size} V ${arm}`
);

const squareKey = (square: { row: number; col: number }) => `${square.row}-${square.col}`;
const pieceTypeKey = (piece: Pick<Piece, "color" | "kind">) => `${piece.color}-${piece.kind}`;
const pieceKindKey = (piece: Pick<Piece, "kind">) => piece.kind;
const samePieceType = (left: Pick<Piece, "color" | "kind">, right: Pick<Piece, "color" | "kind">) => (
  left.color === right.color && left.kind === right.kind
);
const pieceTypeCounts = (pieces: Piece[]) => pieces.reduce((counts, piece) => {
  const key = pieceTypeKey(piece);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map<string, number>());
const pieceKindCounts = (pieces: Piece[]) => pieces.reduce((counts, piece) => {
  const key = pieceKindKey(piece);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map<string, number>());
const distance = (left: { row: number; col: number }, right: { row: number; col: number }) => (
  Math.abs(left.row - right.row) + Math.abs(left.col - right.col)
);
const publicPiece = (piece: Piece): Piece => ({
  row: piece.row,
  col: piece.col,
  color: piece.color,
  kind: piece.kind,
  label: piece.label,
});
const samePieceOnSquare = (left: Piece, right: Piece) => (
  left.row === right.row
  && left.col === right.col
  && samePieceType(left, right)
);
const samePieceSet = (left: Piece[], right: Piece[]) => (
  left.length === right.length
  && left.every((piece) => right.some((candidate) => samePieceOnSquare(piece, candidate)))
);

function recoverStableStaticPieces(
  stablePieces: Piece[],
  currentPieces: Piece[],
  lastMove: Props["lastMove"],
) {
  if (!lastMove) return stablePieces;
  const fromKey = squareKey(lastMove.from);
  const toKey = squareKey(lastMove.to);
  const occupiedSquares = new Set(stablePieces.map(squareKey));
  const stableCounts = pieceTypeCounts(stablePieces);
  const currentCounts = pieceTypeCounts(currentPieces);
  const stableKindCounts = pieceKindCounts(stablePieces);
  const currentKindCounts = pieceKindCounts(currentPieces);
  const recoveredPieces: Piece[] = [];

  for (const piece of currentPieces) {
    const square = squareKey(piece);
    if (square === fromKey || square === toKey || occupiedSquares.has(square)) continue;
    const type = pieceTypeKey(piece);
    const kind = pieceKindKey(piece);
    if ((stableCounts.get(type) ?? 0) >= (currentCounts.get(type) ?? 0)) continue;
    if ((stableKindCounts.get(kind) ?? 0) >= (currentKindCounts.get(kind) ?? 0)) continue;
    recoveredPieces.push(publicPiece(piece));
    occupiedSquares.add(square);
    stableCounts.set(type, (stableCounts.get(type) ?? 0) + 1);
    stableKindCounts.set(kind, (stableKindCounts.get(kind) ?? 0) + 1);
  }

  return recoveredPieces.length ? [...stablePieces, ...recoveredPieces] : stablePieces;
}

function stabilizePiecesForLinkedMove(
  pieces: Piece[],
  lastMove: Props["lastMove"] | undefined,
  previousPieces: RenderedMiniPiece[],
  enabled: boolean,
) {
  if (!enabled || !lastMove || previousPieces.length === 0) return pieces;
  const fromKey = squareKey(lastMove.from);
  const toKey = squareKey(lastMove.to);
  if (fromKey === toKey) return pieces;
  const previousPublicPieces = previousPieces.map(publicPiece);
  if (samePieceSet(pieces, previousPublicPieces)) return pieces;

  const previousFrom = previousPieces.find((piece) => squareKey(piece) === fromKey);
  const incomingTo = previousFrom
    ? pieces.find((piece) => squareKey(piece) === toKey && samePieceType(piece, previousFrom))
    : undefined;
  if (previousFrom && incomingTo) {
    const previousTarget = previousPieces.find((piece) => squareKey(piece) === toKey);
    if (previousTarget && previousTarget.color === previousFrom.color) return pieces;
    const stablePieces = previousPieces.flatMap((piece) => {
      const key = squareKey(piece);
      if (key === fromKey) return [{ ...publicPiece(incomingTo), row: lastMove.to.row, col: lastMove.to.col }];
      if (key === toKey) return [];
      return [publicPiece(piece)];
    });
    return recoverStableStaticPieces(stablePieces, pieces, lastMove);
  }

  const previousTo = previousPieces.find((piece) => squareKey(piece) === toKey);
  const incomingStillShowsMovedPiece = previousTo
    ? pieces.some((piece) => squareKey(piece) === toKey && samePieceType(piece, previousTo))
    : false;
  return incomingStillShowsMovedPiece ? recoverStableStaticPieces(previousPublicPieces, pieces, lastMove) : pieces;
}

export function reconcileLinkMiniPieces(
  pieces: Piece[],
  lastMove: Props["lastMove"] | undefined,
  previousPieces: RenderedMiniPiece[] = [],
  nextId = 1,
  options: ReconcileOptions = {},
) {
  const displayPieces = stabilizePiecesForLinkedMove(
    pieces,
    lastMove,
    previousPieces,
    options.stabilizeLinkedMove ?? false,
  );
  const previousBySquare = new Map(previousPieces.map((piece) => [squareKey(piece), piece]));
  const unusedKeys = new Set(previousPieces.map((piece) => piece.renderKey));
  const moveFromKey = lastMove ? squareKey(lastMove.from) : undefined;
  const moveToKey = lastMove ? squareKey(lastMove.to) : undefined;
  const previousMover = moveFromKey ? previousBySquare.get(moveFromKey) : undefined;
  const previousCaptured = moveToKey ? previousBySquare.get(moveToKey) : undefined;
  const capturedPieces: CapturedMiniPiece[] = previousMover
    && previousCaptured
    && previousCaptured.color !== previousMover.color
    && displayPieces.some((piece) => squareKey(piece) === moveToKey && samePieceType(piece, previousMover))
    ? [{
      ...publicPiece(previousCaptured),
      renderKey: `link-mini-captured-${previousCaptured.renderKey}-${moveFromKey}-${moveToKey}`,
    }]
    : [];
  const take = (candidate: RenderedMiniPiece | undefined, piece: Piece) => {
    if (!candidate || !unusedKeys.has(candidate.renderKey) || !samePieceType(candidate, piece)) {
      return undefined;
    }
    unusedKeys.delete(candidate.renderKey);
    return candidate.renderKey;
  };

  const rendered = displayPieces.map((piece) => {
    const exactKey = take(previousBySquare.get(squareKey(piece)), piece);
    const moveKey = !exactKey
      && lastMove
      && piece.row === lastMove.to.row
      && piece.col === lastMove.to.col
      ? take(previousBySquare.get(squareKey(lastMove.from)), piece)
      : undefined;
    const nearestKey = exactKey || moveKey || (!options.stabilizeLinkedMove ? take(
      previousPieces
        .filter((candidate) => unusedKeys.has(candidate.renderKey) && samePieceType(candidate, piece))
        .sort((left, right) => distance(left, piece) - distance(right, piece))[0],
      piece,
    ) : undefined);
    const renderKey = nearestKey ?? `link-mini-piece-${nextId++}`;
    return {
      ...piece,
      renderKey,
      shouldAnimateMove: Boolean(moveKey),
      moveFrom: moveKey && lastMove ? lastMove.from : undefined,
    };
  });

  return { pieces: rendered, capturedPieces, nextId };
}

export function LinkMiniBoard({ pieces, arrows, lastMove, sideToMove, reversed = false, presentation = "link", markerStyle = "arrow", selectedSquare, boardAriaLabel, pieceAsset, boardAsset, pieceScale = 1, markerScale = 1, arrowVisualScale = 1, animateMoves = true }: Props) {
  const arrowFlowIdPrefix = useId().replace(/:/g, "");
  // An empty asset path is not a usable skin. Resolve it once so the visual
  // background and the fallback grid cannot disagree about which board owns
  // the geometry.
  const hasBoardAsset = Boolean(boardAsset?.trim());
  const boardSkin = boardSkinFromAssetPath(boardAsset);
  const pointForSquare = (square: { row: number; col: number }) => boardIntersectionPoint(square, reversed, boardSkin);
  const lastFrom = lastMove ? pointForSquare(lastMove.from) : undefined;
  const lastTo = lastMove ? pointForSquare(lastMove.to) : undefined;
  const selectedPoint = selectedSquare ? pointForSquare(selectedSquare) : undefined;
  const safePieceScale = Number.isFinite(pieceScale) ? clamp(pieceScale, .75, 1.35) : 1;
  const safeMarkerScale = Number.isFinite(markerScale) ? clamp(markerScale, .55, 1.25) : 1;
  const safeArrowVisualScale = Number.isFinite(arrowVisualScale) ? clamp(arrowVisualScale, .55, 1.2) : 1;
  const lastSideClass = lastMove?.movedBy === "黑方" ? "black" : lastMove?.movedBy === "红方" ? "red" : "";
  // Corner markers identify squares, not the side that moved. Keeping them
  // red in screenshot/U10 previews matches the main board and avoids a black
  // move silently switching the source/target affordance to blue.
  const markerColorClass = markerStyle === "corner" ? "red" : markerStyle === "tiantian" ? "tiantian" : lastSideClass;
  const markerStyleClass = markerStyle === "corner" ? "corner-marker" : markerStyle === "tiantian" ? "tiantian-marker" : "";
  const turnSideClass = sideToMove === "黑方" ? "black" : sideToMove === "红方" ? "red" : "";
  const lastMoveLabel = lastMove ? `上一着${lastMove.movedBy ?? ""}${lastMove.notation ? `：${lastMove.notation}` : ""}` : undefined;
  const animationMoveKey = lastMove ? `${squareKey(lastMove.from)}:${squareKey(lastMove.to)}` : undefined;
  const tiantianSourceRadius = 19 * safeMarkerScale;
  const tiantianSourceCenterRadius = Math.max(6.6, 7.6 * safeMarkerScale);
  const tiantianTargetGlowRadius = BOARD_PIECE_DIAMETER * safePieceScale * .49;
  const tiantianTargetRingRadius = BOARD_PIECE_DIAMETER * safePieceScale * .46;
  const pieceKeyState = useRef<{ nextId: number; pieces: RenderedMiniPiece[]; capturedPieces: CapturedMiniPiece[]; movingPieces: MovingMiniPiece[]; animationMoveKey?: string; animationExpiresAt?: number }>({ nextId: 1, pieces: [], capturedPieces: [], movingPieces: [] });
  const reconciledPieces = reconcileLinkMiniPieces(pieces, lastMove, pieceKeyState.current.pieces, pieceKeyState.current.nextId, { stabilizeLinkedMove: presentation === "link" });
  const now = Date.now();
  const nextMovingPieces = animateMoves ? reconciledPieces.pieces.flatMap((piece) => piece.shouldAnimateMove && piece.moveFrom ? [{
    ...publicPiece(piece),
    renderKey: `link-mini-moving-${piece.renderKey}-${squareKey(piece.moveFrom)}-${squareKey(piece)}`,
    baseRenderKey: piece.renderKey,
    moveFrom: piece.moveFrom,
  }] : []) : [];
  const nextCapturedPieces = animateMoves ? reconciledPieces.capturedPieces : [];
  const animationExpiresAt = nextMovingPieces.length || nextCapturedPieces.length
    ? now + LINK_MINI_MOVE_ANIMATION_MS
    : pieceKeyState.current.animationExpiresAt;
  const keepCurrentAnimation = Boolean(
    animateMoves
    && animationMoveKey
    && pieceKeyState.current.animationMoveKey === animationMoveKey
    && animationExpiresAt
    && now < animationExpiresAt,
  );
  const capturedPieces = nextCapturedPieces.length
    ? nextCapturedPieces
    : keepCurrentAnimation ? pieceKeyState.current.capturedPieces : [];
  const movingPieces = nextMovingPieces.length
    ? nextMovingPieces
    : keepCurrentAnimation ? pieceKeyState.current.movingPieces : [];
  pieceKeyState.current = { ...reconciledPieces, capturedPieces, movingPieces, animationMoveKey, animationExpiresAt: movingPieces.length || capturedPieces.length ? animationExpiresAt : undefined };
  const movingBaseKeys = new Set(movingPieces.map((piece) => piece.baseRenderKey));
  const lastMoveLayer = lastMove && lastFrom && lastTo && <svg
    className={`link-mini-last-move ${markerColorClass} ${presentation === "preview" ? "overlay" : ""} ${markerStyleClass}`}
    viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`}
    aria-label={lastMoveLabel}
    preserveAspectRatio="none"
    style={markerStyle === "tiantian" ? {
      "--link-mini-tiantian-source-ring-width": `${3.2 * safeMarkerScale}px`,
      "--link-mini-tiantian-target-glow-width": `${15 * safeMarkerScale}px`,
      "--link-mini-tiantian-target-ring-width": `${7 * safeMarkerScale}px`,
    } as CSSProperties : undefined}
  >
    {markerStyle === "corner" ? <>
      <g className="link-mini-corner-source" transform={`translate(${lastFrom.x} ${lastFrom.y})`}>
        <path d={cornerPath(cornerMarkerSize, cornerMarkerArm)}/>
      </g>
      <g className="link-mini-corner-target" transform={`translate(${lastTo.x} ${lastTo.y})`}>
        <path d={cornerPath(cornerMarkerSize, cornerMarkerArm)}/>
      </g>
    </> : markerStyle === "tiantian" ? <>
      <g className="link-mini-tiantian-source" transform={`translate(${lastFrom.x} ${lastFrom.y})`}>
        <circle className="link-mini-tiantian-source-ring" r={tiantianSourceRadius}/>
        <circle className="link-mini-tiantian-source-center" r={tiantianSourceCenterRadius} fill="rgba(255, 255, 255, .98)"/>
      </g>
      <g className="link-mini-tiantian-target" transform={`translate(${lastTo.x} ${lastTo.y})`}>
        <circle className="link-mini-tiantian-target-glow" r={tiantianTargetGlowRadius}/>
        <circle className="link-mini-tiantian-target-ring" r={tiantianTargetRingRadius}/>
        <circle className="link-mini-tiantian-target-flow-white" r={tiantianTargetRingRadius} pathLength="100"/>
        <circle className="link-mini-tiantian-target-flow-blue" r={Math.max(12, tiantianTargetRingRadius - 5 * safeMarkerScale)} pathLength="100"/>
      </g>
    </> : <>
    <defs>
      <marker id="link-mini-last-move-head" markerWidth="42" markerHeight="42" refX="36" refY="21" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 42 21 L 0 42 z"/>
      </marker>
    </defs>
    {(() => {
      const { from, to } = shortenLine(lastFrom, lastTo, 3.8);
      return <>
        <line className="link-mini-last-arrow" x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#link-mini-last-move-head)"/>
        <line className="link-mini-last-arrow-flow" x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>
      </>;
    })()}
    <g className="link-mini-last-from">
      <circle cx={lastFrom.x} cy={lastFrom.y} r="19.5"/>
    </g>
    <g className="link-mini-last-to">
      <circle cx={lastTo.x} cy={lastTo.y} r={lastMoveTargetRingRadius}/>
    </g>
    </>}
  </svg>;
  const selectedLayer = selectedPoint && <svg className={`link-mini-selected-square ${presentation === "preview" ? "overlay" : ""}`} viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} aria-label="已选起点" preserveAspectRatio="none">
    <g transform={`translate(${selectedPoint.x} ${selectedPoint.y})`}><path d={cornerPath(cornerMarkerSize, cornerMarkerArm)}/></g>
  </svg>;
  const boardEndX = BOARD_INTERSECTION_ORIGIN + (BOARD_INTERSECTION_COUNT_COLS - 1) * BOARD_INTERSECTION_STEP;
  const boardEndY = BOARD_INTERSECTION_ORIGIN + (BOARD_INTERSECTION_COUNT_ROWS - 1) * BOARD_INTERSECTION_STEP;
  const riverTop = BOARD_INTERSECTION_ORIGIN + 4 * BOARD_INTERSECTION_STEP;
  const riverBottom = BOARD_INTERSECTION_ORIGIN + 5 * BOARD_INTERSECTION_STEP;
  const palaceLeft = BOARD_INTERSECTION_ORIGIN + 3 * BOARD_INTERSECTION_STEP;
  const palaceRight = BOARD_INTERSECTION_ORIGIN + 5 * BOARD_INTERSECTION_STEP;
  const palaceTop = BOARD_INTERSECTION_ORIGIN;
  const palaceBottom = BOARD_INTERSECTION_ORIGIN + 7 * BOARD_INTERSECTION_STEP;
  const resolvedBoardAriaLabel = boardAriaLabel ?? (presentation === "preview" ? "飞刀预演棋盘" : "连线提示棋盘，仅用于显示候选路线");
  return <div className={`link-mini-board-wrap ${presentation === "preview" ? "preview" : ""}`}>
    <div className="link-mini-board-status">
      {lastMoveLabel ? <span className={`last ${lastSideClass}`}>{lastMoveLabel}</span> : <span className="last muted">暂无上一着</span>}
      {sideToMove && <strong className={`turn ${turnSideClass}`}>{sideToMove}行棋</strong>}
    </div>
    <div className={`link-mini-board ${presentation === "preview" ? "preview" : ""} ${hasBoardAsset ? "with-board-asset" : ""} ${sideToMove === "黑方" ? "black-turn" : sideToMove === "红方" ? "red-turn" : ""}`} style={hasBoardAsset ? { backgroundImage: `url("${boardAsset}")`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" } : undefined} aria-label={resolvedBoardAriaLabel}>
      {!hasBoardAsset && <svg className="link-mini-board-grid" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} aria-hidden="true">
        {Array.from({ length: BOARD_INTERSECTION_COUNT_ROWS }, (_, row) => <line key={`h-${row}`} x1={BOARD_INTERSECTION_ORIGIN} y1={BOARD_INTERSECTION_ORIGIN + row * BOARD_INTERSECTION_STEP} x2={boardEndX} y2={BOARD_INTERSECTION_ORIGIN + row * BOARD_INTERSECTION_STEP}/>) }
        {Array.from({ length: BOARD_INTERSECTION_COUNT_COLS }, (_, col) => col === 0 || col === BOARD_INTERSECTION_COUNT_COLS - 1
          ? <line key={`v-${col}`} x1={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y1={BOARD_INTERSECTION_ORIGIN} x2={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y2={boardEndY}/>
          : <g key={`v-${col}`}><line x1={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y1={BOARD_INTERSECTION_ORIGIN} x2={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y2={riverTop}/><line x1={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y1={riverBottom} x2={BOARD_INTERSECTION_ORIGIN + col * BOARD_INTERSECTION_STEP} y2={boardEndY}/></g>)}
        <path d={`M ${palaceLeft} ${palaceTop} L ${palaceRight} ${palaceTop + 2 * BOARD_INTERSECTION_STEP} M ${palaceRight} ${palaceTop} L ${palaceLeft} ${palaceTop + 2 * BOARD_INTERSECTION_STEP} M ${palaceLeft} ${palaceBottom} L ${palaceRight} ${boardEndY} M ${palaceRight} ${palaceBottom} L ${palaceLeft} ${boardEndY}`}/>
        <text className="link-mini-river-text chu" x={BOARD_INTERSECTION_ORIGIN + 2.25 * BOARD_INTERSECTION_STEP} y={(riverTop + riverBottom) / 2 + 6}>楚河</text>
        <text className="link-mini-river-text han" x={BOARD_INTERSECTION_ORIGIN + 5.75 * BOARD_INTERSECTION_STEP} y={(riverTop + riverBottom) / 2 + 6}>汉界</text>
      </svg>}
      <svg
        className="link-mini-board-arrows"
        viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`}
        aria-hidden="true"
        preserveAspectRatio="none"
        style={{
          "--link-mini-arrow-backdrop-width": `${18 * safeArrowVisualScale}px`,
          "--link-mini-arrow-outline-width": `${15 * safeArrowVisualScale}px`,
          "--link-mini-arrow-stem-width": `${8 * safeArrowVisualScale}px`,
        } as CSSProperties}
      >
        <defs>
          {arrows.map((arrow) => {
            const rawFrom = pointForSquare(arrow.from);
            const rawTo = pointForSquare(arrow.to);
            const { from, to } = shortenLine(rawFrom, rawTo, candidateArrowPadding(rawFrom, rawTo));
            return <path key={`flow-${arrow.rank}`} id={`${arrowFlowIdPrefix}-arrow-flow-${arrow.rank}`} d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} fill="none"/>;
          })}
          {arrows.map((arrow) => <marker key={arrow.rank} id={`link-mini-arrow-head-${arrow.rank}`} markerWidth="46" markerHeight="46" refX="38" refY="23" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 46 23 L 0 46 z" fill={arrow.color} fillOpacity=".82" stroke="rgba(255, 255, 255, .68)" strokeWidth="4" strokeLinejoin="round"/></marker>)}
        </defs>
        {arrows.map((arrow) => {
          const rawFrom = pointForSquare(arrow.from);
          const rawTo = pointForSquare(arrow.to);
          const { from, to } = shortenLine(rawFrom, rawTo, candidateArrowPadding(rawFrom, rawTo));
          return <g key={arrow.rank} className="link-mini-candidate-arrow">
            <line className="link-mini-arrow-stem-backdrop" x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>
            <line className="link-mini-arrow-stem-outline" x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>
            <line className="link-mini-arrow-stem" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={arrow.color} markerEnd={`url(#link-mini-arrow-head-${arrow.rank})`}/>
            <g className="link-mini-arrow-flow-marker" aria-hidden="true">
              <path d="M -13 -8 L -4 0 L -13 8"/>
              <path d="M -2 -8 L 7 0 L -2 8"/>
              <animateMotion dur={`${7.2 + arrow.rank * .35}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${arrowFlowIdPrefix}-arrow-flow-${arrow.rank}`}/>
              </animateMotion>
            </g>
          </g>;
        })}
      </svg>
      <svg className="link-mini-arrow-labels" viewBox={`0 0 ${BOARD_ART_WIDTH} ${BOARD_ART_HEIGHT}`} aria-label={`候选箭头编号：${arrows.map((arrow) => arrow.rank).join("、")}`} preserveAspectRatio="none">
        {arrows.map((arrow) => {
          const label = arrowLabelPoint(pointForSquare(arrow.from), pointForSquare(arrow.to));
          return <g key={arrow.rank} className="link-mini-arrow-label high-contrast" style={{ "--arrow-color": arrow.color, "--link-mini-label-font-size": `${39 * safeArrowVisualScale}px`, "--link-mini-label-stroke-width": `${4 * safeArrowVisualScale}px`, "--link-mini-label-circle-stroke-width": `${4 * safeArrowVisualScale}px` } as CSSProperties}>
            <circle cx={label.x} cy={label.y} r={29 * safeArrowVisualScale}/>
            <text x={label.x} y={label.y}>{arrow.rank}</text>
          </g>;
        })}
      </svg>
      {presentation !== "preview" && lastMoveLayer}
      {presentation !== "preview" && selectedLayer}
      {capturedPieces.map((piece) => {
        const pointAtPiece = pointForSquare(piece);
        return <img key={piece.renderKey} data-piece-key={piece.renderKey} data-piece={pieceTypeKey(piece)} data-square={squareKey(piece)} className="link-mini-piece capture-animate" style={pieceStyle(pointAtPiece, safePieceScale)} src={pieceAsset(piece)} alt="" draggable={false}/>;
      })}
      {reconciledPieces.pieces.map((piece) => {
        const pointAtPiece = pointForSquare(piece);
        return <img key={piece.renderKey} data-piece-key={piece.renderKey} data-piece={pieceTypeKey(piece)} data-square={squareKey(piece)} className={`link-mini-piece${movingBaseKeys.has(piece.renderKey) ? " move-arrive" : ""}`} style={pieceStyle(pointAtPiece, safePieceScale)} src={pieceAsset(piece)} alt="" draggable={false}/>;
      })}
      {movingPieces.map((piece) => {
        const pointAtPiece = pointForSquare(piece);
        return <img key={piece.renderKey} data-piece-key={piece.renderKey} data-piece={pieceTypeKey(piece)} data-square={squareKey(piece)} className="link-mini-piece move-animate" style={movingPieceStyle(pointForSquare(piece.moveFrom), pointAtPiece, safePieceScale) as CSSProperties} src={pieceAsset(piece)} alt="" draggable={false}/>;
      })}
      {presentation === "preview" && lastMoveLayer}
      {presentation === "preview" && selectedLayer}
    </div>
  </div>;
}

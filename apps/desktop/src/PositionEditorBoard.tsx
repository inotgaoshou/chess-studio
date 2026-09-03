import type { CSSProperties, SyntheticEvent } from "react";
import type { Piece } from "./platform";
import { boardCellStyle } from "./boardGeometry";

type PositionEditorBoardProps = {
  cells: readonly { row: number; col: number }[];
  pieces: ReadonlyMap<string, Piece>;
  boardSkin: string;
  pieceSkin: string;
  pieceAsset(piece: Piece): string;
  onPieceAssetError(event: SyntheticEvent<HTMLImageElement>, piece: Piece): void;
  onEditSquare(row: number, col: number): void;
  squareLabel(row: number, col: number): string;
};

/**
 * The editor deliberately shares the workbench's artwork and measured
 * intersections. A separate CSS grid drifts from the selected board skin and
 * makes a position look different before it is saved.
 */
export function PositionEditorBoard({
  cells,
  pieces,
  boardSkin,
  pieceSkin,
  pieceAsset,
  onPieceAssetError,
  onEditSquare,
  squareLabel,
}: PositionEditorBoardProps) {
  return (
    <div className={`editor-board board-skin-${boardSkin} piece-skin-${pieceSkin}`} aria-label="局面编辑棋盘">
      <div className="board-art" aria-hidden="true" />
      {cells.map(({ row, col }) => {
        const piece = pieces.get(`${row}-${col}`);
        const cellStyle = boardCellStyle({ row, col }, false, boardSkin);
        const style = {
          "--piece-left": cellStyle.left,
          "--piece-top": cellStyle.top,
        } as CSSProperties;
        return (
          <button
            type="button"
            key={`${row}-${col}`}
            className={`editor-board-square board-square piece-${piece?.color ?? "empty"}`}
            style={style}
            onClick={() => onEditSquare(row, col)}
            aria-label={`编辑 ${squareLabel(row, col)}`}
          >
            {piece && <img src={pieceAsset(piece)} alt={piece.label} onError={(event) => onPieceAssetError(event, piece)} />}
          </button>
        );
      })}
    </div>
  );
}

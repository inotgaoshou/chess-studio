import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardCanonicalSquare, boardIntersectionStyle, boardSkinFromAssetPath } from "./boardGeometry";
import type { Piece, PreviewLineStep, Side } from "./platform";

type Props = {
  baseFen: string;
  basePieces: Piece[];
  baseSideToMove: Side;
  onPreview(moves: string[]): Promise<PreviewLineStep[]>;
  pieceAsset(piece: Piece): string;
  boardAsset: string;
  boardAriaLabel: string;
  disabled?: boolean;
  minMoves?: number;
  maxMoves?: number;
  /** A revealed book line may temporarily take over the board display. */
  referenceStep?: PreviewLineStep;
  onLineChange?(moves: string[], steps: PreviewLineStep[]): void;
};

/** Shared by course boards: validate only a bounded temporary line, never a game tree. */
export function previewTemporaryLine(onPreview: (moves: string[]) => Promise<PreviewLineStep[]>, moves: string[], maxMoves = 8) {
  return onPreview(moves.slice(0, maxMoves));
}

function squareToIccs(row: number, col: number) {
  return `${String.fromCharCode(97 + col)}${9 - row}`;
}

function squareLabel(row: number, col: number) {
  return `棋盘第 ${row + 1} 行第 ${col + 1} 列`;
}

export function TemporaryCalculationBoard({ baseFen, basePieces, baseSideToMove, onPreview, pieceAsset, boardAsset, boardAriaLabel, disabled = false, minMoves = 2, maxMoves = 8, referenceStep, onLineChange }: Props) {
  const boardSkin = useMemo(() => boardSkinFromAssetPath(boardAsset), [boardAsset]);
  const [selectedSquare, setSelectedSquare] = useState<{ row: number; col: number }>();
  const [moves, setMoves] = useState<string[]>([]);
  const [steps, setSteps] = useState<PreviewLineStep[]>([]);
  const [viewedStepIndex, setViewedStepIndex] = useState<number>();
  const [pending, setPending] = useState(false);
  const [lineError, setLineError] = useState("");
  const requestId = useRef(0);
  const interactionLocked = useRef(false);
  const calculatedStep = viewedStepIndex == null ? steps.at(-1) : steps[viewedStepIndex];
  const currentStep = referenceStep ?? calculatedStep;
  const pieces = currentStep?.pieces ?? basePieces;
  const sideToMove = currentStep ? (currentStep.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方") : baseSideToMove;
  const displayedMove = selectedSquare || pending || !currentStep ? undefined : { from: currentStep.from, to: currentStep.to, notation: currentStep.notation, movedBy: currentStep.movedBy };

  useEffect(() => () => { requestId.current += 1; }, []);

  async function setLine(nextMoves: string[]) {
    const limited = nextMoves.slice(0, maxMoves);
    const currentRequest = ++requestId.current;
    if (limited.length === 0) {
      interactionLocked.current = false;
      setMoves([]);
      setSteps([]);
      setViewedStepIndex(undefined);
      setSelectedSquare(undefined);
      setLineError("");
      onLineChange?.([], []);
      return;
    }
    try {
      interactionLocked.current = true;
      setPending(true);
      const nextSteps = await previewTemporaryLine(onPreview, limited, maxMoves);
      if (currentRequest !== requestId.current) return;
      setMoves(limited);
      setSteps(nextSteps);
      setViewedStepIndex(undefined);
      setLineError("");
      onLineChange?.(limited, nextSteps);
    } catch (error) {
      if (currentRequest === requestId.current) setLineError(error instanceof Error ? error.message : "这一步不符合棋规，请重新走子");
    } finally {
      if (currentRequest === requestId.current) {
        interactionLocked.current = false;
        setPending(false);
      }
    }
  }

  async function clickSquare(row: number, col: number) {
    if (disabled || pending || interactionLocked.current) return;
    if (viewedStepIndex != null && viewedStepIndex < moves.length - 1) {
      setLineError("正在回看前面的局面，请先点击“从该步继续推演”后再走子");
      return;
    }
    const square = boardCanonicalSquare({ row, col });
    const piece = pieces.find((candidate) => candidate.row === square.row && candidate.col === square.col);
    const movingColor = sideToMove === "红方" ? "red" : "black";
    if (!selectedSquare) {
      if (piece?.color !== movingColor) {
        setLineError(`请先选择轮到${sideToMove}走的棋子`);
        return;
      }
      setSelectedSquare(square);
      setLineError("");
      return;
    }
    if (piece?.color === movingColor) {
      setSelectedSquare(square);
      setLineError("");
      return;
    }
    if (moves.length >= maxMoves) {
      setSelectedSquare(undefined);
      setLineError(`最多推演 ${maxMoves} 个半回合，请撤回后再尝试`);
      return;
    }
    const move = `${squareToIccs(selectedSquare.row, selectedSquare.col)}${squareToIccs(square.row, square.col)}`;
    setSelectedSquare(undefined);
    await setLine([...moves, move]);
  }

  return <section className="temporary-calculation-board">
    <div className={`temporary-board-click-layer ${selectedSquare ? "selecting" : ""}`}>
      <LinkMiniBoard presentation="preview" markerStyle="corner" animateMoves={false} boardAriaLabel={boardAriaLabel} pieces={pieces} arrows={[]} lastMove={displayedMove} selectedSquare={selectedSquare} sideToMove={sideToMove} pieceAsset={pieceAsset} boardAsset={boardAsset}/>
      {!disabled && <div className="temporary-board-hit-grid" aria-label={`${boardAriaLabel}走子区域`}>{Array.from({ length: 90 }, (_, index) => {
        const row = Math.floor(index / 9); const col = index % 9;
        const square = boardCanonicalSquare({ row, col });
        return <button key={`${row}-${col}`} type="button" disabled={pending} aria-label={`推演${squareLabel(row, col)}`} data-square={`${square.row}-${square.col}`} className="temporary-board-hit-target" style={boardIntersectionStyle(square, false, boardSkin)} onClick={() => void clickSquare(row, col)}/>;
      })}</div>}
    </div>
    <small className="temporary-board-help">先点棋子，再点目标点。临时推演不会修改真实大师棋谱。</small>
    <section className="temporary-prediction-strip" aria-label="我的推演">
      <header><strong>我的推演</strong><small>{moves.length < minMoves ? `还需 ${minMoves - moves.length} 手才可提交` : `已推演 ${moves.length}/${maxMoves} 手，可提交`}</small></header>
      <div className="temporary-prediction-steps">{steps.length === 0 ? <span>请直接在棋盘上走出你的想法</span> : steps.map((step, index) => <button type="button" key={`${step.notation}-${index}`} className={viewedStepIndex === index ? "active" : ""} title={`回看第 ${index + 1} 步局面`} onClick={() => !disabled && setViewedStepIndex(index)}><b>{index + 1}</b><span>{step.movedBy} · {step.notation}</span></button>)}</div>
      {!disabled && <footer>{viewedStepIndex != null && viewedStepIndex < moves.length - 1 && <button type="button" className="temporary-continue-from-step" disabled={pending} onClick={() => void setLine(moves.slice(0, viewedStepIndex + 1))}>从第 {viewedStepIndex + 1} 步继续</button>}<span><button type="button" disabled={pending || moves.length === 0} onClick={() => void setLine(moves.slice(0, -1))}><RotateCcw size={12}/>撤回</button><button type="button" disabled={pending || (moves.length === 0 && !selectedSquare)} onClick={() => void setLine([])}><Trash2 size={12}/>重置题目</button></span></footer>}
    </section>
    {lineError && <p className="temporary-line-error" role="alert">{lineError}</p>}
  </section>;
}

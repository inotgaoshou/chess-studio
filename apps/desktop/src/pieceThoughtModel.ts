import { buildMoveThought, type MoveThought } from "./moveThoughtModel";
import type { AnalysisLine, BoardState, MoveItem, MoveSquare, Piece, ReportIssuePresentationDto, Side } from "./platform/types";

export type PieceThoughtSource = "engine" | "move" | "fallback";

export type PieceThoughtCandidate = {
  iccs: string;
  notation: string;
  scoreText: string;
  depth?: number;
  line: string;
};

export type SelectedPieceThought = {
  source: PieceThoughtSource;
  sourceLabel: string;
  piece: Piece;
  square: MoveSquare;
  squareName: string;
  sideToMove: Side;
  title: string;
  role: string;
  candidates: PieceThoughtCandidate[];
  risk: string;
  nextAction: string;
  comparison?: string;
  confidenceNote?: string;
};

export type PieceThoughtSelection = {
  piece: Piece;
  square: MoveSquare;
  fen: string;
  sideToMove: Side;
};

export type BuildPieceThoughtOptions = {
  selection: PieceThoughtSelection;
  board: Pick<BoardState, "fen" | "sideToMove">;
  analysisLines: AnalysisLine[];
  analysisFen?: string;
  analysisIsStale?: boolean;
  currentMove?: MoveItem;
  currentMoveIssue?: ReportIssuePresentationDto;
};

function pieceSide(piece: Pick<Piece, "color">): Side {
  return piece.color === "red" ? "红方" : "黑方";
}

function squareToIccs(square: MoveSquare) {
  return `${String.fromCharCode(97 + square.col)}${9 - square.row}`;
}

function squareName(square: MoveSquare) {
  return squareToIccs(square).toUpperCase();
}

function scoreText(line: AnalysisLine, sideToMove: Side) {
  if (line.mate != null) return `${sideToMove}杀 ${Math.abs(line.mate)}`;
  if (line.scoreCp == null) return "评分待补";
  const sideScore = sideToMove === "红方" ? line.scoreCp : -line.scoreCp;
  return `${sideScore > 0 ? "+" : ""}${sideScore}`;
}

function lineText(line: AnalysisLine) {
  const text = line.notation?.join(" ") || line.pv.join(" ");
  return text || "引擎暂未返回后续变化";
}

function buildEngineCandidates(lines: AnalysisLine[], selection: PieceThoughtSelection): PieceThoughtCandidate[] {
  const from = squareToIccs(selection.square);
  const seen = new Set<string>();
  return lines.flatMap((line) => {
    const firstMove = line.pv[0];
    if (!firstMove || firstMove.slice(0, 2) !== from || seen.has(firstMove)) return [];
    seen.add(firstMove);
    return [{
      iccs: firstMove,
      notation: line.notation?.[0] ?? firstMove,
      scoreText: scoreText(line, selection.sideToMove),
      depth: line.depth,
      line: lineText(line),
    }];
  });
}

function fallbackRole(piece: Piece) {
  switch (piece.kind) {
    case "rook":
      return "车的核心作用是直线控制和抢开放线：看它能不能压住同一路/同一横线，或直接威胁对方重要子。";
    case "horse":
      return "马重在跳点、踩点和制造双重威胁：先看马腿是否被堵，再看能否跳到河口、卧槽或挂角附近。";
    case "cannon":
      return "炮需要炮架和目标：重点观察中路、底线和对方将帅附近有没有可借用的子。";
    case "pawn":
      return "兵卒的价值在过河控点、限制马路和制造小先手；不要只看吃子，也要看它控住了哪些要点。";
    case "elephant":
      return "相象主要负责防守和补厚阵形：先确认象眼是否被塞，再看是否能补住中路或将门。";
    case "advisor":
      return "士的作用是稳住九宫和将帅安全：优先服务于防守结构，别为了小利让将门暴露。";
    case "king":
      return "帅将通常以安全为第一目标：先检查将军、照面和九宫内的防守缺口。";
    default:
      return `${piece.label}的作用要结合线路判断：先看它是否有直接威胁，再看是否会暴露防守弱点。`;
  }
}

function fallbackRisk(piece: Piece) {
  switch (piece.kind) {
    case "rook":
      return "风险是车被小子追赶、离开关键防线，或贪吃后被对方抢先手。";
    case "horse":
      return "风险是马腿被塞、跳到边角后回旋不足，或被炮车牵制。";
    case "cannon":
      return "风险是炮架消失、空炮无目标，或中路出击后后防变薄。";
    case "pawn":
      return "风险是兵卒过早深入被白吃，或放弃原本控制的马路/肋道。";
    case "elephant":
    case "advisor":
    case "king":
      return "风险是防守子离位后形成将门漏洞，尤其要先排除对方将军和杀棋。";
    default:
      return "风险是只看到本子可走，忽略对方下一手的将军、吃子和反先。";
  }
}

function fallbackNextAction(piece: Piece) {
  switch (piece.kind) {
    case "rook":
      return "先找车能压住的开放线，再比较是否有吃子、将军或牵制。";
    case "horse":
      return "先数可跳点，优先比较能踩中兵线、河口和将门附近的走法。";
    case "cannon":
      return "先找炮架，再比较平炮抢中、打底线和退炮防守哪条更稳。";
    case "pawn":
      return "先看进兵是否能控点或赶马；过河后优先找能保留先手的位置。";
    case "elephant":
    case "advisor":
    case "king":
      return "先做安全检查：是否被将、是否照面、是否存在一手杀，再考虑改善阵形。";
    default:
      return "建议先用引擎分析当前局面，再对比这枚子的候选走法。";
  }
}

function moveThoughtForSelectedPiece(options: BuildPieceThoughtOptions): MoveThought | undefined {
  const currentMove = options.currentMove;
  const selected = options.selection.square;
  if (!currentMove || currentMove.to.row !== selected.row || currentMove.to.col !== selected.col) return undefined;
  return buildMoveThought(currentMove, options.currentMoveIssue);
}

export function buildSelectedPieceThought(options: BuildPieceThoughtOptions): SelectedPieceThought | undefined {
  const { selection, board, analysisLines, analysisFen, analysisIsStale } = options;
  if (selection.fen !== board.fen || selection.sideToMove !== board.sideToMove) return undefined;
  if (pieceSide(selection.piece) !== board.sideToMove) return undefined;

  const candidates = !analysisIsStale && analysisFen === board.fen
    ? buildEngineCandidates(analysisLines, selection)
    : [];
  const moveThought = moveThoughtForSelectedPiece(options);
  const source: PieceThoughtSource = candidates.length > 0 ? "engine" : moveThought ? "move" : "fallback";
  return {
    source,
    sourceLabel: source === "engine" ? "引擎候选" : source === "move" ? "当前着法" : "轻量棋理",
    piece: selection.piece,
    square: selection.square,
    squareName: squareName(selection.square),
    sideToMove: selection.sideToMove,
    title: `${selection.sideToMove}${selection.piece.label} · ${squareName(selection.square)}`,
    role: candidates.length > 0
      ? `Pikafish 当前候选里，这枚${selection.piece.label}至少有 ${candidates.length} 个推荐方向。`
      : moveThought?.purpose ?? fallbackRole(selection.piece),
    candidates,
    risk: moveThought?.risk ?? fallbackRisk(selection.piece),
    nextAction: moveThought?.nextAction ?? fallbackNextAction(selection.piece),
    comparison: moveThought?.comparison,
    confidenceNote: candidates.length > 0
      ? "依据当前局面的 MultiPV 候选起点匹配；可点候选线继续预览比较。"
      : "未匹配到当前引擎候选时，先显示规则化棋理提示。",
  };
}

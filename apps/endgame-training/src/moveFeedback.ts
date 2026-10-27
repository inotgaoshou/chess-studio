import type { BoardPiece, BoardState } from "./types";
import { stopCommentarySpeech } from "./commentarySpeech";

export type TrainingFeedbackKind = "move" | "capture" | "check" | "checkmate" | "stalemate";
export type TrainingFeedbackEvent = { id: number; kind: TrainingFeedbackKind; iccs: string; piece?: BoardPiece };
export const FEEDBACK_DURATION: Record<TrainingFeedbackKind, number> = { move:180,capture:900,check:1500,checkmate:1800,stalemate:1800 };
export const TRAINING_FEEDBACK_PACK = {
  id: "crisp-board-v107",
  labels: { check: "将", checkmate: "绝杀", stalemate: "困毙" },
  voice: { move:"/audio/v107-move.wav",capture:"/audio/v107-capture.wav",check:"/audio/v107-check.wav",checkmate:"/audio/v107-checkmate.wav",stalemate:"/audio/v107-stalemate.wav" },
} as const;
let nextEvent = 0;
export function trainingFeedbackEvent(before:BoardPiece[], after:BoardState, iccs:string):TrainingFeedbackEvent {
  const from = {col:iccs.charCodeAt(0)-97,row:9-Number(iccs[1])};
  return {id:++nextEvent,kind:deriveTrainingFeedback(before,after,iccs),iccs,piece:before.find(p=>sameSquare(p,from.row,from.col))};
}
function sameSquare(piece: BoardPiece, row: number, col: number) {
  return piece.row === row && piece.col === col;
}

export function deriveTrainingFeedback(before: BoardPiece[], after: BoardState, iccs: string): TrainingFeedbackKind {
  if (after.status === "将死") return "checkmate";
  if (after.status === "困毙") return "stalemate";
  if (after.status === "将军") return "check";
  const to = { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) };
  const from = { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) };
  const mover = before.find((piece) => sameSquare(piece, from.row, from.col));
  return mover && before.some((piece) => piece.color !== mover.color && sameSquare(piece, to.row, to.col)) ? "capture" : "move";
}

// One clip per actual move. A new move stops the previous clip, including a
// repeated check. Audio rejection is optional feedback, never a move failure.
const voices = new Map<TrainingFeedbackKind, HTMLAudioElement>();
export function cancelTrainingFeedback() {
  for (const voice of voices.values()) {
    try { voice.pause(); voice.currentTime=0; } catch { /* Unavailable audio output. */ }
  }
}
export function playTrainingFeedback(kind:TrainingFeedbackKind) {
  void stopCommentarySpeech();
  cancelTrainingFeedback();
  if(typeof Audio === "undefined")return;
  try {
    let voice=voices.get(kind);
    if(!voice){voice=new Audio(TRAINING_FEEDBACK_PACK.voice[kind]);voice.preload="auto";voices.set(kind,voice);}
    voice.volume=.85;
    void voice.play()?.catch(()=>undefined);
  } catch { /* Audio must never block a legal move. */ }
}

import type { BoardPiece, BoardState } from "./types";
import { stopCommentarySpeech } from "./commentarySpeech";

export type TrainingFeedbackKind = "move" | "capture" | "check" | "checkmate" | "stalemate";
export type TrainingFeedbackEvent = { id: number; kind: TrainingFeedbackKind; iccs: string; piece?: BoardPiece; captured?: BoardPiece };
export const FEEDBACK_DURATION: Record<TrainingFeedbackKind, number> = { move:180,capture:900,check:1500,checkmate:1800,stalemate:1800 };
export const TRAINING_FEEDBACK_PACK = {
  id: "crisp-board-v107",
  labels: { check: "将", checkmate: "绝杀", stalemate: "困毙" },
  voice: { move:"/audio/v107-move.wav",capture:"/audio/v107-capture.wav",check:"/audio/v107-check.wav",checkmate:"/audio/v107-checkmate.wav",stalemate:"/audio/v107-stalemate.wav" },
} as const;
let nextEvent = 0;
export function trainingFeedbackEvent(before:BoardPiece[], after:BoardState, iccs:string):TrainingFeedbackEvent {
  const from = {col:iccs.charCodeAt(0)-97,row:9-Number(iccs[1])};
  const to = {col:iccs.charCodeAt(2)-97,row:9-Number(iccs[3])};
  const piece=before.find(p=>sameSquare(p,from.row,from.col));
  const captured=before.find(p=>piece && p.color!==piece.color && sameSquare(p,to.row,to.col));
  return {id:++nextEvent,kind:deriveTrainingFeedback(before,after,iccs),iccs,piece,captured};
}
export function replayTrainingFeedbackEvent(before:BoardPiece[], after:BoardState, moves:string[], previousCursor:number, nextCursor:number) {
  const iccs=nextCursor===previousCursor+1?moves[nextCursor-1]:undefined;
  return iccs?trainingFeedbackEvent(before,after,iccs):undefined;
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
const buffers = new Map<TrainingFeedbackKind, AudioBuffer>();
let audioContext: AudioContext | undefined;
let audioLoading: Promise<void> | undefined;
let activeSource: AudioBufferSourceNode | undefined;
let audioUnlockInstalled = false;
let playbackGeneration = 0;
function feedbackAudioContext() {
  if(typeof window === "undefined" || !window.AudioContext)return undefined;
  try { audioContext ??= new window.AudioContext(); return audioContext; }
  catch { return undefined; }
}
export function prepareTrainingFeedbackAudio() {
  if(typeof document !== "undefined" && !audioUnlockInstalled) {
    document.addEventListener("pointerdown", unlockTrainingFeedbackAudio, { capture: true });
    document.addEventListener("keydown", unlockTrainingFeedbackAudio, { capture: true });
    audioUnlockInstalled = true;
  }
  const context=feedbackAudioContext();
  if(!context || audioLoading)return;
  audioLoading=Promise.all((Object.entries(TRAINING_FEEDBACK_PACK.voice) as [TrainingFeedbackKind,string][]).map(async([kind,url])=>{
    if(buffers.has(kind))return;
    try {
      const response=await fetch(url);
      if(response.ok)buffers.set(kind,await context.decodeAudioData(await response.arrayBuffer()));
    } catch { /* The HTML audio fallback remains available. */ }
  })).then(()=>undefined);
}
export function unlockTrainingFeedbackAudio() {
  const context=feedbackAudioContext();
  if(!context)return;
  prepareTrainingFeedbackAudio();
  if(context.state!=="running")void context.resume().catch(()=>undefined);
}
export function cancelTrainingFeedback() {
  playbackGeneration++;
  if(activeSource){try{activeSource.stop();activeSource.disconnect();}catch{/* Already ended. */}activeSource=undefined;}
  for (const voice of voices.values()) {
    try { voice.pause(); voice.currentTime=0; } catch { /* Unavailable audio output. */ }
  }
}
function playDecodedFeedback(kind:TrainingFeedbackKind, generation:number) {
  const context=audioContext,buffer=buffers.get(kind);
  if(generation!==playbackGeneration || context?.state!=="running" || !buffer)return false;
  try {
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;gain.gain.value=.85;
    source.connect(gain);gain.connect(context.destination);
    activeSource=source;
    source.onended=()=>{if(activeSource===source)activeSource=undefined;};
    source.start();
    return true;
  } catch { activeSource=undefined; return false; }
}
export function playTrainingFeedback(kind:TrainingFeedbackKind) {
  void stopCommentarySpeech();
  cancelTrainingFeedback();
  const generation=playbackGeneration;
  if(playDecodedFeedback(kind,generation))return;
  const retryDecoded=()=>void audioLoading?.then(()=>playDecodedFeedback(kind,generation));
  if(typeof Audio === "undefined"){retryDecoded();return;}
  try {
    let voice=voices.get(kind);
    if(!voice){voice=new Audio(TRAINING_FEEDBACK_PACK.voice[kind]);voice.preload="auto";voices.set(kind,voice);}
    voice.volume=.85;
    void voice.play()?.catch(retryDecoded);
  } catch { retryDecoded(); }
}

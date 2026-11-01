import type { BoardPiece, BoardState } from "./types";
import { stopCommentarySpeech } from "./commentarySpeech";

export type TrainingFeedbackKind = "move" | "capture" | "check" | "checkmate" | "stalemate";
export type TrainingFeedbackEvent = { id: number; kind: TrainingFeedbackKind; iccs: string; piece?: BoardPiece; captured?: BoardPiece };
export const FEEDBACK_DURATION: Record<TrainingFeedbackKind, number> = { move:180,capture:1450,check:1600,checkmate:2000,stalemate:2000 };
export const TRAINING_FEEDBACK_PACK = {
  id: "reference-board-v109",
  labels: { check: "将", checkmate: "绝杀", stalemate: "困毙" },
  voice: { move:"/audio/v109-move.wav",capture:"/audio/v109-capture.wav",captureAdvisor:"/audio/v109-capture-advisor.wav",captureElephant:"/audio/v109-capture-elephant.wav",check:"/audio/v109-check.wav",checkmate:"/audio/v109-checkmate.wav",stalemate:"/audio/v109-stalemate-reference-v5.wav" },
} as const;
export type FeedbackAudioCue = keyof typeof TRAINING_FEEDBACK_PACK.voice;
export function captureVariant(event?: TrainingFeedbackEvent) {
  if (event?.kind !== "capture") return "ordinary";
  if (event.captured?.kind === "advisor") return "advisor";
  if (event.captured?.kind === "elephant") return "elephant";
  return "ordinary";
}
export function captureLabel(event?: TrainingFeedbackEvent) {
  const variant=captureVariant(event);
  return variant === "advisor" ? "破士" : variant === "elephant" ? (event?.captured?.color === "red" ? "破相" : "破象") : "吃";
}
export function feedbackAudioCue(event: TrainingFeedbackKind | TrainingFeedbackEvent): FeedbackAudioCue {
  if (typeof event === "string") return event;
  const variant=captureVariant(event);
  return variant === "advisor" ? "captureAdvisor" : variant === "elephant" ? "captureElephant" : event.kind;
}
export const movementDuration = (event:TrainingFeedbackEvent) => event.captured ? 280 : 180;
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
const voices = new Map<FeedbackAudioCue, HTMLAudioElement>();
const buffers = new Map<FeedbackAudioCue, AudioBuffer>();
let audioContext: AudioContext | undefined;
let audioLoading: Promise<void> | undefined;
let activeSource: AudioBufferSourceNode | undefined;
let audioUnlockInstalled = false;
let playbackGeneration = 0;
let pendingPlayback: ReturnType<typeof setTimeout> | undefined;
let playbackDeadline = 0;
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
  audioLoading=Promise.all((Object.entries(TRAINING_FEEDBACK_PACK.voice) as [FeedbackAudioCue,string][]).map(async([kind,url])=>{
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
  clearTimeout(pendingPlayback);pendingPlayback=undefined;
  if(activeSource){try{activeSource.stop();activeSource.disconnect();}catch{/* Already ended. */}activeSource=undefined;}
  for (const voice of voices.values()) {
    try { voice.pause(); voice.currentTime=0; } catch { /* Unavailable audio output. */ }
  }
}
function playDecodedFeedback(kind:FeedbackAudioCue, generation:number) {
  const context=audioContext,buffer=buffers.get(kind);
  if(generation!==playbackGeneration || Date.now()>playbackDeadline || context?.state!=="running" || !buffer)return false;
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
export function playTrainingFeedback(event:TrainingFeedbackKind | TrainingFeedbackEvent) {
  const kind=feedbackAudioCue(event);
  void stopCommentarySpeech();
  cancelTrainingFeedback();
  const generation=playbackGeneration;
  // Spoken impact cues meet the arriving piece/title, not the initial tap.
  const delay=typeof event==="string"?0:event.kind==="move"?0:150;
  playbackDeadline=Date.now()+delay+400;
  const start=()=>{
    pendingPlayback=undefined;
    if(generation!==playbackGeneration || (typeof document!=="undefined" && document.visibilityState==="hidden"))return;
    if(playDecodedFeedback(kind,generation))return;
    const retryDecoded=()=>void audioLoading?.then(()=>playDecodedFeedback(kind,generation));
    if(typeof Audio === "undefined"){retryDecoded();return;}
    try {
      let voice=voices.get(kind);
      if(!voice){voice=new Audio(TRAINING_FEEDBACK_PACK.voice[kind]);voice.preload="auto";voices.set(kind,voice);}
      voice.volume=.85;
      void voice.play()?.catch(retryDecoded);
    } catch { retryDecoded(); }
  };
  if(delay)pendingPlayback=setTimeout(start,delay);else start();
}

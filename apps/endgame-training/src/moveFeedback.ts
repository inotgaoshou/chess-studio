import type { BoardPiece, BoardState } from "./types";

export type TrainingFeedbackKind = "move" | "capture" | "check" | "checkmate" | "stalemate";

export const TRAINING_FEEDBACK_PACK = {
  id: "ink-strike",
  labels: { check: "将", checkmate: "绝杀", stalemate: "困毙" },
  voice: { move: "/audio/move-crisp.wav", capture: "/audio/capture.wav", check: "/audio/check.wav", checkmate: "/audio/checkmate.wav" },
} as const;

const voices = new Map<"capture" | "check" | "checkmate", HTMLAudioElement>();
let moveAudio: HTMLAudioElement | undefined;

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

function playVoice(kind: "capture" | "check" | "checkmate") {
  if (typeof Audio === "undefined") return;
  let voice = voices.get(kind);
  if (!voice) {
    voice = new Audio(TRAINING_FEEDBACK_PACK.voice[kind]);
    voice.preload = "auto";
    voices.set(kind, voice);
  }
  voice.pause();
  voice.currentTime = 0;
  voice.volume = .85;
  void voice.play().catch(() => undefined);
}

function playMoveSample(onFailure: () => void) {
  if (typeof Audio === "undefined") return false;
  try {
    moveAudio ??= new Audio(TRAINING_FEEDBACK_PACK.voice.move);
    moveAudio.preload = "auto";
    moveAudio.pause();
    moveAudio.currentTime = 0;
    moveAudio.volume = 1;
    const playback = moveAudio.play();
    void playback.catch(onFailure);
    return true;
  } catch {
    return false;
  }
}

let feedbackAudioContext: AudioContext | undefined;

function getFeedbackAudioContext() {
  const Context = window.AudioContext;
  if (!Context) return undefined;
  feedbackAudioContext ??= new Context();
  return feedbackAudioContext;
}

function playNoiseSweep(context: AudioContext, now: number, duration: number, startHz: number, endHz: number, amount: number) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  samples.forEach((_, index) => {
    const progress = index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * Math.sin(Math.PI * progress);
  });
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(startHz, now);
  filter.frequency.exponentialRampToValueAtTime(endHz, now + duration);
  filter.Q.setValueAtTime(.72, now);
  gain.gain.setValueAtTime(.001, now);
  gain.gain.exponentialRampToValueAtTime(amount, now + Math.min(.035, duration * .35));
  gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now);
  source.stop(now + duration);
}

function playTone(context: AudioContext, now: number, frequency: number, endFrequency: number, duration: number, amount: number, type: OscillatorType = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
  gain.gain.setValueAtTime(.001, now);
  gain.gain.exponentialRampToValueAtTime(amount, now + Math.min(.008, duration * .2));
  gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playClickTransient(context: AudioContext, now: number, amount: number) {
  const duration = .018;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  samples.forEach((_, index) => {
    samples[index] = (Math.random() * 2 - 1) * Math.exp(-index / (context.sampleRate * .0038));
  });
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2400, now);
  gain.gain.setValueAtTime(amount, now);
  gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now);
  source.stop(now + duration);
}

function playWoodClick(context: AudioContext, now: number, level: number, weight = 1) {
  playClickTransient(context, now, .2 * level * weight);
  playTone(context, now, 2400, 1050, .028, .34 * level * weight, "triangle");
  playTone(context, now + .001, 5200, 2400, .012, .16 * level * weight, "triangle");
  playTone(context, now, 620, 390, .035, .04 * level * weight, "sine");
}

function playWhoosh(context: AudioContext, now: number, level: number, weight = 1) {
  playNoiseSweep(context, now, .18, 620, 2650, .095 * level * weight);
}

function playMetalAccent(context: AudioContext, now: number, level: number) {
  playTone(context, now + .025, 930, 900, .24, .075 * level, "sine");
  playTone(context, now + .025, 1395, 1360, .2, .045 * level, "sine");
  playTone(context, now + .025, 2010, 1960, .15, .026 * level, "sine");
}

function playGong(context: AudioContext, now: number, level: number) {
  playTone(context, now, 196, 184, 1.05, .13 * level, "sine");
  playTone(context, now + .012, 287, 271, .86, .09 * level, "sine");
  playTone(context, now + .018, 421, 397, .68, .055 * level, "triangle");
  playNoiseSweep(context, now, .09, 850, 380, .04 * level);
}

export function playTrainingFeedback(kind: TrainingFeedbackKind) {
  if (kind === "capture" || kind === "check" || kind === "checkmate") playVoice(kind);
  if (kind === "stalemate") playVoice("checkmate");
  try {
    if (kind === "move") {
      const fallback = () => {
        const fallbackContext = getFeedbackAudioContext();
        if (!fallbackContext) return;
        playWoodClick(fallbackContext, fallbackContext.currentTime, .85);
        void fallbackContext.resume().catch(() => undefined);
      };
      if (playMoveSample(fallback)) return;
      fallback();
      return;
    }
    const context = getFeedbackAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const level = .85;
    if (kind === "capture") {
      playWoodClick(context, now, level, 1.05);
      playWhoosh(context, now, level, .72);
    }
    if (kind === "check") {
      playWhoosh(context, now, level, .82);
      playMetalAccent(context, now, level);
    }
    if (kind === "checkmate" || kind === "stalemate") {
      playWhoosh(context, now, level, 1.05);
      playGong(context, now + .035, level);
    }
    void context.resume().catch(() => undefined);
  } catch {
    // Audio output is optional and must never block a legal move.
  }
}

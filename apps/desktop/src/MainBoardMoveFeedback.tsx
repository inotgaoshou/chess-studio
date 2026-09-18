import { useEffect, type CSSProperties } from "react";
import type { BoardState, MoveItem, Piece } from "./platform";
import { mainBoardIntersectionStyle } from "./boardGeometry";
import { DEFAULT_MOVE_FEEDBACK_PACK } from "./MoveFeedbackPack";

export type MoveFeedbackKind = "move" | "capture" | "check" | "checkmate" | "stalemate";

export type MoveFeedback = {
  id: string;
  kind: MoveFeedbackKind;
  move: Pick<MoveItem, "from" | "to">;
  mover: Piece;
  captured?: Piece;
  checkedKing?: Piece;
};

function sameSquare(left: Pick<Piece, "row" | "col">, right: Pick<Piece, "row" | "col">) {
  return left.row === right.row && left.col === right.col;
}

function isKing(piece: Piece) {
  return /^(king|general)$/i.test(piece.kind) || piece.label === "帅" || piece.label === "将";
}

/** Derives purely presentational feedback from the authoritative board snapshots. */
export function createMoveFeedback(before: BoardState, after: BoardState): MoveFeedback | undefined {
  const move = after.history.at(-1);
  if (!move || after.history.length !== before.history.length + 1) return undefined;
  const mover = before.pieces.find((piece) => sameSquare(piece, move.from));
  if (!mover) return undefined;
  const captured = before.pieces.find((piece) => sameSquare(piece, move.to) && piece.color !== mover.color);
  const isCheckmate = after.status === "将死";
  const isCheck = after.status === "将军" || isCheckmate;
  const checkedKing = isCheck
    ? after.pieces.find((piece) => piece.color !== mover.color && isKing(piece))
    : undefined;
  return {
    id: `${after.currentNode ?? after.fen}:${move.id}`,
    kind: isCheckmate ? "checkmate" : isCheck ? "check" : captured ? "capture" : "move",
    move,
    mover,
    captured,
    checkedKing,
  };
}

type Props = {
  feedback?: MoveFeedback;
  reversed: boolean;
  boardSkin?: string;
  pieceAsset(piece: Piece): string;
  onComplete(id: string): void;
};

export function MainBoardMoveFeedback({ feedback, reversed, boardSkin, pieceAsset, onComplete }: Props) {
  useEffect(() => {
    if (!feedback) return;
    const duration = feedback.kind === "checkmate" ? 3400 : feedback.kind === "check" ? 2800 : feedback.kind === "capture" ? 520 : 320;
    const timer = window.setTimeout(() => onComplete(feedback.id), duration);
    return () => window.clearTimeout(timer);
  }, [feedback, onComplete]);

  if (!feedback) return null;
  const from = mainBoardIntersectionStyle(feedback.move.from, reversed, boardSkin);
  const to = mainBoardIntersectionStyle(feedback.move.to, reversed, boardSkin);
  const king = feedback.checkedKing ? mainBoardIntersectionStyle(feedback.checkedKing, reversed, boardSkin) : undefined;
  return <>
    {feedback.captured && <img
      className="main-board-feedback-piece capture"
      src={pieceAsset(feedback.captured)}
      style={{ "--feedback-left": to.left, "--feedback-top": to.top } as CSSProperties}
      alt=""
      aria-hidden="true"
    />}
    <img
      className="main-board-feedback-piece moving"
      src={pieceAsset(feedback.mover)}
      style={{
        "--feedback-from-left": from.left,
        "--feedback-from-top": from.top,
        "--feedback-to-left": to.left,
        "--feedback-to-top": to.top,
      } as CSSProperties}
      alt=""
      aria-hidden="true"
    />
    {feedback.kind === "capture" && <span
      className="main-board-capture-feedback"
      style={{ "--feedback-left": to.left, "--feedback-top": to.top } as CSSProperties}
      aria-hidden="true"
    ><span>吃</span></span>}
    {king && <span
      className="main-board-check-feedback"
      style={{ "--feedback-left": king.left, "--feedback-top": king.top } as CSSProperties}
      aria-hidden="true"
    />}
    {(feedback.kind === "check" || feedback.kind === "checkmate") && <span
      className={`main-board-ink-feedback ${DEFAULT_MOVE_FEEDBACK_PACK.visualClass} ${feedback.kind}`}
      aria-hidden="true"
    ><span>{DEFAULT_MOVE_FEEDBACK_PACK.labels[feedback.kind]}</span></span>}
  </>;
}

let audioContext: AudioContext | undefined;
let moveAudio: HTMLAudioElement | undefined;

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return undefined;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

function speakFeedback(kind: Extract<MoveFeedbackKind, "capture" | "check" | "checkmate" | "stalemate">, volume: number) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  const text = kind === "capture" ? "吃" : kind === "check" ? "将军" : kind === "stalemate" ? "困毙" : "绝杀";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = kind === "capture" ? 1.35 : 1.08;
  utterance.pitch = .72;
  utterance.volume = Math.min(1, Math.max(0, volume / 100));
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function playMoveSample(volume: number, onFailure: () => void) {
  if (typeof Audio === "undefined") return false;
  try {
    moveAudio ??= new Audio(DEFAULT_MOVE_FEEDBACK_PACK.voice.move);
    moveAudio.preload = "auto";
    moveAudio.pause();
    moveAudio.currentTime = 0;
    moveAudio.volume = Math.min(1, Math.sqrt(volume / 100) * 1.15);
    const playback = moveAudio.play();
    void playback.catch(onFailure);
    return true;
  } catch {
    return false;
  }
}

function playNoiseSweep(context: AudioContext, now: number, duration: number, startHz: number, endHz: number, amount: number) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const decay = 1 - index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * Math.sin(Math.PI * (1 - decay));
  }
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
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (Math.random() * 2 - 1) * Math.exp(-index / (context.sampleRate * .0038));
  }
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

/** Combines spoken feedback with a compact wood, wind and gong sound palette. */
export function playMoveFeedbackSound(kind: MoveFeedbackKind, enabled: boolean, volume: number) {
  if (!enabled || !Number.isFinite(volume) || volume <= 0 || typeof window === "undefined") return;
  try {
    const level = Math.sqrt(Math.min(1, Math.max(0, volume / 100)));
    if (kind === "capture" || kind === "check" || kind === "checkmate" || kind === "stalemate") speakFeedback(kind, volume);
    if (kind === "move") {
      const fallback = () => {
        const fallbackContext = getAudioContext();
        if (!fallbackContext) return;
        playWoodClick(fallbackContext, fallbackContext.currentTime, level);
        void fallbackContext.resume().catch(() => undefined);
      };
      if (playMoveSample(volume, fallback)) return;
      fallback();
      return;
    }
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime;
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
    // Audio permissions and unavailable devices must never block a legal move.
  }
}

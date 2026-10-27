import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeSpeech = {
  speak(options: { text: string; rate: number }): Promise<{ stopped?: boolean }>;
  stop(): Promise<void>;
};
const speech = registerPlugin<NativeSpeech>("CommentarySpeech");
let generation = 0;
let pendingStop: Promise<void> = Promise.resolve();

export function stopCommentarySpeech() {
  generation += 1;
  if (Capacitor.isNativePlatform()) pendingStop = pendingStop.then(() => speech.stop()).catch(() => undefined);
  return pendingStop;
}

export async function speakCommentary(text: string, rate: number) {
  if (!Capacitor.isNativePlatform()) throw new Error("当前浏览器仅提供文字讲解；离线朗读请使用 iOS 或 Android App。");
  const stopped = stopCommentarySpeech();
  const owner = generation;
  await stopped;
  if (document.hidden) return;
  // stop/start operations are ordered so a late stop cannot silence a new voice.
  if (owner !== generation) return;
  await speech.speak({ text, rate: Math.max(.6, Math.min(1.5, rate)) });
}

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BoardState, CblLibrary } from "./types";

type NativeCloudBook = {
  query(options: { fen: string }): Promise<{ payload: string }>;
};
const nativeCloudBook = registerPlugin<NativeCloudBook>("CloudBook");
type NativePikafish = {
  bestMove(options: { fen: string; moveTimeMs: number }): Promise<{ iccs: string }>;
  analyze(options: { fen: string; moveTimeMs: number; multiPv: number }): Promise<PikafishAnalysis>;
  cancel(): Promise<void>;
};
const nativePikafish = registerPlugin<NativePikafish>("Pikafish");
export type CloudBookMove = { iccs: string; notation: string; score: number };
export type EngineReply = { iccs: string; notation: string };
export type PikafishAnalysisLine = { multipv: number; depth: number; scoreCp?: number; mate?: number; nodes: number; nps: number; pv: string[] };
export type PikafishAnalysis = { bestMove: string; lines: PikafishAnalysisLine[] };

type Core = {
  default(): Promise<void>;
  parseCblLibrary(bytes: Uint8Array): string;
  chineseLine(fen: string, moves: string[]): string;
  WebGame: { new(fen?: string): { playMove(iccs: string): string; stateJson(): string } };
};

let corePromise: Promise<Core> | undefined;

export async function trainingCore() {
  const moduleUrl = "/wasm/xiangqi_web_core.js";
  corePromise ??= import(/* @vite-ignore */ moduleUrl) as Promise<Core>;
  const core = await corePromise;
  await core.default();
  return core;
}

export async function parseCbl(bytes: Uint8Array): Promise<CblLibrary> {
  return JSON.parse((await trainingCore()).parseCblLibrary(bytes)) as CblLibrary;
}

export async function chineseLine(fen: string, moves: string[]) {
  return JSON.parse((await trainingCore()).chineseLine(fen, moves)) as string[];
}

export async function boardAt(fen: string, moves: string[]): Promise<BoardState> {
  const core = await trainingCore();
  const game = new core.WebGame(fen);
  for (const move of moves) game.playMove(move);
  const state = JSON.parse(game.stateJson()) as { fen: string; pieces: BoardState["pieces"]; side_to_move: string; status: string };
  return { fen: state.fen, pieces: state.pieces, sideToMove: state.side_to_move, status: state.status };
}

export async function acceptsMove(fen: string, moves: string[], move: string) {
  try {
    await boardAt(fen, [...moves, move]);
    return true;
  } catch {
    return false;
  }
}

export async function queryCloudBook(fen: string): Promise<CloudBookMove[]> {
  let payload: string;
  try {
    if (Capacitor.isNativePlatform()) payload = (await nativeCloudBook.query({ fen })).payload;
    else {
      const endpoint = new URL("https://www.chessdb.cn/chessdb.php");
      endpoint.searchParams.set("action", "queryall");
      endpoint.searchParams.set("board", fen);
      const response = await fetch(endpoint, { headers: { accept: "text/plain" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.text();
    }
  } catch (error) { throw new Error(`云库请求失败：${error instanceof Error ? error.message : "网络不可用"}`); }
  const rows = payload.trim().split("|").map((row) => Object.fromEntries(row.split(",").flatMap((part) => {
    const index = part.indexOf(":");
    return index < 0 ? [] : [[part.slice(0, index), part.slice(index + 1)]];
  })));
  const unique = new Map<string, CloudBookMove>();
  for (const row of rows) {
    const iccs = row.move;
    if (!iccs || unique.has(iccs)) continue;
    try {
      await boardAt(fen, [iccs]);
      unique.set(iccs, { iccs, notation: (await chineseLine(fen, [iccs])).at(-1) ?? iccs, score: Number(row.score) || 0 });
    } catch { /* Ignore invalid candidates returned by the public cloud book. */ }
  }
  return [...unique.values()].sort((left, right) => right.score - left.score || left.iccs.localeCompare(right.iccs));
}

export function hasLocalPikafish() {
  return Capacitor.isNativePlatform() && ["android", "ios"].includes(Capacitor.getPlatform());
}

export async function queryPikafishReply(fen: string, moveTimeMs = 800): Promise<EngineReply> {
  try {
    if (!hasLocalPikafish()) throw new Error("本地 Pikafish 仅在 Android 或 iOS 版可用");
    const { iccs } = await nativePikafish.bestMove({ fen, moveTimeMs });
    await boardAt(fen, [iccs]);
    return { iccs, notation: (await chineseLine(fen, [iccs])).at(-1) ?? iccs };
  } catch (error) {
    throw new Error(`本地 Pikafish 不可用：${error instanceof Error ? error.message : "引擎启动失败"}`);
  }
}

export async function queryPikafishAnalysis(fen: string, moveTimeMs = 2000, multiPv = 4): Promise<PikafishAnalysis> {
  try {
    if (!hasLocalPikafish()) throw new Error("本地 Pikafish 仅在 Android 或 iOS 版可用");
    return await nativePikafish.analyze({ fen, moveTimeMs, multiPv });
  } catch (error) {
    throw new Error(`AI 拆棋失败：${error instanceof Error ? error.message : "引擎启动失败"}`);
  }
}

export async function cancelPikafishSearch() {
  if (hasLocalPikafish()) await nativePikafish.cancel();
}

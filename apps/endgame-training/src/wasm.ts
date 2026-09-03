import type { BoardState, CblLibrary } from "./types";

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
  const state = JSON.parse(game.stateJson()) as { pieces: BoardState["pieces"]; side_to_move: string };
  return { pieces: state.pieces, sideToMove: state.side_to_move };
}

export async function acceptsMove(fen: string, moves: string[], move: string) {
  try {
    await boardAt(fen, [...moves, move]);
    return true;
  } catch {
    return false;
  }
}

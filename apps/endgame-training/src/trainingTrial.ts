import { withRequestDeadline } from "./requestDeadline.ts";
import type { BoardState } from "./types";

/** Trial positions are deliberately separate from the accepted answer path. */
export type TrainingTrialPosition = { path: string[]; board: BoardState; awaitingReply: boolean; terminal: boolean };
export type TrainingTrialDependencies = {
  boardAt(fen: string, path: string[]): Promise<BoardState>;
  reply(fen: string): Promise<string>;
  cancel?(): void | Promise<void>;
};
const terminal = (board: BoardState) => /(?:将死|困毙|和棋|判负)$/.test(board.status);

export async function advanceTrainingTrial(
  fen: string,
  path: string[],
  candidate: string | undefined,
  dependencies: TrainingTrialDependencies,
  isCurrent: () => boolean,
  show: (position: TrainingTrialPosition) => void,
  timeoutMs = 15_000,
): Promise<"ready" | "ended" | "cancelled" | "unavailable"> {
  try {
    return await withRequestDeadline(async signal => {
      const active = () => !signal.aborted && isCurrent();
      if (!active()) return "cancelled";
      const playerPath = candidate ? [...path, candidate] : [...path];
      const board = await dependencies.boardAt(fen, playerPath);
      if (!active()) return "cancelled";
      const ended = terminal(board);
      show({ path: playerPath, board, awaitingReply: !ended, terminal: ended });
      if (ended) return "ended";
      const reply = await dependencies.reply(board.fen);
      if (!active()) return "cancelled";
      if (!reply) throw new Error("缺少 AI 应手");
      const replyPath = [...playerPath, reply];
      // Validate the engine's move through the same rules as a human move.
      const after = await dependencies.boardAt(fen, replyPath);
      if (!active()) return "cancelled";
      show({ path: replyPath, board: after, awaitingReply: false, terminal: terminal(after) });
      return terminal(after) ? "ended" : "ready";
    }, undefined, "AI 应手超时", timeoutMs);
  } catch {
    if (isCurrent()) void Promise.resolve().then(() => dependencies.cancel?.()).catch(() => undefined);
    return isCurrent() ? "unavailable" : "cancelled";
  }
}

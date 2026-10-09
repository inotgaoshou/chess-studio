import type { BoardState } from "./types";
import { boardAt, hasLocalPikafish, queryCloudBook, queryPikafishReply } from "./wasm";

export function trialOutcome(board: BoardState): string | undefined {
  const loser = board.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方";
  const winner = loser === "黑方" ? "红方" : "黑方";
  if (board.status === "将死") return `绝杀（将死） · ${winner}获胜，${loser}被将死`;
  if (board.status === "困毙") return `困毙 · ${winner}获胜，${loser}无合法着法`;
  if (board.ruleStatus && /(判负|和棋|被将死|困毙)$/.test(board.ruleStatus)) return board.ruleStatus;
  return undefined;
}

// Every response is validated against the live position. The saved teaching
// answer is a labelled offline fallback, never a substitute for a legal move.
export async function teacherTrialReply(fen: string, savedDefense: string | undefined, current: () => boolean) {
  if (hasLocalPikafish()) {
    try {
      const reply = await queryPikafishReply(fen, 800);
      if (!current()) return undefined;
      return { move: reply.iccs, source: "AI（Pikafish）" };
    } catch { if (!current()) return undefined; }
  }
  try {
    const reply = (await queryCloudBook(fen))[0];
    if (!current()) return undefined;
    if (reply) return { move: reply.iccs, source: "云库" };
  } catch { if (!current()) return undefined; }
  if (savedDefense) {
    await boardAt(fen, [savedDefense]);
    if (!current()) return undefined;
    return { move: savedDefense, source: "保存题解（AI／云库暂不可用）" };
  }
  throw new Error("AI／云库暂时无法应招，已保留你刚走的一步。请点“重试应招”或回退。");
}

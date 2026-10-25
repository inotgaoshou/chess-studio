import type { LocalManualGame } from "./types";

export function manualResult(game: LocalManualGame) {
  const result = game.metadata?.result;
  if (result === "draw") return { label: "和棋", score: "1/2–1/2", tone: "draw" };
  if (result === "multiple") return { label: "多种结果", score: "", tone: "unknown" };
  if (result !== "first-win" && result !== "first-loss") return { label: "未定", score: "*", tone: "unknown" };
  const firstRed = game.startingFen.split(/\s+/)[1] !== "b";
  const redWon = result === "first-win" ? firstRed : !firstRed;
  return redWon ? { label: "红胜", score: "1–0", tone: "red" } : { label: "黑胜", score: "0–1", tone: "black" };
}
export function manualInFolder(game: LocalManualGame, folder: string, includeDescendants = false) {
  return !folder || game.folderPath === folder || (includeDescendants && Boolean(game.folderPath?.startsWith(`${folder}/`)));
}
export function manualMatchesQuery(game: LocalManualGame, query: string) {
  const result = manualResult(game);
  const normalize = (text: string) => text.toLocaleLowerCase().replace(/[–—]/g,"-");
  const text = [game.title, game.note, game.folderPath, game.metadata?.redPlayer, game.metadata?.blackPlayer,
    game.metadata?.event, game.metadata?.playedAt, result.label, result.score, `${Math.ceil(game.moves.length / 2)}回合`].join(" ");
  return normalize(query.trim()).split(/\s+/).every(word => normalize(text).includes(word));
}
export function manualDate(game: LocalManualGame) {
  const date = new Date(game.metadata?.playedAt || game.updatedAt);
  return Number.isNaN(date.getTime()) ? "时间未填写" : date.toLocaleDateString("zh-CN");
}

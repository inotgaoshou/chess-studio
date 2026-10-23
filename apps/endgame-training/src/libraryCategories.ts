export const FEATURED_LIBRARY_CATEGORIES = ["A", "B", "C", "E", "N", "S"] as const;
export const LIBRARY_CATEGORY_NAMES: Record<string, string> = { A: "开局", B: "中局", C: "残局", D: "排局", E: "对局", F: "全局", G: "让子", H: "弃子", I: "绝杀", J: "飞刀", K: "陷阱", L: "巧妙", M: "书籍", N: "古谱", O: "布局", P: "棋书", S: "杀法", other: "其他" };
export function libraryCategoryCode(folderPath?: string) {
  const match = folderPath?.match(/(?:^|\/)([A-S])(?:[\s、._-]|[\u4e00-\u9fff]|$)/i);
  const code=match?.[1]?.toUpperCase();
  return code&&LIBRARY_CATEGORY_NAMES[code]?code:"other";
}

/** Presentation only for the legacy source browser, never textbook chapters or assignment selection. */
export function legacyTrainingSourceVisible(folderPath: string | undefined, playableCount: number) {
  const code = libraryCategoryCode(folderPath);
  return code !== "other" && (code !== "B" || (Number.isInteger(playableCount) && playableCount >= 10));
}

export function legacyTrainingSourceTitle(title: string, folderPath: string | undefined) {
  if (libraryCategoryCode(folderPath) !== "B") return title;
  const name = title
    .replace(/[（(]\s*训练题\s*[)）]/g, "")
    .replace(/[（(]\s*\d+\s*(?:题|局|份|条)?\s*[)）]\s*$/u, "")
    .replace(/\s*[-—·_：:]?\s*\d+\s*(?:题|局|份|条)?\s*$/u, "")
    .replace(/\s*[-—·_：:]\s*$/u, "")
    .trim();
  return name || "中局";
}


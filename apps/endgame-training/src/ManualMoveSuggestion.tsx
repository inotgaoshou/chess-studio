import { useEffect, useState } from "react";
import { chineseLine } from "./wasm";

// The same ICCS move can have a different Chinese name in another position.
const notationCache = new Map<string, Promise<string | undefined>>();
function suggestionNotation(fen: string, move: string) {
  const key = JSON.stringify([fen, move]);
  let result = notationCache.get(key);
  if (!result) {
    result = chineseLine(fen, [move]).then((line) => {
      const notation = line[0]?.trim();
      return notation && /[\u3400-\u9fff]/u.test(notation) ? notation : undefined;
    }).catch(() => undefined);
    notationCache.set(key, result);
    // Bound the display-only cache across long library sessions.
    if (notationCache.size > 512) notationCache.delete(notationCache.keys().next().value!);
    void result.then((notation) => { if (!notation && notationCache.get(key) === result) notationCache.delete(key); });
  }
  return result;
}

export function ManualMoveSuggestion({ gameId, fen, move }: { gameId: string; fen: string; move: string }) {
  const key = JSON.stringify([gameId, fen, move]);
  const [resolved, setResolved] = useState<{ key: string; notation?: string }>();
  useEffect(() => {
    let active = true;
    if (fen && move) void suggestionNotation(fen, move).then((notation) => {
      if (active) setResolved({ key, notation });
    });
    return () => { active = false; };
  }, [key, fen, move]);
  if (!move) return null;
  if (!fen || (resolved?.key === key && !resolved.notation)) return <> · 建议着法暂不可用</>;
  if (resolved?.key !== key) return <> · 建议着法转换中…</>;
  return <> · 建议 {resolved.notation}</>;
}

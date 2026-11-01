import { useEffect, useState } from "react";
import type { LocalManualGame } from "./types";
import { chineseLine } from "./wasm";
import { moveNotationLabel } from "./moveNotation";

/** Rebuild legacy labels from the complete parent path without rewriting saved data. */
export function useVariationBranchLabels(game: LocalManualGame | undefined, scope: string) {
  const key = game ? JSON.stringify([scope, game.id, game.startingFen, game.branches.map(branch => [branch.id, branch.parentCursor, branch.parentPath, branch.moves, branch.notation])]) : "";
  const [translated, setTranslated] = useState<{ key: string; labels: Map<string, string> }>();
  useEffect(() => {
    if (!game) return;
    let current = true;
    void Promise.all(game.branches.map(async branch => {
      const fallback = moveNotationLabel(branch.notation[0]);
      if (!branch.moves.length) return [branch.id, fallback] as const;
      try {
        const labels = await chineseLine(game.startingFen, [...branch.parentPath, branch.moves[0]]);
        return [branch.id, moveNotationLabel(labels.at(-1))] as const;
      } catch { return [branch.id, fallback] as const; }
    })).then(labels => { if (current) setTranslated({ key, labels: new Map(labels) }); });
    return () => { current = false; };
  }, [key]);
  return game?.branches.map(branch => ({
    id: branch.id,
    label: `${branch.parentCursor + 1}. ${translated?.key === key ? translated.labels.get(branch.id) ?? moveNotationLabel(branch.notation[0]) : moveNotationLabel(branch.notation[0])} · ${branch.moves.length} 步`,
  }));
}

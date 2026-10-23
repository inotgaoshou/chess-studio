import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export type CatalogFilters = { goal: string; difficulty: string; material: string; motif: string; mateGroup: string; mateMoves: string };
export function activeCatalogFilterCount(filters: CatalogFilters, directMate: boolean, mobile = false): number {
  return [filters.goal, ...(mobile ? [] : [filters.difficulty, filters.material]), filters.motif, ...(directMate ? [] : [filters.mateGroup, filters.mateMoves])].filter(Boolean).length;
}
export function clearedCatalogFilters(filters: CatalogFilters, directMate: boolean): CatalogFilters {
  return { goal: "", difficulty: "", material: "", motif: "", mateGroup: "", mateMoves: directMate ? filters.mateMoves : "" };
}

export function MobileCatalogFilters({ filters, directMate, onChange, onClose }: {
  filters: CatalogFilters;
  directMate: boolean;
  onChange(filters: CatalogFilters): void;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const keepInputVisible = () => {
    const input = document.activeElement;
    if (input instanceof HTMLInputElement && panel.current?.contains(input)) input.scrollIntoView?.({ block: "center" });
  };
  useEffect(() => {
    // Native keyboard resizing can leave the focused field below the visible viewport.
    window.visualViewport?.addEventListener("resize", keepInputVisible);
    window.addEventListener("resize", keepInputVisible);
    return () => {
      window.visualViewport?.removeEventListener("resize", keepInputVisible);
      window.removeEventListener("resize", keepInputVisible);
    };
  }, []);
  const change = (key: keyof CatalogFilters, value: string) => onChange({ ...filters, [key]: value });
  return <section ref={panel} className="catalog-mobile-filters" aria-label="筛选题目" onFocusCapture={keepInputVisible}>
    <header><strong>筛选题目</strong><button type="button" onClick={() => onChange(clearedCatalogFilters(filters, directMate))}><X aria-hidden="true"/>清空</button><button type="button" onClick={onClose}>收起</button></header>
    <div className="catalog-mobile-filter-grid">
      <label><span>题目目标</span><select aria-label="题目目标" value={filters.goal} onChange={e => change("goal", e.target.value)}><option value="">全部目标</option><option value="mate">杀棋</option><option value="gain_material">得子</option><option value="draw">求和</option><option value="endgame_win">残局胜法</option></select></label>
      <label><span>题名关键词</span><input aria-label="题名关键词" placeholder="题名或原分类" value={filters.motif} onChange={e => change("motif", e.target.value)}/></label>
      {!directMate && <><label><span>杀法步数分组</span><select aria-label="杀法步数分组" value={filters.mateGroup} onChange={e => change("mateGroup", e.target.value)}><option value="">全部步数</option>{[["one", "一步杀"], ["two", "两步杀"], ["three", "三步杀"], ["long", "四步及以上"], ["unknown", "步数未验证"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label><span>精确杀法步数</span><input aria-label="精确杀法步数" type="number" min="1" max="255" placeholder="步数" value={filters.mateMoves} onChange={e => change("mateMoves", e.target.value)}/></label></>}
    </div>
  </section>;
}

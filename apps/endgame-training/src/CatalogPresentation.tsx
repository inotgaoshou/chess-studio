import { BookOpen, ChevronRight, Crosshair, Flag, Layers, Route, Search, Shield, Swords, Target, X, Zap } from "lucide-react";
import { type ReactNode } from "react";

const entryIcons = {
  basic_mates: Target, mate_series: Layers, checking_mates: Zap,
  quiet_mates: Route, practical_mates: Swords, middlegame: Crosshair,
  endgame_mates: Flag, practical_endgames: BookOpen,
};
const entriesByName: Record<string, keyof typeof entryIcons> = {
  "基础杀法": "basic_mates", "杀法练习系列": "mate_series", "连将杀": "checking_mates",
  "非连将杀": "quiet_mates", "实战杀法": "practical_mates", "中局战术": "middlegame",
  "残局杀法": "endgame_mates", "实用残局": "practical_endgames",
};
export function CatalogIcon({ entry, name, chapter = false }: { entry?: string; name: string; chapter?: boolean }) {
  const key = entry && entry in entryIcons ? entry as keyof typeof entryIcons : entriesByName[name];
  const Icon = key ? entryIcons[key] : chapter ? BookOpen : Shield;
  return <span className={`catalog-entry-symbol catalog-tone-${key || "chapter"}`} aria-hidden="true"><Icon strokeWidth={1.7}/></span>;
}
export function CatalogSearch({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <div className="catalog-search"><Search aria-hidden="true"/><input aria-label="搜索教学目录" placeholder="搜索当前目录下的系列、书籍或章节" value={value} onChange={e => onChange(e.target.value)}/>{value && <button type="button" aria-label="清除目录搜索" onClick={() => onChange("")}><X aria-hidden="true"/></button>}</div>;
}
export function CatalogState({ children, error = false, loading = false }: { children: ReactNode; error?: boolean; loading?: boolean }) {
  return <div className={`catalog-state ${error ? "catalog-state-error" : ""}`} role={error ? "alert" : loading ? "status" : undefined}>{loading ? <span className="catalog-loading-dot" aria-hidden="true"/> : <BookOpen aria-hidden="true"/>}<div>{children}</div></div>;
}
export function CatalogChevron() { return <ChevronRight className="catalog-node-chevron" aria-hidden="true"/>; }

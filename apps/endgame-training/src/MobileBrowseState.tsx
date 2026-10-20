import { useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

const visits = new Map<string, { state: unknown; scroll: number }>();
// In-memory visits are scoped by account/entitlements and book; nothing is shared across accounts.
export function useMobileBrowseVisit<T>(scope: string, initial: T) {
  const saved = visits.get(scope);
  const [state, setState] = useState<T>(() => saved ? saved.state as T : initial);
  const view = useRef<HTMLElement>(null);
  const latest = useRef(state); latest.current = state;
  useLayoutEffect(() => {
    let parent = view.current?.parentElement;
    while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    const container = parent;
    if (container) container.scrollTop = saved?.scroll ?? 0;
    else window.scrollTo(0, saved?.scroll ?? 0);
    return () => {
      visits.set(scope, { state: latest.current, scroll: container?.scrollTop ?? window.scrollY });
      if (visits.size > 40) visits.delete(visits.keys().next().value!);
    };
  }, [scope]);
  return { state, setState, view };
}

export function BrowseSearchButton({ open, onClick }: { open: boolean; onClick(): void }) {
  return <button type="button" className="mobile-heading-icon browse-search-toggle" aria-label={open ? "收起搜索" : "展开搜索"} aria-expanded={open} onClick={onClick}>{open ? <X/> : <Search/>}</button>;
}
export function BrowseSearch({ query, label, onChange }: { query: string; label: string; onChange(query: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <label className="mobile-library-search browse-search"><Search/><input ref={input} value={query} onChange={e => onChange(e.target.value)} placeholder={label} aria-label={label} autoComplete="off"/>{query && <button type="button" aria-label="清除搜索" onClick={() => { onChange(""); input.current?.focus({ preventScroll: true }); }}><X/></button>}</label>;
}

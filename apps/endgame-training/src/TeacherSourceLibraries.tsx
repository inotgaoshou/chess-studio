import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { teachingClient, type TeachingAuth, type TeacherProblemLibrary } from "./teaching";
import { FEATURED_LIBRARY_CATEGORIES, LIBRARY_CATEGORY_NAMES, libraryCategoryCode, legacyTrainingSourceVisible, legacyTrainingSourceTitle } from "./libraryCategories";

export function TeacherSourceLibraries({ auth, query, onOpen }: {
  auth: TeachingAuth; query: string; onOpen(id: string): void;
}) {
  const context = useRef(auth); context.current = auth;
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<TeacherProblemLibrary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryError, setCategoryError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState(query.trim());
  const request = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);
  const epoch = useRef(0);
  const scope = `${auth.user.id}:${auth.user.orgId}:${auth.user.role}`;
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const abort = new AbortController();
    setCategoriesLoading(true); setCategories([]); setCategory(""); setCategoryError("");
    void teachingClient.teacherLibraryCategories(context.current, abort.signal).then(rows => {
      if (abort.signal.aborted) return;
      const codes = rows.filter(row => row.libraryCount > 0 && LIBRARY_CATEGORY_NAMES[row.code]).map(row => row.code);
      setCategories(Object.keys(LIBRARY_CATEGORY_NAMES).filter(code => codes.includes(code)));
    }).catch(reason => { if (!abort.signal.aborted) setCategoryError(String(reason instanceof Error ? reason.message : reason)); }).finally(() => { if (!abort.signal.aborted) setCategoriesLoading(false); });
    return () => abort.abort();
  }, [scope, reload]);
  const selected = categories.includes(category) ? category : categories[0];
  async function load(after?: string) {
    if (!selected || (after && busy.current)) return;
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    const generation = ++epoch.current;
    busy.current = true; setLoading(true); setError("");
    try {
      const page = await teachingClient.teacherProblemLibrariesPage({ q: search, category: selected, publishedOnly: true, cursor: after }, context.current, abort.signal);
      if (abort.signal.aborted || generation !== epoch.current) return;
      setItems(previous => [...new Map([...(after ? previous : []), ...page.items].map(item => [item.id, item])).values()]);
      setCursor(page.nextCursor ?? undefined);
    } catch (reason) {
      if (!abort.signal.aborted && generation === epoch.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (generation === epoch.current) { busy.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    request.current?.abort(); ++epoch.current; busy.current = false;
    setItems([]); setCursor(undefined); setError("");
    if (selected) void load(); else setLoading(false);
    return () => { request.current?.abort(); ++epoch.current; busy.current = false; };
  }, [scope, selected, search, reload]);
  const shown = expanded ? categories : categories.filter(code => (FEATURED_LIBRARY_CATEGORIES as readonly string[]).includes(code) || code === selected);
  const visibleItems = items.filter(item => legacyTrainingSourceVisible(item.folderPath, item.publishedCount));
  return <section className="mobile-library-section teacher-source-libraries">
    <header><strong>平台训练题库</strong><button type="button" className="mobile-section-link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span>{expanded ? "收起分类" : "更多分类"}</span><ChevronDown className={expanded ? "expanded" : ""}/></button></header>
    <div className="mobile-category-strip" role="tablist" aria-label="平台题库分类">{shown.map(code => <button type="button" role="tab" key={code} aria-selected={code === selected} className={code === selected ? "active" : ""} onClick={() => setCategory(code)}>{code} {LIBRARY_CATEGORY_NAMES[code]}</button>)}</div>
    <div className="mobile-library-list">{visibleItems.map(item => <button type="button" key={item.id} onClick={() => onOpen(item.id)}><span className="mobile-library-cover platform"><BookOpen/></span><span><b>{legacyTrainingSourceTitle(item.title, item.folderPath, item.publishedCount)}</b>{libraryCategoryCode(item.folderPath) !== "B" && <small>{item.folderPath ? `${item.folderPath} · ` : ""}{item.publishedCount} 题</small>}</span><ChevronRight/></button>)}</div>
    {(loading || categoriesLoading) && <p role="status">正在加载题库…</p>}
    {(categoryError || error) && <div role="alert"><p>{categoryError || error}</p><button type="button" disabled={loading} onClick={() => categoryError ? setReload(value => value + 1) : void load(cursor)}>重试题库加载</button></div>}
    {!loading && !categoriesLoading && !categoryError && !error && !visibleItems.length && <p>{cursor ? "本页暂无匹配题库，可继续加载" : "当前分类暂无匹配题库"}</p>}
    {cursor && !error && <button type="button" className="catalog-action" disabled={loading} onClick={() => void load(cursor)}>{loading ? "正在加载…" : "加载更多题库"}</button>}
  </section>;
}

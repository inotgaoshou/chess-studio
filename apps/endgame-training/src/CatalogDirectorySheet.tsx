import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BookOpen, ChevronRight, X } from "lucide-react";
import type { TeachingCatalogNode } from "./TeachingCatalog";
import { useCatalogBrowse } from "./useCatalogBrowse";

/** Uses the same authorized, paged directory reader as the catalog. No question fetches. */
export function CatalogDirectorySheet({ rootId, initialId, activeId, scope, libraryId, request, onSelect, onClose }: {
  rootId: string; initialId: string; activeId: string; scope: string; libraryId?: string;
  request(params: Record<string,string>, signal: AbortSignal): ReturnType<typeof import("./teaching").teachingClient.catalogBrowse>;
  onSelect(id: string): void; onClose(): void;
}) {
  const [id, setId] = useState(initialId);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const browse = useCatalogBrowse<TeachingCatalogNode>(request, {nodeId:id,availability:"available",allowStaleCounts:"true",limit:"50",...(libraryId?{libraryId}:{})}, false, 0, 0, scope);
  const rootIndex = browse.page.breadcrumbs.findIndex(node => node.id === rootId);
  const path = rootIndex < 0 ? [] : browse.page.breadcrumbs.slice(rootIndex);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const scroller = previous?.closest(".mobile-library-page") as HTMLElement | null;
    const overflow = scroller?.style.overflow;
    if (scroller) scroller.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".catalog-directory-close")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter(button => button.getClientRects().length);
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (scroller) scroller.style.overflow = overflow ?? ""; if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, []);
  return createPortal(<div className="catalog-directory-backdrop" onClick={onClose}>
    <section ref={dialog} className="catalog-directory-sheet" role="dialog" aria-modal="true" aria-label="残局目录" onClick={event => event.stopPropagation()}>
      <header><BookOpen/><strong>目录</strong><button type="button" className="catalog-directory-close" aria-label="关闭目录" onClick={onClose}><X/></button></header>
      <nav aria-label="目录位置">{path.map(node => <button key={node.id} type="button" aria-current={node.id === id ? "page" : undefined} onClick={() => setId(node.id)}>{node.name}</button>)}</nav>
      <div className="catalog-directory-content" aria-busy={browse.loading}>
        {id !== rootId && <button type="button" className="catalog-directory-parent" onClick={() => setId(path.at(-2)?.id ?? rootId)}><ArrowLeft/>上级目录</button>}
        {browse.loading && <p role="status">正在读取目录…</p>}
        {browse.error ? <p role="alert">目录读取失败：{browse.error}<button type="button" onClick={browse.retry}>重试</button></p> : browse.page.children.map(node => <div className="catalog-directory-row" key={node.id}>
          <button type="button" aria-current={node.id === activeId ? "page" : undefined} onClick={() => onSelect(node.id)}><BookOpen/><span><strong>{node.name}</strong><small>{node.itemCount == null ? "题数统计中" : `${node.itemCount} 可练题`}{node.id === activeId ? " · 当前目录" : ""}</small></span></button>
          <button type="button" aria-label={`展开目录：${node.name}`} onClick={() => setId(node.id)}><ChevronRight/></button>
        </div>)}
        {!browse.loading && !browse.error && !browse.page.children.length && <p>此目录没有下级章节，可直接查看题目。</p>}
        {browse.page.nextCursor && <button type="button" disabled={browse.loading} onClick={() => void browse.more()}>下一页目录</button>}
      </div>
      <footer><button type="button" disabled={browse.loading || !!browse.error || browse.page.currentNode?.id !== id} onClick={() => onSelect(id)}>查看此目录题目</button></footer>
    </section>
  </div>, document.body);
}

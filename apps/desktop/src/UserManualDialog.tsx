import { BookOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  appVersion?: string;
  markdown: string;
  onClose(): void;
};

type ManualChapter = {
  title: string;
  id: string;
  searchText: string;
};

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textFromChildren((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function cleanHeadingTitle(title: string) {
  return title.replace(/^\d+[.、]\s*/, "").trim();
}

function headingId(title: string) {
  return `manual-${cleanHeadingTitle(title).toLocaleLowerCase("zh-CN").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "")}`;
}

function parseChapters(markdown: string): ManualChapter[] {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const title = cleanHeadingTitle(match[1].replace(/[*_`]/g, "").trim());
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    return { title, id: headingId(title), searchText: markdown.slice(start, end).toLocaleLowerCase("zh-CN") };
  });
}

export function UserManualDialog({ appVersion = "1.2.6", markdown, onClose }: Props) {
  const [query, setQuery] = useState("");
  const chapters = useMemo(() => parseChapters(markdown), [markdown]);
  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return normalized ? chapters.filter((chapter) => chapter.searchText.includes(normalized)) : chapters;
  }, [chapters, query]);

  useEffect(() => {
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeFromKeyboard);
    return () => document.removeEventListener("keydown", closeFromKeyboard);
  }, [onClose]);

  function jumpToChapter(id: string) {
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return <div className="modal-backdrop manual-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="user-manual-dialog" role="dialog" aria-modal="true" aria-labelledby="user-manual-title">
      <header className="user-manual-header">
        <span><BookOpen size={18}/><strong id="user-manual-title">棋研使用手册</strong><small>复盘 · 拆棋 · 棋理 · 开局训练</small></span>
        <button type="button" aria-label="关闭使用手册" title="关闭" onClick={onClose}><X size={17}/></button>
      </header>
      <aside className="user-manual-sidebar" aria-label="使用手册目录">
        <label><Search size={14}/><input type="search" aria-label="搜索使用手册" value={query} placeholder="搜索步骤、功能或问题" onChange={(event) => setQuery(event.target.value)}/></label>
        <h2>适用版本 v{appVersion}</h2>
        <p>更新日期：2026 年 8 月 11 日</p>
        <nav aria-label="手册章节">
          {visibleChapters.map((chapter, index) => <button type="button" aria-label={chapter.title} key={chapter.id} onClick={() => jumpToChapter(chapter.id)}><i aria-hidden="true">{index + 1}</i><span>{chapter.title}</span></button>)}
          {visibleChapters.length === 0 && <span className="user-manual-no-result">没有匹配章节，请换一个关键词。</span>}
        </nav>
        <footer><strong>本机优先</strong><span>棋谱、报告和训练记录默认保存在本机 SQLite。</span></footer>
      </aside>
      <main className="user-manual-content" tabIndex={0}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <div className="user-manual-hero"><span>XIANGQI STUDIO</span><h1>{children}</h1><p>从一盘真实棋谱开始，把分析结果变成孩子能够复练的任务。</p></div>,
            h2: ({ children }) => {
              const title = textFromChildren(children);
              return <h2 id={headingId(title)} tabIndex={-1}>{children}</h2>;
            },
            img: ({ alt, ...props }) => <img {...props} alt={alt ?? "使用手册界面示意图"} loading="lazy"/>,
            a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
          }}
        >{markdown}</ReactMarkdown>
      </main>
    </section>
  </div>;
}

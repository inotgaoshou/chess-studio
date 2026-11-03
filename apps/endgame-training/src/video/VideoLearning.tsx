import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, Import, LayoutList, Pencil, Play, Plus, Search, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dismissInputViewport } from '../inputViewport';
import { VideoLibrary, nativeVideoAvailable } from './library';
import { restoreInitialOpeningCategory } from './initialCourseRepair';
import { chapterVideos, naturalOrder, resumableVideo, VIDEO_GROUP_SIZE, videoGroups } from './model';
import type { VideoEntity, VideoSnapshot } from './types';
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer';
import { VideoManager, type VideoDeletion } from './VideoManager';
import './video.css';

function VideoModal({ title, children, onClose, busy = false, confirmation = false, focusInput = false }: { title: string; children: ReactNode; onClose(): void; busy?: boolean; confirmation?: boolean; focusInput?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    (dialog.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialog.current?.querySelector<HTMLElement>(focusInput ? 'input' : 'button'))?.focus({ preventScroll: true });
    return () => {
      if (root) root.inert = wasInert;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className="vl-page vl-modal-shade" onClick={event => { if (!busy && event.target === event.currentTarget) onClose(); }}><section ref={dialog} className="vl-modal" role={confirmation ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); close.current(); }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><header><h2>{title}</h2><button className="vl-icon-button" disabled={busy} aria-label="关闭弹窗" onClick={onClose}><X/></button></header><div className="vl-modal-body">{children}</div></section></div>, document.body);
}
export function VideoLearningEntry({ onOpen, management = false }: { onOpen(): void; management?: boolean }) {
  const [data, setData] = useState<VideoSnapshot>();
  useEffect(() => {
    if (!nativeVideoAvailable()) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        await VideoLibrary.receiveProvisioned();
        const next = await restoreInitialOpeningCategory(await VideoLibrary.snapshot(), options => VideoLibrary.update(options));
        if (!active) return;
        setData(next);
        if (next.tasks.some(task => ['running', 'scanning'].includes(task.state))) timer = setTimeout(() => void refresh(), 1000);
      } catch { /* The learning page displays actionable import errors. */ }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const resume = data && resumableVideo(data);
  const p = data?.progress.find(p => p.id === resume?.id);
  return <button type="button" className={`vl-entry${management ? ' vl-management-entry' : ''}`} onClick={() => {
    if (resume && !management) localStorage.setItem('qixi.video.selected', resume.id);
    if (management) sessionStorage.setItem('qixi.video.manage', '1'); else sessionStorage.removeItem('qixi.video.manage');
    onOpen();
  }}><span className="vl-entry-icon">{management ? <FolderOpen/> : <Play/>}</span><span className="vl-entry-copy"><b>{management ? '视频与目录管理' : resume ? '继续学习' : '视频课堂'}</b><small>{management ? `${data?.videos.length ?? 0} 个视频 · 分类整理与空间管理` : resume?.title ?? '导入课程，离线看课，边学边练'}</small>{!management && p && p.duration > 0 && <span className="vl-entry-progress"><span style={{ width: `${Math.min(100, p.position / p.duration * 100)}%` }}/></span>}</span><span className="vl-entry-action">{management ? <ChevronRight/> : <><span>{resume ? '接着学' : '去学习'}</span><ChevronRight/></>}</span></button>;
}
export function VideoLearning({ onBack, onPractice }: { onBack(): void; onPractice(): void }) {
  const player = useRef<VideoPlayerHandle>(null);
  const [deletion, setDeletion] = useState<VideoDeletion>();
  const [data, setData] = useState<VideoSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [series, setSeries] = useState('');
  const [chapter, setChapter] = useState('');
  const [selected, setSelected] = useState(() => localStorage.getItem('qixi.video.selected') ?? '');
  const [manage, setManage] = useState(() => { const requested = sessionStorage.getItem('qixi.video.manage') === '1'; sessionStorage.removeItem('qixi.video.manage'); return requested; });
  const [managementTab, setManagementTab] = useState<'directories' | 'videos' | 'imports'>('directories');
  const [numbersOpen, setNumbersOpen] = useState(true);
  const [episodeView, setEpisodeView] = useState(() => localStorage.getItem('qixi.video.episodeView') === 'numbers' ? 'numbers' : 'titles');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [courseControlsOpen, setCourseControlsOpen] = useState(false);
  const courseBrowser = useRef<HTMLDivElement>(null);
  const scrollGroupStart = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importCategory, setImportCategory] = useState('category-other');
  const [importSeries, setImportSeries] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [edit, setEdit] = useState<{ kind: VideoEntity; id: string; title: string }>();
  const refresh = useCallback(async () => {
    if (!nativeVideoAvailable()) return;
    const result = await VideoLibrary.snapshot();
    try {
      const corrected = await restoreInitialOpeningCategory(result, options => VideoLibrary.update(options));
      setData(corrected); return corrected;
    } catch (reason) { setData(result); throw reason; }
  }, []);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
  useEffect(() => { void run(async () => { await refresh(); await VideoLibrary.receiveProvisioned(); }); }, []);
  const importing = !!data?.tasks.some(t => ['running', 'scanning'].includes(t.state));
  useEffect(() => { if (!importing) return; const timer = setInterval(() => void refresh().catch(reason => setError(String(reason))), 1000); return () => clearInterval(timer); }, [importing, refresh]);
  const video = data?.videos.find(v => v.id === selected);
  useEffect(() => {
    if (!data || !video) return;
    const c = data.chapters.find(c => c.id === video.chapterId);
    const s = data.series.find(s => s.id === c?.seriesId);
    if (c && s) { setChapter(c.id); setSeries(s.id); setCategory(s.categoryId); setGroup(Math.max(0, Math.floor(chapterVideos(data, c.id).findIndex(v => v.id === video.id) / VIDEO_GROUP_SIZE))); }
  }, [video?.id, data?.chapters.length]);
  const videos = data ? chapterVideos(data, chapter) : [];
  const browseSeries = (id: string) => {
    setSeries(id);
    setChapter(data?.chapters.filter(c => c.seriesId === id).sort(naturalOrder)[0]?.id ?? '');
    setGroup(0); setNumbersOpen(true);
  };
  const browseCategory = (id: string) => {
    setCategory(id);
    browseSeries(data?.series.filter(s => !id || s.categoryId === id).sort(naturalOrder)[0]?.id ?? '');
  };
  useEffect(() => { if (searchOpen) searchInput.current?.focus({ preventScroll: true }); }, [searchOpen]);
  const playingChapter = data?.chapters.find(c => c.id === video?.chapterId);
  const playingSeries = data?.series.find(s => s.id === playingChapter?.seriesId);
  const playbackVideos = data && playingChapter ? chapterVideos(data, playingChapter.id) : [];
  const playbackIndex = playbackVideos.findIndex(v => v.id === video?.id);
  const selectVideo = async (id: string) => {
    try { await player.current?.pauseAndSave(); } catch (reason) { setError(String(reason)); return false; }
    setSelected(id); localStorage.setItem('qixi.video.selected', id); setManage(false);
    // Also sync when reopening the same video after browsing a different chapter.
    const target = data?.videos.find(v => v.id === id);
    const targetChapter = data?.chapters.find(c => c.id === target?.chapterId);
    const targetSeries = data?.series.find(s => s.id === targetChapter?.seriesId);
    if (data && targetChapter && targetSeries) {
      setCategory(targetSeries.categoryId); setSeries(targetSeries.id); setChapter(targetChapter.id);
      const i = chapterVideos(data, targetChapter.id).findIndex(v => v.id === id);
      setGroup(Math.max(0, Math.floor(i / VIDEO_GROUP_SIZE)));
    }
    return true;
  };
  const pauseFor = (action: () => void) => void (async () => { await player.current?.pauseAndSave(); setError(''); action(); })().catch(reason => setError(String(reason)));
  const openManagement = (tab: typeof managementTab = 'directories') => pauseFor(() => { setManagementTab(tab); setManage(true); });
  const openImport = () => pauseFor(() => setImportOpen(true));
  const groups = videoGroups(videos.length);
  const visibleGroup = Math.min(group, Math.max(0, groups.length - 1));
  const changeGroup = (next: number) => {
    scrollGroupStart.current = true;
    setGroup(next);
  };
  useLayoutEffect(() => {
    if (!scrollGroupStart.current) return;
    scrollGroupStart.current = false;
    const browser = courseBrowser.current;
    const navigation = browser?.querySelector<HTMLElement>('.vl-navigation');
    if (!browser || !navigation) return;
    const pinnedHeight = browser.querySelector('.vl-category-bar')?.getBoundingClientRect().height ?? 0;
    browser.scrollTop = Math.max(0, browser.scrollTop + navigation.getBoundingClientRect().top - browser.getBoundingClientRect().top - pinnedHeight - 6);
  }, [visibleGroup]);
  const attention = data?.tasks.filter(t => ['running', 'scanning', 'interrupted'].includes(t.state) || t.failed > 0) ?? [];
  const searchTerm = query.trim().toLocaleLowerCase();
  const results = searchTerm && data ? data.videos.map(item => {
    const c = data.chapters.find(c => c.id === item.chapterId);
    const s = data.series.find(s => s.id === c?.seriesId);
    const category = data.categories.find(c => c.id === s?.categoryId);
    const caption = [category?.title, s?.title, c?.title].filter(Boolean).join(' · ');
    return { video: item, caption };
  }).filter(item => `${item.video.title} ${item.caption}`.toLocaleLowerCase().includes(searchTerm)).sort((a, b) => naturalOrder(a.video, b.video)) : [];
  const rename = (kind: VideoEntity, id: string, title: string) => setEdit({ kind, id, title });
  const dismissDialog = (action: () => void) => void dismissInputViewport().then(action).catch(reason => setError(String(reason)));
  const closeEdit = () => dismissDialog(() => setEdit(undefined));
  const closeImport = () => dismissDialog(() => setImportOpen(false));
  const closeDeletion = () => dismissDialog(() => setDeletion(undefined));
  const closeSearch = () => dismissDialog(() => { setSearchOpen(false); setQuery(''); });
  if (!nativeVideoAvailable()) return <main className="mobile-home-page vl-page"><header className="vl-toolbar"><button onClick={onBack}>返回</button><h1>视频学习</h1></header><p>请在安卓或苹果应用中导入本地 MP4。浏览器预览不支持持久视频库。</p></main>;
  return <main className={`mobile-home-page vl-page${manage ? ' vl-management-page' : ' vl-learning-page'}`}>
    <header className="vl-toolbar"><button className="vl-icon-button" aria-label={manage ? '返回学习' : '返回首页'} onClick={() => manage ? setManage(false) : pauseFor(onBack)}><ChevronLeft/></button><h1>{manage ? '视频管理' : '视频学习'}</h1>{manage ? <button onClick={() => setManage(false)}><BookOpen/>回到学习</button> : <button aria-label="管理" onClick={() => openManagement()}><LayoutList/><span>管理</span></button>}<button className="vl-primary" onClick={openImport}><Plus/><span>导入</span></button></header>
    <div className="vl-body">
      {error && !edit && !deletion && !importOpen && <p role="alert">{error}<button onClick={() => void run(refresh)}>重试读取</button></p>}
      {!data && <p>正在打开本机视频库…</p>}
      {data && <>
        {importOpen && !edit && <VideoModal title="导入视频" onClose={closeImport} busy={busy}><p className="vl-muted">支持 MP4 多选或整个文件夹，子目录会保留为章节。</p>
          <div className="vl-import-fields"><label>课程分类<select value={importCategory} onChange={e => { setImportCategory(e.target.value); setImportSeries(''); }}>{data.categories.slice().sort(naturalOrder).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><button onClick={() => rename('category', '', '')}><Plus/>新建分类</button>
            <label>放入系列<select value={importSeries} onChange={e => setImportSeries(e.target.value)}><option value="">新建系列</option>{data.series.filter(s => s.categoryId === importCategory).sort(naturalOrder).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
            {!importSeries && <label>系列名称<input value={importTitle} placeholder="留空使用文件夹名称" onChange={e => setImportTitle(e.target.value)}/></label>}
          </div>
          {error && <p role="alert">{error}</p>}<div className="vl-import-choices">{[true, false].map(folder => <button key={String(folder)} disabled={busy || importing} onClick={() => void run(async () => { await VideoLibrary.pick({ folder, categoryId: importCategory, seriesId: importSeries || undefined, seriesTitle: importTitle.trim() || undefined }); setImportOpen(false); })}>{folder ? <FolderOpen/> : <Import/>}<span><strong>{folder ? '选择文件夹' : '选择 MP4 文件'}</strong><small>{folder ? '包含子目录，保留课程结构' : '可一次多选视频'}</small></span><ChevronRight/></button>)}</div><p className="vl-help">视频会复制到本应用。取消导入会保留已完成的内容。</p>
        </VideoModal>}
        {deletion && <VideoModal title={`确认删除「${deletion.title}」？`} confirmation busy={busy} onClose={closeDeletion}><p>将删除本应用中的{deletion.kind === 'video' ? '这个视频' : deletion.kind === 'chapter' ? '整个章节及其视频' : '整个系列及其视频'}、观看记录和书签，释放不再被其他课程使用的视频空间。原始文件不受影响。</p>{error && <p role="alert">{error}</p>}<div className="vl-dialog-actions"><button data-initial-focus disabled={busy} onClick={closeDeletion}>取消，保留内容</button><button className="vl-danger-solid" disabled={busy} onClick={() => void run(async () => {
          const chapters = data.chapters.filter(c => deletion.kind === 'series' ? c.seriesId === deletion.id : c.id === deletion.id).map(c => c.id);
          if (video && (deletion.kind === 'video' ? video.id === deletion.id : chapters.includes(video.chapterId))) { await player.current?.pauseAndSave(true); setSelected(''); localStorage.removeItem('qixi.video.selected'); }
          await VideoLibrary.deleteContent({ kind: deletion.kind, id: deletion.id }); setDeletion(undefined);
        })}>确认删除</button></div></VideoModal>}
        {edit && <VideoModal title={edit.id ? '修改名称' : '新建分类'} busy={busy} focusInput onClose={closeEdit}><form onSubmit={e => { e.preventDefault(); if (!edit.title.trim()) return; void run(async () => {
          await dismissInputViewport();
          await VideoLibrary.update({ ...edit, title: edit.title.trim() });
          if (!edit.id && edit.kind === 'category' && importOpen) { const result = await refresh(); const category = result?.categories.slice().reverse().find(c => c.title === edit.title.trim()); if (category) { setImportCategory(category.id); setImportSeries(''); } }
          setEdit(undefined);
        }); }}><label>名称<input required maxLength={180} value={edit.title} onFocus={e => e.currentTarget.select()} onChange={e => setEdit({ ...edit, title: e.target.value })}/></label>{error && <p role="alert">{error}</p>}<div className="vl-dialog-actions"><button type="button" disabled={busy} onClick={closeEdit}>取消</button><button className="vl-primary" disabled={busy}>保存</button></div></form></VideoModal>}
        {manage ? <VideoManager key={managementTab} initialTab={managementTab} data={data} busy={busy} importing={importing} onRun={run} onRename={rename} onDelete={setDeletion} onWatch={id => void selectVideo(id)} onImport={openImport}/> : <>
          <div className="vl-study-layout"><div className="vl-pinned-player">
            {video ? <VideoPlayer ref={player} key={video.id} video={video} subtitle={`${playingSeries?.title ?? ''} · 第${playbackIndex + 1}/${playbackVideos.length}段`} progress={data.progress.find(p => p.id === video.id)} bookmarks={data.bookmarks.filter(b => b.videoId === video.id)} onSaved={() => void refresh().catch(reason => setError(String(reason)))} onPractice={onPractice} onRename={() => rename('video', video.id, video.title)} onPrevious={playbackIndex > 0 ? () => void selectVideo(playbackVideos[playbackIndex - 1].id) : undefined} onNext={playbackIndex >= 0 && playbackIndex < playbackVideos.length - 1 ? () => void selectVideo(playbackVideos[playbackIndex + 1].id) : undefined}/> : <section className="vl-empty"><span className="vl-empty-icon"><BookOpen/></span><h2>{data.videos.length ? '今天，学一节棋课' : '把棋课放进学习库'}</h2><p>{data.videos.length ? '从课程目录选择一节，按自己的节奏学习。' : '导入保存的 MP4，离线观看，随时去练棋。'}</p>{resumableVideo(data) ? <button className="vl-primary" onClick={() => void selectVideo(resumableVideo(data)!.id)}><Play/>继续学习</button> : !data.videos.length && <button className="vl-primary" onClick={openImport}><Plus/>导入第一套课程</button>}</section>}
          </div><div ref={courseBrowser} className="vl-course-browser" aria-label="选集与课程目录" tabIndex={0}>
          {data.videos.length > 0 && <><section className="vl-course-switcher" aria-label="快速切换课程">
            <div className="vl-browser-heading"><strong>课程</strong><small>{data.series.length} 套 · {data.videos.length} 集</small><button className="vl-text-button" aria-label={searchOpen ? '收起课程搜索' : '展开课程搜索'} aria-expanded={searchOpen} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>{searchOpen ? <X/> : <Search/>}{searchOpen ? '收起' : '搜索'}</button></div>
            {searchOpen && <section className="vl-library-search" aria-label="课程搜索"><label className="vl-search"><Search/><input ref={searchInput} type="search" aria-label="搜索课程" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索系列、章节或视频"/>{query && <button className="vl-icon-button" aria-label="清空课程搜索" onClick={() => setQuery('')}><X/></button>}</label>{searchTerm && <div className="vl-search-results" aria-label="课程搜索结果">{results.map(item => <button key={item.video.id} onClick={() => void selectVideo(item.video.id).then(ok => { if (ok) closeSearch(); })}><Play/><span><strong>{item.video.title}</strong><small>{item.caption}</small></span><ChevronRight/></button>)}{results.length === 0 && <p className="vl-empty-note">没有找到课程，试试其他名称。</p>}</div>}</section>}
          </section><div className="vl-category-bar"><div className="vl-category-row"><div className="vl-category-switch" role="group" aria-label="快速切换分类"><button aria-pressed={!category} onClick={() => browseCategory('')}>全部</button>{data.categories.slice().sort(naturalOrder).map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => browseCategory(c.id)}>{c.title}</button>)}</div><button className="vl-directory-toggle" aria-label={courseControlsOpen ? '收起系列与章节' : '展开系列与章节'} aria-expanded={courseControlsOpen} aria-controls="vl-course-selects" onClick={() => setCourseControlsOpen(!courseControlsOpen)}><FolderOpen/><span>目录</span><ChevronDown className={courseControlsOpen ? 'vl-rotated' : ''}/></button></div>
            {courseControlsOpen && <div className="vl-course-selects" id="vl-course-selects"><label className="vl-compact-select"><span className="vl-sr-only">快速切换系列</span><select aria-label="快速切换系列" value={series} onChange={e => browseSeries(e.target.value)}><option value="" disabled>选择系列</option>{data.series.filter(s => !category || s.categoryId === category).sort(naturalOrder).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select><ChevronDown aria-hidden="true"/></label><label className="vl-compact-select"><span className="vl-sr-only">快速切换章节</span><select aria-label="快速切换章节" value={chapter} disabled={!series} onChange={e => { setChapter(e.target.value); setGroup(0); setNumbersOpen(true); }}><option value="" disabled>选择章节</option>{data.chapters.filter(c => c.seriesId === series).sort(naturalOrder).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><ChevronDown aria-hidden="true"/></label></div>}</div>
            {category && !data.series.some(s => s.categoryId === category) && <p className="vl-muted">此分类还没有课程，可在顶部导入。</p>}
          </>}
          {attention.length > 0 && <button className="vl-import-notice" onClick={() => openManagement('imports')}><Import/><span>{importing ? '课程正在导入' : '有导入任务需要处理'}</span><ChevronRight/></button>}

            {videos.length > 0 && <section className="vl-navigation" aria-label="章节选集">
              <div className="vl-section-heading">
                <button className="vl-disclosure" aria-expanded={numbersOpen} onClick={() => setNumbersOpen(!numbersOpen)}><strong>选集</strong><ChevronDown className={!numbersOpen ? 'vl-closed' : ''}/></button>
                <div className="vl-episode-view" aria-label="选集显示方式">{(['titles', 'numbers'] as const).map(mode => <button key={mode} aria-pressed={episodeView === mode} onClick={() => { setEpisodeView(mode); localStorage.setItem('qixi.video.episodeView', mode); setNumbersOpen(true); }}>{mode === 'titles' ? '标题' : '数字'}</button>)}</div>
                <div className="vl-group-pager" role="group" aria-label="视频分组">
                  {groups.length > 1 && <button aria-label="上一组选集" disabled={visibleGroup === 0} onClick={() => changeGroup(visibleGroup - 1)}><ChevronLeft/></button>}
                  <span role="status" aria-live="polite">{groups[visibleGroup].start + 1}–{groups[visibleGroup].end}<small> / {videos.length}</small></span>
                  {groups.length > 1 && <button aria-label="下一组选集" disabled={visibleGroup === groups.length - 1} onClick={() => changeGroup(visibleGroup + 1)}><ChevronRight/></button>}
                </div>
              </div>
              {numbersOpen && (episodeView === 'numbers' ? <div className="vl-numbers">{videos.slice(visibleGroup * VIDEO_GROUP_SIZE, (visibleGroup + 1) * VIDEO_GROUP_SIZE).map((v, i) => { const p = data.progress.find(p => p.id === v.id); return <button key={v.id} title={v.title} aria-label={`第${visibleGroup * VIDEO_GROUP_SIZE + i + 1}段 ${v.title}`} aria-current={selected === v.id ? 'true' : undefined} className={p?.viewed ? 'viewed' : p?.position ? 'started' : ''} onClick={() => void selectVideo(v.id)}>{visibleGroup * VIDEO_GROUP_SIZE + i + 1}{p?.viewed ? <span>✓</span> : p?.position ? <span>•</span> : null}</button>; })}</div> : <ol className="vl-episode-list">{videos.slice(visibleGroup * VIDEO_GROUP_SIZE, (visibleGroup + 1) * VIDEO_GROUP_SIZE).map((v, i) => {
                const p = data.progress.find(p => p.id === v.id);
                return <li key={v.id} className={selected === v.id ? 'vl-current-episode' : ''}>
                  <button className="vl-episode-pick" aria-label={`第${visibleGroup * VIDEO_GROUP_SIZE + i + 1}段 ${v.title}`} aria-current={selected === v.id ? 'true' : undefined} onClick={() => void selectVideo(v.id)}><span className="vl-episode-number">{visibleGroup * VIDEO_GROUP_SIZE + i + 1}</span><strong>{v.title}</strong><small>{selected === v.id ? '当前' : p?.viewed ? '看过' : p?.position ? '在看' : ''}</small></button>
                  <button className="vl-icon-button" aria-label={`重命名 ${v.title}`} title="重命名" disabled={busy} onClick={() => pauseFor(() => rename('video', v.id, v.title))}><Pencil/></button>
                </li>;
              })}</ol>)}
              {numbersOpen && <div className="vl-legend"><span>● 在看</span><span>✓ 看过</span>{groups.length > 1 && <div className="vl-bottom-pager">{visibleGroup > 0 && <button className="vl-text-button" aria-label="上一页选集" onClick={() => changeGroup(visibleGroup - 1)}><ChevronLeft/>上一页</button>}{visibleGroup < groups.length - 1 && <button className="vl-text-button" aria-label="下一页选集" onClick={() => changeGroup(visibleGroup + 1)}>下一页<ChevronRight/></button>}</div>}</div>}
            </section>}
          </div></div>
        </>}
      </>}
    </div>
  </main>;
}

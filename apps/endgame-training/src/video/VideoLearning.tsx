import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoLibrary, nativeVideoAvailable } from './library';
import { chapterVideos, formatVideoSize, naturalOrder, resumableVideo, VIDEO_GROUP_SIZE, videoGroups } from './model';
import type { VideoEntity, VideoSnapshot } from './types';
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer';
import './video.css';

export function VideoLearningEntry({ onOpen, management = false }: { onOpen(): void; management?: boolean }) {
  const [data, setData] = useState<VideoSnapshot>();
  useEffect(() => { if (nativeVideoAvailable()) void VideoLibrary.snapshot().then(setData).catch(() => {}); }, []);
  const resume = data && resumableVideo(data);
  return <button type="button" className="vl-entry" onClick={() => { if (resume && !management) localStorage.setItem('qixi.video.selected',resume.id); onOpen(); }}><span aria-hidden="true">▶</span><span><b>{management ? '视频管理' : resume ? '继续学习' : '视频学习'}</b><small>{resume?.title ?? '导入课程 · 离线观看 · 按集学习'}</small></span><span aria-hidden="true">›</span></button>;
}
export function VideoLearning({ onBack, onPractice }: { onBack(): void; onPractice(): void }) {
  const player = useRef<VideoPlayerHandle>(null);
  const [deletion, setDeletion] = useState<{kind: 'series' | 'chapter' | 'video'; id:string; title:string}>();

  const [data, setData] = useState<VideoSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [series, setSeries] = useState('');
  const [chapter, setChapter] = useState('');
  const [selected, setSelected] = useState(() => localStorage.getItem('qixi.video.selected') ?? '');
  const [manage, setManage] = useState(false);
  const [directory, setDirectory] = useState(true);
  const [numbersOpen, setNumbersOpen] = useState(true);
  const [group, setGroup] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importCategory, setImportCategory] = useState('category-other');
  const [importSeries, setImportSeries] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [edit, setEdit] = useState<{kind:VideoEntity; id:string; title:string}>();
  const refresh = useCallback(async () => {
    if (!nativeVideoAvailable()) return;
    const result = await VideoLibrary.snapshot(); setData(result); return result;
  }, []);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
  useEffect(() => { void run(async () => { await refresh(); await VideoLibrary.receiveProvisioned(); }); }, []);
  const importing = data?.tasks.some(t => ['running','scanning'].includes(t.state));
  useEffect(() => { if (!importing) return; const timer = setInterval(() => void refresh().catch(reason => setError(String(reason))), 1000); return () => clearInterval(timer); }, [importing, refresh]);
  const video = data?.videos.find(v => v.id === selected);
  useEffect(() => {
    if (!data || !video) return;
    const c = data.chapters.find(c => c.id === video.chapterId);
    const s = data.series.find(s => s.id === c?.seriesId);
    if (c && s) { setChapter(c.id); setSeries(s.id); setCategory(s.categoryId); setGroup(Math.max(0,Math.floor(chapterVideos(data,c.id).findIndex(v => v.id === video.id) / VIDEO_GROUP_SIZE))); }
  }, [video?.id, data?.chapters.length]);
  const videos = data ? chapterVideos(data, chapter) : [];
  const selectVideo = async (id: string) => { try { await player.current?.pauseAndSave(); } catch (reason) { setError(String(reason)); return; } setSelected(id); localStorage.setItem('qixi.video.selected',id); const i = videos.findIndex(v => v.id === id); setGroup(Math.max(0, Math.floor(i / VIDEO_GROUP_SIZE))); };
  const update = (kind: VideoEntity, id:string, title:string) => setEdit({kind,id,title});
  const reorder = (kind: VideoEntity, items: {id:string;order:number}[], index:number, direction:number) => void run(async () => {
    const next = [...items]; const other = index + direction; if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    for (let i = 0; i < next.length; i++) await VideoLibrary.update({kind,id:next[i].id,order:i});
  });
  const groups = videoGroups(videos.length);
  const visibleGroup = Math.min(group, Math.max(0, groups.length - 1));
  if (!nativeVideoAvailable()) return <main className="mobile-home-page vl-page"><button onClick={onBack}>返回</button><h1>视频学习</h1><p>请在安卓或苹果应用中导入本地 MP4。浏览器预览不支持持久视频库。</p></main>;
  return <main className="mobile-home-page vl-page">
    <header><button onClick={() => { void (async () => { await player.current?.pauseAndSave(); onBack(); })().catch(reason => setError(String(reason))); }}>‹ 返回</button><h1>视频学习</h1><button onClick={() => setManage(!manage)} aria-pressed={manage}>{manage ? '完成管理' : '管理'}</button><button onClick={() => setImportOpen(true)}>导入</button></header>
    {error && <p role="alert">{error}<button onClick={() => void run(refresh)}>重试读取</button></p>}
    {!data && <p>正在打开本机视频库…</p>}
    {data && <>
      {importOpen && <section className="vl-import" aria-label="导入视频">
        <h2>导入 MP4</h2><p>先在其他应用下载视频，再从文件或文件夹导入。</p>
        <label>分类<select value={importCategory} onChange={e => { setImportCategory(e.target.value); setImportSeries(''); }}>{data.categories.sort(naturalOrder).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>系列<select value={importSeries} onChange={e => setImportSeries(e.target.value)}><option value="">新建系列</option>{data.series.filter(s => s.categoryId === importCategory).sort(naturalOrder).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {!importSeries && <label>系列名称<input value={importTitle} placeholder="留空使用文件夹名称" onChange={e => setImportTitle(e.target.value)}/></label>}
        <p>视频将复制到本应用，占用本机空间。取消保留已成功导入的内容。</p>
        <div className="vl-controls">{[false,true].map(folder => <button key={String(folder)} disabled={busy || importing} onClick={() => void run(async () => { await VideoLibrary.pick({folder,categoryId:importCategory,seriesId:importSeries || undefined,seriesTitle:importTitle.trim() || undefined}); setImportOpen(false); })}>{folder ? '选择文件夹（含子目录）' : '多选 MP4'}</button>)}<button onClick={() => setImportOpen(false)}>收起</button></div>
      </section>}
      {deletion && <div className="vl-confirm-shade"><section className="vl-confirm" role="alertdialog" aria-modal="true" aria-labelledby="vl-delete-title" aria-describedby="vl-delete-description"><h2 id="vl-delete-title">确认删除「{deletion.title}」？</h2><p id="vl-delete-description">将删除本应用中的{deletion.kind === 'video' ? '这个视频' : deletion.kind === 'chapter' ? '整个章节及其视频' : '整个系列及其视频'}、观看记录和书签，释放不再被其他课程使用的视频空间。原始文件不受影响。</p><div className="vl-controls"><button autoFocus disabled={busy} onClick={() => setDeletion(undefined)}>取消，保留内容</button><button disabled={busy} onClick={() => void run(async () => {
        const chapters = data.chapters.filter(c => deletion.kind === 'series' ? c.seriesId === deletion.id : c.id === deletion.id).map(c => c.id);
        if (video && (deletion.kind === 'video' ? video.id === deletion.id : chapters.includes(video.chapterId))) { await player.current?.pauseAndSave(true); setSelected(''); localStorage.removeItem('qixi.video.selected'); }
        await VideoLibrary.deleteContent({kind:deletion.kind,id:deletion.id});setDeletion(undefined);
      })}>确认删除</button></div></section></div>}
      {edit && <form className="vl-edit" onSubmit={e => { e.preventDefault(); if (!edit.title.trim()) return; void run(async () => { await VideoLibrary.update({...edit,title:edit.title.trim()}); setEdit(undefined); }); }}><label>{edit.id ? '修改名称' : '新建分类'}<input autoFocus required maxLength={180} value={edit.title} onChange={e => setEdit({...edit,title:e.target.value})}/></label><button disabled={busy}>保存</button><button type="button" onClick={() => setEdit(undefined)}>取消</button></form>}
      {data.tasks.map(t => <details key={t.id} className="vl-task" open={['running','scanning','interrupted','cancelled'].includes(t.state) || t.failed > 0} aria-live="polite"><summary><strong>{['running','scanning'].includes(t.state) ? '正在导入' : t.state === 'cancelled' ? '已取消' : t.state === 'interrupted' ? '导入已中断' : '导入完成'}</strong> · {t.completed}/{t.total} 个</summary><p>{t.completed}/{t.total} 个 · {formatVideoSize(t.bytes)}/{formatVideoSize(t.totalBytes)} · 重复 {t.duplicates} · 失败 {t.failed}</p><progress max={Math.max(1,t.total)} value={t.completed + t.failed}/><small>{t.current}</small>{['running','scanning'].includes(t.state) ? <button onClick={() => void run(() => VideoLibrary.cancel({taskId:t.id}))}>取消导入</button> : (t.failed > 0 || ['cancelled','interrupted'].includes(t.state)) && <button disabled={busy || importing} onClick={() => void run(() => VideoLibrary.retry({taskId:t.id}))}>重试未完成项</button>}{t.errors.length > 0 && <details><summary>失败原因</summary>{t.errors.map((e,i) => <p key={i}>{e}</p>)}</details>}</details>)}
      <div className="vl-layout">
        <div className="vl-watch">
          {video ? <VideoPlayer ref={player} key={video.id} video={video} progress={data.progress.find(p => p.id === video.id)} bookmarks={data.bookmarks.filter(b => b.videoId === video.id)} onSaved={() => void refresh().catch(reason => setError(String(reason)))} onPractice={onPractice} onPrevious={videos.findIndex(v => v.id === video.id) > 0 ? () => selectVideo(videos[videos.findIndex(v => v.id === video.id) - 1].id) : undefined} onNext={videos.findIndex(v => v.id === video.id) >= 0 && videos.findIndex(v => v.id === video.id) < videos.length - 1 ? () => selectVideo(videos[videos.findIndex(v => v.id === video.id) + 1].id) : undefined}/> : <section className="vl-empty"><h2>选一节课，开始学习</h2><p>{data.videos.length ? '从下方目录选择视频。' : '导入自己保存的 MP4，按分类、系列和章节整理。'}</p>{resumableVideo(data) && <button onClick={() => selectVideo(resumableVideo(data)!.id)}>继续学习</button>}</section>}
          {videos.length > 0 && <section className="vl-navigation"><div className="vl-controls"><button aria-expanded={numbersOpen} onClick={() => setNumbersOpen(!numbersOpen)}>{numbersOpen ? '收起数字导航' : '展开数字导航'}</button><select aria-label="视频分组" value={visibleGroup} onChange={e => setGroup(Number(e.target.value))}>{groups.map((g,i) => <option key={i} value={i}>{g.start + 1}–{g.end}</option>)}</select><small>● 在看　✓ 看过</small></div>{numbersOpen && <div className="vl-numbers">{videos.slice(visibleGroup*25,visibleGroup*25+25).map((v,i) => { const p = data.progress.find(p => p.id === v.id); return <button key={v.id} title={v.title} aria-label={`第${visibleGroup*25+i+1}段 ${v.title}`} aria-current={selected === v.id ? 'true' : undefined} className={p?.viewed ? 'viewed' : p?.position ? 'started' : ''} onClick={() => selectVideo(v.id)}>{visibleGroup*25+i+1}{p?.viewed ? ' ✓' : p?.position ? ' •' : ''}</button>; })}</div>}</section>}
        </div>
        <aside className="vl-directory"><button aria-expanded={directory} onClick={() => setDirectory(!directory)}>{directory ? '收起课程目录' : '展开课程目录'}</button>{directory && <>
          <div className="vl-controls"><select aria-label="课程分类" value={category} onChange={e => {setCategory(e.target.value);setSeries('');setChapter('');}}><option value="">全部分类</option>{data.categories.sort(naturalOrder).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>{manage && <><button onClick={() => update('category','', '')}>新建分类</button>{category && <button onClick={() => update('category',category,data.categories.find(c => c.id === category)?.title ?? '')}>分类改名</button>}</>}</div>
          {data.series.filter(s => !category || s.categoryId === category).sort(naturalOrder).map(s => <section key={s.id} className="vl-series"><button className="vl-title" aria-expanded={series === s.id} onClick={() => {setSeries(series === s.id ? '' : s.id);setChapter('');}}>{s.title}</button>{manage && <div className="vl-controls"><button onClick={() => update('series',s.id,s.title)}>改名</button><select aria-label={`${s.title}所属分类`} value={s.categoryId} onChange={e => void run(() => VideoLibrary.update({kind:'series',id:s.id,categoryId:e.target.value}))}>{data.categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><button onClick={() => setDeletion({kind:'series',id:s.id,title:s.title})}>删除系列</button></div>}{series === s.id && data.chapters.filter(c => c.seriesId === s.id).sort(naturalOrder).map((c,ci,cs) => <section className="vl-chapter" key={c.id}><button aria-expanded={chapter === c.id} onClick={() => {setChapter(c.id);setGroup(0);}}>{c.title} · {data.videos.filter(v => v.chapterId === c.id).length}段</button>{manage && <div className="vl-controls"><button onClick={() => update('chapter',c.id,c.title)}>改名</button><button onClick={() => setDeletion({kind:'chapter',id:c.id,title:c.title})}>删除章节</button><button disabled={!ci || busy} onClick={() => reorder('chapter',cs,ci,-1)}>上移</button><button disabled={ci === cs.length-1 || busy} onClick={() => reorder('chapter',cs,ci,1)}>下移</button></div>}{chapter === c.id && <ol>{chapterVideos(data,c.id).map((v,i,vs) => <li key={v.id}><button aria-current={selected === v.id ? 'true' : undefined} onClick={() => selectVideo(v.id)}>{i+1}. {v.title}{data.progress.find(p => p.id === v.id)?.viewed ? ' ✓' : ''}</button>{manage && <div className="vl-controls"><button onClick={() => update('video',v.id,v.title)}>改名</button><button aria-label={`删除视频 ${v.title}`} onClick={() => setDeletion({kind:'video',id:v.id,title:v.title})}>删除</button><button disabled={!i || busy} onClick={() => reorder('video',vs,i,-1)}>上移</button><button disabled={i === vs.length-1 || busy} onClick={() => reorder('video',vs,i,1)}>下移</button></div>}</li>)}</ol>}</section>)}</section>)}
          <p className="vl-help">卸载应用会清除导入视频和本机学习记录。需要保留时，请保管电脑上的原始视频。</p>
        </>}</aside>
      </div>
    </>}
  </main>;
}

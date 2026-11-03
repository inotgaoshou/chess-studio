import { BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Maximize2, Minimize2, Pause, Pencil, Play, Swords, Trash2 } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { localVideoUrl, VideoLibrary } from './library';
import { formatVideoTime, progressFor } from './model';
import type { LearningVideo, VideoBookmark, VideoProgress } from './types';
import { useVideoFullscreen } from './useVideoFullscreen';
import type { PreferredOrientation } from '../orientation';

export interface VideoPlayerHandle { pauseAndSave(dispose?: boolean): Promise<void> }
export const VideoPlayer = forwardRef<VideoPlayerHandle, {
  video: LearningVideo; subtitle?: string; progress?: VideoProgress; bookmarks: VideoBookmark[];
  onSaved(): void; onPractice(): void; onPrevious?: () => void; onNext?: () => void; onRename?: () => void;
}>(function VideoPlayer({ video, subtitle, progress, bookmarks, onSaved, onPractice, onPrevious, onNext, onRename }, ref) {
  const element = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fullscreen = useVideoFullscreen(element, setError);
  const { immersive } = fullscreen;
  const more = useRef<HTMLDetailsElement>(null);
  const [viewed, setViewed] = useState(progress?.viewed ?? false);
  const viewedRef = useRef(viewed);
  const initialPosition = useRef(progress?.position ?? 0);
  // Serialize writes so an older periodic save cannot overwrite the final paused position.
  const writes = useRef(Promise.resolve());
  const disposed = useRef(false);
  const save = (media = element.current, allowUnloaded = false) => {
    if (disposed.current || ((!media || media.readyState === 0) && !allowUnloaded)) return writes.current;
    const record = progressFor(video.id, media?.readyState ? media.currentTime : initialPosition.current, media?.readyState ? media.duration : progress?.duration ?? 0, viewedRef.current);
    initialPosition.current = record.position;
    writes.current = writes.current.catch(() => {}).then(() => VideoLibrary.saveProgress(record)).then(() => onSaved());
    return writes.current.catch(reason => { setError(`进度保存失败：${String(reason)}。请重试。`); throw reason; });
  };
  const saveRef = useRef(save); saveRef.current = save;
  useImperativeHandle(ref, () => ({ pauseAndSave: async (dispose = false) => { element.current?.pause(); await save(); if (dispose) disposed.current = true; } }));
  useEffect(() => {
    let active = true;
    setError(''); setUrl('');
    void VideoLibrary.playback({ id: video.id }).then(result => { if (active) setUrl(localVideoUrl(result.path)); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [video.id, attempt]);
  useEffect(() => {
    const media = element.current;
    const timer = window.setInterval(() => { void saveRef.current().catch(() => {}); }, 5000);
    const pause = () => { media?.pause(); void saveRef.current(media).catch(() => {}); };
    const background = () => { if (document.hidden) pause(); };
    const nativeBackground = VideoLibrary.addListener('background', pause);
    void nativeBackground.catch(reason => setError(`后台暂停监听失败：${String(reason)}`));
    document.addEventListener('visibilitychange', background);
    window.addEventListener('pagehide', pause);
    return () => { void nativeBackground.then(handle => handle.remove()).catch(() => {}); clearInterval(timer); document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', pause); pause(); if (media) { media.removeAttribute('src'); media.load(); } };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !more.current?.contains(event.target)) more.current?.removeAttribute('open'); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && more.current?.open) { more.current.removeAttribute('open'); more.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const leave = async (action?: () => void) => { element.current?.pause(); await save(); action?.(); };
  const togglePlayback = async () => {
    const media = element.current;
    if (!media) return;
    if (media.paused) { try { await media.play(); } catch (reason) { setError(`暂时无法播放，请重试。${String(reason)}`); } }
    else media.pause();
  };
  return <section className={`vl-player${immersive ? ' vl-immersive' : ''}`} aria-label="课程播放器">
    <div className="vl-lesson-heading"><div>{subtitle && <small>{subtitle}</small>}<h2>{video.title}</h2></div>{!immersive && <>
      {onRename && <button className="vl-icon-button" aria-label="重命名当前视频" title="重命名" onClick={() => void leave(onRename).catch(() => {})}><Pencil/></button>}
      <details ref={more} className="vl-player-more"><summary aria-label="更多播放操作" title="更多"><Ellipsis/></summary><div className="vl-more-panel" role="group" aria-label="更多播放操作">
        <button aria-pressed={viewed} onClick={() => { viewedRef.current = !viewed; setViewed(!viewed); void save(element.current, true).catch(() => {}); }}><Check/>{viewed ? '已看过' : '标记看过'}</button>
        <button onClick={() => { const m = element.current; if (!m || !m.readyState) return; void VideoLibrary.bookmark({ id: crypto.randomUUID(), videoId: video.id, position: m.currentTime, title: `书签 ${formatVideoTime(m.currentTime)}` }).then(onSaved).catch(reason => setError(String(reason))); }}><BookmarkPlus/>加书签</button>
        <button onClick={() => void leave(() => { more.current?.removeAttribute('open'); onPractice(); }).catch(() => {})}><Swords/>去练棋</button>
        {bookmarks.length > 0 && <><small>时间书签 · {bookmarks.length}</small><ul className="vl-bookmarks">{bookmarks.map(b => <li key={b.id}><button onClick={() => { if (element.current) { element.current.currentTime = b.position; element.current.pause(); } more.current?.removeAttribute('open'); }}>{formatVideoTime(b.position)}<span>{b.title}</span></button><button className="vl-icon-button" aria-label={`删除${b.title}`} onClick={() => void VideoLibrary.bookmark({id:b.id, remove:true}).then(onSaved).catch(reason => setError(String(reason)))}><Trash2/></button></li>)}</ul></>}
      </div></details>
    </>}{immersive && <button className="vl-exit-fullscreen" onClick={fullscreen.exit}><Minimize2/>退出全屏</button>}</div>
    <div className="vl-video-frame"><video ref={element} src={url || undefined} controls playsInline preload="metadata"
      onLoadedMetadata={() => { const media = element.current!; media.currentTime = Math.min(initialPosition.current, Number.isFinite(media.duration) ? media.duration : initialPosition.current); media.pause(); }}
      onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); void save().catch(() => {}); }} onEnded={() => { setPlaying(false); void save().catch(() => {}); }}
      onError={() => setError('无法播放此 MP4。请在电脑确认文件可播放，转为 H.264 + AAC 后重新导入；也可重试打开。')} /></div>
    {error && <p role="alert">{error}<button onClick={() => { void save().catch(() => {}); setAttempt(n => n + 1); }}>重试</button></p>}
    <div className="vl-playback-bar"><div className="vl-transport" aria-label="播放控制">
      <button disabled={!onPrevious} aria-label="上一段" title="上一段" onClick={() => void leave(onPrevious).catch(() => {})}><ChevronLeft/></button>
      <button className="vl-play-toggle" aria-label={playing ? '暂停' : '播放'} onClick={() => void togglePlayback()}>{playing ? <Pause/> : <Play/>}<span>{playing ? '暂停' : '播放'}</span></button>
      <button disabled={!onNext} aria-label="下一段" title="下一段" onClick={() => void leave(onNext).catch(() => {})}><ChevronRight/></button>
    </div>
    <div className="vl-playback-options"><label className="vl-compact-select"><span className="vl-sr-only">倍速</span><select aria-label="播放倍速" defaultValue="1" onChange={e => { if (element.current) element.current.playbackRate = Number(e.target.value); }}>{[0.75, 1, 1.25, 1.5, 2].map(n => <option key={n} value={n}>{n}×</option>)}</select><ChevronDown aria-hidden="true"/></label><label className="vl-compact-select"><span className="vl-sr-only">全屏方向</span><select aria-label="全屏方向" value={fullscreen.direction} onChange={e => fullscreen.changeDirection(e.target.value as PreferredOrientation)}><option value="landscape">横屏</option><option value="portrait">竖屏</option><option value="auto">自动</option></select><ChevronDown aria-hidden="true"/></label><button className="vl-fullscreen-button" aria-label="全屏播放" title="全屏播放" onClick={fullscreen.enter}><Maximize2/><span className="vl-sr-only">全屏</span></button></div></div>
  </section>;
});

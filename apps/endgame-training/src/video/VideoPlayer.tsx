import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { localVideoUrl, VideoLibrary } from './library';
import { formatVideoTime, progressFor } from './model';
import type { LearningVideo, VideoBookmark, VideoProgress } from './types';

export interface VideoPlayerHandle { pauseAndSave(dispose?: boolean): Promise<void> }
export const VideoPlayer = forwardRef<VideoPlayerHandle, {
  video: LearningVideo; progress?: VideoProgress; bookmarks: VideoBookmark[];
  onSaved(): void; onPractice(): void; onPrevious?: () => void; onNext?: () => void;
}>(function VideoPlayer({ video, progress, bookmarks, onSaved, onPractice, onPrevious, onNext }, ref) {
  const element = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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
  const leave = async (action?: () => void) => { element.current?.pause(); await save(); action?.(); };
  return <section className="vl-player">
    <h2>{video.title}</h2>
    <video ref={element} src={url || undefined} controls playsInline preload="metadata"
      onLoadedMetadata={() => { const media = element.current!; media.currentTime = Math.min(initialPosition.current, Number.isFinite(media.duration) ? media.duration : initialPosition.current); media.pause(); }}
      onPause={() => void save().catch(() => {})} onEnded={() => void save().catch(() => {})}
      onError={() => setError('无法播放此 MP4。请在电脑确认文件可播放，转为 H.264 + AAC 后重新导入；也可重试打开。')} />
    {error && <p role="alert">{error}<button onClick={() => { void save().catch(() => {}); setAttempt(n => n + 1); }}>重试</button></p>}
    <div className="vl-controls">
      <button disabled={!onPrevious} onClick={() => void leave(onPrevious).catch(() => {})}>上一段</button>
      <button onClick={() => { const m = element.current; if (m) m.currentTime = Math.max(0, m.currentTime - 10); }}>−10秒</button>
      <button onClick={() => { const m = element.current; if (m) m.currentTime = Math.min(m.duration || 0, m.currentTime + 10); }}>+10秒</button>
      <button disabled={!onNext} onClick={() => void leave(onNext).catch(() => {})}>下一段</button>
      <label>倍速 <select defaultValue="1" onChange={e => { if (element.current) element.current.playbackRate = Number(e.target.value); }}>{[0.75, 1, 1.25, 1.5, 2].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
      <button onClick={() => { const m = element.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }; if (m?.requestFullscreen) void m.requestFullscreen().catch(() => m.webkitEnterFullscreen?.()); else m?.webkitEnterFullscreen?.(); }}>全屏</button>
      <button onClick={() => void leave(onPractice).catch(() => {})}>去练棋</button>
      <button aria-pressed={viewed} onClick={() => { viewedRef.current = !viewed; setViewed(!viewed); void save(element.current, true).catch(() => {}); }}>{viewed ? '已看过 ✓' : '标记看过'}</button>
      <button onClick={() => { const m = element.current; if (!m || !m.readyState) return; void VideoLibrary.bookmark({ id: crypto.randomUUID(), videoId: video.id, position: m.currentTime, title: `书签 ${formatVideoTime(m.currentTime)}` }).then(onSaved).catch(reason => setError(String(reason))); }}>加书签</button>
    </div>
    {bookmarks.length > 0 && <ul className="vl-bookmarks">{bookmarks.map(b => <li key={b.id}><button onClick={() => { if (element.current) { element.current.currentTime = b.position; element.current.pause(); } }}>{formatVideoTime(b.position)} · {b.title}</button><button aria-label={`删除${b.title}`} onClick={() => void VideoLibrary.bookmark({id:b.id, remove:true}).then(onSaved).catch(reason => setError(String(reason)))}>删除</button></li>)}</ul>}
    <small>观看记录仅保存在本机，与练棋成绩分开。</small>
  </section>;
});

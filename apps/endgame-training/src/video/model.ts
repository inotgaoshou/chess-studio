import type { LearningVideo, VideoProgress, VideoSnapshot } from './types';
export const VIDEO_GROUP_SIZE = 25;
export const naturalOrder = (a: { order: number; title: string }, b: { order: number; title: string }) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
export function chapterVideos(data: VideoSnapshot, chapterId: string): LearningVideo[] { return data.videos.filter(v => v.chapterId === chapterId).sort(naturalOrder); }
export function videoGroups(count: number) { return Array.from({length: Math.ceil(count / VIDEO_GROUP_SIZE)}, (_, i) => ({ start: i * VIDEO_GROUP_SIZE, end: Math.min(count, (i + 1) * VIDEO_GROUP_SIZE) })); }
export function resumableVideo(data: VideoSnapshot) {
  const p = [...data.progress].filter(p => !p.viewed && p.position > 0 && data.videos.some(v => v.id === p.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return data.videos.find(v => v.id === p?.id);
}
export function safePosition(position: number, duration: number) { return Number.isFinite(position) ? Math.max(0, Math.min(position, Number.isFinite(duration) && duration > 0 ? duration : position)) : 0; }
export function progressFor(id: string, position: number, duration: number, viewed: boolean): VideoProgress { return { id, position: safePosition(position, duration), duration: Number.isFinite(duration) ? Math.max(0, duration) : 0, viewed, updatedAt: Date.now() }; }
export const formatVideoTime = (n: number) => `${Math.floor(Math.max(0, n) / 60)}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, '0')}`;
export const formatVideoSize = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;

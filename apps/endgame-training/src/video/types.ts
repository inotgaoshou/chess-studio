import type { PluginListenerHandle } from '@capacitor/core';
export interface VideoCategory { id: string; title: string; order: number }
export interface VideoSeries { id: string; categoryId: string; title: string; order: number }
export interface VideoChapter { id: string; seriesId: string; title: string; path: string; order: number }
export interface LearningVideo { id: string; chapterId: string; title: string; hash: string; size: number; order: number }
export interface VideoProgress { id: string; position: number; duration: number; viewed: boolean; updatedAt: number }
export interface VideoBookmark { id: string; videoId: string; position: number; title: string }
export interface VideoImportTask {
  id: string; state: 'scanning' | 'running' | 'completed' | 'cancelled' | 'interrupted';
  total: number; completed: number; duplicates: number; failed: number;
  bytes: number; totalBytes: number; current?: string; errors: string[];
}
export interface VideoSnapshot {
  categories: VideoCategory[]; series: VideoSeries[]; chapters: VideoChapter[];
  videos: LearningVideo[]; progress: VideoProgress[]; bookmarks: VideoBookmark[]; tasks: VideoImportTask[];
}
export type VideoEntity = 'category' | 'series' | 'chapter' | 'video';
export interface VideoLibraryPlugin {
  addListener(event: 'background', listener: () => void): Promise<PluginListenerHandle>;
  snapshot(): Promise<VideoSnapshot>;
  pick(options: { folder: boolean; categoryId: string; seriesId?: string; seriesTitle?: string }): Promise<{ taskId?: string }>;
  receiveProvisioned(): Promise<{ taskId?: string }>;
  cancel(options: { taskId: string }): Promise<void>;
  retry(options: { taskId: string }): Promise<void>;
  update(options: { kind: VideoEntity; id: string; title?: string; order?: number; categoryId?: string }): Promise<void>;
  deleteSeries(options: { id: string }): Promise<void>;
  deleteContent(options: { kind: 'series' | 'chapter' | 'video'; id: string }): Promise<void>;
  playback(options: { id: string }): Promise<{ path: string }>;
  saveProgress(options: VideoProgress): Promise<void>;
  bookmark(options: { id: string; videoId?: string; position?: number; title?: string; remove?: boolean }): Promise<void>;
}

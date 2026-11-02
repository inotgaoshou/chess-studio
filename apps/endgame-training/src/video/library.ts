import { Capacitor, registerPlugin } from '@capacitor/core';
import type { VideoLibraryPlugin } from './types';
export const VideoLibrary = registerPlugin<VideoLibraryPlugin>('VideoLibrary');
export const nativeVideoAvailable = () => Capacitor.isNativePlatform();
export const localVideoUrl = (path: string) => `${Capacitor.convertFileSrc(path)}?vl=1`;

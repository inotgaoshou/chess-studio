#!/usr/bin/env node
// A release must never accidentally absorb the personal media library.
import { readdirSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const app = resolve(fileURLToPath(new URL('../apps/endgame-training', import.meta.url)));
const roots = ['public', 'dist', 'android/app/src/main/assets', 'ios/App/App/public'];
function scan(folder) {
  if (!existsSync(folder)) return;
  for (const item of readdirSync(folder)) {
    const path = join(folder,item), info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`打包资源不允许符号链接：${path}`);
    if (/^(VideoLibrary|video-staging)$/i.test(item) || /\.mp4$/i.test(item)) throw new Error(`拒绝将私人课程或暂存内容放进安装包：${path}`);
    if (info.isDirectory()) scan(path);
  }
}
for (const folder of roots) scan(resolve(app,folder));
console.log('Video package guard: no bundled MP4 or private staging directories.');

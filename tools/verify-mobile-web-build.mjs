#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const distArg = process.argv[2] ?? "apps/desktop/dist";
const distDir = path.resolve(process.cwd(), distArg);
const forbiddenNamePatterns = [
  /(^|[/\\])resources([/\\]|$)/i,
  /pikafish/i,
  /fairy/i,
  /stockfish/i,
  /\.nnue$/i,
  /\.onnx$/i,
  /yolo/i,
  /\.exe$/i,
  /\.dmg$/i,
  /\.msi$/i,
  /\.app($|[/\\])/i,
];
const maxSingleFileBytes = Number(process.env.MOBILE_WEB_MAX_FILE_BYTES ?? 25 * 1024 * 1024);

async function walk(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({ absolute, relative: path.relative(root, absolute).replaceAll(path.sep, "/"), bytes: info.size });
    }
  }
  return files;
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

let files;
try {
  files = await walk(distDir);
} catch (error) {
  console.error(`Mobile web build directory is not readable: ${distDir}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const forbidden = files.filter((file) => forbiddenNamePatterns.some((pattern) => pattern.test(file.relative)));
const oversized = files.filter((file) => file.bytes > maxSingleFileBytes);

if (forbidden.length || oversized.length) {
  console.error("Mobile web payload verification failed.");
  if (forbidden.length) {
    console.error("Forbidden desktop/runtime resources:");
    for (const file of forbidden) console.error(`- ${file.relative} (${formatMiB(file.bytes)})`);
  }
  if (oversized.length) {
    console.error(`Files larger than ${formatMiB(maxSingleFileBytes)}:`);
    for (const file of oversized) console.error(`- ${file.relative} (${formatMiB(file.bytes)})`);
  }
  process.exit(1);
}

const largest = [...files].sort((left, right) => right.bytes - left.bytes).slice(0, 10);
console.log(`Mobile web payload verified: ${files.length} files, ${formatMiB(totalBytes)} total.`);
for (const file of largest) console.log(`- ${file.relative}: ${formatMiB(file.bytes)}`);

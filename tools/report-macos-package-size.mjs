#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const [appPath, dmgPath, jsonPath, markdownPath] = process.argv.slice(2);
if (![appPath, dmgPath, jsonPath, markdownPath].every(Boolean)) {
  throw new Error("Usage: report-macos-package-size.mjs <app> <dmg> <json> <markdown>");
}

async function files(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) collected.push(...await files(root, path));
    else if (entry.isFile()) collected.push({ path: relative(root, path), bytes: (await stat(path)).size });
  }
  return collected;
}

function category(path) {
  const value = path.toLowerCase();
  if (value.endsWith("pikafish.nnue")) return "pikafish-nnue";
  if (value.endsWith("/pikafish")) return "pikafish-engine";
  if (value.includes("yolov11.onnx")) return "link-vision-model";
  if (value.includes("flyknife") || value.includes("book-topics") || value.includes("master-style") || value.includes("opening")) return "business-data";
  if (value.endsWith(".ttf") || value.includes("/fonts/")) return "fonts";
  if (/license|copying|notice|readme/.test(value)) return "licenses-and-notices";
  if (value.endsWith(".dylib") || value.includes("/macos/")) return "application";
  return "other";
}

const payload = await files(appPath);
const categoryTotals = new Map();
for (const item of payload) {
  const name = category(item.path);
  const current = categoryTotals.get(name) ?? { name, bytes: 0, files: 0 };
  current.bytes += item.bytes;
  current.files += 1;
  categoryTotals.set(name, current);
}
const categories = [...categoryTotals.values()].sort((a, b) => b.bytes - a.bytes);
const dmgBytes = (await stat(dmgPath)).size;
const report = {
  appPath, dmgPath, dmgBytes, extractedBytes: payload.reduce((sum, item) => sum + item.bytes, 0),
  categories, largestFiles: payload.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
};
const mib = bytes => (bytes / 1024 / 1024).toFixed(2);
const lines = [
  "# macOS package size report", "", `- DMG: ${basename(dmgPath)} (${mib(report.dmgBytes)} MiB)`,
  `- App payload: ${mib(report.extractedBytes)} MiB`, "", "## Categories", "", "| Category | Size (MiB) | Files |", "| --- | ---: | ---: |",
  ...categories.map(item => `| ${item.name} | ${mib(item.bytes)} | ${item.files} |`),
  "", "## Largest files", "", "| Path | Size (MiB) |", "| --- | ---: |",
  ...report.largestFiles.map(item => `| \`${item.path}\` | ${mib(item.bytes)} |`), "",
];
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownPath, lines.join("\n"));

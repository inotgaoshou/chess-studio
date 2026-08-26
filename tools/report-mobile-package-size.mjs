#!/usr/bin/env node
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1]?.startsWith("--") ? "" : process.argv[index + 1];
  args.set(key, value ?? "");
  if (value) index += 1;
}

const cwd = process.cwd();
const distDir = path.resolve(cwd, args.get("--dist") ?? "apps/desktop/dist");
const androidDir = path.resolve(cwd, args.get("--android") ?? "apps/desktop/android");
const iosDir = path.resolve(cwd, args.get("--ios") ?? "apps/desktop/ios");
const outJson = path.resolve(cwd, args.get("--out-json") ?? "mobile-package-size-report.json");
const outMd = path.resolve(cwd, args.get("--out-md") ?? "mobile-package-size-report.md");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, dir = root) {
  if (!await exists(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({ path: path.relative(root, absolute).replaceAll(path.sep, "/"), absolute, bytes: info.size });
    }
  }
  return files;
}

async function artifactDirectories(root, dir = root) {
  if (!await exists(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (/\.(app|xcarchive)$/i.test(entry.name)) {
      const files = await walk(absolute);
      directories.push({
        path: path.relative(root, absolute).replaceAll(path.sep, "/"),
        absolute,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      });
      continue;
    }
    directories.push(...await artifactDirectories(root, absolute));
  }
  return directories;
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function classifyDist(file) {
  if (file.path.startsWith("assets/")) return "web-assets";
  if (file.path.startsWith("wasm/") || file.path.includes("web_core")) return "wasm";
  if (file.path.startsWith("skins/")) return "skins";
  if (file.path.startsWith("icons/") || file.path.endsWith(".webmanifest") || file.path === "sw.js") return "pwa-shell";
  if (file.path.startsWith("manual/")) return "user-manual";
  return "other-web";
}

function summarize(files, classifier) {
  const categories = new Map();
  for (const file of files) {
    const category = classifier(file);
    categories.set(category, (categories.get(category) ?? 0) + file.bytes);
  }
  return [...categories.entries()]
    .map(([name, bytes]) => ({ name, bytes, mib: Number((bytes / 1024 / 1024).toFixed(2)) }))
    .sort((left, right) => right.bytes - left.bytes);
}

const distFiles = await walk(distDir);
const androidArtifacts = (await walk(androidDir))
  .filter((file) => /\.(apk|aab)$/i.test(file.path))
  .map((file) => ({ path: `android/${file.path}`, bytes: file.bytes, mib: Number((file.bytes / 1024 / 1024).toFixed(2)) }));
const iosArtifacts = (await walk(iosDir))
  .filter((file) => /\.ipa$/i.test(file.path))
  .map((file) => ({ path: `ios/${file.path}`, bytes: file.bytes, mib: Number((file.bytes / 1024 / 1024).toFixed(2)) }));
const iosDirectoryArtifacts = (await artifactDirectories(iosDir))
  .map((file) => ({ path: `ios/${file.path}`, bytes: file.bytes, mib: Number((file.bytes / 1024 / 1024).toFixed(2)) }));

const totalDistBytes = distFiles.reduce((sum, file) => sum + file.bytes, 0);
const largestDistFiles = [...distFiles]
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 20)
  .map((file) => ({ path: file.path, bytes: file.bytes, mib: Number((file.bytes / 1024 / 1024).toFixed(2)) }));

const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    mobileShell: "Capacitor",
    localEngineBundled: false,
    nnueBundled: false,
    yoloBundled: false,
    desktopWindowAutomationBundled: false,
  },
  dist: {
    path: path.relative(cwd, distDir) || ".",
    fileCount: distFiles.length,
    bytes: totalDistBytes,
    mib: Number((totalDistBytes / 1024 / 1024).toFixed(2)),
    categories: summarize(distFiles, classifyDist),
    largestFiles: largestDistFiles,
  },
  artifacts: {
    android: androidArtifacts,
    ios: [...iosArtifacts, ...iosDirectoryArtifacts].sort((left, right) => right.bytes - left.bytes),
  },
};

const markdown = [
  "# Mobile package size report",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Policy",
  "",
  "- Mobile shell: Capacitor",
  "- Local Pikafish/NNUE: not bundled",
  "- YOLO/link-vision model: not bundled",
  "- Desktop screenshot/window automation: not bundled",
  "",
  "## Web payload",
  "",
  `- Path: \`${report.dist.path}\``,
  `- Files: ${report.dist.fileCount}`,
  `- Total: ${formatMiB(report.dist.bytes)}`,
  "",
  "| Category | Size |",
  "| --- | ---: |",
  ...report.dist.categories.map((category) => `| ${category.name} | ${formatMiB(category.bytes)} |`),
  "",
  "## Largest web payload files",
  "",
  "| File | Size |",
  "| --- | ---: |",
  ...report.dist.largestFiles.map((file) => `| \`${file.path}\` | ${formatMiB(file.bytes)} |`),
  "",
  "## Native artifacts",
  "",
  ...(androidArtifacts.length
    ? ["### Android", "", "| File | Size |", "| --- | ---: |", ...androidArtifacts.map((file) => `| \`${file.path}\` | ${formatMiB(file.bytes)} |`), ""]
    : ["- Android APK/AAB not found yet.", ""]),
  ...(report.artifacts.ios.length
    ? ["### iOS", "", "| File | Size |", "| --- | ---: |", ...report.artifacts.ios.map((file) => `| \`${file.path}\` | ${formatMiB(file.bytes)} |`), ""]
    : ["- iOS IPA/archive not found yet.", ""]),
].join("\n");

await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(outMd, markdown);
console.log(`Mobile package size report written: ${outJson}`);
console.log(`Mobile package size summary written: ${outMd}`);

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = process.argv[2] ?? "/Users/chenyubin/Documents/chess/皮肤";
const outputRoot = path.join(repoRoot, "apps/endgame-training/public/skins");
const catalogPath = path.join(repoRoot, "apps/endgame-training/src/skinCatalog.ts");
const statusPath = path.join(sourceRoot, "SKIN_STATUS.md");

const requiredFiles = [
  "board.png",
  "rk.png", "ra.png", "rb.png", "rn.png", "rr.png", "rc.png", "rp.png",
  "bk.png", "ba.png", "bb.png", "bn.png", "br.png", "bc.png", "bp.png",
];
const optionalFiles = ["mask.png", "mask2.png", "board-river-blank.png"];
const expectedDimensions = {
  "board.png": [1120, 1240],
  "board-river-blank.png": [1120, 1240],
  "rk.png": [120, 120],
  "ra.png": [120, 120],
  "rb.png": [120, 120],
  "rn.png": [120, 120],
  "rr.png": [120, 120],
  "rc.png": [120, 120],
  "rp.png": [120, 120],
  "bk.png": [120, 120],
  "ba.png": [120, 120],
  "bb.png": [120, 120],
  "bn.png": [120, 120],
  "br.png": [120, 120],
  "bc.png": [120, 120],
  "bp.png": [120, 120],
};
const disabledSkins = [
  { pattern: /01[-_]?玄曜黑金/i, reason: "移动端棋子辨识度不足，暂不进入 App 列表" },
  { pattern: /02[-_]?汝窑青瓷/i, reason: "红框标注低辨识度，暂不进入 App 列表" },
  { pattern: /02[-_]?月白竹影/i, reason: "红框标注低辨识度，暂不进入 App 列表" },
  { pattern: /03[-_]?寒霜冰晶/i, reason: "红框标注低辨识度，暂不进入 App 列表" },
  { pattern: /04[-_]?云山水墨/i, reason: "红框标注低辨识度，暂不进入 App 列表" },
];
const titleOverrides = new Map([
  ["02_obsidian_neon.zip", "曜石"],
  ["04_clean_competitive.zip", "竞技"],
  ["07_cyber_ink.zip", "赛博"],
  ["08_celadon_ceramic.zip", "青瓷"],
  ["10_carbon_fiber.zip", "碳纤"],
  ["21-枫木经典.zip", "枫木"],
  ["方案1－国风金丝楠木.zip", "金丝楠"],
  ["方案2－黑金竞技.zip", "黑金"],
  ["方案6－青铜古战场.zip", "青铜"],
  ["方案9－紫金夜战.zip", "紫金"],
]);
const appSkinGroups = new Set(["919-3d/2d", "919-3d/3d"]);
const defaultSkin = {
  id: "qingxin-zhuyun",
  name: "清新竹韵",
  source: "folder",
  supportsCustomRiverText: false,
};

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function skinIdFor(name, sourcePath) {
  if (/清新竹韵/.test(name) && !/3D| 2|2\.zip/.test(name)) return "qingxin-zhuyun";
  if (/默认/.test(name) && !/\.zip$/.test(sourcePath)) return "default";
  return `skin-${hash(sourcePath)}`;
}

function titleFor(fileName) {
  if (titleOverrides.has(fileName)) return titleOverrides.get(fileName);
  if (/^方案10－清新竹韵/.test(fileName)) return "竹韵";
  if (/清新竹韵/.test(fileName) && !/3D| 2|2\.zip/.test(fileName)) return "清新竹韵";
  return fileName.replace(/\.zip$/i, "").replace(/^xiangqi-assets-style-/i, "风格 ");
}

function listDirectories(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "__MACOSX" && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name));
}

function listZipFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))
    .map((entry) => path.join(root, entry.name));
}

function listPreviewImages(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name));
}

function disabledReasonFor(name, sourcePath) {
  const value = `${name} ${sourcePath}`;
  return disabledSkins.find((skin) => skin.pattern.test(value))?.reason;
}

function isAppSkinCandidate(candidate) {
  return appSkinGroups.has(candidate.group);
}

function hasRequiredFiles(directory) {
  return requiredFiles.every((file) => fs.existsSync(path.join(directory, file)));
}

function findSkinRoot(root) {
  if (hasRequiredFiles(root)) return root;
  const queue = listDirectories(root);
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (hasRequiredFiles(current)) return current;
    queue.push(...listDirectories(current));
  }
  return undefined;
}

function imageSize(filePath) {
  const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { encoding: "utf8" });
  const width = Number(output.match(/pixelWidth:\s+(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s+(\d+)/)?.[1]);
  return [width, height];
}

function validateSkin(directory) {
  for (const file of requiredFiles) {
    const target = path.join(directory, file);
    const [actualWidth, actualHeight] = imageSize(target);
    const [expectedWidth, expectedHeight] = expectedDimensions[file];
    if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
      throw new Error(`${file} 尺寸 ${actualWidth}×${actualHeight}，期望 ${expectedWidth}×${expectedHeight}`);
    }
  }
  if (fs.existsSync(path.join(directory, "board-river-blank.png"))) {
    const [actualWidth, actualHeight] = imageSize(path.join(directory, "board-river-blank.png"));
    const [expectedWidth, expectedHeight] = expectedDimensions["board-river-blank.png"];
    if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
      throw new Error(`board-river-blank.png 尺寸 ${actualWidth}×${actualHeight}，期望 ${expectedWidth}×${expectedHeight}`);
    }
  }
}

function removeDirectory(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copySkin(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const file of [...requiredFiles, ...optionalFiles]) {
    const source = path.join(sourceDirectory, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDirectory, file));
  }
}

function unpackZip(zipPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-skin-"));
  execFileSync("unzip", ["-qq", zipPath, "-d", tempRoot]);
  return tempRoot;
}

function collectCandidates() {
  const nested3dRoot = path.join(sourceRoot, "919-3d");
  const nested2dRoot = path.join(nested3dRoot, "2d");
  const nested3dZipRoot = path.join(nested3dRoot, "3d");
  const directFolders = listDirectories(sourceRoot)
    .filter((sourcePath) => path.basename(sourcePath) !== "919-3d")
    .map((sourcePath) => ({
    sourcePath,
    name: path.basename(sourcePath),
    kind: "folder",
  }));
  const zips = listZipFiles(sourceRoot).map((sourcePath) => ({
    sourcePath,
    name: path.basename(sourcePath),
    kind: "zip",
  }));
  const nested2dZips = fs.existsSync(nested2dRoot) ? listZipFiles(nested2dRoot).map((sourcePath) => ({
    sourcePath,
    name: path.basename(sourcePath),
    kind: "zip",
    group: "919-3d/2d",
  })) : [];
  const nested3dZips = fs.existsSync(nested3dZipRoot) ? listZipFiles(nested3dZipRoot).map((sourcePath) => ({
    sourcePath,
    name: path.basename(sourcePath),
    kind: "zip",
    group: "919-3d/3d",
  })) : [];
  return [...nested2dZips, ...directFolders, ...zips, ...nested3dZips].sort((left, right) => {
    const leftRank = left.group === "919-3d/2d" ? 0 : 1;
    const rightRank = right.group === "919-3d/2d" ? 0 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

function writeCatalog(items) {
  const catalogItems = [defaultSkin, ...items.filter((item) => item.id !== defaultSkin.id)];
  const body = `export type SkinCatalogItem = {
  id: string;
  name: string;
  source: "folder" | "zip";
  supportsCustomRiverText: boolean;
  group?: "2d" | "3d";
};

export const DEFAULT_SKIN_ID = ${JSON.stringify(defaultSkin.id)};
export const LEGACY_DEFAULT_SKIN_ID = "skin-bb439484";

export const SKIN_CATALOG = ${JSON.stringify(catalogItems, null, 2)} as const satisfies readonly SkinCatalogItem[];

export function normalizeSkinId(value: string | null | undefined) {
  return SKIN_CATALOG.some((skin) => skin.id === value) ? value as string : DEFAULT_SKIN_ID;
}

export function skinById(value: string | null | undefined) {
  const id = normalizeSkinId(value);
  return SKIN_CATALOG.find((skin) => skin.id === id) ?? SKIN_CATALOG[0];
}
`;
  fs.writeFileSync(catalogPath, body);
}

function ensureDefaultSkin(statusRecords) {
  const defaultSource = path.join(sourceRoot, "清新竹韵");
  const defaultTarget = path.join(outputRoot, defaultSkin.id);
  try {
    if (hasRequiredFiles(defaultTarget)) {
      validateSkin(defaultTarget);
    } else {
      const skinRoot = findSkinRoot(defaultSource);
      if (!skinRoot) throw new Error("缺少完整 board.png 和 14 个棋子文件");
      validateSkin(skinRoot);
      removeDirectory(defaultTarget);
      copySkin(skinRoot, defaultTarget);
    }
    statusRecords.push({
      name: defaultSkin.name,
      source: path.relative(sourceRoot, fs.existsSync(defaultTarget) ? defaultTarget : defaultSource),
      status: "已接入",
      reason: `默认皮肤；App ID：${defaultSkin.id}${fs.existsSync(path.join(defaultTarget, "board-river-blank.png")) ? "；支持河界覆盖" : ""}`,
    });
    console.log(`ok default ${defaultSkin.name} -> ${defaultSkin.id}`);
  } catch (error) {
    statusRecords.push({
      name: defaultSkin.name,
      source: path.relative(sourceRoot, defaultSource),
      status: "跳过",
      reason: `默认皮肤不可用：${error instanceof Error ? error.message : String(error)}`,
    });
    console.log(`skip default ${defaultSkin.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeStatus(records) {
  const connected = records.filter((record) => record.status === "已接入");
  const disabled = records.filter((record) => record.status === "暂不使用");
  const hidden = records.filter((record) => record.status === "暂不展示");
  const skipped = records.filter((record) => record.status === "跳过" || record.status === "待补全");
  const lines = [
    "# 棋析皮肤资源状态",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "说明：本文件只标识电脑素材目录状态，不移动、不删除原始资源。App 实际可选皮肤以移动端 catalog 为准。",
    "",
    "## 已接入 App",
    "",
    ...tableFor(connected),
    "",
    "## 暂不使用",
    "",
    ...tableFor(disabled),
    "",
    "## 暂不展示",
    "",
    ...tableFor(hidden),
    "",
    "## 待补全 / 跳过",
    "",
    ...tableFor(skipped),
    "",
  ];
  fs.writeFileSync(statusPath, `${lines.join("\n")}\n`);
}

function tableFor(records) {
  if (!records.length) return ["无"];
  return [
    "| 名称 | 来源 | 状态 | 原因 |",
    "|---|---|---|---|",
    ...records.map((record) => `| ${escapeTable(record.name)} | ${escapeTable(record.source)} | ${record.status} | ${escapeTable(record.reason)} |`),
  ];
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|");
}

fs.mkdirSync(outputRoot, { recursive: true });

const catalog = [];
const statusRecords = [];
const seenIds = new Set();
ensureDefaultSkin(statusRecords);
const candidates = collectCandidates();
const selected2dNames = new Set(candidates.filter((candidate) => candidate.group === "919-3d/2d").map((candidate) => candidate.name));
for (const preview of listPreviewImages(path.join(sourceRoot, "919-3d"))) {
  statusRecords.push({
    name: path.basename(preview),
    source: path.relative(sourceRoot, preview),
    status: "跳过",
    reason: "3D 同名预览图，仅作电脑目录参考，不作为 App 皮肤资源",
  });
}
for (const candidate of candidates) {
  let tempRoot;
  try {
    const disabledReason = disabledReasonFor(candidate.name, candidate.sourcePath);
    if (disabledReason) {
      statusRecords.push({
        name: titleFor(candidate.name),
        source: path.relative(sourceRoot, candidate.sourcePath),
        status: "暂不使用",
        reason: disabledReason,
      });
      console.log(`disabled ${candidate.name}: ${disabledReason}`);
      continue;
    }
    if (candidate.group !== "919-3d/2d" && selected2dNames.has(candidate.name)) {
      statusRecords.push({
        name: titleFor(candidate.name),
        source: path.relative(sourceRoot, candidate.sourcePath),
        status: "暂不展示",
        reason: "同名精选皮肤已复制到 919-3d/2d，App 使用 2d 目录版本",
      });
      console.log(`hidden ${candidate.name}: 同名精选皮肤已在 919-3d/2d`);
      continue;
    }
    if (!isAppSkinCandidate(candidate)) {
      statusRecords.push({
        name: titleFor(candidate.name),
        source: path.relative(sourceRoot, candidate.sourcePath),
        status: "暂不展示",
        reason: "移动端当前只使用 919-3d/2d 和 919-3d/3d 目录中的 10 个整套皮肤",
      });
      console.log(`hidden ${candidate.name}: 非 919-3d/2d 或 919-3d/3d 皮肤`);
      continue;
    }
    const root = candidate.kind === "zip" ? (tempRoot = unpackZip(candidate.sourcePath)) : candidate.sourcePath;
    const skinRoot = findSkinRoot(root);
    if (!skinRoot) {
      statusRecords.push({
        name: titleFor(candidate.name),
        source: path.relative(sourceRoot, candidate.sourcePath),
        status: "待补全",
        reason: "缺少完整 board.png 和 14 个棋子文件",
      });
      console.log(`skip ${candidate.name}: 缺少完整棋盘/棋子文件`);
      continue;
    }
    validateSkin(skinRoot);
    let id = skinIdFor(candidate.name, candidate.sourcePath);
    if (seenIds.has(id)) id = `skin-${hash(`${candidate.sourcePath}:${candidate.kind}`)}`;
    seenIds.add(id);
    const target = path.join(outputRoot, id);
    const existingRiverBlank = path.join(target, "board-river-blank.png");
    let preservedRiverBlank;
    if (!fs.existsSync(path.join(skinRoot, "board-river-blank.png")) && fs.existsSync(existingRiverBlank)) {
      preservedRiverBlank = path.join(os.tmpdir(), `xiangqi-river-blank-${id}-${hash(existingRiverBlank)}.png`);
      fs.copyFileSync(existingRiverBlank, preservedRiverBlank);
    }
    removeDirectory(target);
    copySkin(skinRoot, target);
    if (preservedRiverBlank) {
      fs.copyFileSync(preservedRiverBlank, path.join(target, "board-river-blank.png"));
      fs.rmSync(preservedRiverBlank, { force: true });
    }
    const supportsCustomRiverText = fs.existsSync(path.join(target, "board-river-blank.png"));
    catalog.push({
      id,
      name: titleFor(candidate.name),
      source: candidate.kind,
      supportsCustomRiverText,
      group: candidate.group === "919-3d/3d" ? "3d" : candidate.group === "919-3d/2d" ? "2d" : undefined,
    });
    statusRecords.push({
      name: titleFor(candidate.name),
      source: path.relative(sourceRoot, candidate.sourcePath),
      status: "已接入",
      reason: `App ID：${id}${supportsCustomRiverText ? "；支持河界覆盖" : ""}`,
    });
    console.log(`ok ${candidate.name} -> ${id}${supportsCustomRiverText ? " river-blank" : ""}`);
  } catch (error) {
    statusRecords.push({
      name: titleFor(candidate.name),
      source: path.relative(sourceRoot, candidate.sourcePath),
      status: "跳过",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.log(`skip ${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempRoot) removeDirectory(tempRoot);
  }
}

if (!catalog.length) {
  throw new Error("未生成任何可用皮肤");
}

catalog.sort((left, right) => {
  if (left.id === "qingxin-zhuyun") return -1;
  if (right.id === "qingxin-zhuyun") return 1;
  if (left.id === "default") return -1;
  if (right.id === "default") return 1;
  return left.name.localeCompare(right.name, "zh-Hans-CN");
});
writeCatalog(catalog);
writeStatus(statusRecords);
console.log(`generated ${catalog.length} skins`);
console.log(`wrote ${statusPath}`);

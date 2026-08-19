#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultInDir = resolve(repoRoot, ".theory-work", "master-style");
const defaultOutDir = resolve(repoRoot, "apps", "desktop", "src-tauri", "resources", "master-style");
const defaultPlayers = ["赵鑫鑫", "许银川", "王天一", "郑惟桐"];

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeName(value) {
  return String(value ?? "").replace(/[\s\u3000]+/g, "");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

async function main() {
  const inDir = resolve(argValue("in-dir", defaultInDir));
  const outDir = resolve(argValue("out-dir", defaultOutDir));
  const players = argValue("players", defaultPlayers.join(","))
    .split(",")
    .map(normalizeName)
    .filter(Boolean);
  const playerSet = new Set(players);

  const profilesPath = resolve(inDir, "master-style-profiles.json");
  const samplesPath = resolve(inDir, "master-style-samples.jsonl");
  const analysisPath = resolve(inDir, "master-style-analysis.jsonl");

  const profiles = (await readJson(profilesPath)).filter((profile) =>
    playerSet.has(normalizeName(profile.normalizedName ?? profile.playerName)),
  );
  const profileNames = new Set(profiles.map((profile) => normalizeName(profile.normalizedName ?? profile.playerName)));
  const samples = (await readJsonl(samplesPath)).filter((sample) =>
    profileNames.has(normalizeName(sample.playerName)),
  );
  const sampleIds = new Set(samples.map((sample) => String(sample.sampleId)));
  const analysis = (await readJsonl(analysisPath)).filter((row) => sampleIds.has(String(row.sampleId)));

  if (profiles.length !== players.length) {
    const found = profiles.map((profile) => profile.playerName).join(", ");
    throw new Error(`种子画像数量不对：期望 ${players.length}，实际 ${profiles.length}（${found}）`);
  }
  for (const player of players) {
    const sampleCount = samples.filter((sample) => normalizeName(sample.playerName) === player).length;
    if (sampleCount === 0) {
      throw new Error(`缺少 ${player} 的风格样本`);
    }
  }

  await mkdir(outDir, { recursive: true });
  const profilesText = JSON.stringify(profiles, null, 2) + "\n";
  const samplesText = toJsonl(samples);
  const analysisText = toJsonl(analysis);
  const files = {
    "master-style-profiles.json": profilesText,
    "master-style-samples.jsonl": samplesText,
    "master-style-analysis.jsonl": analysisText,
  };

  const byPlayer = {};
  for (const player of players) {
    const playerAnalysis = analysis.filter((row) => normalizeName(row.playerName ?? row.player) === player);
    byPlayer[player] = {
      samples: samples.filter((sample) => normalizeName(sample.playerName) === player).length,
      analyzed: playerAnalysis.filter((row) => !row.analysisError).length,
      analysisRows: playerAnalysis.length,
      errors: playerAnalysis.filter((row) => row.analysisError).length,
    };
  }

  const fileDigests = Object.fromEntries(
    Object.entries(files).map(([name, contents]) => [name, `sha256:${sha256Text(contents)}`]),
  );
  const seedId = sha256Text(JSON.stringify({ players, byPlayer, fileDigests })).slice(0, 24);
  const manifest = {
    schemaVersion: 1,
    seedId,
    generatedAt: new Date().toISOString(),
    description: "公开棋谱结构化样本，仅用于本地学习与大师风格启发；不包含用户个人棋谱、反馈、训练记录或原始网页 HTML。",
    players,
    byPlayer,
    files: fileDigests,
  };

  for (const [name, contents] of Object.entries(files)) {
    await writeFile(resolve(outDir, name), contents);
  }
  await writeFile(resolve(outDir, "seed-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    resolve(outDir, "README.md"),
    [
      "# Master style seed",
      "",
      "This bundled seed contains public-game-derived master style profiles and samples for local, offline study hints.",
      "",
      "- It is system seed data, not user personal data.",
      "- It does not include raw website HTML or private game records.",
      "- User games, reports, feedback, favorites, and training history remain in the user's local app SQLite and backups.",
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify({
    outDir,
    seedId,
    profiles: profiles.map((profile) => profile.playerName),
    samples: samples.length,
    analyzed: analysis.filter((row) => !row.analysisError).length,
    analysisRows: analysis.length,
    byPlayer,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultInDir = resolve(repoRoot, ".theory-work", "master-style");
const defaultSqlite = "/Users/chenyubin/Library/Application Support/cn.xiangqi.studio/xiangqi.sqlite3";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeName(value) {
  return String(value ?? "").replace(/[\s\u3000]+/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : "NULL";
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
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

function sqlite(sqlText, sqlitePath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("sqlite3", [sqlitePath], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(stderr.trim() || `sqlite3 exited ${code}`));
    });
    child.stdin.end(sqlText);
  });
}

function schemaSql() {
  return `
CREATE TABLE IF NOT EXISTS master_style_profiles (
  id TEXT PRIMARY KEY, player_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  version TEXT NOT NULL, sample_count INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL, profile_json TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_master_style_profiles_name ON master_style_profiles(normalized_name, imported_at DESC);
CREATE TABLE IF NOT EXISTS master_style_samples (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, player_name TEXT NOT NULL,
  source_game_id TEXT NOT NULL, source_title TEXT NOT NULL,
  event_name TEXT, game_date TEXT, ply INTEGER NOT NULL,
  phase TEXT NOT NULL, before_fen TEXT NOT NULL, played_move TEXT NOT NULL,
  played_move_rank INTEGER, played_move_in_topn INTEGER NOT NULL DEFAULT 0,
  best_move TEXT, best_score_cp INTEGER,
  candidates_json TEXT NOT NULL DEFAULT '[]', source_json TEXT NOT NULL DEFAULT '{}',
  imported_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_master_style_samples_fen ON master_style_samples(before_fen, profile_id);
CREATE INDEX IF NOT EXISTS idx_master_style_samples_phase_move ON master_style_samples(phase, played_move, profile_id);
CREATE TABLE IF NOT EXISTS master_style_matches (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, report_signature TEXT NOT NULL,
  node_id TEXT NOT NULL, profile_id TEXT NOT NULL, sample_id TEXT NOT NULL,
  confidence TEXT NOT NULL, reason TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'unreviewed',
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  UNIQUE(game_id, report_signature, node_id, profile_id, sample_id),
  FOREIGN KEY(profile_id) REFERENCES master_style_profiles(id),
  FOREIGN KEY(sample_id) REFERENCES master_style_samples(id)
);
CREATE INDEX IF NOT EXISTS idx_master_style_matches_node ON master_style_matches(game_id, node_id, created_at DESC);
`;
}

async function main() {
  const inDir = resolve(argValue("in-dir", defaultInDir));
  const sqlitePath = argValue("sqlite", defaultSqlite);
  const players = new Set(argValue("players", "赵鑫鑫").split(",").map(normalizeName).filter(Boolean));
  const profilesPath = resolve(inDir, "master-style-profiles.json");
  const samplesPath = resolve(inDir, "master-style-samples.jsonl");
  const analysisPath = resolve(inDir, "master-style-analysis.jsonl");
  const profiles = await readJson(profilesPath, []);
  const samples = await readJsonl(samplesPath);
  const analysisRows = await readJsonl(analysisPath);
  const analysisBySampleId = new Map(analysisRows.map((row) => [String(row.sampleId), row]));
  const selectedProfiles = profiles.filter((profile) => players.has(normalizeName(profile.normalizedName ?? profile.playerName)));
  const profileByName = new Map(selectedProfiles.map((profile) => [normalizeName(profile.normalizedName ?? profile.playerName), profile]));
  const selectedSamples = samples.filter((sample) => profileByName.has(normalizeName(sample.playerName)));
  const now = new Date().toISOString();
  const sqlLines = ["PRAGMA foreign_keys=ON;", "BEGIN;", schemaSql()];
  for (const profile of selectedProfiles) {
    const normalized = normalizeName(profile.normalizedName ?? profile.playerName);
    const profileId = profile.profileId ?? profile.id ?? sha256(`master-style-profile|${normalized}`).slice(0, 16);
    const profileSamples = selectedSamples.filter((sample) => normalizeName(sample.playerName) === normalized);
    sqlLines.push(`
INSERT INTO master_style_profiles
(id, player_name, normalized_name, version, sample_count, generated_at, profile_json, imported_at)
VALUES (${sql(profileId)}, ${sql(profile.playerName)}, ${sql(normalized)}, 'master-style-training-v1',
        ${profileSamples.length}, ${sql(profile.generatedAt ?? now)}, ${sql(JSON.stringify(profile))}, ${sql(now)})
ON CONFLICT(id) DO UPDATE SET
  player_name=excluded.player_name,
  normalized_name=excluded.normalized_name,
  version=excluded.version,
  sample_count=excluded.sample_count,
  generated_at=excluded.generated_at,
  profile_json=excluded.profile_json,
  imported_at=excluded.imported_at;`);
    for (const sample of profileSamples) {
      const rawSampleId = String(sample.sampleId ?? `${sample.gameId}#${sample.ply}`);
      const sampleId = sha256(`master-style-sample|${profileId}|${rawSampleId}`).slice(0, 24);
      const analysis = analysisBySampleId.get(rawSampleId);
      const candidates = analysis?.candidates ?? [];
      const source = {
        sample,
        analysis: analysis ?? null,
        licenseNote: "公开棋谱结构化样本，仅用于本地学习与风格启发，不包含原始网页 HTML。",
      };
      sqlLines.push(`
INSERT INTO master_style_samples
(id, profile_id, player_name, source_game_id, source_title, event_name, game_date, ply, phase,
 before_fen, played_move, played_move_rank, played_move_in_topn, best_move, best_score_cp,
 candidates_json, source_json, imported_at)
VALUES (${sql(sampleId)}, ${sql(profileId)}, ${sql(sample.playerName)}, ${sql(sample.gameId ?? "")},
        ${sql(sample.title ?? "赵鑫鑫公开棋谱")}, ${sql(sample.eventName)}, ${sql(sample.gameDate)},
        ${sqlNumber(sample.ply)}, ${sql(sample.phase ?? "middle")}, ${sql(sample.beforeFen ?? "")},
        ${sql(sample.playedMove ?? "")}, ${sqlNumber(analysis?.playedMoveRank)},
        ${analysis?.playedMoveInTopN ? 1 : 0}, ${sql(analysis?.bestMove)}, ${sqlNumber(analysis?.bestScoreCp)},
        ${sql(JSON.stringify(candidates))}, ${sql(JSON.stringify(source))}, ${sql(now)})
ON CONFLICT(id) DO UPDATE SET
  profile_id=excluded.profile_id,
  player_name=excluded.player_name,
  source_game_id=excluded.source_game_id,
  source_title=excluded.source_title,
  event_name=excluded.event_name,
  game_date=excluded.game_date,
  ply=excluded.ply,
  phase=excluded.phase,
  before_fen=excluded.before_fen,
  played_move=excluded.played_move,
  played_move_rank=excluded.played_move_rank,
  played_move_in_topn=excluded.played_move_in_topn,
  best_move=excluded.best_move,
  best_score_cp=excluded.best_score_cp,
  candidates_json=excluded.candidates_json,
  source_json=excluded.source_json,
  imported_at=excluded.imported_at;`);
    }
  }
  sqlLines.push("COMMIT;");
  await sqlite(sqlLines.join("\n"), sqlitePath);
  console.log(JSON.stringify({
    sqlitePath,
    players: selectedProfiles.map((profile) => profile.playerName),
    importedSamples: selectedSamples.length,
    analyzedSamples: selectedSamples.filter((sample) => {
      const analysis = analysisBySampleId.get(String(sample.sampleId));
      return analysis && !analysis.analysisError;
    }).length,
    analysisRows: selectedSamples.filter((sample) => analysisBySampleId.has(String(sample.sampleId))).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

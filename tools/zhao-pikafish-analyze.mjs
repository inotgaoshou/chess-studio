#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultEngine = join(repoRoot, "apps", "desktop", "src-tauri", "resources", "pikafish", "pikafish");
const defaultJobs = join(repoRoot, ".theory-work", "master-style", "master-pikafish-jobs.jsonl");
const defaultOut = join(repoRoot, ".theory-work", "master-style", "master-style-analysis.jsonl");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseInfo(line) {
  if (!line.startsWith("info ")) return undefined;
  const tokens = line.split(/\s+/);
  const depth = Number(tokens[tokens.indexOf("depth") + 1]);
  const multipvIndex = tokens.indexOf("multipv");
  const multipv = multipvIndex >= 0 ? Number(tokens[multipvIndex + 1]) : 1;
  const scoreIndex = tokens.indexOf("score");
  let scoreCp;
  let mate;
  if (scoreIndex >= 0) {
    const kind = tokens[scoreIndex + 1];
    const value = Number(tokens[scoreIndex + 2]);
    if (kind === "cp") scoreCp = value;
    if (kind === "mate") mate = value;
  }
  const pvIndex = tokens.indexOf("pv");
  const pv = pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [];
  if (!pv.length) return undefined;
  return { depth, multipv, scoreCp, mate, pv };
}

class PikafishSession {
  constructor(enginePath) {
    this.process = spawn(enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.buffer = [];
    this.stderr = [];
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        this.buffer.push(line);
      }
    });
    this.process.stderr.on("data", (chunk) => this.stderr.push(chunk));
  }

  send(command) {
    this.process.stdin.write(`${command}\n`);
  }

  async waitFor(predicate, timeoutMs = 30_000) {
    const started = Date.now();
    for (;;) {
      const index = this.buffer.findIndex(predicate);
      if (index >= 0) return this.buffer.splice(0, index + 1);
      if (Date.now() - started > timeoutMs) throw new Error(`Pikafish timeout. stderr=${this.stderr.join("").slice(-500)}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }

  async init({ multipv, threads, hashMb }) {
    this.send("uci");
    await this.waitFor((line) => line === "uciok");
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hashMb}`);
    this.send("isready");
    await this.waitFor((line) => line === "readyok");
  }

  async analyze(job, { depth, timeoutMs }) {
    this.buffer.length = 0;
    this.send(`position fen ${job.beforeFen}`);
    this.send(`go depth ${depth}`);
    const lines = await this.waitFor((line) => line.startsWith("bestmove "), timeoutMs);
    const byPv = new Map();
    for (const line of lines) {
      const info = parseInfo(line);
      if (!info) continue;
      const existing = byPv.get(info.multipv);
      if (!existing || (info.depth ?? 0) >= (existing.depth ?? 0)) byPv.set(info.multipv, info);
    }
    const candidates = [...byPv.values()].sort((left, right) => left.multipv - right.multipv);
    const topRank = candidates.find((candidate) => candidate.pv[0] === job.playedMove)?.multipv ?? null;
    return {
      ...job,
      analyzedAt: new Date().toISOString(),
      depth,
      candidates,
      playedMoveRank: topRank,
      playedMoveInTopN: topRank != null,
      bestMove: candidates[0]?.pv[0],
      bestScoreCp: candidates[0]?.scoreCp,
    };
  }

  close() {
    this.send("quit");
  }
}

async function main() {
  const jobsPath = resolve(argValue("jobs", defaultJobs));
  const outPath = resolve(argValue("out", defaultOut));
  const enginePath = resolve(argValue("engine", defaultEngine));
  const depth = Number(argValue("depth", "24"));
  const multipv = Number(argValue("multipv", "5"));
  const threads = Number(argValue("threads", "2"));
  const hashMb = Number(argValue("hash", "128"));
  const limit = Number(argValue("limit", "20"));
  const timeoutMs = Number(argValue("timeout-ms", "60000"));
  const resume = hasFlag("resume");
  const continueOnError = hasFlag("continue-on-error");
  const existingRows = resume && existsSync(outPath) ? await readJsonl(outPath) : [];
  const existingKeys = new Set(existingRows.map((row) => String(row.jobId ?? row.sampleId ?? `${row.gameId}#${row.ply}`)));
  const allJobs = await readJsonl(jobsPath);
  const selectedJobs = allJobs.slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  const jobs = resume
    ? selectedJobs.filter((job) => !existingKeys.has(String(job.jobId ?? job.sampleId ?? `${job.gameId}#${job.ply}`)))
    : selectedJobs;
  await mkdir(dirname(outPath), { recursive: true });
  const session = new PikafishSession(enginePath);
  const rows = [];
  try {
    await session.init({ multipv, threads, hashMb });
    for (const [index, job] of jobs.entries()) {
      console.log(`[${index + 1}/${jobs.length}] ${job.phase} ${job.playedMove}`);
      try {
        rows.push(await session.analyze(job, { depth, timeoutMs }));
      } catch (error) {
        if (!continueOnError) throw error;
        console.error(`[warn] skipped ${job.jobId ?? job.sampleId ?? `${job.gameId}#${job.ply}`}: ${error.message}`);
        rows.push({
          ...job,
          analyzedAt: new Date().toISOString(),
          depth,
          candidates: [],
          playedMoveRank: null,
          playedMoveInTopN: false,
          bestMove: null,
          bestScoreCp: null,
          analysisError: error.message,
        });
      }
      const partialRows = resume ? [...existingRows, ...rows] : rows;
      await writeFile(outPath, `${partialRows.map((row) => JSON.stringify(row)).join("\n")}${partialRows.length ? "\n" : ""}`);
    }
  } finally {
    session.close();
  }
  const outputRows = resume ? [...existingRows, ...rows] : rows;
  await writeFile(outPath, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}${outputRows.length ? "\n" : ""}`);
  const topN = outputRows.filter((row) => row.playedMoveInTopN).length;
  console.log(`Analyzed ${rows.length} new master style jobs (${outputRows.length} total). Played move in MultiPV: ${topN}/${outputRows.length}.`);
  console.log(`Output: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

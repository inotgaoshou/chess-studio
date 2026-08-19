#!/usr/bin/env node
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const sources = [
  ["opening", "赵鑫鑫布局棋理48讲", "/Users/chenyubin/Desktop/象棋学习/01赵鑫鑫布局棋理48讲"],
  ["middle", "赵鑫鑫中局棋理48讲", "/Users/chenyubin/Desktop/象棋学习/02赵鑫鑫中局棋理48讲"],
  ["endgame", "赵鑫鑫残局棋理48讲", "/Users/chenyubin/Desktop/象棋学习/03赵鑫鑫残局棋理48讲"],
];
const coreTerms = ["原则", "出车", "横车", "直车", "线路", "要道", "谋势", "车路", "肋道", "三七线", "以多打少", "兵种", "将位", "牵制", "拦截", "等招", "谋和"];
const workDir = process.env.THEORY_WORK_DIR ?? "/private/tmp/xiangqi-theory-distill";
const whisperCli = process.env.WHISPER_CLI ?? "/opt/homebrew/bin/whisper-cli";
const whisperModel = process.env.WHISPER_MODEL ?? "../../.theory-work/models/ggml-large-v3.bin";
const ffmpegCli = process.env.FFMPEG_CLI ?? "ffmpeg";
const shouldTranscribe = process.argv.includes("--transcribe");
const shouldForce = process.argv.includes("--force");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const lessonLimit = limitArgument ? Number(limitArgument.slice("--limit=".length)) : Number.POSITIVE_INFINITY;
const chunkMinutesArgument = process.argv.find((argument) => argument.startsWith("--chunk-minutes="));
const chunkSeconds = Math.max(60, Math.round(Number(chunkMinutesArgument?.slice("--chunk-minutes=".length) ?? 5) * 60));
const whisperThreads = process.env.WHISPER_THREADS ?? "4";

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  return nested.flat();
}

function lessonTitle(path) {
  return basename(path, extname(path)).replace(/^\d+(?:-\d+)?\s*/, "").trim();
}

async function hasTranscript(outputBase) {
  try {
    return (await stat(`${outputBase}.json`)).size > 0;
  } catch {
    return false;
  }
}

function probeDuration(sourcePath) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath], { encoding: "utf8" });
  const duration = Number(probe.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration) : 0;
}

function timestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const ms = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function mergeChunks(chunkBases, outputBase) {
  const documents = await Promise.all(chunkBases.map(async ({ outputBase: chunkOutputBase, offsetMs }) => ({ offsetMs, document: JSON.parse(await readFile(`${chunkOutputBase}.json`, "utf8")) })));
  const first = documents[0]?.document;
  if (!first) return false;
  const transcription = documents.flatMap(({ offsetMs, document }) => (document.transcription ?? []).map((entry) => {
    const from = Number(entry.offsets?.from ?? 0) + offsetMs;
    const to = Number(entry.offsets?.to ?? 0) + offsetMs;
    return { ...entry, timestamps: { from: timestamp(from), to: timestamp(to) }, offsets: { from, to } };
  }));
  await writeFile(`${outputBase}.json`, `${JSON.stringify({ ...first, transcription }, null, 2)}\n`);
  return true;
}

async function main() {
  const lessons = [];
  for (const [phase, courseName, root] of sources) {
    for (const path of await files(root)) {
      if (extname(path).toLowerCase() !== ".mp4") continue;
      const title = lessonTitle(path);
      if (!coreTerms.some((term) => title.includes(term))) continue;
      const info = await stat(path);
      lessons.push({ phase, courseName, title, sourcePath: path, relativePath: relative(root, path), fingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}` });
    }
  }
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "core-lessons.json"), `${JSON.stringify(lessons, null, 2)}\n`);
  await writeFile(join(workDir, "review-template.json"), `${JSON.stringify(lessons.map((lesson) => ({ ...lesson, timecode: "", title: "", summary: "", appliesWhen: "", risk: "", reviewStatus: "pending" })), null, 2)}\n`);
  if (!shouldTranscribe) {
    console.log(`Indexed ${lessons.length} core lessons in ${workDir}. Run 'npm run theory:distill -- --transcribe' to start CPU transcription.`);
    return;
  }
  await access(whisperCli);
  await access(whisperModel);
  const audioDir = join(workDir, "audio");
  await mkdir(audioDir, { recursive: true });
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const queuedLessons = lessons.slice(0, Number.isInteger(lessonLimit) && lessonLimit > 0 ? lessonLimit : lessons.length);
  for (const [index, lesson] of queuedLessons.entries()) {
    const outputBase = join(workDir, lesson.fingerprint.replace(/[^a-zA-Z0-9]/g, "_"));
    if (!shouldForce && await hasTranscript(outputBase)) {
      skipped += 1;
      console.log(`[${index + 1}/${queuedLessons.length}] Already transcribed: ${lesson.title}`);
      continue;
    }
    const durationSeconds = probeDuration(lesson.sourcePath);
    if (!durationSeconds) {
      console.error(`Could not read duration: ${lesson.title}`);
      failed += 1;
      continue;
    }
    const chunkDir = `${outputBase}.chunks`;
    await mkdir(chunkDir, { recursive: true });
    const chunks = Array.from({ length: Math.ceil(durationSeconds / chunkSeconds) }, (_, chunkIndex) => ({
      chunkIndex,
      offsetSeconds: chunkIndex * chunkSeconds,
      durationSeconds: Math.min(chunkSeconds, durationSeconds - chunkIndex * chunkSeconds),
      outputBase: join(chunkDir, String(chunkIndex).padStart(4, "0")),
    }));
    let lessonFailed = false;
    for (const chunk of chunks) {
      if (!shouldForce && await hasTranscript(chunk.outputBase)) {
        console.log(`[${index + 1}/${queuedLessons.length}] ${lesson.title} · segment ${chunk.chunkIndex + 1}/${chunks.length} already completed`);
        continue;
      }
      const audioPath = join(audioDir, `${lesson.fingerprint.replace(/[^a-zA-Z0-9]/g, "_")}-${String(chunk.chunkIndex).padStart(4, "0")}.wav`);
      console.log(`[${index + 1}/${queuedLessons.length}] ${lesson.title} · segment ${chunk.chunkIndex + 1}/${chunks.length}`);
      const extract = spawnSync(ffmpegCli, ["-y", "-i", lesson.sourcePath, "-ss", String(chunk.offsetSeconds), "-t", String(chunk.durationSeconds), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath], { stdio: "inherit" });
      if (extract.status !== 0) {
        console.error(`Audio extraction failed: ${lesson.title}, segment ${chunk.chunkIndex + 1}`);
        lessonFailed = true;
        break;
      }
      const run = spawnSync(whisperCli, ["-ng", "-m", whisperModel, "-f", audioPath, "-l", "zh", "-t", whisperThreads, "-oj", "-of", chunk.outputBase], { stdio: "inherit" });
      await rm(audioPath, { force: true });
      if (run.status !== 0 || !await hasTranscript(chunk.outputBase)) {
        console.error(`Transcription failed: ${lesson.title}, segment ${chunk.chunkIndex + 1}`);
        lessonFailed = true;
        break;
      }
    }
    if (lessonFailed || !await mergeChunks(chunks.map((chunk) => ({ outputBase: chunk.outputBase, offsetMs: chunk.offsetSeconds * 1_000 })), outputBase)) {
      console.error(`Transcription failed: ${lesson.title}`);
      failed += 1;
      continue;
    }
    completed += 1;
  }
  console.log(`Transcription summary: ${completed} completed, ${skipped} already completed, ${failed} failed. Transcripts are local to ${workDir}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

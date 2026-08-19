#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultWorkDir = join(repoRoot, ".theory-work", "qili-pdf");
const phaseLabels = { opening: "开局", middle: "中局", endgame: "残局" };

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function chineseLessonNumber(raw) {
  const normalized = raw.replace(/[了工lI]/g, "1");
  const digits = raw.match(/\d+/);
  if (digits) return Number(digits[0]);
  const numerals = "一二三四五六七八九十";
  const normalizedDigits = normalized.match(/\d+/);
  if (normalizedDigits) return Number(normalizedDigits[0]);
  if (![...normalized].some((char) => numerals.includes(char))) return undefined;
  if (normalized === "十") return 10;
  if (normalized.startsWith("十")) return 10 + numerals.indexOf(normalized[1]) + 1;
  if (normalized.endsWith("十")) return (numerals.indexOf(normalized[0]) + 1) * 10;
  const parts = normalized.split("十");
  if (parts.length === 2) {
    const tens = parts[0] ? numerals.indexOf(parts[0]) + 1 : 1;
    const ones = parts[1] ? numerals.indexOf(parts[1]) + 1 : 0;
    return tens * 10 + ones;
  }
  return numerals.indexOf(normalized[0]) + 1;
}

function detectLesson(text) {
  const compact = text
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .slice(0, 16)
    .join("\n");
  const match = compact.match(/第\s*([0-9一二三四五六七八九十了工lI]+)\s*[讲講]\s*[、:：]?\s*([^\n]{2,40})/);
  if (!match) return undefined;
  return {
    lessonNo: chineseLessonNumber(match[1]),
    lessonTitle: match[2]
      .replace(/[^\u4e00-\u9fffA-Za-z0-9/／、：:（）() -]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 40),
  };
}

function previewFrom(text) {
  return text
    .replace(/^source_.*$/gm, "")
    .replace(/^phase:.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function lessonKey(source, lesson) {
  return [
    source.phase,
    lesson?.lessonNo ?? "unknown",
    lesson?.lessonTitle || "未识别课名",
  ].join(":");
}

async function readPages(workDir, source) {
  const pageDir = join(workDir, "ocr-pages", source.id);
  if (!existsSync(pageDir)) return [];
  const entries = (await readdir(pageDir)).filter((entry) => entry.endsWith(".txt")).sort();
  const pages = [];
  for (const entry of entries) {
    const page = Number(entry.replace(/\.txt$/, ""));
    const text = await readFile(join(pageDir, entry), "utf8");
    pages.push({ page, text });
  }
  return pages;
}

async function main() {
  const workDir = resolve(argValue("work-dir", process.env.QILI_PDF_WORK_DIR ?? defaultWorkDir));
  const manifest = JSON.parse(await readFile(join(workDir, "manifest.json"), "utf8"));
  const outDir = join(workDir, "card-candidates");
  await mkdir(outDir, { recursive: true });
  const jsonl = [];
  const bundles = new Map();
  const markdown = [
    "# 赵鑫鑫棋理三部曲 PDF 原则卡候选",
    "",
    "说明：这里不是最终知识库，只是 OCR 后的待人工确认索引。最终进入应用的只能是短摘要原则卡，不能放入长篇书本文字。",
    "",
  ];

  for (const source of manifest.sources) {
    let currentLesson = undefined;
    const pages = await readPages(workDir, source);
    markdown.push(`## ${source.title}`, "");
    for (const page of pages) {
      const detected = detectLesson(page.text);
      if (detected) currentLesson = detected;
      const candidate = {
        id: `qili-${source.id}-p${String(page.page).padStart(4, "0")}`,
        status: "needs_review",
        phase: source.phase,
        phaseLabel: phaseLabels[source.phase],
        source: {
          label: "赵鑫鑫棋理三部曲",
          book: source.title,
          pageStart: page.page,
          pageEnd: page.page,
          pdf: source.pdf,
        },
        lessonNo: currentLesson?.lessonNo,
        lessonTitle: currentLesson?.lessonTitle,
        principle: "",
        summary: "",
        appliesWhen: "",
        risk: "",
        engineCorrelation: [],
        tags: [],
        ocrPreviewForReview: previewFrom(page.text),
      };
      jsonl.push(JSON.stringify(candidate));
      const key = lessonKey(source, currentLesson);
      const existing = bundles.get(key) ?? {
        id: `qili-${source.id}-lesson-${currentLesson?.lessonNo ?? "unknown"}-${String(bundles.size + 1).padStart(3, "0")}`,
        phase: source.phase,
        phaseLabel: phaseLabels[source.phase],
        source: {
          label: "赵鑫鑫棋理三部曲",
          book: source.title,
          pdf: source.pdf,
          pageStart: page.page,
          pageEnd: page.page,
        },
        lessonNo: currentLesson?.lessonNo,
        lessonTitle: currentLesson?.lessonTitle,
        candidateIds: [],
        reviewHints: [],
      };
      existing.source.pageStart = Math.min(existing.source.pageStart, page.page);
      existing.source.pageEnd = Math.max(existing.source.pageEnd, page.page);
      existing.candidateIds.push(candidate.id);
      if (candidate.ocrPreviewForReview && existing.reviewHints.length < 6) {
        existing.reviewHints.push({
          page: page.page,
          preview: candidate.ocrPreviewForReview,
        });
      }
      bundles.set(key, existing);
      if (detected) markdown.push(`### 第 ${detected.lessonNo ?? "?"} 讲 ${detected.lessonTitle}`, "");
      markdown.push(`- p.${page.page}: ${candidate.ocrPreviewForReview}`);
    }
    markdown.push("");
  }

  await writeFile(join(outDir, "qili-pdf-candidates.jsonl"), `${jsonl.join("\n")}\n`);
  await writeFile(join(outDir, "qili-pdf-candidates.md"), `${markdown.join("\n")}\n`);
  const bundleRecords = [...bundles.values()]
    .filter((bundle) => bundle.reviewHints.length > 0)
    .sort((left, right) => left.phase.localeCompare(right.phase) || left.source.pageStart - right.source.pageStart);
  await writeFile(join(outDir, "qili-pdf-lesson-bundles.jsonl"), `${bundleRecords.map((bundle) => JSON.stringify(bundle)).join("\n")}\n`);
  await writeFile(join(outDir, "qili-pdf-lesson-bundles.md"), `${[
    "# 赵鑫鑫棋理三部曲课级 OCR Bundle",
    "",
    "说明：这是页级 OCR 候选的课/主题聚合，用于按真实棋谱问题反向召回。这里只展示短预览，正式卡仍需人工确认。",
    "",
    ...bundleRecords.flatMap((bundle) => [
      `## ${bundle.phaseLabel} · ${bundle.lessonNo ? `第 ${bundle.lessonNo} 讲 ` : ""}${bundle.lessonTitle ?? "未识别课名"} · p.${bundle.source.pageStart}-${bundle.source.pageEnd}`,
      "",
      ...bundle.reviewHints.map((hint) => `- p.${hint.page}: ${hint.preview}`),
      "",
    ]),
  ].join("\n")}\n`);
  console.log(`Wrote ${jsonl.length} candidate records.`);
  console.log(`JSONL: ${join(outDir, "qili-pdf-candidates.jsonl")}`);
  console.log(`Review: ${join(outDir, "qili-pdf-candidates.md")}`);
  console.log(`Bundles: ${join(outDir, "qili-pdf-lesson-bundles.jsonl")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

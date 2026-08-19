#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultWorkDir = join(repoRoot, ".theory-work", "qili-pdf");
const defaultRenderDir = "/private/tmp/qili-pdf-render";

const sources = [
  {
    id: "opening",
    phase: "opening",
    title: "赵鑫鑫布局棋理48讲",
    pdf: "/Users/chenyubin/Documents/chess/qili/布局棋理48讲 - Bo cuc Ky ly 48 giang.pdf",
  },
  {
    id: "middle",
    phase: "middle",
    title: "赵鑫鑫中局棋理48讲",
    pdf: "/Users/chenyubin/Documents/chess/qili/中局棋理48讲 - Trung cuc Ky ly 48 giang.pdf",
  },
  {
    id: "endgame",
    phase: "endgame",
    title: "赵鑫鑫残局棋理48讲",
    pdf: "/Users/chenyubin/Documents/chess/qili/残局棋理48讲 - Tan cuc Ky ly 48 giang.pdf",
  },
];

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error([`Command failed: ${command} ${args.join(" ")}`, stderr, stdout].filter(Boolean).join("\n"));
  }
  return result;
}

function pdfPageCount(pdfinfo, pdf) {
  const result = run(pdfinfo, [pdf]);
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Could not read page count from pdfinfo output for ${pdf}`);
  return Number(match[1]);
}

function padPage(page) {
  return String(page).padStart(4, "0");
}

async function hasText(path) {
  try {
    return (await stat(path)).size > 20;
  } catch {
    return false;
  }
}

async function renderedPngFor(renderDir, imageBaseName) {
  const entries = await readdir(renderDir);
  const matches = entries
    .filter((entry) => entry.startsWith(`${imageBaseName}-`) && entry.endsWith(".png"))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`Expected one rendered PNG for ${imageBaseName}, found ${matches.length}`);
  }
  return join(renderDir, matches[0]);
}

function cleanOcrText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function selectedSources(book) {
  if (!book || book === "all") return sources;
  const ids = new Set(book.split(",").map((item) => item.trim()).filter(Boolean));
  const selected = sources.filter((source) => ids.has(source.id));
  if (selected.length === 0) {
    throw new Error(`No matching book for --book=${book}. Use one of: all, ${sources.map((source) => source.id).join(", ")}`);
  }
  return selected;
}

async function main() {
  const workDir = resolve(argValue("work-dir", process.env.QILI_PDF_WORK_DIR ?? defaultWorkDir));
  const renderDir = resolve(argValue("render-dir", process.env.QILI_PDF_RENDER_DIR ?? defaultRenderDir));
  const pdfinfo = argValue("pdfinfo", process.env.PDFINFO ?? "/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdfinfo");
  const pdftoppm = argValue("pdftoppm", process.env.PDFTOPPM ?? "/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm");
  const tesseract = argValue("tesseract", process.env.TESSERACT ?? "/opt/homebrew/bin/tesseract");
  const language = argValue("lang", process.env.TESSERACT_LANG ?? "chi_sim+eng");
  const dpi = Number(argValue("dpi", process.env.QILI_OCR_DPI ?? "180"));
  const psm = argValue("psm", process.env.QILI_OCR_PSM ?? "4");
  const from = Number(argValue("from", "1"));
  const toArgument = argValue("to", "");
  const limit = Number(argValue("limit", "0"));
  const force = hasFlag("force");
  const dryRun = hasFlag("dry-run");

  if (!existsSync(pdfinfo)) throw new Error(`pdfinfo not found: ${pdfinfo}`);
  if (!existsSync(pdftoppm)) throw new Error(`pdftoppm not found: ${pdftoppm}`);
  if (!existsSync(tesseract)) throw new Error(`tesseract not found: ${tesseract}`);
  if (!Number.isFinite(dpi) || dpi < 90) throw new Error(`Invalid --dpi=${dpi}`);
  if (!Number.isFinite(from) || from < 1) throw new Error(`Invalid --from=${from}`);

  await mkdir(workDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  await mkdir(join(workDir, "ocr-pages"), { recursive: true });

  const manifest = [];
  for (const source of sources) {
    const pageCount = pdfPageCount(pdfinfo, source.pdf);
    manifest.push({ ...source, pageCount });
  }
  await writeFile(
    join(workDir, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), workDir, sources: manifest }, null, 2)}\n`,
  );

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const books = selectedSources(argValue("book", "all"));

  for (const source of books) {
    const pageCount = manifest.find((entry) => entry.id === source.id).pageCount;
    const pageTo = toArgument ? Math.min(Number(toArgument), pageCount) : pageCount;
    const pageDir = join(workDir, "ocr-pages", source.id);
    await mkdir(pageDir, { recursive: true });
    let handledForBook = 0;

    for (let page = from; page <= pageTo; page += 1) {
      if (limit > 0 && handledForBook >= limit) break;
      handledForBook += 1;
      const textPath = join(pageDir, `${padPage(page)}.txt`);
      if (!force && await hasText(textPath)) {
        skipped += 1;
        console.log(`[skip] ${source.id} p.${page} -> ${textPath}`);
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] ${source.id} p.${page} -> ${textPath}`);
        continue;
      }

      const renderBookDir = join(renderDir, source.id);
      await mkdir(renderBookDir, { recursive: true });
      const imageBaseName = `${source.id}_${padPage(page)}`;
      const imageBasePath = join(renderBookDir, imageBaseName);
      try {
        console.log(`[ocr] ${source.id} p.${page}/${pageCount}`);
        run(pdftoppm, ["-f", String(page), "-l", String(page), "-png", "-r", String(dpi), source.pdf, imageBasePath]);
        const imagePath = await renderedPngFor(renderBookDir, imageBaseName);
        const ocr = run(tesseract, [imagePath, "stdout", "-l", language, "--psm", String(psm)]);
        const text = cleanOcrText(ocr.stdout);
        await writeFile(textPath, [
          `source_book: ${source.title}`,
          `source_pdf: ${source.pdf}`,
          `source_page: ${page}`,
          `phase: ${source.phase}`,
          "",
          text,
          "",
        ].join("\n"));
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[fail] ${source.id} p.${page}: ${error.message}`);
      }
    }
  }

  console.log(`OCR summary: ${completed} completed, ${skipped} skipped, ${failed} failed.`);
  console.log(`Output: ${join(workDir, "ocr-pages")}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

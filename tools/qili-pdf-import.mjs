#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sqlString(value) {
  return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "NULL";
}

function stableIdOf(card) {
  return card.stableId || card.externalId || card.id;
}

function reviewStatusOf(card, includeNeedsReview) {
  const status = card.reviewStatus || card.status;
  if (status === "approved") return "approved";
  return includeNeedsReview ? "needs_review" : status;
}

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1} 不是合法 JSON：${error.message}`);
      }
    });
}

function normalizeApprovedCards(cards, { includeNeedsReview = false } = {}) {
  return cards
    .filter((card) => {
      const reviewStatus = reviewStatusOf(card, includeNeedsReview);
      return reviewStatus === "approved" || (includeNeedsReview && reviewStatus === "needs_review");
    })
    .map((card) => {
      const source = card.source ?? {};
      const stableId = stableIdOf(card);
      if (!stableId) throw new Error("approved 卡缺少 stableId/externalId/id");
      const phase = card.phase;
      if (!["opening", "middle", "endgame", "all"].includes(phase)) {
        throw new Error(`${stableId} 的 phase 无效：${phase}`);
      }
      const reviewStatus = reviewStatusOf(card, includeNeedsReview);
      const sourcePage = source.pageStart ?? card.sourcePageStart;
      const sourceBook = source.book || card.sourceBook || "";
      const lessonTitle = source.lessonTitle || card.lessonTitle || `${sourceBook || "赵鑫鑫棋理"}${sourcePage ? ` p.${sourcePage}` : ""}`;
      const title = cleanText(card.title || card.principle || `${lessonTitle}${sourcePage ? ` · 第${sourcePage}页` : ""}`);
      const summary = cleanText(
        card.summary ||
          (reviewStatus === "approved"
            ? card.principle
            : `${sourceBook || "赵鑫鑫棋理三部曲"}页级 OCR 候选，待人工复核后提炼为正式短原则卡。`),
      );
      const appliesWhen = cleanText(
        card.appliesWhen ||
          `当${card.phaseLabel || phase}复盘命中「${lessonTitle}」相关主题或页码时，用作人工复核材料。`,
      );
      const risk = cleanText(
        card.risk ||
          (reviewStatus === "approved"
            ? ""
            : "未经人工确认，可能包含 OCR 错字、页眉页脚或非原则性内容；正式分析前需复核。"),
      );
      for (const [key, value] of Object.entries({ title, summary, appliesWhen, risk })) {
        if (!value) throw new Error(`${stableId} 缺少 ${key}`);
      }
      if (summary.length > 180) {
        throw new Error(`${stableId} 的 summary 过长；请改成原创短摘要后再导入`);
      }
      const tags = Array.isArray(card.tags) ? card.tags.map(String).filter(Boolean) : [];
      if (card.phaseLabel) tags.unshift(card.phaseLabel);
      if (lessonTitle) tags.push(lessonTitle);
      if (reviewStatus !== "approved") tags.push("OCR候选");
      const engineCorrelations = Array.isArray(card.engineCorrelations)
        ? card.engineCorrelations
        : Array.isArray(card.engineCorrelation)
          ? card.engineCorrelation
          : [];
      return {
        stableId,
        phase,
        courseName: "赵鑫鑫棋理三部曲",
        lessonTitle,
        sourcePath: `qili-pdf:${phase}:${sourceBook}::${sourcePage || ""}-${source.pageEnd || sourcePage || ""}`,
        fingerprint: `${stableId}:${sourcePage || ""}:${source.pageEnd || ""}`,
        title,
        summary,
        appliesWhen,
        risk,
        reviewStatus,
        sourceBook,
        sourcePageStart: sourcePage,
        sourcePageEnd: source.pageEnd ?? card.sourcePageEnd ?? sourcePage,
        tags: [...new Set(tags)],
        engineCorrelations: engineCorrelations.map(String).filter(Boolean),
        needsRecheck: reviewStatus !== "approved",
      };
    });
}

function buildSql(cards) {
  const statements = [
    "BEGIN;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_theory_cards_external_id_unique ON theory_cards(external_id);",
  ];
  for (const card of cards) {
    const tagsJson = JSON.stringify(card.tags);
    const correlationsJson = JSON.stringify(card.engineCorrelations);
    const needsRecheck = card.needsRecheck ? 1 : 0;
    statements.push(`
INSERT INTO theory_lessons (phase, course_name, title, source_path, fingerprint, transcription_status, scanned_at)
VALUES (${sqlString(card.phase)}, ${sqlString(card.courseName)}, ${sqlString(card.lessonTitle)}, ${sqlString(card.sourcePath)}, ${sqlString(card.fingerprint)}, 'complete', datetime('now'))
ON CONFLICT(source_path) DO UPDATE SET
  phase=excluded.phase,
  course_name=excluded.course_name,
  title=excluded.title,
  fingerprint=excluded.fingerprint,
  transcription_status='complete',
  scanned_at=excluded.scanned_at;
INSERT INTO theory_cards (
  external_id, lesson_id, title, summary, applies_when, risk, review_status,
  source_book, source_page_start, source_page_end, tags_json, engine_correlations_json,
  origin, version, user_modified, needs_recheck
) VALUES (
  ${sqlString(card.stableId)},
  (SELECT id FROM theory_lessons WHERE source_path = ${sqlString(card.sourcePath)}),
  ${sqlString(card.title)},
  ${sqlString(card.summary)},
  ${sqlString(card.appliesWhen)},
  ${sqlString(card.risk)},
  ${sqlString(card.reviewStatus)},
  ${sqlString(card.sourceBook || null)},
  ${sqlNumber(card.sourcePageStart)},
  ${sqlNumber(card.sourcePageEnd)},
  ${sqlString(tagsJson)},
  ${sqlString(correlationsJson)},
  'imported',
  1,
  0,
  ${needsRecheck}
)
ON CONFLICT(external_id) DO UPDATE SET
  lesson_id=excluded.lesson_id,
  version=CASE
    WHEN theory_cards.title != excluded.title
      OR theory_cards.summary != excluded.summary
      OR theory_cards.applies_when != excluded.applies_when
      OR theory_cards.risk != excluded.risk
      OR theory_cards.review_status != excluded.review_status
      OR COALESCE(theory_cards.source_book, '') != COALESCE(excluded.source_book, '')
      OR COALESCE(theory_cards.source_page_start, -1) != COALESCE(excluded.source_page_start, -1)
      OR COALESCE(theory_cards.source_page_end, -1) != COALESCE(excluded.source_page_end, -1)
      OR theory_cards.tags_json != excluded.tags_json
      OR theory_cards.engine_correlations_json != excluded.engine_correlations_json
    THEN theory_cards.version + 1
    ELSE theory_cards.version
  END,
  title=excluded.title,
  summary=excluded.summary,
  applies_when=excluded.applies_when,
  risk=excluded.risk,
  review_status=excluded.review_status,
  source_book=excluded.source_book,
  source_page_start=excluded.source_page_start,
  source_page_end=excluded.source_page_end,
  tags_json=excluded.tags_json,
  engine_correlations_json=excluded.engine_correlations_json,
  origin='imported',
  user_modified=0,
  needs_recheck=excluded.needs_recheck;`);
  }
  statements.push("COMMIT;");
  return statements.join("\n");
}

function runSqlite(db, args, input) {
  const result = spawnSync("sqlite3", [resolve(db), ...args], { input, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim());
  }
  return result.stdout;
}

function ensureExternalIdColumn(db) {
  const rows = JSON.parse(runSqlite(db, ["-json", "PRAGMA table_info(theory_cards);"]) || "[]");
  if (!rows.some((row) => row.name === "external_id")) {
    runSqlite(db, [], "ALTER TABLE theory_cards ADD COLUMN external_id TEXT;");
  }
}

async function main() {
  const inputArgument = argValue("input", "");
  if (!inputArgument) {
    throw new Error("请提供 --input=<人工确认后的 JSONL>。");
  }
  const input = resolve(inputArgument);
  const db = argValue("db", process.env.XIANGQI_SQLITE_DB ?? "");
  const rawCards = await readJsonl(input);
  const includeNeedsReview = hasFlag("include-needs-review");
  const cards = normalizeApprovedCards(rawCards, { includeNeedsReview });
  if (hasFlag("dry-run")) {
    console.log(JSON.stringify({
      input,
      includeNeedsReview,
      approved: cards.filter((card) => card.reviewStatus === "approved").length,
      needsReview: cards.filter((card) => card.reviewStatus === "needs_review").length,
      skipped: rawCards.length - cards.length,
      stableIds: cards.map((card) => card.stableId),
    }, null, 2));
    return;
  }
  if (!db) throw new Error("请提供 --db=<SQLite路径> 或设置 XIANGQI_SQLITE_DB。");
  ensureExternalIdColumn(db);
  const sql = buildSql(cards);
  runSqlite(db, [], sql);
  const approved = cards.filter((card) => card.reviewStatus === "approved").length;
  const needsReview = cards.filter((card) => card.reviewStatus === "needs_review").length;
  console.log(`Imported ${cards.length} Qili cards into ${resolve(db)}. approved=${approved}, needs_review=${needsReview}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

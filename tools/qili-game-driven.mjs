#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultWorkDir = join(repoRoot, ".theory-work", "qili-pdf");
const phaseLabels = { opening: "开局", middle: "中局", endgame: "残局" };
const bookLabels = {
  opening: "赵鑫鑫布局棋理48讲",
  middle: "赵鑫鑫中局棋理48讲",
  endgame: "赵鑫鑫残局棋理48讲",
};

const phaseKeywords = {
  opening: ["布局", "开局", "战略", "方向", "子力", "协调", "出车", "横车", "直车", "三七", "急攻", "反击", "先手"],
  middle: ["中局", "候选", "计算", "战术", "牵制", "拦截", "线路", "车路", "肋道", "以多打少", "反击", "车马炮", "双车"],
  endgame: ["残局", "胜和", "谋和", "兵", "卒", "将位", "兑子", "等招", "牵制", "拦截", "车兵", "马兵", "炮兵"],
};

const tagKeywords = {
  脱离体系: ["布局", "定式", "体系", "选择", "方向", "变化"],
  战略方向: ["战略", "方向", "决战", "计划", "谋势"],
  子力协调: ["子力", "协调", "出车", "车路", "马", "炮"],
  反击条件: ["反击", "先手", "抢先", "威胁", "将军"],
  候选着: ["候选", "选择", "计算", "变着", "次序"],
  战术漏算: ["战术", "牵制", "拦截", "抽", "捉", "杀", "将军"],
  线路控制: ["线路", "车路", "肋道", "中路", "要道", "控制"],
  理论胜和: ["胜和", "谋和", "理论", "例胜", "例和"],
  兑子误判: ["兑子", "交换", "简化", "子力"],
  兵卒效率: ["兵", "卒", "效率", "过河", "推进"],
  将位: ["将位", "老将", "帅", "将门"],
};

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function clampText(value, length) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readReportsFromDb(dbPath, gameId) {
  const where = gameId ? `WHERE game_id = ${sqlString(gameId)}` : "";
  const sql = `SELECT dataset_json FROM game_reports ${where} ORDER BY created_at DESC, rowid DESC LIMIT ${gameId ? 1 : 20};`;
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`sqlite3 读取复盘报告失败：${result.stderr.trim()}`);
  }
  const rows = JSON.parse(result.stdout || "[]");
  return rows.map((row) => JSON.parse(row.dataset_json));
}

async function readReports() {
  const reportPath = argValue("report", "");
  if (reportPath) return [JSON.parse(await readFile(resolve(reportPath), "utf8"))];
  const reportsDir = argValue("reports-dir", "");
  if (reportsDir) {
    const dir = resolve(reportsDir);
    const files = (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort();
    return Promise.all(files.map((entry) => readFile(join(dir, entry), "utf8").then(JSON.parse)));
  }
  const dbPath = argValue("db", process.env.XIANGQI_SQLITE_DB ?? "");
  if (dbPath) return readReportsFromDb(resolve(dbPath), argValue("game-id", ""));
  throw new Error("请提供 --report=<复盘JSON>、--reports-dir=<目录> 或 --db=<SQLite路径>。");
}

function lossFor(report, index) {
  const position = report.positions[index];
  const previous = report.positions[index - 1];
  const moved = position?.move;
  if (!position || !previous || !moved) return undefined;
  if (position.scoreCp == null || previous.scoreCp == null) {
    if (position.mate != null) return 400;
    return undefined;
  }
  const loss = moved.movedBy === "红方"
    ? previous.scoreCp - position.scoreCp
    : position.scoreCp - previous.scoreCp;
  return Math.max(0, loss);
}

function tagsFor(position, loss) {
  const tags = new Set();
  if (position.phase === "opening") {
    ["开局", "脱离体系", "战略方向", "子力协调", "反击条件"].forEach((tag) => tags.add(tag));
  } else if (position.phase === "middle") {
    ["中局", "候选着", "计算", "线路控制"].forEach((tag) => tags.add(tag));
  } else if (position.phase === "endgame") {
    ["残局", "理论胜和", "兑子误判", "兵卒效率", "将位"].forEach((tag) => tags.add(tag));
  } else {
    tags.add("复盘");
  }
  if (position.mate != null || loss >= 300) tags.add("战术漏算");
  if (position.bestNotation) tags.add("推荐着对比");
  return [...tags];
}

function engineSignalFor(position, tags, loss) {
  if (position.mate != null) return "missed_tactic";
  if (tags.includes("兑子误判")) return "exchange_miscalculation";
  if (tags.includes("理论胜和")) return "endgame_theoretical_win_draw";
  if (tags.includes("脱离体系")) return "opening_deviation";
  if (tags.includes("子力协调")) return "development_lag";
  if (loss >= 300 || tags.includes("战术漏算")) return "missed_tactic";
  if (tags.includes("候选着")) return "missed_candidate";
  if (tags.includes("线路控制")) return "line_control";
  return "plan_without_counterplay_check";
}

function collectIssues(reports, threshold, maxIssues) {
  const issues = [];
  for (const report of reports) {
    for (let index = 1; index < report.positions.length; index += 1) {
      const position = report.positions[index];
      const moved = position?.move;
      const loss = lossFor(report, index);
      if (!moved || loss == null || loss < threshold) continue;
      const tags = tagsFor(position, loss);
      issues.push({
        gameId: report.gameId,
        reportSignature: report.lineSignature,
        nodeId: moved.nodeId,
        moveNumber: Math.ceil(position.ply / 2),
        played: moved.notation,
        movedBy: moved.movedBy,
        phase: position.phase,
        phaseLabel: phaseLabels[position.phase] ?? "复盘",
        loss,
        bestNotation: position.bestNotation,
        pvNotation: position.pvNotation ?? [],
        scoreCp: position.scoreCp,
        mate: position.mate,
        tags,
        engineSignal: engineSignalFor(position, tags, loss),
      });
    }
  }
  return issues.sort((left, right) => right.loss - left.loss).slice(0, maxIssues);
}

function scoreCandidate(candidate, issue) {
  if (candidate.phase !== issue.phase) return -100;
  const text = `${candidate.lessonTitle ?? ""} ${candidate.ocrPreviewForReview ?? ""}`.toLowerCase();
  let score = 0;
  for (const keyword of phaseKeywords[issue.phase] ?? []) {
    if (text.includes(keyword.toLowerCase())) score += 2;
  }
  for (const tag of issue.tags) {
    if (text.includes(tag.toLowerCase())) score += 5;
    for (const keyword of tagKeywords[tag] ?? []) {
      if (text.includes(keyword.toLowerCase())) score += 4;
    }
  }
  if (candidate.lessonTitle) score += 2;
  if (!candidate.ocrPreviewForReview) score -= 8;
  return score;
}

function recallCandidates(candidates, issue, topK) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, issue) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function shortHash(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cardTemplate(issue, recalled) {
  const best = recalled[0]?.candidate;
  const mainTag = issue.tags.find((tag) => !["开局", "中局", "残局", "推荐着对比"].includes(tag)) ?? issue.phaseLabel;
  const lesson = best?.lessonTitle || `${issue.phaseLabel}问题手`;
  const pageStart = best?.source?.pageStart;
  const pageEnd = best?.source?.pageEnd;
  const sourceKey = `${issue.phase}:${lesson}:${mainTag}:${issue.engineSignal}:${pageStart ?? ""}-${pageEnd ?? ""}`;
  return {
    stableId: `qili-demand-${issue.phase}-${issue.engineSignal}-${shortHash(sourceKey)}`,
    reviewStatus: "needs_review",
    phase: issue.phase,
    title: `${mainTag}：${lesson}`,
    summary: `本手亏分重点先按“${mainTag}”复盘：比较实战着与 Pikafish 推荐着，再回到对应棋理页确认原则。`,
    appliesWhen: `第 ${issue.moveNumber} 手附近出现${issue.phaseLabel}亏分，实战 ${issue.played}，推荐 ${issue.bestNotation ?? "待复核"}。`,
    risk: "该卡由真实棋谱问题手反向召回生成，需人工核对 OCR 页和局面后才能确认采用。",
    tags: issue.tags,
    engineCorrelations: [issue.engineSignal],
    source: {
      label: "赵鑫鑫棋理三部曲",
      book: best?.source?.book ?? bookLabels[issue.phase],
      lessonNo: best?.lessonNo,
      lessonTitle: best?.lessonTitle,
      pageStart,
      pageEnd,
      review: "待确认",
    },
    issueExample: issue,
    issueExamples: [issue],
    recall: recalled.map(({ candidate, score }) => ({
      candidateId: candidate.id,
      score,
      book: candidate.source.book,
      pageStart: candidate.source.pageStart,
      pageEnd: candidate.source.pageEnd,
      lessonNo: candidate.lessonNo,
      lessonTitle: candidate.lessonTitle,
      preview: clampText(candidate.ocrPreviewForReview, 180),
    })),
  };
}

function mergeCards(cards) {
  const merged = new Map();
  for (const card of cards) {
    const key = [
      card.phase,
      card.title,
      card.engineCorrelations.join(","),
      card.source.book,
      card.source.pageStart ?? "",
      card.source.pageEnd ?? "",
    ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, card);
      continue;
    }
    existing.issueExamples.push(card.issueExample);
    existing.appliesWhen = `已有 ${existing.issueExamples.length} 个真实问题手命中：重点复核 ${existing.issueExamples
      .slice(0, 3)
      .map((issue) => `第 ${issue.moveNumber} 手 ${issue.played}`)
      .join("、")}。`;
    const recallById = new Map(existing.recall.map((item) => [item.candidateId, item]));
    for (const item of card.recall) {
      const old = recallById.get(item.candidateId);
      if (!old || item.score > old.score) recallById.set(item.candidateId, item);
    }
    existing.recall = [...recallById.values()].sort((left, right) => right.score - left.score).slice(0, 5);
  }
  return [...merged.values()];
}

async function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const info = await stat(path);
  return info.mtimeMs;
}

async function main() {
  const workDir = resolve(argValue("work-dir", process.env.QILI_PDF_WORK_DIR ?? defaultWorkDir));
  const candidatesPath = resolve(argValue("candidates", join(workDir, "card-candidates", "qili-pdf-candidates.jsonl")));
  const outDir = resolve(argValue("out-dir", join(workDir, "game-driven")));
  const threshold = Number(argValue("threshold", "150"));
  const maxIssues = Number(argValue("max-issues", "8"));
  const topK = Number(argValue("top-k", "5"));
  const reports = await readReports();
  const candidates = await readJsonl(candidatesPath);
  const issues = collectIssues(reports, threshold, maxIssues);
  const cards = mergeCards(issues.map((issue) => cardTemplate(issue, recallCandidates(candidates, issue, topK))));
  await mkdir(outDir, { recursive: true });
  const jsonlPath = join(outDir, "qili-demand-cards.draft.jsonl");
  const reportPath = join(outDir, "qili-demand-analysis.md");
  await writeFile(jsonlPath, `${cards.map((card) => JSON.stringify(card)).join("\n")}\n`);
  const markdown = [
    "# 棋谱驱动的三部曲棋理召回",
    "",
    `生成时间：${new Date().toISOString()}`,
    `输入报告数：${reports.length}`,
    `问题手数：${issues.length}`,
    `去重后待审卡：${cards.length}`,
    `候选卡来源更新时间：${new Date(await newestMtime(candidatesPath)).toISOString()}`,
    "",
    "说明：本文件只用于人工审核。正式导入 SQLite 前，请把可信条目的 `reviewStatus` 改为 `approved`，并按需精修 title/summary/appliesWhen/risk。",
    "",
    ...cards.flatMap((card, index) => [
      `## ${index + 1}. ${card.title}`,
      "",
      `- 阶段：${card.issueExample.phaseLabel}`,
      `- 命中问题手：${card.issueExamples.length} 个`,
      `- 标签：${card.tags.join(" / ")}`,
      `- 建议来源：${card.source.book}${card.source.pageStart ? ` p.${card.source.pageStart}` : ""}${card.source.lessonTitle ? ` · ${card.source.lessonTitle}` : ""}`,
      "",
      "问题手样例：",
      ...card.issueExamples.slice(0, 5).map((issue) => `- 第 ${issue.moveNumber} 手 ${issue.movedBy} ${issue.played}，亏分约 ${issue.loss}，Pikafish 建议 ${issue.bestNotation ?? "无"}，PV ${issue.pvNotation.slice(0, 4).join(" ") || "无"}`),
      "",
      "召回页：",
      ...card.recall.map((item) => `- score ${item.score} · p.${item.pageStart} · ${item.lessonTitle ?? "未识别课名"}：${item.preview}`),
      "",
    ]),
  ];
  await writeFile(reportPath, `${markdown.join("\n")}\n`);
  if (hasFlag("json")) {
    console.log(JSON.stringify({ reports: reports.length, issues: issues.length, cards: cards.length, jsonlPath, reportPath }, null, 2));
  } else {
    console.log(`Generated ${cards.length} demand-driven draft cards.`);
    console.log(`Draft JSONL: ${jsonlPath}`);
    console.log(`Review report: ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

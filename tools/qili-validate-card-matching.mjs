#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultWorkDir = join(repoRoot, ".theory-work", "qili-pdf");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function runSqliteJson(dbPath, sql) {
  const result = spawnSync("sqlite3", ["-json", resolve(dbPath), sql], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return JSON.parse(result.stdout || "[]");
}

function phaseLabel(phase) {
  return { opening: "开局", middle: "中局", endgame: "残局" }[phase] ?? "复盘";
}

function tagsForPosition(position, loss) {
  let tags;
  if (position.phase === "opening") {
    tags = ["开局", "脱离体系", "战略方向", "子力协调"];
  } else if (position.phase === "middle") {
    tags = ["中局", "候选着", "计算"];
  } else if (position.phase === "endgame") {
    tags = ["残局", "理论胜和", "兑子"];
  } else {
    tags = ["复盘"];
  }
  if (position.mate != null) tags.push("漏杀/防杀");
  else if (loss >= 300) tags.push("战术漏算");
  if (position.bestNotation) tags.push("推荐着对比");
  addNotationTags(position, tags);
  return [...new Set(tags)].sort();
}

function addNotationTags(position, tags) {
  const text = position.move?.notation ?? "";
  if (text.includes("车")) {
    tags.push("出车选择", "线路控制");
  }
  if (text.includes("马")) tags.push("活马");
  if (text.includes("炮")) tags.push("炮位", "炮路");
  if (text.includes("兵") || text.includes("卒")) tags.push("兵卒出动", "兵卒效率");
  if (text.includes("仕") || text.includes("士")) tags.push("补士", "将位");
  if (text.includes("肋")) tags.push("肋道");
  if (text.includes("兑")) tags.push("兑子");
}

function engineSignalForPosition(position, tags, loss) {
  if (position.mate != null) return "missed_tactic";
  if (tags.some((tag) => tag.includes("兑子"))) return "exchange_miscalculation";
  if (tags.some((tag) => tag.includes("理论胜和"))) return "endgame_theoretical_win_draw";
  if (tags.some((tag) => tag.includes("脱离体系"))) return "opening_deviation";
  if (tags.some((tag) => tag.includes("子力协调"))) return "development_lag";
  if (loss >= 300 || tags.some((tag) => tag.includes("战术漏算"))) return "missed_tactic";
  if (tags.some((tag) => tag.includes("候选着"))) return "missed_candidate";
  return "plan_without_counterplay_check";
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

function scoreCard(card, phase, tags, engineSignal) {
  if (card.phase !== phase && card.phase !== "all") return undefined;
  if (card.needs_recheck) return undefined;
  const haystack = [
    card.title,
    card.summary,
    card.applies_when,
    card.risk,
    ...(card.tags ?? []),
  ].join(" ").toLowerCase();
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const tagScore = normalizedTags
    .filter((tag) => haystack.includes(tag))
    .reduce((sum, tag) => sum + tagWeight(tag), 0);
  const correlationHits = (card.engine_correlations ?? [])
    .filter((correlation) => correlation.trim().toLowerCase() === engineSignal.trim().toLowerCase())
    .length;
  const score = tagScore + correlationHits * 12 - Number(card.match_penalty ?? 0) * 3;
  return score > 0 ? score : undefined;
}

function tagWeight(tag) {
  if (["开局", "中局", "残局", "复盘", "推荐着对比"].includes(tag)) return 1;
  if (["脱离体系", "战略方向", "子力协调", "候选着", "计算", "理论胜和", "兑子"].includes(tag)) {
    return 5;
  }
  return 14;
}

function bestMatch(cards, phase, tags, engineSignal) {
  return cards
    .map((card) => ({ card, score: scoreCard(card, phase, tags, engineSignal) }))
    .filter((entry) => entry.score != null)
    .sort((left, right) => right.score - left.score || left.card.id - right.card.id)[0];
}

async function main() {
  const dbPath = argValue("db", process.env.XIANGQI_SQLITE_DB ?? "");
  if (!dbPath) throw new Error("请提供 --db=<SQLite路径> 或 XIANGQI_SQLITE_DB。");
  const threshold = Number(argValue("threshold", "80"));
  const workDir = resolve(argValue("work-dir", process.env.QILI_PDF_WORK_DIR ?? defaultWorkDir));
  const outDir = resolve(argValue("out-dir", join(workDir, "validation")));
  const gameId = argValue("game-id", "");

  const reportWhere = gameId ? `WHERE game_id = ${sqlString(gameId)}` : "";
  const reportRows = runSqliteJson(
    dbPath,
    `SELECT game_id, line_signature, dataset_json, created_at FROM game_reports ${reportWhere} ORDER BY created_at DESC LIMIT 1;`,
  );
  if (reportRows.length === 0) throw new Error("没有可验证的 game_reports。请先生成整局复盘报告。");
  const reportRow = reportRows[0];
  const report = JSON.parse(reportRow.dataset_json);

  const cards = runSqliteJson(
    dbPath,
    `SELECT c.id, c.external_id, l.phase, c.title, c.summary, c.applies_when, c.risk,
            c.review_status, c.source_book, c.source_page_start, c.source_page_end,
            c.tags_json, c.engine_correlations_json, c.version, c.match_penalty, c.needs_recheck
       FROM theory_cards c
       JOIN theory_lessons l ON l.id = c.lesson_id
      WHERE c.review_status = 'approved';`,
  ).map((card) => ({
    ...card,
    tags: JSON.parse(card.tags_json || "[]"),
    engine_correlations: JSON.parse(card.engine_correlations_json || "[]"),
  }));

  const matches = [];
  for (let index = 1; index < report.positions.length; index += 1) {
    const position = report.positions[index];
    const moved = position?.move;
    const loss = lossFor(report, index);
    if (!moved || loss == null || loss < threshold) continue;
    const tags = tagsForPosition(position, loss);
    const engineSignal = engineSignalForPosition(position, tags, loss);
    const match = bestMatch(cards, position.phase, tags, engineSignal);
    matches.push({
      gameId: report.gameId,
      nodeId: moved.nodeId,
      moveNumber: Math.ceil(position.ply / 2),
      phase: position.phase,
      phaseLabel: phaseLabel(position.phase),
      movedBy: moved.movedBy,
      played: moved.notation,
      loss,
      bestNotation: position.bestNotation,
      tags,
      engineSignal,
      matched: match
        ? {
            cardId: match.card.id,
            externalId: match.card.external_id,
            title: match.card.title,
            score: match.score,
            sourceBook: match.card.source_book,
            pageStart: match.card.source_page_start,
            pageEnd: match.card.source_page_end,
            version: match.card.version,
          }
        : null,
    });
  }

  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "qili-card-match-validation.json");
  const mdPath = join(outDir, "qili-card-match-validation.md");
  await writeFile(jsonPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    dbPath: resolve(dbPath),
    threshold,
    approvedCards: cards.length,
    gameId: reportRow.game_id,
    reportCreatedAt: reportRow.created_at,
    issueCount: matches.length,
    matchedCount: matches.filter((match) => match.matched).length,
    unmatchedCount: matches.filter((match) => !match.matched).length,
    matches,
  }, null, 2)}\n`);
  await writeFile(mdPath, `${[
    "# 棋理卡匹配验证",
    "",
    `生成时间：${new Date().toISOString()}`,
    `SQLite：${resolve(dbPath)}`,
    `复盘 gameId：${reportRow.game_id}`,
    `复盘时间：${reportRow.created_at}`,
    `亏分阈值：${threshold}`,
    `approved 卡：${cards.length}`,
    `问题手：${matches.length}`,
    `已命中：${matches.filter((match) => match.matched).length}`,
    `未命中：${matches.filter((match) => !match.matched).length}`,
    "",
    ...matches.flatMap((match, index) => [
      `## ${index + 1}. 第 ${match.moveNumber} 手 ${match.movedBy} ${match.played}`,
      "",
      `- 阶段：${match.phaseLabel}`,
      `- 亏分：${match.loss}`,
      `- Pikafish 建议：${match.bestNotation ?? "无"}`,
      `- 标签：${match.tags.join(" / ")}`,
      `- 引擎信号：${match.engineSignal}`,
      match.matched
        ? `- 命中棋理：${match.matched.title}（score ${match.matched.score}，${match.matched.sourceBook} p.${match.matched.pageStart}-${match.matched.pageEnd}，v${match.matched.version}）`
        : "- 命中棋理：无",
      "",
    ]),
  ].join("\n")}\n`);

  console.log(JSON.stringify({
    approvedCards: cards.length,
    issueCount: matches.length,
    matchedCount: matches.filter((match) => match.matched).length,
    unmatchedCount: matches.filter((match) => !match.matched).length,
    jsonPath,
    mdPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

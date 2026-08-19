#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultOutDir = join(repoRoot, ".theory-work", "master-style");
const defaultDatabaseUrl = "mysql://root:root@localhost:3306/xiangqi";
const defaultSqlitePath = "/Users/chenyubin/Library/Application Support/cn.xiangqi.studio/xiangqi.sqlite3";

const pieceLabels = {
  r: "车",
  n: "马",
  b: "相/象",
  a: "仕/士",
  k: "帅/将",
  c: "炮",
  p: "兵/卒",
  unknown: "未知",
};

const phaseLabels = {
  opening: "开局",
  middle: "中局",
  endgame: "残局",
};

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  return `Usage:
  node tools/master-style-train.mjs profile --players=赵鑫鑫,许银川,王天一,郑惟桐

Options:
  --database-url=mysql://root:root@localhost:3306/xiangqi
  --out-dir=.theory-work/master-style
  --players=赵鑫鑫,许银川,王天一,郑惟桐
  --sample-limit-per-player=3000
  --pikafish-job-limit-per-player=200
  --sqlite="/Users/.../xiangqi.sqlite3"
  --no-sqlite

This is a lightweight, explainable first-pass training step. It does not run Pikafish
and does not write to MySQL. It reads master_position_samples and emits local
style profiles, training samples, and optional Pikafish job seeds.`;
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname || "localhost",
    port: url.port || "3306",
    user: decodeURIComponent(url.username || "root"),
    password: decodeURIComponent(url.password || ""),
    database: url.pathname.replace(/^\//, "") || "xiangqi",
  };
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function normalizeName(value) {
  return String(value ?? "").replace(/[\s\u3000]+/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

async function mysqlJsonRows(db, query) {
  const stdout = await runCommand("mysql", [
    "--protocol=TCP",
    "-h", db.host,
    "-P", db.port,
    "-u", db.user,
    db.database,
    "--batch",
    "--raw",
    "--skip-column-names",
    "-e",
    query,
  ], {
    env: { ...process.env, MYSQL_PWD: db.password },
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function sqliteJsonRows(sqlitePath, query) {
  if (!existsSync(sqlitePath)) return [];
  const stdout = await runCommand("sqlite3", [
    "-json",
    sqlitePath,
    query,
  ]);
  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

async function readTheoryStats(sqlitePath) {
  try {
    const [summaryRows, phaseRows] = await Promise.all([
      sqliteJsonRows(sqlitePath, `
        SELECT
          (SELECT COUNT(*) FROM theory_lessons) AS lessons,
          (SELECT COUNT(*) FROM theory_cards) AS cards,
          (SELECT COUNT(*) FROM theory_cards WHERE review_status='approved') AS approvedCards,
          (SELECT COUNT(*) FROM theory_cards WHERE review_status='needs_review') AS needsReviewCards;
      `),
      sqliteJsonRows(sqlitePath, `
        SELECT l.phase, c.review_status AS reviewStatus, COUNT(*) AS count
        FROM theory_cards c
        JOIN theory_lessons l ON l.id = c.lesson_id
        GROUP BY l.phase, c.review_status
        ORDER BY l.phase, c.review_status;
      `),
    ]);
    return {
      sqlitePath,
      summary: summaryRows[0] ?? {},
      byPhase: phaseRows,
    };
  } catch (error) {
    return {
      sqlitePath,
      error: error.message,
    };
  }
}

function topRows(rows, limit = 12) {
  return rows
    .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0))
    .slice(0, limit);
}

function percent(part, total) {
  if (!total) return 0;
  return Number(((Number(part) / Number(total)) * 100).toFixed(1));
}

function rowsToMap(rows, key = "key") {
  const out = {};
  for (const row of rows) {
    out[row[key] ?? ""] = Number(row.count ?? 0);
  }
  return out;
}

async function queryOneProfile(db, playerName, options) {
  const normalized = normalizeName(playerName);
  const playerSql = sqlString(normalized);
  const [sourceRows, gameRows, sideRows, resultRows, phaseRows, pieceRows, eventRows, openingRows, moveRows] = await Promise.all([
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT(
        'id', p.id,
        'name', p.name,
        'normalizedName', p.normalized_name,
        'sourceSite', p.source_site,
        'sourcePlayerId', p.source_player_id,
        'profileUrl', p.profile_url,
        'gameRefs', COALESCE(gr.gameRefs, 0),
        'samples', COALESCE(sr.samples, 0)
      )
      FROM master_players p
      LEFT JOIN (
        SELECT master_player_id, COUNT(DISTINCT game_id) AS gameRefs
        FROM master_game_player_refs
        GROUP BY master_player_id
      ) gr ON gr.master_player_id = p.id
      LEFT JOIN (
        SELECT master_player_id, COUNT(*) AS samples
        FROM master_position_samples
        GROUP BY master_player_id
      ) sr ON sr.master_player_id = p.id
      WHERE p.normalized_name = ${playerSql}
      ORDER BY COALESCE(gr.gameRefs, 0) DESC, COALESCE(sr.samples, 0) DESC;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT(
        'games', COUNT(DISTINCT r.game_id),
        'earliestDate', MIN(g.game_date),
        'latestDate', MAX(g.game_date),
        'avgMoveCount', ROUND(AVG(g.move_count), 1)
      )
      FROM master_game_player_refs r
      JOIN master_players p ON p.id = r.master_player_id
      JOIN master_games g ON g.id = r.game_id
      WHERE p.normalized_name = ${playerSql};
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('key', x.side, 'count', x.count)
      FROM (
        SELECT r.side, COUNT(DISTINCT r.game_id) AS count
        FROM master_game_player_refs r
        JOIN master_players p ON p.id = r.master_player_id
        WHERE p.normalized_name = ${playerSql}
        GROUP BY r.side
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('key', x.resultKey, 'count', x.count)
      FROM (
        SELECT
          CASE
            WHEN g.result='1/2-1/2' THEN 'draw'
            WHEN r.side='red' AND g.result='1-0' THEN 'win'
            WHEN r.side='black' AND g.result='0-1' THEN 'win'
            WHEN g.result='*' THEN 'unknown'
            ELSE 'loss'
          END AS resultKey,
          COUNT(DISTINCT r.game_id) AS count
        FROM master_game_player_refs r
        JOIN master_players p ON p.id = r.master_player_id
        JOIN master_games g ON g.id = r.game_id
        WHERE p.normalized_name = ${playerSql}
        GROUP BY resultKey
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('key', x.phase, 'count', x.count)
      FROM (
        SELECT s.phase, COUNT(DISTINCT CONCAT(s.game_id, '#', s.ply)) AS count
        FROM master_position_samples s
        JOIN master_players p ON p.id = s.master_player_id
        WHERE p.normalized_name = ${playerSql}
        GROUP BY s.phase
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('key', x.pieceKey, 'count', x.count)
      FROM (
        SELECT LOWER(COALESCE(NULLIF(m.piece, ''), 'unknown')) AS pieceKey, COUNT(DISTINCT CONCAT(s.game_id, '#', s.ply)) AS count
        FROM master_position_samples s
        JOIN master_players p ON p.id = s.master_player_id
        LEFT JOIN master_game_moves m ON m.game_id = s.game_id AND m.ply = s.ply
        WHERE p.normalized_name = ${playerSql}
        GROUP BY pieceKey
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('name', x.eventName, 'count', x.count)
      FROM (
        SELECT COALESCE(NULLIF(g.event_name, ''), '未知赛事') AS eventName, COUNT(DISTINCT r.game_id) AS count
        FROM master_game_player_refs r
        JOIN master_players p ON p.id = r.master_player_id
        JOIN master_games g ON g.id = r.game_id
        WHERE p.normalized_name = ${playerSql}
        GROUP BY eventName
        ORDER BY count DESC
        LIMIT 15
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT('name', x.openingName, 'count', x.count)
      FROM (
        SELECT COALESCE(NULLIF(g.opening, ''), '未知开局') AS openingName, COUNT(DISTINCT r.game_id) AS count
        FROM master_game_player_refs r
        JOIN master_players p ON p.id = r.master_player_id
        JOIN master_games g ON g.id = r.game_id
        WHERE p.normalized_name = ${playerSql}
        GROUP BY openingName
        ORDER BY count DESC
        LIMIT 15
      ) x;
    `),
    mysqlJsonRows(db, `
      SELECT JSON_OBJECT(
        'phase', x.phase,
        'piece', x.pieceKey,
        'move', x.playedMove,
        'count', x.count
      )
      FROM (
        SELECT
          s.phase,
          LOWER(COALESCE(NULLIF(m.piece, ''), 'unknown')) AS pieceKey,
          s.played_move AS playedMove,
          COUNT(DISTINCT CONCAT(s.game_id, '#', s.ply)) AS count
        FROM master_position_samples s
        JOIN master_players p ON p.id = s.master_player_id
        LEFT JOIN master_game_moves m ON m.game_id = s.game_id AND m.ply = s.ply
        WHERE p.normalized_name = ${playerSql}
        GROUP BY s.phase, pieceKey, s.played_move
        ORDER BY count DESC
        LIMIT 25
      ) x;
    `),
  ]);

  const samples = await mysqlJsonRows(db, `
    SELECT JSON_OBJECT(
      'sampleId', x.sampleId,
      'masterPlayerId', x.masterPlayerId,
      'playerName', x.playerName,
      'sourceSite', x.sourceSite,
      'sourcePlayerId', x.sourcePlayerId,
      'sourceRefs', x.sourceRefs,
      'gameId', x.gameId,
      'title', x.title,
      'redPlayer', x.redPlayer,
      'blackPlayer', x.blackPlayer,
      'eventName', x.eventName,
      'gameDate', x.gameDate,
      'result', x.result,
      'ply', x.ply,
      'moveNo', x.moveNo,
      'masterSide', x.masterSide,
      'phase', x.phase,
      'beforeFen', x.beforeFen,
      'playedMove', x.playedMove,
      'piece', x.piece,
      'captured', x.captured,
      'sampleKey', x.sampleKey
    )
    FROM (
      SELECT
        b.*,
        ROW_NUMBER() OVER (
          PARTITION BY b.phase
          ORDER BY SHA2(CONCAT(b.gameId, '#', b.ply, '#', b.playerName), 256)
        ) AS rn
      FROM (
        SELECT
          MIN(s.id) AS sampleId,
          MIN(s.master_player_id) AS masterPlayerId,
          ${sqlString(playerName)} AS playerName,
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT p.source_site ORDER BY p.source_site SEPARATOR ','), ',', 1) AS sourceSite,
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT p.source_player_id ORDER BY p.source_site, p.source_player_id SEPARATOR ','), ',', 1) AS sourcePlayerId,
          GROUP_CONCAT(DISTINCT CONCAT(p.source_site, ':', p.source_player_id) ORDER BY p.source_site, p.source_player_id SEPARATOR ',') AS sourceRefs,
          s.game_id AS gameId,
          g.title,
          g.red_player AS redPlayer,
          g.black_player AS blackPlayer,
          g.event_name AS eventName,
          g.game_date AS gameDate,
          g.result,
          s.ply,
          m.move_no AS moveNo,
          s.master_side AS masterSide,
          s.phase,
          s.before_fen AS beforeFen,
          s.played_move AS playedMove,
          COALESCE(NULLIF(m.piece, ''), 'unknown') AS piece,
          COALESCE(NULLIF(m.captured, ''), '') AS captured,
          CONCAT(s.game_id, '#', s.ply) AS sampleKey
        FROM master_position_samples s
        JOIN master_players p ON p.id = s.master_player_id
        JOIN master_games g ON g.id = s.game_id
        LEFT JOIN master_game_moves m ON m.game_id = s.game_id AND m.ply = s.ply
        WHERE p.normalized_name = ${playerSql}
        GROUP BY
          s.game_id, s.ply, s.master_side, s.phase, s.before_fen, s.played_move,
          g.title, g.red_player, g.black_player, g.event_name, g.game_date, g.result,
          m.move_no, m.piece, m.captured
      ) b
    ) x
    WHERE x.rn <= ${Number(options.sampleLimitPerPhase)}
    ORDER BY x.phase, x.rn;
  `);

  const uniqueSamples = [];
  const seenSampleKeys = new Set();
  for (const sample of samples) {
    const key = `${normalized}#${sample.sampleKey}`;
    if (seenSampleKeys.has(key)) continue;
    seenSampleKeys.add(key);
    sample.pieceType = String(sample.piece ?? "unknown").toLowerCase();
    sample.pieceLabel = pieceLabels[sample.pieceType] ?? sample.pieceType;
    sample.trainingLabel = "master_played_move";
    sample.usageNote = "公开棋谱实战着正例；后续可与 Pikafish MultiPV 候选形成风格重排对比样本。";
    uniqueSamples.push(sample);
  }

  const gameSummary = gameRows[0] ?? {};
  const phaseMap = rowsToMap(phaseRows);
  const pieceMap = rowsToMap(pieceRows);
  const resultMap = rowsToMap(resultRows);
  const totalSamples = Object.values(phaseMap).reduce((sum, value) => sum + Number(value), 0);
  const profileId = sha256(`master-style-profile|${normalized}`).slice(0, 16);
  const profile = {
    profileId,
    playerName,
    normalizedName: normalized,
    generatedAt: new Date().toISOString(),
    sources: sourceRows,
    gameSummary,
    sideDistribution: rowsToMap(sideRows),
    resultDistribution: resultMap,
    resultRates: {
      win: percent(resultMap.win ?? 0, gameSummary.games ?? 0),
      draw: percent(resultMap.draw ?? 0, gameSummary.games ?? 0),
      loss: percent(resultMap.loss ?? 0, gameSummary.games ?? 0),
      unknown: percent(resultMap.unknown ?? 0, gameSummary.games ?? 0),
    },
    phaseSamples: phaseMap,
    phaseRates: Object.fromEntries(Object.entries(phaseMap).map(([phase, count]) => [phase, percent(count, totalSamples)])),
    pieceMoves: pieceMap,
    pieceMoveRanking: topRows(Object.entries(pieceMap).map(([piece, count]) => ({
      piece,
      label: pieceLabels[piece] ?? piece,
      count,
    })), 12),
    topEvents: topRows(eventRows, 12),
    topOpenings: topRows(openingRows, 12),
    frequentMoves: moveRows.map((row) => ({
      ...row,
      phaseLabel: phaseLabels[row.phase] ?? row.phase,
      pieceLabel: pieceLabels[row.piece] ?? row.piece,
    })),
    sampledTrainingRows: uniqueSamples.length,
    notes: [
      "这是公开棋谱统计得到的“风格启发”画像，不代表棋手本人意见，也不是冒充棋手。",
      "Pikafish 仍负责判断棋力；大师画像只适合在引擎可接受候选中辅助重排、找相似实战和生成训练提示。",
      "当前脚本只读 MySQL，不写数据库；后续可把稳定画像版本写入 SQLite 或 MySQL 的派生表。",
    ],
  };
  return { profile, samples: uniqueSamples };
}

function markdownTable(rows, columns) {
  const headers = columns.map((column) => column.title);
  const body = rows.map((row) => columns.map((column) => String(column.value(row) ?? "")));
  const escape = (value) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map((cells) => `| ${cells.map(escape).join(" | ")} |`),
  ].join("\n");
}

function profileMarkdown(profile, theoryStats) {
  const lines = [];
  lines.push(`# ${profile.playerName}：公开棋谱风格启发画像`);
  lines.push("");
  lines.push(`生成时间：${profile.generatedAt}`);
  lines.push("");
  lines.push("## 样本规模");
  lines.push("");
  lines.push(`- 棋谱：${profile.gameSummary.games ?? 0} 局`);
  lines.push(`- 实战走子样本：${Object.values(profile.phaseSamples).reduce((sum, value) => sum + Number(value), 0)} 条`);
  lines.push(`- 时间范围：${profile.gameSummary.earliestDate ?? "未知"} 至 ${profile.gameSummary.latestDate ?? "未知"}`);
  lines.push(`- 平均半回合数：${profile.gameSummary.avgMoveCount ?? "未知"}`);
  lines.push(`- 本次导出训练样本：${profile.sampledTrainingRows} 条`);
  lines.push("");
  lines.push("## 阶段分布");
  lines.push("");
  lines.push(markdownTable(Object.entries(profile.phaseSamples).map(([phase, count]) => ({
    phase: phaseLabels[phase] ?? phase,
    count,
    rate: `${profile.phaseRates[phase] ?? 0}%`,
  })), [
    { title: "阶段", value: (row) => row.phase },
    { title: "样本数", value: (row) => row.count },
    { title: "占比", value: (row) => row.rate },
  ]));
  lines.push("");
  lines.push("## 胜和负概览");
  lines.push("");
  lines.push(`- 胜：${profile.resultDistribution.win ?? 0}（${profile.resultRates.win}%）`);
  lines.push(`- 和：${profile.resultDistribution.draw ?? 0}（${profile.resultRates.draw}%）`);
  lines.push(`- 负：${profile.resultDistribution.loss ?? 0}（${profile.resultRates.loss}%）`);
  lines.push("");
  lines.push("## 常动子力");
  lines.push("");
  lines.push(markdownTable(profile.pieceMoveRanking, [
    { title: "子力", value: (row) => row.label },
    { title: "代码", value: (row) => row.piece },
    { title: "次数", value: (row) => row.count },
  ]));
  lines.push("");
  lines.push("## 高频赛事");
  lines.push("");
  lines.push(markdownTable(profile.topEvents, [
    { title: "赛事", value: (row) => row.name },
    { title: "局数", value: (row) => row.count },
  ]));
  lines.push("");
  lines.push("## 高频开局字段");
  lines.push("");
  lines.push(markdownTable(profile.topOpenings, [
    { title: "开局", value: (row) => row.name },
    { title: "局数", value: (row) => row.count },
  ]));
  lines.push("");
  if (theoryStats?.summary) {
    lines.push("## 与本地棋理库的连接");
    lines.push("");
    lines.push(`- theory_lessons：${theoryStats.summary.lessons ?? 0}`);
    lines.push(`- theory_cards：${theoryStats.summary.cards ?? 0}`);
    lines.push(`- approved 原则卡：${theoryStats.summary.approvedCards ?? 0}`);
    lines.push("");
    lines.push("使用方式：先用 Pikafish 找出用户问题手，再用阶段/子力/错因标签召回 approved 原则卡；若同一 FEN 或相近主题命中大师样本，就补充“类似大师实战参考”。");
    lines.push("");
  }
  lines.push("## 下一步");
  lines.push("");
  lines.push("1. 用 `master-pikafish-jobs.jsonl` 抽样跑 Pikafish MultiPV。");
  lines.push("2. 把实战着在 MultiPV 中的排名、亏分写入 `master_position_analysis`。");
  lines.push("3. 棋谱复盘时展示：引擎建议 + 棋理原则卡 + 相似大师实战。");
  lines.push("");
  lines.push("> 说明：这是“风格启发”，不是复刻棋手本人。真正落子仍以 Pikafish 棋力判断和你的复盘目标为准。");
  lines.push("");
  return lines.join("\n");
}

function manifestFor(profiles, theoryStats, options) {
  return {
    generatedAt: new Date().toISOString(),
    kind: "master-style-training-v1",
    database: {
      host: options.db.host,
      port: options.db.port,
      database: options.db.database,
    },
    players: profiles.map((profile) => ({
      playerName: profile.playerName,
      normalizedName: profile.normalizedName,
      games: profile.gameSummary.games ?? 0,
      exportedTrainingRows: profile.sampledTrainingRows,
      phaseSamples: profile.phaseSamples,
    })),
    theory: theoryStats ?? null,
    outputs: {
      profiles: "master-style-profiles.json",
      samples: "master-style-samples.jsonl",
      pikafishJobs: "master-pikafish-jobs.jsonl",
      pikafishAnalysis: "master-style-analysis.jsonl",
      reports: "reports/*.md",
    },
    notes: [
      "profile 阶段不运行引擎、不写 MySQL，只生成本地可回滚产物。",
      "后续 Pikafish 分析建议从每位大师每阶段小样本开始，确认质量后再扩大。",
    ],
  };
}

async function profileCommand() {
  const db = parseDatabaseUrl(argValue("database-url", process.env.DATABASE_URL || defaultDatabaseUrl));
  const outDir = resolve(argValue("out-dir", defaultOutDir));
  const players = argValue("players", "赵鑫鑫,许银川,王天一,郑惟桐")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const sampleLimitPerPlayer = Number(argValue("sample-limit-per-player", "3000"));
  const pikafishJobLimitPerPlayer = Number(argValue("pikafish-job-limit-per-player", "200"));
  const sampleLimitPerPhase = Math.max(1, Math.ceil(sampleLimitPerPlayer / 3));
  const sqlitePath = argValue("sqlite", defaultSqlitePath);
  await mkdir(join(outDir, "reports"), { recursive: true });

  const theoryStats = hasFlag("no-sqlite") ? null : await readTheoryStats(sqlitePath);
  const profiles = [];
  const allSamples = [];
  const allJobs = [];

  for (const playerName of players) {
    console.log(`Training profile: ${playerName}`);
    const { profile, samples } = await queryOneProfile(db, playerName, { sampleLimitPerPhase });
    profiles.push(profile);
    allSamples.push(...samples);
    allJobs.push(...samples.slice(0, pikafishJobLimitPerPlayer).map((sample) => ({
      jobId: sha256(`master-pikafish-job|${sample.playerName}|${sample.gameId}|${sample.ply}`).slice(0, 24),
      sampleId: sample.sampleId,
      playerName: sample.playerName,
      sourceSite: sample.sourceSite,
      sourcePlayerId: sample.sourcePlayerId,
      gameId: sample.gameId,
      title: sample.title,
      eventName: sample.eventName,
      gameDate: sample.gameDate,
      ply: sample.ply,
      phase: sample.phase,
      beforeFen: sample.beforeFen,
      playedMove: sample.playedMove,
      masterSide: sample.masterSide,
      piece: sample.piece,
      suggestedEngine: "Pikafish",
      suggestedDepth: 24,
      suggestedMultiPv: 5,
    })));
    await writeFile(join(outDir, "reports", `${profile.normalizedName}.md`), profileMarkdown(profile, theoryStats), "utf8");
  }

  const manifest = manifestFor(profiles, theoryStats, { db });
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "master-style-profiles.json"), `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "master-style-samples.jsonl"), `${allSamples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8");
  await writeFile(join(outDir, "master-pikafish-jobs.jsonl"), `${allJobs.map((job) => JSON.stringify(job)).join("\n")}\n`, "utf8");

  const stats = await Promise.all([
    stat(join(outDir, "master-style-profiles.json")),
    stat(join(outDir, "master-style-samples.jsonl")),
    stat(join(outDir, "master-pikafish-jobs.jsonl")),
  ]);
  console.log(JSON.stringify({
    outDir,
    players: profiles.map((profile) => ({
      playerName: profile.playerName,
      games: profile.gameSummary.games ?? 0,
      exportedTrainingRows: profile.sampledTrainingRows,
    })),
    files: {
      profilesBytes: stats[0].size,
      samplesBytes: stats[1].size,
      pikafishJobsBytes: stats[2].size,
    },
  }, null, 2));
}

async function main() {
  const command = process.argv[2] ?? "profile";
  if (hasFlag("help") || command === "help") {
    console.log(usage());
    return;
  }
  if (command !== "profile") {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
  await profileCommand();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Import an East Day Xiangqi (dpxq.com) SQLite archive into the public MySQL
 * library. The SQLite archive stores DhtmlXQ UBB; this tool stores normalized
 * metadata and ICCS moves, leaving the source database untouched.
 *
 * Example:
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3306/xiangqi \
 *     node tools/import-dpxq-sqlite.mjs --sqlite=/path/to/dpxq.db
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { parseDhtmlXqBlock, gameToMoveRows } from "./zhao-public-games.mjs";

const defaultDatabaseUrl = "mysql://root:root@127.0.0.1:3306/xiangqi";
const defaultSqlite = "/Users/chenyubin/Documents/chess/dpxq.db";
const dpxqSourceSite = "dpxq.com";
const fallbackPlayer = {
  id: "b7bd7438-274d-4e95-9093-8017f7acbd8e",
  name: "东萍公开棋谱库",
  sourcePlayerId: "dpxq-public-archive",
  profileUrl: "https://www.dpxq.com/hldcg/",
};

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlString(value) {
  const escaped = String(value ?? "").replace(/[\\\0\n\r\x1a']/g, (character) => ({
    "\\": "\\\\",
    "\0": "\\0",
    "\n": "\\n",
    "\r": "\\r",
    "\x1a": "\\Z",
    "'": "\\'",
  })[character]);
  return `'${escaped}'`;
}

function sqlValue(value) {
  return value === undefined || value === null || String(value).trim() === "" ? "NULL" : sqlString(value);
}

function normalizeDate(value) {
  const found = String(value ?? "").match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/);
  if (!found) return "";
  const year = Number(found[1]);
  const month = Number(found[2]);
  const day = Number(found[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return "";
  return `${found[1]}-${found[2].padStart(2, "0")}-${found[3].padStart(2, "0")}`;
}

function normalizeResult(value) {
  const text = String(value ?? "");
  if (/红胜|先胜|1-0/.test(text)) return "1-0";
  if (/黑胜|先负|0-1/.test(text)) return "0-1";
  if (/和棋|和局|1\/2/.test(text)) return "1/2-1/2";
  return "*";
}

function parseDatabaseUrl(value) {
  const url = new URL(value || defaultDatabaseUrl);
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "3306",
    user: decodeURIComponent(url.username || "root"),
    password: decodeURIComponent(url.password || ""),
    database: url.pathname.replace(/^\//, "") || "xiangqi",
  };
}

function dpxqSourceUrl(owner, id) {
  return `https://www.dpxq.com/hldcg/search/view_${owner}_${id}.html`;
}

function normalizePlayerName(value) {
  return String(value ?? "").replace(/[\s\u3000]+/g, "").trim() || fallbackPlayer.name;
}

function playerFor(name) {
  const normalizedName = normalizePlayerName(name);
  if (normalizedName === fallbackPlayer.name) return fallbackPlayer;
  const sourcePlayerId = `dpxq-player-${sha256(normalizedName).slice(0, 16)}`;
  return {
    id: `dpxq-${sha256(`player|${normalizedName}`).slice(0, 24)}`,
    name: normalizedName,
    sourcePlayerId,
    profileUrl: `https://www.dpxq.com/hldcg/search/?q=${encodeURIComponent(normalizedName)}`,
  };
}

function gameFromRow({ id, owner, sourceDate, ubb }) {
  const parsed = parseDhtmlXqBlock(ubb);
  if (!parsed || parsed.moves.length === 0) return undefined;
  const fields = parsed.fields;
  const redPlayer = String(fields.redname || fields.red || "未知红方").trim();
  const blackPlayer = String(fields.blackname || fields.black || "未知黑方").trim();
  const sourceUrl = dpxqSourceUrl(owner, id);
  const date = normalizeDate(fields.date || sourceDate);
  const event = String(fields.event || fields.class || "未命名赛事").trim();
  const title = String(fields.title || `${redPlayer} vs ${blackPlayer}`).trim();
  const moves = parsed.moves;
  // Owner + source id is intentional: rows with incomplete legacy metadata must
  // remain distinct and reruns must be idempotent without heuristic merging.
  const fingerprint = sha256(`dpxq|${owner}|${id}|${moves.join(" ")}`);
  return {
    id,
    owner,
    sourceUrl,
    title,
    redPlayer,
    blackPlayer,
    event,
    round: String(fields.round || "").trim(),
    date,
    result: normalizeResult(fields.result || title),
    opening: String(fields.open || "").trim(),
    moves,
    fingerprint,
  };
}

function gameRecords(game, includeMoveIndex) {
  const gameId = `dpxq-${game.owner}-${game.id}`;
  const red = playerFor(game.redPlayer);
  const black = playerFor(game.blackPlayer);
  return {
    players: black.id === red.id ? [red] : [red, black],
    game: [gameId, red.id, dpxqSourceSite, game.sourceUrl, game.title, game.redPlayer, game.blackPlayer, game.event, game.round, game.date, game.result, game.opening, game.moves.length, JSON.stringify(game.moves), "DhtmlXQ", game.fingerprint, "东萍象棋网公开棋谱；仅供个人本地学习，发布或再分发前需复核来源许可。", "parsed"],
    source: [gameId, dpxqSourceSite, game.sourceUrl, game.title, "DhtmlXQ"],
    refs: (black.id === red.id ? [[red, "red"]] : [[red, "red"], [black, "black"]]).map(([player, side]) => [player.id, gameId, side, dpxqSourceSite, player.sourcePlayerId]),
    moves: includeMoveIndex ? gameToMoveRows({ ...game, sourceUrl: game.sourceUrl }).map((row) => [gameId, row.ply, row.moveNo, row.sideToMove, row.moveIccs, row.beforeFen, row.afterFen, row.piece, row.captured, row.phase]) : [],
  };
}

function sqlTuple(values, numeric = new Set()) {
  return `(${values.map((value, index) => numeric.has(index) ? Number(value) : sqlValue(value)).join(", ")})`;
}

function multiInsert(table, columns, rows, updateClause, numeric = new Set()) {
  if (rows.length === 0) return "";
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${rows.map((row) => sqlTuple(row, numeric)).join(",\n")}\nON DUPLICATE KEY UPDATE ${updateClause};`;
}

function batchSql(games, includeMoveIndex) {
  const playerRows = new Map();
  const gameRows = [];
  const sourceRows = [];
  const refRows = new Map();
  const moveRows = [];
  for (const game of games) {
    const record = gameRecords(game, includeMoveIndex);
    for (const player of record.players) playerRows.set(player.id, [player.id, player.name, player.name, dpxqSourceSite, player.sourcePlayerId, player.profileUrl]);
    gameRows.push(record.game);
    sourceRows.push(record.source);
    for (const ref of record.refs) refRows.set(`${ref[0]}|${ref[1]}`, ref);
    moveRows.push(...record.moves);
  }
  return [
    multiInsert("master_players", ["id", "name", "normalized_name", "source_site", "source_player_id", "profile_url"], [...playerRows.values()], "name=VALUES(name), normalized_name=VALUES(normalized_name), profile_url=VALUES(profile_url)"),
    multiInsert("master_games", ["id", "master_player_id", "source_site", "source_url", "title", "red_player", "black_player", "event_name", "round_name", "game_date", "result", "opening", "move_count", "moves_json", "raw_notation_type", "fingerprint", "license_note", "crawl_status"], gameRows, "title=VALUES(title), red_player=VALUES(red_player), black_player=VALUES(black_player), event_name=VALUES(event_name), round_name=VALUES(round_name), game_date=VALUES(game_date), result=VALUES(result), opening=VALUES(opening), move_count=VALUES(move_count), moves_json=VALUES(moves_json), crawl_status=VALUES(crawl_status)", new Set([12])),
    multiInsert("master_game_sources", ["game_id", "source_site", "source_url", "source_title", "raw_notation_type"], sourceRows, "game_id=VALUES(game_id), source_title=VALUES(source_title), last_seen_at=CURRENT_TIMESTAMP(6)"),
    multiInsert("master_game_player_refs", ["master_player_id", "game_id", "side", "source_site", "source_player_id"], [...refRows.values()], "side=VALUES(side), source_site=VALUES(source_site), source_player_id=VALUES(source_player_id)"),
    multiInsert("master_game_moves", ["game_id", "ply", "move_no", "side_to_move", "move_iccs", "before_fen", "after_fen", "piece", "captured", "phase"], moveRows, "move_no=VALUES(move_no), side_to_move=VALUES(side_to_move), move_iccs=VALUES(move_iccs), before_fen=VALUES(before_fen), after_fen=VALUES(after_fen), piece=VALUES(piece), captured=VALUES(captured), phase=VALUES(phase)", new Set([1, 2])),
  ].filter(Boolean).join("\n");
}

function writeToMysql(databaseUrl) {
  const db = parseDatabaseUrl(databaseUrl);
  const child = spawn("mysql", ["--protocol=TCP", "--default-character-set=utf8mb4", "-h", db.host, "-P", db.port, "-u", db.user, db.database], {
    env: { ...process.env, MYSQL_PWD: db.password },
    stdio: ["pipe", "inherit", "pipe"],
  });
  let stderr = "";
  let stdinError;
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  // MySQL can reject a batch and close stdin before Node observes the process
  // exit. Keep that error attached to the import instead of crashing on EPIPE.
  child.stdin.on("error", (error) => { stdinError = error; });
  const done = new Promise((resolveDone, rejectDone) => {
    child.on("error", rejectDone);
    child.on("close", (code) => code === 0 ? resolveDone() : rejectDone(new Error(stderr.trim() || `mysql exited ${code}`)));
  });
  // A failed write may surface before `close`; the caller receives that write
  // error, while this handler prevents a second unhandled rejection.
  done.catch(() => {});
  async function write(sql) {
    if (stdinError) throw new Error(stderr.trim() || `mysql stdin failed: ${stdinError.message}`);
    if (child.stdin.write(sql)) return;
    await new Promise((resolveDrain, rejectDrain) => {
      const cleanup = () => {
        child.stdin.off("drain", onDrain);
        child.stdin.off("error", fail);
        child.off("close", fail);
      };
      const onDrain = () => { cleanup(); resolveDrain(); };
      const fail = () => {
        cleanup();
        rejectDrain(new Error(stderr.trim() || `mysql stdin failed: ${stdinError?.message || "connection closed"}`));
      };
      child.stdin.once("drain", onDrain);
      child.stdin.once("error", fail);
      child.once("close", fail);
    });
  }
  return { write, close: async () => { child.stdin.end(); await done; } };
}

async function main() {
  const sqlitePath = argValue("sqlite", defaultSqlite);
  const databaseUrl = argValue("database-url", process.env.DATABASE_URL || defaultDatabaseUrl);
  const batchSize = Math.max(1, Number(argValue("batch-size", "150")) || 150);
  const maxMoveRowsPerBatch = Math.max(1, Number(argValue("max-move-rows-per-batch", "16000")) || 16000);
  const includeMoveIndex = !hasFlag("skip-move-index");
  const limit = Math.max(0, Number(argValue("limit", "0")) || 0);
  const dryRun = hasFlag("dry-run");
  if (!existsSync(sqlitePath)) throw new Error(`找不到 SQLite 数据库：${sqlitePath}`);

  const separator = "\u001f";
  const sqlite = spawn("sqlite3", ["-readonly", "-separator", separator, sqlitePath,
    "SELECT id, owner, date, replace(replace(replace(ubb, char(13), ' '), char(10), ' '), char(31), ' ') FROM games WHERE status = 'ok' ORDER BY id;"],
  { stdio: ["ignore", "pipe", "pipe"] });
  let sqliteError = "";
  sqlite.stderr.on("data", (chunk) => { sqliteError += chunk.toString(); });
  const sqliteDone = new Promise((resolveDone, rejectDone) => {
    sqlite.on("error", rejectDone);
    sqlite.on("close", (code) => code === 0 ? resolveDone() : rejectDone(new Error(sqliteError.trim() || `sqlite3 exited ${code}`)));
  });

  const mysql = dryRun ? undefined : writeToMysql(databaseUrl);
  if (mysql) await mysql.write("SET NAMES utf8mb4;\n");
  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let moveRows = 0;
  const playerNames = new Set();
  let batch = [];
  let batchMoveRows = 0;
  let stoppedEarly = false;

  async function flush() {
    if (batch.length === 0) return;
    if (mysql) await mysql.write(`START TRANSACTION;\n${batchSql(batch, includeMoveIndex)}\nCOMMIT;\n`);
    imported += batch.length;
    console.log(`${dryRun ? "Validated" : "Imported"} ${imported} games; ${moveRows} source move rows${includeMoveIndex ? " indexed" : " (index deferred)"}; skipped ${skipped}.`);
    batch = [];
    batchMoveRows = 0;
  }

  const reader = createInterface({ input: sqlite.stdout, crlfDelay: Infinity });
  for await (const line of reader) {
    if (limit && scanned >= limit) {
      stoppedEarly = true;
      sqlite.kill("SIGTERM");
      break;
    }
    scanned += 1;
    const [id, owner, sourceDate, ubb] = line.split(separator);
    let game;
    try {
      game = gameFromRow({ id: Number(id), owner: owner || "m", sourceDate, ubb });
    } catch (error) {
      skipped += 1;
      console.warn(`Skipped dpxq ${owner}_${id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!game) {
      skipped += 1;
      continue;
    }
    moveRows += game.moves.length;
    playerNames.add(normalizePlayerName(game.redPlayer));
    playerNames.add(normalizePlayerName(game.blackPlayer));
    if (batch.length > 0 && batchMoveRows + game.moves.length > maxMoveRowsPerBatch) await flush();
    batch.push(game);
    batchMoveRows += game.moves.length;
    if (batch.length >= batchSize || batchMoveRows >= maxMoveRowsPerBatch) await flush();
  }
  await flush();
  try {
    await sqliteDone;
  } catch (error) {
    if (!stoppedEarly) throw error;
  }
  if (mysql) await mysql.close();
  console.log(JSON.stringify({ sqlitePath, scanned, imported, skipped, players: playerNames.size, moveRows, moveIndexDeferred: !includeMoveIndex, dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  dhtmlMoveListToIccs,
  extractXiangqiqipuLinks,
  extractGdchessIndexLinks,
  extractGdchessLinks,
  gameToMoveRows,
  gameToPgn,
  gameToPositionJobs,
  parseDhtmlXqBlock,
  parseGameHtml,
} from "./zhao-public-games.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const gdchessBase = "http://www.gdchess.com";
const xiangqiqipuBase = "https://www.xiangqiqipu.com";
const dpxqBase = "http://www.dpxq.com";
const oneXqBase = "http://www.01xq.com";
const defaultDatabaseUrl = "mysql://root:root@localhost:3306/xiangqi";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argValues(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}

function normalizeChineseName(value) {
  return String(value ?? "").replace(/<[^>]+>/g, "").replace(/[\s\u3000]+/g, "").trim();
}

const oneXqNameAliases = new Map([
  ["Lu Qin", "吕钦"],
  ["LvQin", "吕钦"],
  ["LuQin", "吕钦"],
  ["XuTianHong", "徐天红"],
  ["Xu TianHong", "徐天红"],
  ["LiLaiQun", "李来群"],
  ["Li LaiQun", "李来群"],
  ["LiuDaHua", "柳大华"],
  ["Liu DaHua", "柳大华"],
  ["YuYouHua", "于幼华"],
  ["Yu YouHua", "于幼华"],
  ["TaoHanMing", "陶汉明"],
  ["Tao HanMing", "陶汉明"],
  ["CaoYanLei", "曹岩磊"],
  ["Cao YanLei", "曹岩磊"],
  ["MoZiJian", "莫梓健"],
  ["Mo ZiJian", "莫梓健"],
  ["HuRongHua", "胡荣华"],
  ["Hu RongHua", "胡荣华"],
  ["ZhaoGuoRong", "赵国荣"],
  ["Zhao GuoRong", "赵国荣"],
  ["ZhengWeiTong", "郑惟桐"],
  ["Zheng WeiTong", "郑惟桐"],
  ["WangTianYi", "王天一"],
  ["Wang TianYi", "王天一"],
  ["ZhaoXinXin", "赵鑫鑫"],
  ["Zhao XinXin", "赵鑫鑫"],
  ["JiangChuan", "蒋川"],
  ["Jiang Chuan", "蒋川"],
  ["MengChen", "孟辰"],
  ["Meng Chen", "孟辰"],
  ["HongZhi", "洪智"],
  ["Hong Zhi", "洪智"],
  ["WangYang", "汪洋"],
  ["Wang Yang", "汪洋"],
  ["XieJing", "谢靖"],
  ["Xie Jing", "谢靖"],
  ["SunYongZheng", "孙勇征"],
  ["Sun YongZheng", "孙勇征"],
  ["WangBin", "王斌"],
  ["Wang Bin", "王斌"],
  ["XuChao", "徐超"],
  ["Xu Chao", "徐超"],
  ["LiJinHuan", "李锦欢"],
  ["Li JinHuan", "李锦欢"],
  ["ZhaoRuQuan", "赵汝权"],
  ["Zhao RuQuan", "赵汝权"],
  ["WangLinNa", "王琳娜"],
  ["Wang LinNa", "王琳娜"],
]);

function normalizeOneXqName(value) {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  const compact = text.replace(/\s+/g, "");
  return oneXqNameAliases.get(text) || oneXqNameAliases.get(compact) || text || compact;
}

function slugify(value) {
  return normalizeChineseName(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-") || "master";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).toString();
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function uuidFromSeed(seed) {
  const hash = sha256(seed);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function defaultOutDir({ source, sourcePlayerId, player }) {
  return join(repoRoot, ".theory-work", "masters", `${source}-${sourcePlayerId}-${slugify(player)}`);
}

function parseDatabaseUrl(value) {
  const url = new URL(value || defaultDatabaseUrl);
  return {
    host: url.hostname || "localhost",
    port: url.port || "3306",
    user: decodeURIComponent(url.username || "root"),
    password: decodeURIComponent(url.password || ""),
    database: url.pathname.replace(/^\//, "") || "xiangqi",
  };
}

function sqlString(value) {
  return `'${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z")
    .replace(/'/g, "\\'")}'`;
}

function sqlValue(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  return sqlString(value);
}

function normalizeDateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const datePrefix = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s|T|$)/);
  if (datePrefix) return `${datePrefix[1]}-${datePrefix[2].padStart(2, "0")}-${datePrefix[3].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const chinese = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (chinese) return `${chinese[1]}-${chinese[2].padStart(2, "0")}-${chinese[3].padStart(2, "0")}`;
  return "";
}

function gameFingerprint({ redPlayer, blackPlayer, date, event, moves }) {
  const moveHash = sha256((moves ?? []).join(" ")).slice(0, 16);
  return sha256([
    redPlayer,
    blackPlayer,
    normalizeDateValue(date),
    event,
    moveHash,
  ].join("|"));
}

function sqlDateValue(value) {
  return sqlValue(normalizeDateValue(value));
}

function rawNotationType(game) {
  const raw = String(game.rawNotation ?? "");
  if (/^MOVE_STR=/i.test(raw)) return "MOVE_STR";
  if (/\[DhtmlXQ\]/i.test(raw)) return "DhtmlXQ";
  return "UNKNOWN";
}

function playerSide(game, player) {
  if (String(game.redPlayer ?? "").includes(player)) return "red";
  if (String(game.blackPlayer ?? "").includes(player)) return "black";
  return "";
}

async function fetchText(url, delayMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      },
    });
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    clearTimeout(timeout);
    return text;
  } catch (fetchError) {
    clearTimeout(timeout);
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-L",
      "-A",
      "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
      "-H",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
      "--max-time",
      "30",
      url,
    ], { maxBuffer: 20 * 1024 * 1024 });
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    if (!stdout.trim()) throw fetchError;
    return stdout;
  }
}

async function fetchPostForm(url, fields, delayMs) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "-L",
    "-A",
    "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
    "-H",
    "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "--max-time",
    "30",
    "-X",
    "POST",
    "--data",
    form.toString(),
    url,
  ], { maxBuffer: 20 * 1024 * 1024 });
  if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  return stdout;
}

async function fetchTextDecoded(url, delayMs, encoding = "utf-8") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      },
    });
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = await response.arrayBuffer();
    clearTimeout(timeout);
    return new TextDecoder(encoding).decode(bytes);
  } catch (fetchError) {
    clearTimeout(timeout);
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-L",
      "-A",
      "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
      "-H",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
      "--max-time",
      "30",
      url,
    ], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    if (!stdout.length) throw fetchError;
    return new TextDecoder(encoding).decode(stdout);
  }
}

function applyCandidateHints(game, candidate) {
  if (!game || !candidate) return game;
  let changed = false;
  const listedDate = normalizeDateValue(candidate.listedDate);
  if (!game.date && listedDate) {
    game.date = listedDate;
    changed = true;
  }
  if (!game.event && candidate.eventHint) {
    game.event = candidate.eventHint;
    changed = true;
  }
  if (!game.round && candidate.roundHint) game.round = candidate.roundHint;
  if (changed) {
    game.fingerprint = gameFingerprint({
      redPlayer: game.redPlayer,
      blackPlayer: game.blackPlayer,
      date: game.date,
      event: game.event,
      moves: game.moves,
    });
    game.duplicateSourceUrls = [game.sourceUrl];
  }
  return game;
}

function normalizeDpxqResult(value) {
  const text = String(value ?? "");
  if (/黑胜|先负| 负 |负/.test(text)) return "0-1";
  if (/红胜|先胜| 胜 |胜/.test(text)) return "1-0";
  if (/和棋| 和 |和/.test(text)) return "1/2-1/2";
  return "*";
}

function dpxqPlayerListUrl(player, page = 1) {
  const base = `${dpxqBase}/hldcg/share/chess_大师对局/按棋手姓名/${player}/全部对局/`;
  return encodeURI(page <= 1 ? base : `${base}${page}.html`);
}

function extractDpxqPlayerLinks(html, baseUrl = dpxqBase, player = "郑惟桐") {
  const links = new Map();
  for (const rowMatch of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    if (!/view_m_\d+\.html/i.test(rowHtml) || !rowHtml.includes(player)) continue;
    const href = rowHtml.match(/href=["']([^"']*view_m_\d+\.html)["']/i)?.[1];
    if (!href) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
    const title = stripHtml(rowHtml.match(/<a\b[^>]*view_m_\d+\.html[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    const sourceUrl = absoluteUrl(href, baseUrl);
    links.set(sourceUrl, {
      sourceUrl,
      sourceSite: "dpxq.com",
      title,
      listedDate: normalizeDateValue(cells[1]),
      eventHint: cells[2] ?? "",
      roundHint: cells[3] ?? "",
      listedMoveCount: cells[5] ?? "",
    });
  }
  return [...links.values()];
}

function parseDpxqGame(html, sourceUrl, candidate = {}) {
  const parsedBlock = parseDhtmlXqBlock(html);
  const fields = parsedBlock?.fields ?? {};
  const moveList =
    String(html).match(/var\s+DhtmlXQ_movelist\s*=\s*['"]\[DhtmlXQ_movelist\](\d+)\[\/DhtmlXQ_movelist\]['"]/i)?.[1]
    || fields.movelist
    || "";
  const moves = dhtmlMoveListToIccs(moveList);
  if (moves.length === 0) return undefined;

  const pageTitle = stripHtml(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = fields.title || candidate.title || pageTitle.replace(/\s*-\s*东萍象棋棋谱仓库\s*$/i, "");
  const redPlayer = normalizeChineseName(fields.redname || fields.red || "");
  const blackPlayer = normalizeChineseName(fields.blackname || fields.black || "");
  const event = fields.event || candidate.eventHint || "";
  const date = normalizeDateValue(fields.date || candidate.listedDate || "");
  const result = normalizeDpxqResult(fields.result || title);
  const opening = fields.open || "";
  const fingerprint = gameFingerprint({ redPlayer, blackPlayer, date, event, moves });
  return {
    sourceUrl,
    sourceSite: "dpxq.com",
    crawlStatus: "parsed",
    title,
    redPlayer,
    blackPlayer,
    event,
    round: fields.round || candidate.roundHint || "",
    date,
    result,
    opening,
    moves,
    rawNotation: `[DhtmlXQ]\n${Object.entries(fields).map(([key, value]) => `[DhtmlXQ_${key}]${value}[/DhtmlXQ_${key}]`).join("\n")}\n[DhtmlXQ_movelist]${moveList}[/DhtmlXQ_movelist]\n[/DhtmlXQ]`,
    fingerprint,
    duplicateSourceUrls: [sourceUrl],
    licenseNote: "东萍象棋网公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。",
  };
}

function normalizeCandidateDate(value) {
  const normalized = normalizeDateValue(value);
  return normalized || "";
}

function refreshFingerprint(game) {
  game.fingerprint = gameFingerprint({
    redPlayer: game.redPlayer,
    blackPlayer: game.blackPlayer,
    date: game.date,
    event: game.event,
    moves: game.moves,
  });
  game.duplicateSourceUrls = [game.sourceUrl];
  return game;
}

function applyOneXqCandidateHints(game, candidate) {
  if (!game || !candidate) return game;
  let changed = false;
  const date = normalizeCandidateDate(candidate.listedDate);
  if (date && game.date !== date) {
    game.date = date;
    changed = true;
  }
  if (candidate.eventHint && !game.event) {
    game.event = candidate.eventHint;
    changed = true;
  }
  if (candidate.roundHint && !game.round) {
    game.round = candidate.roundHint;
  }
  if (candidate.openingHint && !game.opening) {
    game.opening = candidate.openingHint;
  }
  if (changed) refreshFingerprint(game);
  return game;
}

export function extractOneXqProfileEventLinks(html, baseUrl = oneXqBase) {
  const links = new Map();
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const eventHref = attrs.match(/\bhref=(?:"([^"]*EventInfo\.asp\?eid=\d+[^"]*)"|'([^']*EventInfo\.asp\?eid=\d+[^']*)'|([^\s>]*EventInfo\.asp\?eid=\d+[^\s>]*))/i);
    if (!eventHref) continue;
    const infoUrl = absoluteUrl(eventHref[1] ?? eventHref[2] ?? eventHref[3], baseUrl);
    const gameUrl = infoUrl.replace(/EventInfo\.asp/i, "GameList.asp");
    const before = String(html).slice(Math.max(0, match.index - 500), match.index);
    const dates = [...before.matchAll(/<td\b[^>]*>\s*(\d{4}(?:-\d{1,2}-\d{1,2})?|\d{8})\s*<\/td>/gi)].map((dateMatch) => dateMatch[1]);
    links.set(gameUrl, {
      sourceUrl: gameUrl,
      infoUrl,
      sourceSite: "01xq.com",
      title: stripHtml(match[2]),
      listedDate: normalizeDateValue(dates.at(-1)),
    });
  }
  return [...links.values()];
}

export function extractOneXqRecentGameLinks(html, baseUrl = oneXqBase, player = "吕钦") {
  const links = new Map();
  const normalizedPlayer = normalizeChineseName(player);
  for (const match of String(html).matchAll(/<b>(\d{8})<\/b>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*([^<\n\r]+)/gi)) {
    const attrs = match[2];
    const href = attrs.match(/\bhref=(?:"([^"]*e_game_view\.asp\?id=[^"]*)"|'([^']*e_game_view\.asp\?id=[^']*)'|([^\s>]*e_game_view\.asp\?id=[^\s>]*))/i);
    if (!href) continue;
    const title = stripHtml(match[3]);
    const normalizedTitle = normalizeChineseName(title.split(/2\+0|2:0|0-2|0:2|1=1|1:1/).map(normalizeOneXqName).join(""));
    if (!normalizedTitle.includes(normalizedPlayer)) continue;
    const sourceUrl = absoluteUrl(href[1] ?? href[2] ?? href[3], baseUrl);
    links.set(sourceUrl, {
      sourceUrl,
      sourceSite: "01xq.com",
      title,
      listedDate: normalizeDateValue(match[1]),
      eventHint: stripHtml(match[4]),
    });
  }
  return [...links.values()];
}

export function extractOneXqGameListLinks(html, baseUrl = oneXqBase, player = "吕钦") {
  const links = new Map();
  const normalizedPlayer = normalizeChineseName(player);
  for (const rowMatch of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    if (!/e_game_view\.asp\?id=/i.test(rowHtml)) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
    if (cells.length < 7) continue;
    const redPlayer = normalizeOneXqName(cells[3]);
    const blackPlayer = normalizeOneXqName(cells[5]);
    if (!normalizeChineseName(`${redPlayer}${blackPlayer}`).includes(normalizedPlayer)) continue;
    const href = rowHtml.match(/\bhref=(?:"([^"]*e_game_view\.asp\?id=[^"]*)"|'([^']*e_game_view\.asp\?id=[^']*)'|([^\s>]*e_game_view\.asp\?id=[^\s>]*))/i);
    if (!href) continue;
    const sourceUrl = absoluteUrl(href[1] ?? href[2] ?? href[3], baseUrl);
    links.set(sourceUrl, {
      sourceUrl,
      sourceSite: "01xq.com",
      title: `${redPlayer} ${cells[4]} ${blackPlayer}`,
      listedDate: normalizeDateValue(cells[0]),
      roundHint: cells[1] ? `Round ${cells[1]}` : "",
      openingHint: cells[8] || "",
    });
  }
  return [...links.values()];
}

function addGame(gamesByFingerprint, game, player) {
  if (!game) return false;
  if (!`${game.redPlayer} ${game.blackPlayer} ${game.title}`.includes(player)) return false;
  const existing = gamesByFingerprint.get(game.fingerprint);
  if (existing) {
    existing.duplicateSourceUrls = [...new Set([...(existing.duplicateSourceUrls ?? [existing.sourceUrl]), game.sourceUrl])];
  } else {
    gamesByFingerprint.set(game.fingerprint, {
      ...game,
      duplicateSourceUrls: game.duplicateSourceUrls ?? [game.sourceUrl],
    });
  }
  return true;
}

function extractGdchessEventGameListLinks(html, baseUrl = `${gdchessBase}/XQData/`) {
  const links = new Map();
  for (const rowMatch of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const rowText = stripHtml(rowHtml);
    for (const linkMatch of rowHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = linkMatch[1];
      const href = attrs.match(/\bhref=(?:"([^"]*GameList\.asp\?eid=\d+[^"]*)"|'([^']*GameList\.asp\?eid=\d+[^']*)'|([^\s>]*GameList\.asp\?eid=\d+[^\s>]*))/i);
      if (!href) continue;
      const url = absoluteUrl(href[1] ?? href[2] ?? href[3], baseUrl);
      links.set(url, {
        sourceUrl: url,
        sourceSite: "gdchess.com",
        title: rowText,
      });
    }
  }
  return [...links.values()];
}

function gdchessEventPageUrl(eventUrl, page) {
  const url = new URL(eventUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  return url.toString();
}

async function collect() {
  const source = argValue("source", "gdchess");
  const player = argValue("player", "赵鑫鑫");
  const sourcePlayerId = argValue("source-player-id", argValue("gdchess-pid", "0074"));
  if (source !== "gdchess") throw new Error(`当前 collect-import 第一阶段只支持 --source=gdchess，收到：${source}`);
  const maxGames = Number(argValue("max-games", "50"));
  const delayMs = Number(argValue("delay-ms", "800"));
  const maxGdchessIndexPages = Number(argValue("gdchess-index-pages", String(Math.max(1, Math.ceil(maxGames / 20)))));
  const gdchessPageStep = Number(argValue("gdchess-page-step", "0"));
  const seedUrl = argValue("seed-url", `${gdchessBase}/xqgame/xqpgame.asp?pid=${sourcePlayerId}`);
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const indexRecords = [];
  const quiet = hasFlag("quiet");
  const candidateLinks = new Map();
  const gamesByFingerprint = new Map();
  const gdchessIndexQueue = [seedUrl];
  const seenGdchessIndexUrls = new Set();
  const queuedGdchessIndexUrls = new Set([seedUrl]);
  if (!argValue("seed-url", "") && gdchessPageStep > 0) {
    for (let pageIndex = 1; pageIndex < maxGdchessIndexPages; pageIndex += 1) {
      const offset = pageIndex * gdchessPageStep;
      const indexUrl = `${gdchessBase}/xqgame/xqpgame.asp?pid=${encodeURIComponent(sourcePlayerId)}&page=${offset}`;
      gdchessIndexQueue.push(indexUrl);
      queuedGdchessIndexUrls.add(indexUrl);
    }
  }

  await mkdir(outDir, { recursive: true });
  let processedGdchessIndexPages = 0;
  while (gdchessIndexQueue.length > 0 && processedGdchessIndexPages < maxGdchessIndexPages && candidateLinks.size < maxGames * 3) {
    const indexUrl = gdchessIndexQueue.shift();
    if (!indexUrl || seenGdchessIndexUrls.has(indexUrl)) continue;
    seenGdchessIndexUrls.add(indexUrl);
    try {
      const html = await fetchText(indexUrl, delayMs);
      const directGame = parseGameHtml(html, indexUrl);
      if (directGame && addGame(gamesByFingerprint, directGame, player)) {
        indexRecords.push({ sourceUrl: indexUrl, sourceSite: "gdchess.com", crawlStatus: "parsed_direct" });
      }
      const discoveredGames = extractGdchessLinks(html, indexUrl, player);
      for (const link of discoveredGames) candidateLinks.set(link.sourceUrl, link);
      for (const nextIndexUrl of extractGdchessIndexLinks(html, indexUrl, sourcePlayerId)) {
        if (!seenGdchessIndexUrls.has(nextIndexUrl) && !queuedGdchessIndexUrls.has(nextIndexUrl)) {
          gdchessIndexQueue.push(nextIndexUrl);
          queuedGdchessIndexUrls.add(nextIndexUrl);
        }
      }
      processedGdchessIndexPages += 1;
      if (!quiet) {
        console.log(`Indexed ${processedGdchessIndexPages}/${maxGdchessIndexPages} pages, candidate games: ${candidateLinks.size}`);
      }
      indexRecords.push({
        sourceUrl: indexUrl,
        sourceSite: "gdchess.com",
        crawlStatus: "indexed_page",
        discoveredLinks: discoveredGames.length,
        processedGdchessIndexPages,
      });
    } catch (error) {
      indexRecords.push({ sourceUrl: indexUrl, sourceSite: "gdchess.com", crawlStatus: "failed", error: String(error.message ?? error) });
    }
  }

  let parsedCandidates = 0;
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchText(link.sourceUrl, delayMs);
      const game = applyCandidateHints(parseGameHtml(html, link.sourceUrl), link);
      addGame(gamesByFingerprint, game, player);
      parsedCandidates += 1;
      if (!quiet && (parsedCandidates % 25 === 0 || gamesByFingerprint.size >= maxGames)) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} candidate pages, games: ${gamesByFingerprint.size}`);
      }
    } catch (error) {
      parsedCandidates += 1;
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: link.sourceSite || "gdchess.com", crawlStatus: "failed", error: String(error.message ?? error) });
      if (!quiet && parsedCandidates % 25 === 0) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} candidate pages, games: ${gamesByFingerprint.size}`);
      }
    }
  }

  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  await writeJsonl(join(outDir, "games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
    player,
    source,
    sourcePlayerId,
    profileUrl: seedUrl,
    generatedAt: new Date().toISOString(),
    games: games.length,
    samples: samples.length,
  }, null, 2)}\n`);
  return { outDir, games, samples, indexRecords, player, source, sourcePlayerId, profileUrl: seedUrl };
}

async function collectFromGdchessEvents() {
  const source = argValue("source", "gdchess");
  const player = argValue("player", "郑惟桐");
  const sourcePlayerId = argValue("source-player-id", argValue("gdchess-pid", "1799"));
  if (source !== "gdchess") throw new Error(`当前 collect-import-events 第一阶段只支持 --source=gdchess，收到：${source}`);
  const maxGames = Number(argValue("max-games", "2000"));
  const delayMs = Number(argValue("delay-ms", "3000"));
  const eventSearchPages = Number(argValue("event-search-pages", "3"));
  const eventGamePages = Number(argValue("event-game-pages", "2"));
  const maxEvents = Number(argValue("max-events", "10000"));
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const quiet = hasFlag("quiet");
  const profileUrl = argValue("profile-url", `${gdchessBase}/xqgame/xqpgame.asp?pid=${sourcePlayerId}`);
  const eventRecords = [];
  const indexRecords = [];
  const candidateLinks = new Map();
  const gamesByFingerprint = new Map();

  await mkdir(outDir, { recursive: true });

  for (let page = 1; page <= eventSearchPages; page += 1) {
    const searchUrl = `${gdchessBase}/XQData/?playername=${encodeURIComponent(player)}${page > 1 ? `&page=${page}` : ""}`;
    try {
      const html = await fetchText(searchUrl, delayMs);
      const events = extractGdchessEventGameListLinks(html, searchUrl);
      for (const event of events) eventRecords.push({ ...event, searchUrl, searchPage: page });
      if (!quiet) console.log(`Searched event page ${page}/${eventSearchPages}, events: ${eventRecords.length}`);
    } catch (error) {
      indexRecords.push({ sourceUrl: searchUrl, sourceSite: "gdchess.com", crawlStatus: "failed_event_search", error: String(error.message ?? error) });
    }
  }

  const uniqueEvents = [...new Map(eventRecords.map((event) => [event.sourceUrl, event])).values()].slice(0, maxEvents);
  let processedEventPages = 0;
  for (const event of uniqueEvents) {
    for (let page = 1; page <= eventGamePages; page += 1) {
      const gameListUrl = gdchessEventPageUrl(event.sourceUrl, page);
      try {
        const html = await fetchText(gameListUrl, delayMs);
        const discoveredGames = extractGdchessLinks(html, gameListUrl, player);
        for (const link of discoveredGames) candidateLinks.set(link.sourceUrl, { ...link, eventListUrl: event.sourceUrl });
        processedEventPages += 1;
        indexRecords.push({
          sourceUrl: gameListUrl,
          sourceSite: "gdchess.com",
          crawlStatus: "indexed_event_games",
          discoveredLinks: discoveredGames.length,
          eventTitle: event.title,
        });
        if (!quiet && (processedEventPages % 10 === 0 || discoveredGames.length > 0)) {
          console.log(`Indexed event game page ${processedEventPages}/${uniqueEvents.length * eventGamePages}, candidate games: ${candidateLinks.size}`);
        }
      } catch (error) {
        processedEventPages += 1;
        indexRecords.push({ sourceUrl: gameListUrl, sourceSite: "gdchess.com", crawlStatus: "failed_event_games", error: String(error.message ?? error), eventTitle: event.title });
      }
    }
  }

  let parsedCandidates = 0;
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchText(link.sourceUrl, delayMs);
      const game = applyCandidateHints(parseGameHtml(html, link.sourceUrl), link);
      addGame(gamesByFingerprint, game, player);
      parsedCandidates += 1;
      if (!quiet && (parsedCandidates % 25 === 0 || gamesByFingerprint.size >= maxGames)) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} candidate pages, games: ${gamesByFingerprint.size}`);
      }
    } catch (error) {
      parsedCandidates += 1;
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: link.sourceSite || "gdchess.com", crawlStatus: "failed", error: String(error.message ?? error) });
      if (!quiet && parsedCandidates % 25 === 0) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} candidate pages, games: ${gamesByFingerprint.size}`);
      }
    }
  }

  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  await writeJsonl(join(outDir, "event-search.index.jsonl"), eventRecords);
  await writeJsonl(join(outDir, "games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
    player,
    source,
    sourcePlayerId,
    profileUrl,
    collectionMode: "gdchess-event-search",
    generatedAt: new Date().toISOString(),
    eventSearchPages,
    eventGamePages,
    events: uniqueEvents.length,
    candidateLinks: candidateLinks.size,
    games: games.length,
    samples: samples.length,
  }, null, 2)}\n`);
  return { outDir, games, samples, indexRecords, player, source, sourcePlayerId, profileUrl };
}

async function collectFromXiangqiqipuSearch() {
  const source = argValue("source", "xiangqiqipu");
  const player = argValue("player", "郑惟桐");
  const sourcePlayerId = argValue("source-player-id", argValue("xiangqiqipu-player-id", "9"));
  if (source !== "xiangqiqipu") throw new Error(`collect-import-xiangqiqipu-search 只支持 --source=xiangqiqipu，收到：${source}`);
  const maxGames = Number(argValue("max-games", "1000"));
  const delayMs = Number(argValue("delay-ms", "3000"));
  const searchPages = Number(argValue("search-pages", "33"));
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const quiet = hasFlag("quiet");
  const profileUrl = argValue("profile-url", `${xiangqiqipuBase}/Player/View-${sourcePlayerId}.html`);
  const indexRecords = [];
  const candidateLinks = new Map();
  const gamesByFingerprint = new Map();

  await mkdir(outDir, { recursive: true });

  for (let page = 1; page <= searchPages; page += 1) {
    const searchUrl = `${xiangqiqipuBase}/Article/Search`;
    try {
      const html = await fetchPostForm(searchUrl, { key: player, page }, delayMs);
      const links = extractXiangqiqipuLinks(html, searchUrl, player);
      for (const link of links) candidateLinks.set(link.sourceUrl, link);
      indexRecords.push({
        sourceUrl: `${searchUrl}?key=${encodeURIComponent(player)}&page=${page}`,
        sourceSite: "xiangqiqipu.com",
        crawlStatus: "indexed_search_page",
        discoveredLinks: links.length,
      });
      if (!quiet) console.log(`Searched xiangqiqipu page ${page}/${searchPages}, candidate pages: ${candidateLinks.size}`);
    } catch (error) {
      indexRecords.push({
        sourceUrl: `${searchUrl}?key=${encodeURIComponent(player)}&page=${page}`,
        sourceSite: "xiangqiqipu.com",
        crawlStatus: "failed_search_page",
        error: String(error.message ?? error),
      });
    }
  }

  let parsedCandidates = 0;
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchText(link.sourceUrl, delayMs);
      const game = parseGameHtml(html, link.sourceUrl);
      const added = addGame(gamesByFingerprint, game, player);
      parsedCandidates += 1;
      if (!added) {
        indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "xiangqiqipu.com", crawlStatus: "skipped_no_parseable_game" });
      }
      if (!quiet && (parsedCandidates % 25 === 0 || gamesByFingerprint.size >= maxGames)) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} xiangqiqipu pages, games: ${gamesByFingerprint.size}`);
      }
    } catch (error) {
      parsedCandidates += 1;
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "xiangqiqipu.com", crawlStatus: "failed", error: String(error.message ?? error) });
      if (!quiet && parsedCandidates % 25 === 0) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} xiangqiqipu pages, games: ${gamesByFingerprint.size}`);
      }
    }
  }

  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  await writeJsonl(join(outDir, "games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
    player,
    source,
    sourcePlayerId,
    profileUrl,
    collectionMode: "xiangqiqipu-search",
    generatedAt: new Date().toISOString(),
    searchPages,
    candidateLinks: candidateLinks.size,
    games: games.length,
    samples: samples.length,
  }, null, 2)}\n`);
  return { outDir, games, samples, indexRecords, player, source, sourcePlayerId, profileUrl };
}

async function collectFromDpxqPlayer() {
  const source = argValue("source", "dpxq");
  const player = argValue("player", "郑惟桐");
  const sourcePlayerId = argValue("source-player-id", argValue("dpxq-player-id", normalizeChineseName(player)));
  if (source !== "dpxq") throw new Error(`collect-import-dpxq-player 只支持 --source=dpxq，收到：${source}`);
  const maxGames = Number(argValue("max-games", "1000"));
  const delayMs = Number(argValue("delay-ms", "5000"));
  const pages = Number(argValue("pages", "15"));
  const startPage = Number(argValue("start-page", "1"));
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const quiet = hasFlag("quiet");
  const profileUrl = argValue("profile-url", dpxqPlayerListUrl(player, 1));
  const indexRecords = [];
  const candidateLinks = new Map();
  const gamesByFingerprint = new Map();

  await mkdir(outDir, { recursive: true });

  for (let page = startPage; page <= pages; page += 1) {
    const listUrl = dpxqPlayerListUrl(player, page);
    try {
      const html = await fetchTextDecoded(listUrl, delayMs, "gb18030");
      const links = extractDpxqPlayerLinks(html, listUrl, player);
      for (const link of links) candidateLinks.set(link.sourceUrl, link);
      indexRecords.push({
        sourceUrl: listUrl,
        sourceSite: "dpxq.com",
        crawlStatus: "indexed_player_page",
        discoveredLinks: links.length,
      });
      if (!quiet) console.log(`Indexed dpxq page ${page}/${pages}, candidate pages: ${candidateLinks.size}`);
      if (links.length === 0 && page > 1) break;
    } catch (error) {
      indexRecords.push({
        sourceUrl: listUrl,
        sourceSite: "dpxq.com",
        crawlStatus: "failed_player_page",
        error: String(error.message ?? error),
      });
      if (!quiet) console.log(`Failed dpxq page ${page}/${pages}: ${error.message ?? error}`);
    }
  }

  let parsedCandidates = 0;
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchTextDecoded(link.sourceUrl, delayMs, "gb18030");
      const game = parseDpxqGame(html, link.sourceUrl, link);
      const added = addGame(gamesByFingerprint, game, player);
      parsedCandidates += 1;
      if (!added) {
        indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "dpxq.com", crawlStatus: "skipped_no_parseable_game" });
      }
      if (!quiet && (parsedCandidates % 25 === 0 || gamesByFingerprint.size >= maxGames)) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} dpxq pages, games: ${gamesByFingerprint.size}`);
      }
    } catch (error) {
      parsedCandidates += 1;
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "dpxq.com", crawlStatus: "failed", error: String(error.message ?? error) });
      if (!quiet && parsedCandidates % 25 === 0) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} dpxq pages, games: ${gamesByFingerprint.size}`);
      }
    }
  }

  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  await writeJsonl(join(outDir, "games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
    player,
    source,
    sourcePlayerId,
    profileUrl,
    collectionMode: "dpxq-player",
    generatedAt: new Date().toISOString(),
    pages,
    startPage,
    candidateLinks: candidateLinks.size,
    games: games.length,
    samples: samples.length,
  }, null, 2)}\n`);
  return { outDir, games, samples, indexRecords, player, source, sourcePlayerId, profileUrl };
}

async function collectFromOneXqEvents() {
  const source = argValue("source", "01xq");
  const player = argValue("player", "吕钦");
  const sourcePlayerId = argValue("source-player-id", argValue("01xq-pid", "0002"));
  if (source !== "01xq") throw new Error(`collect-01xq-events 只支持 --source=01xq，收到：${source}`);
  const maxGames = Number(argValue("max-games", "300"));
  const delayMs = Number(argValue("delay-ms", "3000"));
  const maxEvents = Number(argValue("max-events", "80"));
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const quiet = hasFlag("quiet");
  const profileUrl = argValue("profile-url", `${oneXqBase}/xqplayer/xqplayer.asp?pid=${sourcePlayerId}`);
  const eventRecords = [];
  const indexRecords = [];
  const candidateLinks = new Map();
  const gamesByFingerprint = new Map();

  await mkdir(outDir, { recursive: true });

  try {
    const profileHtml = await fetchText(profileUrl, delayMs);
    const recentLinks = extractOneXqRecentGameLinks(profileHtml, profileUrl, player);
    const eventLinks = extractOneXqProfileEventLinks(profileHtml, profileUrl).slice(0, maxEvents);
    for (const link of recentLinks) candidateLinks.set(link.sourceUrl, link);
    for (const event of eventLinks) eventRecords.push(event);
    indexRecords.push({
      sourceUrl: profileUrl,
      sourceSite: "01xq.com",
      crawlStatus: "indexed_profile",
      recentLinks: recentLinks.length,
      eventLinks: eventLinks.length,
    });
    if (!quiet) console.log(`Indexed 01xq profile, recent games: ${recentLinks.length}, events: ${eventLinks.length}`);
  } catch (error) {
    indexRecords.push({
      sourceUrl: profileUrl,
      sourceSite: "01xq.com",
      crawlStatus: "failed_profile",
      error: String(error.message ?? error),
    });
  }

  let processedEvents = 0;
  for (const event of eventRecords) {
    if (candidateLinks.size >= maxGames * 3) break;
    try {
      const html = await fetchText(event.sourceUrl, delayMs);
      const links = extractOneXqGameListLinks(html, event.sourceUrl, player);
      for (const link of links) {
        candidateLinks.set(link.sourceUrl, {
          ...link,
          eventHint: event.title || link.eventHint || "",
          listedDate: link.listedDate || event.listedDate || "",
          eventListUrl: event.sourceUrl,
        });
      }
      processedEvents += 1;
      indexRecords.push({
        sourceUrl: event.sourceUrl,
        sourceSite: "01xq.com",
        crawlStatus: "indexed_event_games",
        eventTitle: event.title,
        discoveredLinks: links.length,
      });
      if (!quiet && (processedEvents % 10 === 0 || links.length > 0)) {
        console.log(`Indexed 01xq event ${processedEvents}/${eventRecords.length}, candidate games: ${candidateLinks.size}`);
      }
    } catch (error) {
      processedEvents += 1;
      indexRecords.push({
        sourceUrl: event.sourceUrl,
        sourceSite: "01xq.com",
        crawlStatus: "failed_event_games",
        eventTitle: event.title,
        error: String(error.message ?? error),
      });
      if (!quiet && processedEvents % 10 === 0) {
        console.log(`Indexed 01xq event ${processedEvents}/${eventRecords.length}, candidate games: ${candidateLinks.size}`);
      }
    }
  }

  let parsedCandidates = 0;
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchText(link.sourceUrl, delayMs);
      const game = applyOneXqCandidateHints(parseGameHtml(html, link.sourceUrl), link);
      const added = addGame(gamesByFingerprint, game, player);
      parsedCandidates += 1;
      if (!added) {
        indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "01xq.com", crawlStatus: "skipped_no_parseable_game" });
      }
      if (!quiet && (parsedCandidates % 25 === 0 || gamesByFingerprint.size >= maxGames)) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} 01xq pages, games: ${gamesByFingerprint.size}`);
      }
    } catch (error) {
      parsedCandidates += 1;
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: "01xq.com", crawlStatus: "failed", error: String(error.message ?? error) });
      if (!quiet && parsedCandidates % 25 === 0) {
        console.log(`Parsed ${parsedCandidates}/${candidateLinks.size} 01xq pages, games: ${gamesByFingerprint.size}`);
      }
    }
  }

  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  await writeJsonl(join(outDir, "event-search.index.jsonl"), eventRecords);
  await writeJsonl(join(outDir, "games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify({
    player,
    source,
    sourcePlayerId,
    profileUrl,
    collectionMode: "01xq-events",
    generatedAt: new Date().toISOString(),
    maxEvents,
    events: eventRecords.length,
    candidateLinks: candidateLinks.size,
    games: games.length,
    samples: samples.length,
  }, null, 2)}\n`);
  return { outDir, games, samples, indexRecords, player, source, sourcePlayerId, profileUrl };
}

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJsonl(path, rows) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`);
}

async function runMysql(sql, databaseUrl) {
  const db = parseDatabaseUrl(databaseUrl);
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn("mysql", [
      "--protocol=TCP",
      "-h", db.host,
      "-P", db.port,
      "-u", db.user,
      db.database,
    ], {
      env: { ...process.env, MYSQL_PWD: db.password },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(stderr.trim() || `mysql exited with ${code}`));
    });
    child.stdin.end(sql);
  });
}

function insertPlayerSql({ player, source, sourcePlayerId, profileUrl }) {
  const playerId = uuidFromSeed(`master-player|${source}|${sourcePlayerId}`);
  return {
    playerId,
    sql: `INSERT INTO master_players (id, name, normalized_name, source_site, source_player_id, profile_url)
VALUES (${sqlString(playerId)}, ${sqlString(player)}, ${sqlString(normalizeChineseName(player))}, ${sqlString(`${source}.com`)}, ${sqlString(sourcePlayerId)}, ${sqlString(profileUrl)})
ON DUPLICATE KEY UPDATE name=VALUES(name), normalized_name=VALUES(normalized_name), profile_url=VALUES(profile_url);`,
  };
}

function gameSql(game, playerId, sourceSite, player, sourcePlayerId) {
  const gameId = uuidFromSeed(`master-game|${game.fingerprint}`);
  const side = playerSide(game, player);
  const lines = [];
  lines.push(`INSERT INTO master_games (id, master_player_id, source_site, source_url, title, red_player, black_player, event_name, round_name, game_date, result, opening, move_count, moves_json, raw_notation_type, fingerprint, license_note, crawl_status)
VALUES (${sqlString(gameId)}, ${sqlString(playerId)}, ${sqlString(game.sourceSite || sourceSite)}, ${sqlString(game.sourceUrl)}, ${sqlString(game.title || `${game.redPlayer} vs ${game.blackPlayer}`)}, ${sqlString(game.redPlayer || "")}, ${sqlString(game.blackPlayer || "")}, ${sqlValue(game.event)}, ${sqlValue(game.round)}, ${sqlDateValue(game.date)}, ${sqlString(game.result || "*")}, ${sqlValue(game.opening)}, ${Number(game.moves?.length ?? 0)}, ${sqlString(JSON.stringify(game.moves ?? []))}, ${sqlString(rawNotationType(game))}, ${sqlString(game.fingerprint)}, ${sqlString(game.licenseNote || "公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。")}, ${sqlString(game.crawlStatus || "parsed")})
ON DUPLICATE KEY UPDATE source_site=VALUES(source_site), source_url=VALUES(source_url), title=VALUES(title), red_player=VALUES(red_player), black_player=VALUES(black_player), event_name=VALUES(event_name), round_name=VALUES(round_name), game_date=VALUES(game_date), result=VALUES(result), opening=VALUES(opening), move_count=VALUES(move_count), moves_json=VALUES(moves_json), raw_notation_type=VALUES(raw_notation_type), license_note=VALUES(license_note), crawl_status=VALUES(crawl_status);`);

  if (side) {
    lines.push(`INSERT INTO master_game_player_refs (master_player_id, game_id, side, source_site, source_player_id)
VALUES (${sqlString(playerId)}, ${sqlString(gameId)}, ${sqlString(side)}, ${sqlString(game.sourceSite || sourceSite)}, ${sqlString(sourcePlayerId)})
ON DUPLICATE KEY UPDATE side=VALUES(side), source_site=VALUES(source_site), source_player_id=VALUES(source_player_id);`);
  }

  for (const sourceUrl of new Set(game.duplicateSourceUrls ?? [game.sourceUrl])) {
    lines.push(`INSERT INTO master_game_sources (game_id, source_site, source_url, source_title, raw_notation_type)
VALUES (${sqlString(gameId)}, ${sqlString(game.sourceSite || sourceSite)}, ${sqlString(sourceUrl)}, ${sqlValue(game.title)}, ${sqlString(rawNotationType(game))})
ON DUPLICATE KEY UPDATE game_id=VALUES(game_id), source_site=VALUES(source_site), source_title=VALUES(source_title), raw_notation_type=VALUES(raw_notation_type), last_seen_at=CURRENT_TIMESTAMP(6);`);
  }

  for (const row of gameToMoveRows(game)) {
    lines.push(`INSERT INTO master_game_moves (game_id, ply, move_no, side_to_move, move_iccs, before_fen, after_fen, piece, captured, phase)
VALUES (${sqlString(gameId)}, ${row.ply}, ${row.moveNo}, ${sqlString(row.sideToMove)}, ${sqlString(row.moveIccs)}, ${sqlString(row.beforeFen)}, ${sqlValue(row.afterFen)}, ${sqlValue(row.piece)}, ${sqlValue(row.captured)}, ${sqlString(row.phase)})
ON DUPLICATE KEY UPDATE move_no=VALUES(move_no), side_to_move=VALUES(side_to_move), move_iccs=VALUES(move_iccs), before_fen=VALUES(before_fen), after_fen=VALUES(after_fen), piece=VALUES(piece), captured=VALUES(captured), phase=VALUES(phase);`);
  }

  for (const sample of gameToPositionJobs(game, player)) {
    lines.push(`INSERT INTO master_position_samples (master_player_id, game_id, ply, master_side, phase, before_fen, played_move)
VALUES (${sqlString(playerId)}, ${sqlString(gameId)}, ${sample.ply}, ${sqlString(sample.masterSide || sample.zhaoSide)}, ${sqlString(sample.phase)}, ${sqlString(sample.beforeFen)}, ${sqlString(sample.playedMove)})
ON DUPLICATE KEY UPDATE master_side=VALUES(master_side), phase=VALUES(phase), before_fen=VALUES(before_fen), played_move=VALUES(played_move);`);
  }
  return lines.join("\n");
}

async function importMysql(options = {}) {
  const source = options.source ?? argValue("source", "gdchess");
  const player = options.player ?? argValue("player", "赵鑫鑫");
  const sourcePlayerId = options.sourcePlayerId ?? argValue("source-player-id", argValue("gdchess-pid", "0074"));
  const profileUrl = options.profileUrl ?? argValue("profile-url", `${gdchessBase}/xqgame/xqpgame.asp?pid=${sourcePlayerId}`);
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const input = resolve(argValue("input", options.input ?? join(outDir, "games.normalized.jsonl")));
  if (!existsSync(input)) throw new Error(`找不到输入文件：${input}`);
  const databaseUrl = argValue("database-url", process.env.DATABASE_URL || defaultDatabaseUrl);
  const chunkSize = Number(argValue("chunk-size", "25"));
  const games = await readJsonl(input);
  const { playerId, sql: playerSql } = insertPlayerSql({ player, source, sourcePlayerId, profileUrl });
  for (let index = 0; index < games.length; index += chunkSize) {
    const chunk = games.slice(index, index + chunkSize);
    const sql = [
      "SET NAMES utf8mb4;",
      "START TRANSACTION;",
      playerSql,
      ...chunk.map((game) => gameSql(game, playerId, `${source}.com`, player, sourcePlayerId)),
      "COMMIT;",
    ].join("\n");
    await runMysql(sql, databaseUrl);
    console.log(`Imported ${Math.min(index + chunk.length, games.length)}/${games.length} games...`);
  }
  return { input, games, playerId };
}

async function exportMysqlSql(options = {}) {
  const source = options.source ?? argValue("source", "merged");
  const player = options.player ?? argValue("player", "吕钦");
  const sourcePlayerId = options.sourcePlayerId ?? argValue("source-player-id", "lu-qin");
  const profileUrl = options.profileUrl ?? argValue("profile-url", `${oneXqBase}/xqplayer/xqplayer.asp?pid=0002`);
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const input = resolve(argValue("input", options.input ?? join(outDir, "games.normalized.jsonl")));
  const output = resolve(argValue("output", join(outDir, "import-master-games.sql")));
  if (!existsSync(input)) throw new Error(`找不到输入文件：${input}`);
  const games = await readJsonl(input);
  const { playerId, sql: playerSql } = insertPlayerSql({ player, source, sourcePlayerId, profileUrl });
  const lines = [
    "SET NAMES utf8mb4;",
    "START TRANSACTION;",
    playerSql,
    ...games.map((game) => gameSql(game, playerId, `${source}.com`, player, sourcePlayerId)),
    "COMMIT;",
  ];
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${lines.join("\n")}\n`);
  return { input, output, games, playerId };
}

function sortGamesForReport(games) {
  return games.slice().sort((left, right) => {
    const dateCompare = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans-CN");
  });
}

async function mergeCollectedGames() {
  const player = argValue("player", "吕钦");
  const sourcePlayerId = argValue("source-player-id", "merged-lu-qin");
  const source = argValue("source", "merged");
  const inputs = argValues("input").map((input) => resolve(input));
  if (inputs.length === 0) throw new Error("merge 需要至少一个 --input=<games.normalized.jsonl>");
  const outDir = resolve(argValue("out-dir", defaultOutDir({ source, sourcePlayerId, player })));
  const gamesByFingerprint = new Map();
  const sourceStats = [];
  for (const input of inputs) {
    const games = await readJsonl(input);
    let added = 0;
    let duplicates = 0;
    for (const game of games) {
      const existing = gamesByFingerprint.get(game.fingerprint);
      if (existing) {
        duplicates += 1;
        existing.duplicateSourceUrls = [...new Set([
          ...(existing.duplicateSourceUrls ?? [existing.sourceUrl]),
          ...(game.duplicateSourceUrls ?? [game.sourceUrl]),
        ])];
        existing.sourceSites = [...new Set([...(existing.sourceSites ?? [existing.sourceSite]), game.sourceSite].filter(Boolean))];
      } else {
        added += 1;
        gamesByFingerprint.set(game.fingerprint, {
          ...game,
          duplicateSourceUrls: game.duplicateSourceUrls ?? [game.sourceUrl],
          sourceSites: [game.sourceSite].filter(Boolean),
        });
      }
    }
    sourceStats.push({ input, rows: games.length, added, duplicates });
  }
  const games = sortGamesForReport([...gamesByFingerprint.values()]);
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  const samples = games.flatMap((game) => gameToPositionJobs(game, player));
  const byResult = {};
  const bySourceSite = {};
  const bySide = { red: 0, black: 0, unknown: 0 };
  const byYear = {};
  for (const game of games) {
    byResult[game.result || "*"] = (byResult[game.result || "*"] || 0) + 1;
    for (const sourceSite of game.sourceSites ?? [game.sourceSite || "unknown"]) {
      bySourceSite[sourceSite || "unknown"] = (bySourceSite[sourceSite || "unknown"] || 0) + 1;
    }
    const side = playerSide(game, player) || "unknown";
    bySide[side] = (bySide[side] || 0) + 1;
    const year = String(game.date || "").slice(0, 4) || "unknown";
    byYear[year] = (byYear[year] || 0) + 1;
  }
  const report = {
    player,
    source,
    sourcePlayerId,
    generatedAt: new Date().toISOString(),
    inputs: sourceStats,
    games: games.length,
    samples: samples.length,
    byResult,
    bySourceSite,
    bySide,
    byYear,
  };
  await writeJsonl(join(outDir, "games.normalized.jsonl"), games);
  await writeJsonl(join(outDir, "position-samples.jsonl"), samples);
  await writeJsonl(join(outDir, "merge-sources.jsonl"), sourceStats);
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, "summary.md"), `${[
    `# ${player}综合公开棋谱包`,
    "",
    `生成时间：${report.generatedAt}`,
    `去重后棋谱数：${games.length}`,
    `局面样本数：${samples.length}`,
    "",
    "## 来源",
    ...sourceStats.map((item) => `- ${item.input}：${item.rows} 行，新增 ${item.added}，重复 ${item.duplicates}`),
    "",
    "## 结果分布",
    ...Object.entries(byResult).map(([key, count]) => `- ${key}：${count}`),
    "",
    "## 执红执黑",
    ...Object.entries(bySide).map(([key, count]) => `- ${key}：${count}`),
    "",
    "## 边界",
    "- 公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。",
    "- 多来源按棋谱指纹去重，保留重复来源地址，未做人名实体统一库合并。",
  ].join("\n")}\n`);
  return { outDir, games, samples, report };
}

async function main() {
  const command = process.argv[2]?.startsWith("--") ? "collect" : process.argv[2] ?? "collect";
  if (command === "collect") {
    const result = await collect();
    console.log(`Collected ${result.games.length} ${result.player} games.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "import-mysql") {
    const result = await importMysql();
    console.log(`Imported ${result.games.length} games from ${result.input}.`);
    return;
  }
  if (command === "export-mysql-sql") {
    const result = await exportMysqlSql();
    console.log(`Exported ${result.games.length} games SQL from ${result.input}.`);
    console.log(`Output: ${result.output}`);
    return;
  }
  if (command === "merge") {
    const result = await mergeCollectedGames();
    console.log(`Merged ${result.games.length} ${result.report.player} games.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "collect-import") {
    const collected = await collect();
    const imported = await importMysql({
      input: join(collected.outDir, "games.normalized.jsonl"),
      source: collected.source,
      player: collected.player,
      sourcePlayerId: collected.sourcePlayerId,
      profileUrl: collected.profileUrl,
    });
    console.log(`Collected and imported ${imported.games.length} games for ${collected.player}.`);
    console.log(`Output: ${collected.outDir}`);
    return;
  }
  if (command === "collect-events") {
    const result = await collectFromGdchessEvents();
    console.log(`Collected ${result.games.length} ${result.player} games from event search.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "collect-import-events") {
    const collected = await collectFromGdchessEvents();
    const imported = await importMysql({
      input: join(collected.outDir, "games.normalized.jsonl"),
      source: collected.source,
      player: collected.player,
      sourcePlayerId: collected.sourcePlayerId,
      profileUrl: collected.profileUrl,
    });
    console.log(`Collected and imported ${imported.games.length} event-search games for ${collected.player}.`);
    console.log(`Output: ${collected.outDir}`);
    return;
  }
  if (command === "collect-xiangqiqipu-search") {
    const result = await collectFromXiangqiqipuSearch();
    console.log(`Collected ${result.games.length} ${result.player} games from xiangqiqipu search.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "collect-import-xiangqiqipu-search") {
    const collected = await collectFromXiangqiqipuSearch();
    const imported = await importMysql({
      input: join(collected.outDir, "games.normalized.jsonl"),
      source: collected.source,
      player: collected.player,
      sourcePlayerId: collected.sourcePlayerId,
      profileUrl: collected.profileUrl,
    });
    console.log(`Collected and imported ${imported.games.length} xiangqiqipu-search games for ${collected.player}.`);
    console.log(`Output: ${collected.outDir}`);
    return;
  }
  if (command === "collect-dpxq-player") {
    const result = await collectFromDpxqPlayer();
    console.log(`Collected ${result.games.length} ${result.player} games from dpxq player pages.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "collect-import-dpxq-player") {
    const collected = await collectFromDpxqPlayer();
    const imported = await importMysql({
      input: join(collected.outDir, "games.normalized.jsonl"),
      source: collected.source,
      player: collected.player,
      sourcePlayerId: collected.sourcePlayerId,
      profileUrl: collected.profileUrl,
    });
    console.log(`Collected and imported ${imported.games.length} dpxq-player games for ${collected.player}.`);
    console.log(`Output: ${collected.outDir}`);
    return;
  }
  if (command === "collect-01xq-events") {
    const result = await collectFromOneXqEvents();
    console.log(`Collected ${result.games.length} ${result.player} games from 01xq event pages.`);
    console.log(`Position samples: ${result.samples.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "collect-import-01xq-events") {
    const collected = await collectFromOneXqEvents();
    const imported = await importMysql({
      input: join(collected.outDir, "games.normalized.jsonl"),
      source: collected.source,
      player: collected.player,
      sourcePlayerId: collected.sourcePlayerId,
      profileUrl: collected.profileUrl,
    });
    console.log(`Collected and imported ${imported.games.length} 01xq event games for ${collected.player}.`);
    console.log(`Output: ${collected.outDir}`);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

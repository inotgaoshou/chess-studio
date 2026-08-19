#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultOutDir = join(repoRoot, ".theory-work", "zhao-games");
const targetPlayer = "赵鑫鑫";
const xiangqiqipuBase = "https://www.xiangqiqipu.com";
const gdchessBase = "http://www.gdchess.com";
const defaultSeeds = [
  "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074",
  "https://www.xiangqiqipu.com/Player/View-12.html",
  "https://www.dpxq.com/hldcg/player_187_7.html",
  "https://www.xqipu.com/search?q=%E8%B5%B5%E9%91%AB%E9%91%AB",
];

const initialBoard = [
  ["r", "n", "b", "a", "k", "a", "b", "n", "r"],
  [null, null, null, null, null, null, null, null, null],
  [null, "c", null, null, null, null, null, "c", null],
  ["p", null, "p", null, "p", null, "p", null, "p"],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ["P", null, "P", null, "P", null, "P", null, "P"],
  [null, "C", null, null, null, null, null, "C", null],
  [null, null, null, null, null, null, null, null, null],
  ["R", "N", "B", "A", "K", "A", "B", "N", "R"],
];

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function argValues(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function stripHtml(value) {
  return htmlDecode(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function htmlDecode(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function absoluteUrl(url, base = xiangqiqipuBase) {
  return new URL(url, base).toString();
}

function normalizeChineseName(value) {
  return stripHtml(value).replace(/[\s\u3000]+/g, "");
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
]);

function normalizeOneXqName(value) {
  const compact = stripHtml(value).replace(/\s+/g, "");
  const spaced = stripHtml(value).replace(/\s+/g, " ").trim();
  return oneXqNameAliases.get(spaced) || oneXqNameAliases.get(compact) || spaced || compact;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gameFingerprint({ redPlayer, blackPlayer, date, event, moves }) {
  const moveHash = sha256(moves.join(" ")).slice(0, 16);
  return sha256([
    redPlayer,
    blackPlayer,
    date,
    event,
    moveHash,
  ].join("|"));
}

function normalizeResult(value) {
  const text = String(value ?? "");
  if (/红胜|先胜|1-0/.test(text)) return "1-0";
  if (/黑胜|先负|0-1/.test(text)) return "0-1";
  if (/和棋|和局|1\/2/.test(text)) return "1/2-1/2";
  return "*";
}

function normalizeOneXqResult(value) {
  const text = String(value ?? "");
  if (/2\s*[:+]\s*0|2\+0/.test(text)) return "1-0";
  if (/0\s*[:-]\s*2|0-2/.test(text)) return "0-1";
  if (/1\s*[=:]\s*1|1=1/.test(text)) return "1/2-1/2";
  return normalizeResult(text);
}

function inferPlayersFromTitle(title) {
  const clean = String(title ?? "")
    .replace(/^.*[:：]/, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = clean.match(/^(.+?)\s+(?:先)?(胜|負|负|和)\s+(.+)$/);
  if (!match) return {};
  return {
    redPlayer: match[1].trim(),
    blackPlayer: match[3].trim(),
    result: match[2] === "胜" ? "1-0" : match[2] === "和" ? "1/2-1/2" : "0-1",
  };
}

function phaseForPly(ply) {
  if (ply <= 24) return "opening";
  if (ply <= 80) return "middle";
  return "endgame";
}

function dhtmlCoordToIccs(col, row) {
  return `${String.fromCharCode("a".charCodeAt(0) + Number(col))}${9 - Number(row)}`;
}

export function dhtmlMoveListToIccs(movelist) {
  const compact = String(movelist ?? "").replace(/\D/g, "");
  const moves = [];
  for (let index = 0; index + 3 < compact.length; index += 4) {
    const [fromCol, fromRow, toCol, toRow] = compact.slice(index, index + 4).split("").map(Number);
    if ([fromCol, fromRow, toCol, toRow].some((value) => !Number.isInteger(value)) || fromCol > 8 || toCol > 8 || fromRow > 9 || toRow > 9) {
      continue;
    }
    moves.push(`${dhtmlCoordToIccs(fromCol, fromRow)}${dhtmlCoordToIccs(toCol, toRow)}`);
  }
  return moves;
}

export function parseDhtmlXqBlock(html) {
  const blockMatch = String(html).match(/\[DhtmlXQ\]([\s\S]*?)\[\/DhtmlXQ\]/i);
  if (!blockMatch) return undefined;
  const fields = {};
  for (const match of blockMatch[1].matchAll(/\[DhtmlXQ_([^\]]+)\]([\s\S]*?)\[\/DhtmlXQ_\1\]/g)) {
    fields[match[1]] = htmlDecode(match[2].trim());
  }
  const moves = dhtmlMoveListToIccs(fields.movelist);
  return {
    fields,
    moves,
    rawNotation: blockMatch[0].trim(),
  };
}

export function extractXiangqiqipuLinks(html, baseUrl = xiangqiqipuBase, playerName = targetPlayer) {
  const links = new Map();
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref=["']([^"']*\/Category\/View-\d+\.html)["']/i)?.[1];
    if (!href) continue;
    const url = absoluteUrl(href, baseUrl);
    const title = stripHtml(attrs.match(/\btitle=["']([^"']*)["']/i)?.[1] || match[2]);
    if (!title.includes(playerName)) continue;
    links.set(url, { sourceUrl: url, title });
  }
  return [...links.values()];
}

export function extractGdchessLinks(html, baseUrl = gdchessBase, playerName = targetPlayer) {
  const links = new Map();
  const normalizedPlayerName = normalizeChineseName(playerName);
  for (const rowMatch of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const rowText = stripHtml(rowHtml);
    const normalizedRowText = normalizeChineseName(rowText);
    for (const linkMatch of rowHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = linkMatch[1];
      const href = attrs.match(/\bhref=["']([^"']*\/?xqgame\/gview\.asp\?id=[^"']+)["']/i)?.[1]
        || attrs.match(/\bhref=["'](gview\.asp\?id=[^"']+)["']/i)?.[1];
      if (!href) continue;
      const title = stripHtml(linkMatch[2]).replace(/先\s+([胜負负和])/, "先$1");
      if (!normalizeChineseName(`${title} ${normalizedRowText}`).includes(normalizedPlayerName)) continue;
      const date = rowText.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
        || rowText.match(/\b(\d{4})(\d{2})(\d{2})\b/)?.slice(1, 4).join("-");
      const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
      const eventHint = cells.at(-1) && !cells.at(-1).includes("棋谱") ? cells.at(-1) : "";
      const url = absoluteUrl(href, baseUrl);
      links.set(url, {
        sourceUrl: url,
        sourceSite: "gdchess.com",
        title,
        listedDate: date || "",
        eventHint,
      });
    }
  }
  return [...links.values()];
}

export function extractGdchessIndexLinks(html, baseUrl = gdchessBase, sourcePlayerId = "0074") {
  const links = new Set();
  for (const match of String(html).matchAll(/<a\b([^>]*)>/gi)) {
    const hrefMatch = match[1].match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = htmlDecode(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    if (!/xqpgame\.asp/i.test(href) && !href.startsWith("?")) continue;
    const pidPattern = new RegExp(`pid=${sourcePlayerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (!pidPattern.test(href)) continue;
    links.add(absoluteUrl(href, baseUrl));
  }
  return [...links];
}

function parseTitleFromHtml(html) {
  return stripHtml(String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

export function parseXiangqiqipuGame(html, sourceUrl) {
  const parsed = parseDhtmlXqBlock(html);
  if (!parsed || parsed.moves.length === 0) return undefined;
  const fields = parsed.fields;
  const title = fields.title || parseTitleFromHtml(html);
  const inferred = inferPlayersFromTitle(title);
  const redPlayer = fields.redname || fields.red || inferred.redPlayer || "";
  const blackPlayer = fields.blackname || fields.black || inferred.blackPlayer || "";
  const event = fields.event || fields.class || "";
  const date = fields.date || "";
  const result = normalizeResult(fields.result || inferred.result || title);
  const opening = fields.open || "";
  const fingerprint = gameFingerprint({ redPlayer, blackPlayer, date, event, moves: parsed.moves });
  return {
    sourceUrl,
    sourceSite: "xiangqiqipu.com",
    crawlStatus: "parsed",
    title,
    redPlayer,
    blackPlayer,
    event,
    date,
    result,
    opening,
    moves: parsed.moves,
    rawNotation: parsed.rawNotation,
    fingerprint,
    duplicateSourceUrls: [sourceUrl],
    licenseNote: "公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。",
  };
}

function parseGdchessPlayers(html, title) {
  const titleMatch = String(title ?? "").match(/^(.+?)\s+(胜|負|负|和)\s+(.+?)(?:\s+-\s+.*)?$/);
  if (titleMatch) {
    return {
      redPlayer: normalizeChineseName(titleMatch[1]),
      blackPlayer: normalizeChineseName(titleMatch[3]),
      result: titleMatch[2] === "胜" ? "1-0" : titleMatch[2] === "和" ? "1/2-1/2" : "0-1",
    };
  }
  const anchorMatch = String(html).match(/<a\b[^>]*>\s*([^<]*?)\s*<\/a>\s*先\s*(?:<font\b[^>]*>)?\s*(胜|負|负|和)\s*(?:<\/font>)?\s*<a\b[^>]*>\s*([^<]*?)\s*<\/a>/i);
  if (anchorMatch) {
    return {
      redPlayer: normalizeChineseName(anchorMatch[1]),
      blackPlayer: normalizeChineseName(anchorMatch[3]),
      result: anchorMatch[2] === "胜" ? "1-0" : anchorMatch[2] === "和" ? "1/2-1/2" : "0-1",
    };
  }
  const text = stripHtml(html);
  const textMatch = text.match(/([^\s]+(?:\s+[^\s]+)?)\s+先(胜|負|负|和)\s+([^\s]+(?:\s+[^\s]+)?)/);
  if (textMatch) {
    return {
      redPlayer: normalizeChineseName(textMatch[1]),
      blackPlayer: normalizeChineseName(textMatch[3]),
      result: textMatch[2] === "胜" ? "1-0" : textMatch[2] === "和" ? "1/2-1/2" : "0-1",
    };
  }
  return {};
}

function gdchessDate(value) {
  const match = String(value ?? "").match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function parseGdchessGame(html, sourceUrl) {
  const moveStr = String(html).match(/\bMOVE_STR\s*=\s*["'](\d+)["']/)?.[1];
  if (!moveStr) return undefined;
  const moves = dhtmlMoveListToIccs(moveStr);
  if (moves.length === 0) return undefined;
  const title = parseTitleFromHtml(html).replace(/\s*-\s*广象网\s*$/i, "");
  const players = parseGdchessPlayers(html, title);
  const pageText = stripHtml(html);
  const eventFromInfo = pageText.match(/赛事：(.+?)\s+日期[:：]\s*\d{8}/)?.[1]?.trim();
  const date = gdchessDate(pageText.match(/日期[:：]\s*(\d{8})/)?.[1])
    || gdchessDate(pageText.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]);
  const eventFromTitle = title.includes(" - ") ? title.split(" - ").slice(1).join(" - ").trim() : "";
  const event = eventFromInfo || eventFromTitle;
  const result = normalizeResult(players.result || title);
  const fingerprint = gameFingerprint({
    redPlayer: players.redPlayer || "",
    blackPlayer: players.blackPlayer || "",
    date,
    event,
    moves,
  });
  return {
    sourceUrl,
    sourceSite: "gdchess.com",
    crawlStatus: "parsed",
    title,
    redPlayer: players.redPlayer || "",
    blackPlayer: players.blackPlayer || "",
    event,
    date,
    result,
    opening: "",
    moves,
    rawNotation: `MOVE_STR=${moveStr}`,
    fingerprint,
    duplicateSourceUrls: [sourceUrl],
    licenseNote: "广象网公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。",
  };
}

export function parseOneXqGame(html, sourceUrl) {
  const moveStr = String(html).match(/\bMOVE_STR\s*=\s*["'](\d+)["']/)?.[1];
  if (!moveStr) return undefined;
  const moves = dhtmlMoveListToIccs(moveStr);
  if (moves.length === 0) return undefined;

  const pageTitle = parseTitleFromHtml(html);
  const gameTips = stripHtml(String(html).match(/<div\s+id=["']game_tips["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || "");
  const title = gameTips || pageTitle;
  const playerMatch = title.match(/^(.+?)\s+(2\+0|2:0|0-2|0:2|1=1|1:1)\s+(.+?)(?:\s+-\s+(.+?))?(?:\s+Round\s+(\d+))?\s*$/i);
  const redPlayer = normalizeOneXqName(playerMatch?.[1] || "");
  const blackPlayer = normalizeOneXqName(playerMatch?.[3] || "");
  const result = normalizeOneXqResult(playerMatch?.[2] || title);
  const event = (playerMatch?.[4] || pageTitle.replace(`${playerMatch?.[1] || ""} ${playerMatch?.[2] || ""} ${playerMatch?.[3] || ""}`, "")).trim();
  const round = playerMatch?.[5] ? `Round ${playerMatch[5]}` : "";
  const fingerprint = gameFingerprint({
    redPlayer,
    blackPlayer,
    date: "",
    event,
    moves,
  });
  return {
    sourceUrl,
    sourceSite: "01xq.com",
    crawlStatus: "parsed",
    title,
    redPlayer,
    blackPlayer,
    event,
    round,
    date: "",
    result,
    opening: "",
    moves,
    rawNotation: `MOVE_STR=${moveStr}`,
    fingerprint,
    duplicateSourceUrls: [sourceUrl],
    licenseNote: "01xq.com公开网页采集，仅供个人本地学习；发布或再分发前需复核来源网站许可。",
  };
}

export function parseGameHtml(html, sourceUrl) {
  if (sourceUrl.includes("01xq.com") || /e_game_view\.asp/i.test(sourceUrl)) {
    return parseOneXqGame(html, sourceUrl);
  }
  if (sourceUrl.includes("gdchess.com") || /\bMOVE_STR\s*=/.test(html)) {
    return parseGdchessGame(html, sourceUrl);
  }
  return parseXiangqiqipuGame(html, sourceUrl);
}

function applyCandidateHints(game, candidate) {
  if (!game || !candidate) return game;
  let changed = false;
  if (!game.date && candidate.listedDate) {
    game.date = candidate.listedDate;
    changed = true;
  }
  if (!game.event && candidate.eventHint) {
    game.event = candidate.eventHint;
    changed = true;
  }
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

function pgnEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function gameToPgn(game) {
  const tags = [
    ["Game", "Chinese Chess"],
    ["Title", game.title || `${game.redPlayer} vs ${game.blackPlayer}`],
    ["Event", game.event || ""],
    ["Site", game.sourceUrl],
    ["Date", game.date || "????.??.??"],
    ["Red", game.redPlayer || ""],
    ["Black", game.blackPlayer || ""],
    ["Result", game.result || "*"],
    ["Opening", game.opening || ""],
    ["Format", "ICCS"],
  ];
  const lines = tags.map(([name, value]) => `[${name} "${pgnEscape(value)}"]`);
  const moves = [];
  for (let index = 0; index < game.moves.length; index += 2) {
    const moveNo = Math.floor(index / 2) + 1;
    moves.push(`${moveNo}. ${game.moves[index]}${game.moves[index + 1] ? ` ${game.moves[index + 1]}` : ""}`);
  }
  return `${lines.join("\n")}\n\n${moves.join(" ")} ${game.result || "*"}\n`;
}

function cloneBoard() {
  return initialBoard.map((row) => row.slice());
}

function boardToFen(board, redToMove, fullmove) {
  const rows = board.map((row) => {
    let text = "";
    let empty = 0;
    for (const piece of row) {
      if (!piece) {
        empty += 1;
      } else {
        if (empty) text += String(empty);
        empty = 0;
        text += piece;
      }
    }
    if (empty) text += String(empty);
    return text;
  });
  return `${rows.join("/")} ${redToMove ? "w" : "b"} - - 0 ${Math.max(1, fullmove)}`;
}

function parseIccsSquare(square) {
  return {
    col: square.charCodeAt(0) - "a".charCodeAt(0),
    row: 9 - Number(square[1]),
  };
}

function applyIccs(board, move) {
  const from = parseIccsSquare(move.slice(0, 2));
  const to = parseIccsSquare(move.slice(2, 4));
  const piece = board[from.row]?.[from.col] ?? null;
  const captured = board[to.row]?.[to.col] ?? null;
  if (!piece) return { piece: "", captured: "", ok: false };
  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;
  return { piece, captured: captured || "", ok: true };
}

export function gameToMoveRows(game) {
  const board = cloneBoard();
  const rows = [];
  for (const [index, move] of game.moves.entries()) {
    const ply = index + 1;
    const redToMove = index % 2 === 0;
    const fullmove = Math.floor(index / 2) + 1;
    const beforeFen = boardToFen(board, redToMove, fullmove);
    const applied = applyIccs(board, move);
    const afterFen = boardToFen(board, !redToMove, fullmove);
    rows.push({
      gameFingerprint: game.fingerprint,
      sourceUrl: game.sourceUrl,
      ply,
      moveNo: fullmove,
      sideToMove: redToMove ? "red" : "black",
      moveIccs: move,
      beforeFen,
      afterFen,
      piece: applied.piece,
      captured: applied.captured,
      phase: phaseForPly(ply),
    });
  }
  return rows;
}

export function gameToPositionJobs(game, playerName = targetPlayer) {
  const rows = gameToMoveRows(game);
  const jobs = [];
  for (const row of rows) {
    const mover = row.sideToMove === "red" ? game.redPlayer : game.blackPlayer;
    const playerToMove = String(mover).includes(playerName);
    if (playerToMove) {
      jobs.push({
        gameFingerprint: game.fingerprint,
        sourceUrl: game.sourceUrl,
        ply: row.ply,
        phase: row.phase,
        zhaoSide: row.sideToMove,
        masterSide: row.sideToMove,
        beforeFen: row.beforeFen,
        playedMove: row.moveIccs,
        piece: row.piece,
        captured: row.captured,
        opening: game.opening,
        event: game.event,
        date: game.date,
      });
    }
  }
  return jobs;
}

function styleProfileFromGames(games) {
  const zhaoGames = games.filter((game) => `${game.redPlayer} ${game.blackPlayer}`.includes(targetPlayer));
  const profile = {
    label: "赵鑫鑫风格启发画像",
    generatedAt: new Date().toISOString(),
    totalGames: zhaoGames.length,
    sourceGames: zhaoGames.map((game) => ({ fingerprint: game.fingerprint, sourceUrl: game.sourceUrl, title: game.title })),
    sides: { red: 0, black: 0 },
    results: {},
    openings: {},
    phaseMoves: { opening: 0, middle: 0, endgame: 0 },
    pieceMoves: {},
    notes: [
      "该画像来自公开棋谱统计，只用于个人训练中的候选着重排，不代表赵鑫鑫本人意见。",
      "Pikafish 仍是棋力底座；风格分只在引擎可接受候选内参与排序。",
    ],
  };
  for (const game of zhaoGames) {
    const zhaoRed = String(game.redPlayer).includes(targetPlayer);
    const zhaoBlack = String(game.blackPlayer).includes(targetPlayer);
    if (zhaoRed) profile.sides.red += 1;
    if (zhaoBlack) profile.sides.black += 1;
    profile.results[game.result || "*"] = (profile.results[game.result || "*"] ?? 0) + 1;
    if (game.opening) profile.openings[game.opening] = (profile.openings[game.opening] ?? 0) + 1;
    for (const job of gameToPositionJobs(game)) {
      profile.phaseMoves[job.phase] += 1;
      const piece = job.piece || "unknown";
      profile.pieceMoves[piece] = (profile.pieceMoves[piece] ?? 0) + 1;
    }
  }
  profile.topOpenings = Object.entries(profile.openings).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
  profile.pieceMoveRanking = Object.entries(profile.pieceMoves).sort((a, b) => b[1] - a[1]).map(([piece, count]) => ({ piece, count }));
  return profile;
}

async function fetchText(url, delayMs) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 XiangqiStudio/1.0 personal-research",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      },
    });
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (fetchError) {
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

async function collect(outDir) {
  const maxGames = Number(argValue("max-games", "50"));
  const delayMs = Number(argValue("delay-ms", "800"));
  const maxGdchessIndexPages = Number(argValue("gdchess-index-pages", String(Math.max(1, Math.ceil(maxGames / 20)))));
  const customSeeds = argValues("seed-url");
  const seeds = hasFlag("seed-only") ? customSeeds : [...defaultSeeds, ...customSeeds];
  const indexRecords = [];
  const gamesByFingerprint = new Map();
  const candidateLinks = new Map();
  const gdchessIndexQueue = [];
  const seenGdchessIndexUrls = new Set();
  const addGdchessIndexUrl = (url) => {
    if (seenGdchessIndexUrls.has(url)) return;
    gdchessIndexQueue.push(url);
  };
  const addGame = (game) => {
    if (!game) return false;
    if (!`${game.redPlayer} ${game.blackPlayer} ${game.title}`.includes(targetPlayer)) return false;
    const existing = gamesByFingerprint.get(game.fingerprint);
    if (existing) {
      existing.duplicateSourceUrls = [...new Set([...existing.duplicateSourceUrls, game.sourceUrl])];
    } else {
      gamesByFingerprint.set(game.fingerprint, game);
    }
    return true;
  };
  await mkdir(outDir, { recursive: true });
  for (const seed of seeds) {
    try {
      if (seed.includes("gdchess.com")) {
        const html = await fetchText(seed, delayMs);
        const directGame = parseGdchessGame(html, seed);
        if (directGame && addGame(directGame)) {
          indexRecords.push({ sourceUrl: seed, sourceSite: "gdchess.com", crawlStatus: "parsed_direct" });
        }
        const discoveredGames = extractGdchessLinks(html, seed);
        for (const link of discoveredGames) candidateLinks.set(link.sourceUrl, link);
        for (const url of extractGdchessIndexLinks(html, seed)) addGdchessIndexUrl(url);
        indexRecords.push({
          sourceUrl: seed,
          sourceSite: "gdchess.com",
          crawlStatus: "indexed",
          discoveredLinks: discoveredGames.length,
          discoveredIndexPages: gdchessIndexQueue.length,
        });
        continue;
      }
      if (!seed.includes("xiangqiqipu.com")) {
        indexRecords.push({
          sourceUrl: seed,
          sourceSite: new URL(seed).hostname,
          crawlStatus: "index_only",
          licenseNote: "该源作为公开索引记录；若页面需要验证、登录或连接不稳定，不自动抓取正文。",
        });
        continue;
      }
      const html = await fetchText(seed, delayMs);
      const directGame = parseGameHtml(html, seed);
      if (directGame && addGame(directGame)) {
        indexRecords.push({ sourceUrl: seed, sourceSite: "xiangqiqipu.com", crawlStatus: "parsed_direct" });
      }
      for (const link of extractXiangqiqipuLinks(html, seed)) {
        candidateLinks.set(link.sourceUrl, link);
      }
      indexRecords.push({ sourceUrl: seed, sourceSite: "xiangqiqipu.com", crawlStatus: "indexed", discoveredLinks: candidateLinks.size });
    } catch (error) {
      indexRecords.push({ sourceUrl: seed, crawlStatus: "failed", error: String(error.message ?? error) });
    }
  }
  let processedGdchessIndexPages = 0;
  while (gdchessIndexQueue.length > 0 && processedGdchessIndexPages < maxGdchessIndexPages && candidateLinks.size < maxGames * 3) {
    const indexUrl = gdchessIndexQueue.shift();
    if (!indexUrl || seenGdchessIndexUrls.has(indexUrl)) continue;
    seenGdchessIndexUrls.add(indexUrl);
    try {
      const html = await fetchText(indexUrl, delayMs);
      const discoveredGames = extractGdchessLinks(html, indexUrl);
      for (const link of discoveredGames) candidateLinks.set(link.sourceUrl, link);
      for (const url of extractGdchessIndexLinks(html, indexUrl)) addGdchessIndexUrl(url);
      processedGdchessIndexPages += 1;
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
  for (const link of [...candidateLinks.values()].slice(0, maxGames * 3)) {
    if (gamesByFingerprint.size >= maxGames) break;
    try {
      const html = await fetchText(link.sourceUrl, delayMs);
      const game = applyCandidateHints(parseGameHtml(html, link.sourceUrl), link);
      addGame(game);
    } catch (error) {
      indexRecords.push({ sourceUrl: link.sourceUrl, sourceSite: link.sourceSite || new URL(link.sourceUrl).hostname, crawlStatus: "failed", error: String(error.message ?? error) });
    }
  }
  const games = [...gamesByFingerprint.values()];
  const pgnDir = join(outDir, "pgn");
  await rm(pgnDir, { recursive: true, force: true });
  await mkdir(pgnDir, { recursive: true });
  for (const game of games) {
    await writeFile(join(pgnDir, `${game.fingerprint.slice(0, 16)}.pgn`), gameToPgn(game));
  }
  await writeJsonl(join(outDir, "zhao-games.index.jsonl"), indexRecords);
  await writeJsonl(join(outDir, "zhao-games.normalized.jsonl"), games);
  const jobs = games.flatMap(gameToPositionJobs);
  await writeJsonl(join(outDir, "zhao-pikafish-jobs.jsonl"), jobs);
  const profile = styleProfileFromGames(games);
  await writeFile(join(outDir, "style-profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  await writeFile(join(outDir, "training-report.md"), reportMarkdown(games, jobs, profile));
  return { games, jobs, profile, indexRecords, outDir };
}

async function loadGames(input) {
  const path = resolve(input);
  if (!existsSync(path)) return [];
  if ((await readFile(path, "utf8")).trim().startsWith("[")) {
    return JSON.parse(await readFile(path, "utf8"));
  }
  return readJsonl(path);
}

async function profile(outDir) {
  const input = argValue("input", join(outDir, "zhao-games.normalized.jsonl"));
  const games = await loadGames(input);
  const jobs = games.flatMap(gameToPositionJobs);
  const profile = styleProfileFromGames(games);
  await mkdir(outDir, { recursive: true });
  await writeJsonl(join(outDir, "zhao-pikafish-jobs.jsonl"), jobs);
  await writeFile(join(outDir, "style-profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  await writeFile(join(outDir, "training-report.md"), reportMarkdown(games, jobs, profile));
  return { games, jobs, profile, outDir };
}

function reportMarkdown(games, jobs, profile) {
  return `${[
    "# 赵鑫鑫公开棋谱本地训练集",
    "",
    `生成时间：${profile.generatedAt}`,
    `公开棋谱数：${games.length}`,
    `赵鑫鑫着法样本：${jobs.length}`,
    "",
    "## 来源与边界",
    "",
    "- 只采集公开可访问页面；遇到验证、登录、超时或许可不明页面，保留索引记录而不强抓。",
    "- 本数据集用于个人本地训练和候选着重排；不要把原始网页或棋谱库打包再发布。",
    "- 输出称为“赵鑫鑫风格启发”，不冒充赵鑫鑫本人。",
    "",
    "## 高频开局",
    "",
    ...profile.topOpenings.map((item) => `- ${item.name}：${item.count}`),
    "",
    "## 子力着法统计",
    "",
    ...profile.pieceMoveRanking.map((item) => `- ${item.piece}：${item.count}`),
    "",
    "## 下一步",
    "",
    "1. 人工抽查 `pgn/` 下 10 盘，确认网页原谱与 PGN 一致。",
    "2. 用 `zhao-pikafish-jobs.jsonl` 批量跑 Pikafish MultiPV。",
    "3. 将实战着作为正例、同局面其它候选作为对比样本，训练风格重排器。",
  ].join("\n")}\n`;
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

async function main() {
  const command = process.argv[2]?.startsWith("--") ? "collect" : process.argv[2] ?? "collect";
  const outDir = resolve(argValue("out-dir", defaultOutDir));
  if (command === "collect") {
    const result = await collect(outDir);
    console.log(`Collected ${result.games.length} parsed Zhao Xinxin games.`);
    console.log(`Position jobs: ${result.jobs.length}`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "profile") {
    const result = await profile(outDir);
    console.log(`Profiled ${result.games.length} games, ${result.jobs.length} Zhao move jobs.`);
    console.log(`Output: ${result.outDir}`);
    return;
  }
  if (command === "parse-file") {
    const file = argValue("file", "");
    if (!file) throw new Error("parse-file 需要 --file=<HTML文件>");
    const html = await readFile(resolve(file), "utf8");
    const game = parseGameHtml(html, `file://${basename(file)}`);
    console.log(JSON.stringify(game, null, 2));
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

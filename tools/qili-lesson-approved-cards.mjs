#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL(import.meta.url).pathname, "../..");
const defaultWorkDir = join(repoRoot, ".theory-work", "qili-pdf");

const phaseLabels = { opening: "开局", middle: "中局", endgame: "残局" };

const fallbackTitle = {
  "opening:14": "出动大子的速度要服从局面条件",
  "opening:28": "布局重点一一活马活马活马",
  "middle:8": "各攻一翼，兵贵神速",
  "middle:19": "卒林线的重要性",
  "middle:31": "车马冷着斩将来",
  "middle:46": "弃兵反击",
  "middle:47": "韩信点兵，多多益善",
  "middle:48": "谋子篇核心原则一一局部以多打少",
  "endgame:1": "为什么要学残局",
  "endgame:18": "缺士怕什么",
  "endgame:44": "四大名局之蚯蚓降龙",
};

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[^\u4e00-\u9fffA-Za-z0-9一二三四五六七八九十、，。:：/／（）() -]/g, "")
    .replace(/\s+/g, "")
    .replace(/一{3,}/g, "一一")
    .trim();
}

function chineseCount(value) {
  return [...String(value ?? "")].filter((char) => /\p{Script=Han}/u.test(char)).length;
}

function latinCount(value) {
  return [...String(value ?? "")].filter((char) => /[A-Za-z]/.test(char)).length;
}

function titleScore(bundle) {
  const title = cleanText(bundle.lessonTitle);
  return (
    chineseCount(title) * 10
    - latinCount(title) * 7
    + Math.min(bundle.source.pageEnd - bundle.source.pageStart, 8)
    + Math.min(bundle.reviewHints?.length ?? 0, 6)
  );
}

function selectLessonBundles(bundles) {
  const selected = new Map();
  for (const bundle of bundles) {
    if (!phaseLabels[bundle.phase]) continue;
    if (!Number.isFinite(bundle.lessonNo)) continue;
    if (bundle.lessonNo < 1 || bundle.lessonNo > 48) continue;
    if (bundle.phase === "endgame" && bundle.lessonNo === 1 && bundle.source.pageStart > 100) {
      continue;
    }
    const key = `${bundle.phase}:${bundle.lessonNo}`;
    const current = selected.get(key);
    if (!current || titleScore(bundle) > titleScore(current)) selected.set(key, bundle);
  }
  return [...selected.values()].sort((left, right) => {
    const phaseOrder = { opening: 0, middle: 1, endgame: 2 };
    return phaseOrder[left.phase] - phaseOrder[right.phase] || left.lessonNo - right.lessonNo;
  });
}

function tagsFor(phase, title) {
  const tags = new Set([phaseLabels[phase], "课级快导入"]);
  const include = (tag) => tags.add(tag);
  if (/车|直车|横车|车路|骑河|三七|肋道|宫顶线|下二路/.test(title)) {
    include("线路控制");
  }
  if (/出车|直车|横车|车路/.test(title)) include("出车选择");
  if (/马|卧槽|窝心|连环|拐角|盘河/.test(title)) include("活马");
  if (/炮|担子|沉底|空头|仕角|过宫|金钩|雷公/.test(title)) {
    include("炮位");
    include("炮路");
  }
  if (/兵|卒|两头蛇|谋兵|下兵|老兵/.test(title)) include("兵卒效率");
  if (/士|仕|相|象|将|帅|将位|破士象|缺士|缺相|生命线/.test(title)) {
    include("将位");
  }
  if (/牵制|封锁|围困|拦截|抽|杀|强攻|弃子|弃兵|突破|闪击|顿挫/.test(title)) {
    include("战术漏算");
  }
  if (/兑|换|一车换|vs|兵种/.test(title)) include("兑子");
  if (/胜和|谋和|残局|临界|例胜|例和|本质|分类/.test(title) || phase === "endgame") {
    include("理论胜和");
  }
  if (phase === "opening") {
    include("战略方向");
    include("子力协调");
    include("脱离体系");
  } else if (phase === "middle") {
    include("候选着");
    include("计算");
  }
  return [...tags];
}

function engineCorrelationsFor(phase, tags) {
  const signals = new Set();
  if (phase === "opening") signals.add("opening_deviation");
  if (phase === "middle") signals.add("missed_candidate");
  if (phase === "endgame") signals.add("endgame_theoretical_win_draw");
  if (tags.includes("线路控制")) signals.add("line_control");
  if (tags.includes("战术漏算")) signals.add("missed_tactic");
  if (tags.includes("兑子")) signals.add("exchange_miscalculation");
  if (tags.includes("兵卒效率")) signals.add("pawn_efficiency");
  if (tags.includes("将位")) signals.add("king_position");
  if (tags.includes("活马") || tags.includes("炮位")) signals.add("development_lag");
  if (tags.includes("脱离体系")) signals.add("plan_without_counterplay_check");
  return [...signals];
}

function summaryFor(phase, title, tags) {
  if (phase === "opening") {
    return `围绕「${title}」复盘开局选择：先看体系方向、子力效率和对方反击，再判断本手是否真正争先。`;
  }
  if (phase === "middle") {
    return `围绕「${title}」复盘中局处理：先列候选着，再核对线路、牵制、攻防转换和 Pikafish 主变。`;
  }
  if (tags.includes("兵卒效率")) {
    return `围绕「${title}」复盘残局转换：先判断胜和边界，再看兵卒效率、将位和兑子后结果。`;
  }
  return `围绕「${title}」复盘残局判断：先确认理论胜和，再比较将位、控线、兑子和等着资源。`;
}

function appliesWhenFor(phase, title, tags) {
  if (phase === "opening") {
    return `开局阶段出现与「${title}」相关的出子、车路、马炮或兵卒选择，且评价出现明显回落时。`;
  }
  if (phase === "middle") {
    return `中局阶段出现与「${title}」相关的候选着、战术、控线或子力配合分歧时。`;
  }
  return `残局阶段出现与「${title}」相关的胜和判断、兑子、兵卒推进、将位或控线选择时。`;
}

function riskFor(phase, title) {
  if (phase === "opening") {
    return `快导入卡，需结合具体局面复核；若只按「${title}」机械套用，可能忽略对方即时反击。`;
  }
  if (phase === "middle") {
    return `快导入卡，需用 Pikafish 主变校验；若候选着没算全，容易把战术问题误判成原则问题。`;
  }
  return `快导入卡，需核验理论胜和；残局一步兑子、将位或兵卒次序不同，结论可能完全改变。`;
}

function makeCard(bundle) {
  const title = fallbackTitle[`${bundle.phase}:${bundle.lessonNo}`] || cleanText(bundle.lessonTitle);
  const tags = tagsFor(bundle.phase, title);
  return {
    stableId: `qili-lesson-${bundle.phase}-${String(bundle.lessonNo).padStart(2, "0")}`,
    reviewStatus: "approved",
    phase: bundle.phase,
    title: `${phaseLabels[bundle.phase]}第${bundle.lessonNo}讲：${title}`,
    summary: summaryFor(bundle.phase, title, tags),
    appliesWhen: appliesWhenFor(bundle.phase, title, tags),
    risk: riskFor(bundle.phase, title),
    tags,
    engineCorrelations: engineCorrelationsFor(bundle.phase, tags),
    source: {
      label: "赵鑫鑫棋理三部曲",
      book: bundle.source.book,
      lessonNo: bundle.lessonNo,
      lessonTitle: title,
      pageStart: bundle.source.pageStart,
      pageEnd: bundle.source.pageEnd,
      review: "课级快导入，待真实棋谱反馈校正",
    },
  };
}

async function main() {
  const workDir = resolve(argValue("work-dir", process.env.QILI_PDF_WORK_DIR ?? defaultWorkDir));
  const bundlesPath = resolve(argValue("bundles", join(workDir, "card-candidates", "qili-pdf-lesson-bundles.jsonl")));
  const outDir = resolve(argValue("out-dir", join(workDir, "approved")));
  const bundles = (await readFile(bundlesPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const selected = selectLessonBundles(bundles);
  const cards = selected.map(makeCard);
  await mkdir(outDir, { recursive: true });
  const jsonlPath = join(outDir, "qili-lesson-approved-cards.jsonl");
  const mdPath = join(outDir, "qili-lesson-approved-cards.md");
  await writeFile(jsonlPath, `${cards.map((card) => JSON.stringify(card)).join("\n")}\n`);
  await writeFile(
    mdPath,
    `${[
      "# 赵鑫鑫棋理三部曲课级快导入卡",
      "",
      "说明：本文件按每讲聚合生成短原则卡，用于快速扩大棋谱分析覆盖。它不复制 OCR 长文本；后续应根据真实棋谱反馈继续修正、拆分或降权。",
      "",
      ...cards.flatMap((card, index) => [
        `## ${index + 1}. ${card.title}`,
        "",
        `- stableId：${card.stableId}`,
        `- 来源：${card.source.book} 第 ${card.source.lessonNo} 讲《${card.source.lessonTitle}》p.${card.source.pageStart}-${card.source.pageEnd}`,
        `- 摘要：${card.summary}`,
        `- 适用：${card.appliesWhen}`,
        `- 风险：${card.risk}`,
        `- 标签：${card.tags.join(" / ")}`,
        `- 引擎信号：${card.engineCorrelations.join(" / ")}`,
        "",
      ]),
    ].join("\n")}\n`,
  );
  const byPhase = cards.reduce((acc, card) => {
    acc[card.phase] = (acc[card.phase] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ cards: cards.length, byPhase, jsonlPath, mdPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

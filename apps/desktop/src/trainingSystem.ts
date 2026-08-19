import type { OpeningBookHitDto, ReportPhase } from "./platform";

export const TRAINING_METHOD_LABEL = "特级大师训练法";

export const TRAINING_METHOD_TAGS = [
  "残局打底",
  "战术漏算",
  "候选着计算",
  "专属布局",
  "深度复盘",
  "慢棋训练",
  "心态管理",
] as const;

export const REPORT_CAUSE_TAGS = [
  "开局失误",
  "残局处理",
  "候选不足",
  "随手棋",
  "心态波动",
] as const;

export function reportTrainingTagsForIssue(issue: {
  phase: ReportPhase;
  lossCp: number;
  missedMate: boolean;
  opening?: OpeningBookHitDto;
  bestNotation?: string;
}) {
  const tags = new Set<string>(["深度复盘"]);
  if (issue.phase === "opening" || issue.opening) {
    tags.add("专属布局");
    tags.add("开局失误");
  }
  if (issue.phase === "endgame") {
    tags.add("残局打底");
    tags.add("残局处理");
  }
  if (issue.missedMate || issue.lossCp >= 300) {
    tags.add("战术漏算");
  }
  if (issue.bestNotation || issue.phase === "middle") {
    tags.add("候选着计算");
  }
  if (issue.lossCp >= 150 && !issue.missedMate) {
    tags.add("随手棋");
  }
  if (issue.lossCp >= 500) {
    tags.add("心态管理");
    tags.add("心态波动");
  }
  return [...tags];
}

export function reviewPromptForTrainingTags(tags: string[]) {
  if (tags.includes("战术漏算")) return "复盘时先重扫双方将军、吃子、捉双，再核对主变。";
  if (tags.includes("专属布局")) return "把这步放回自己的红黑布局体系里，比较同类实战和开局库主线。";
  if (tags.includes("残局打底")) return "先判断理论胜和与兑换方向，再看是否应限制对方活子。";
  if (tags.includes("候选着计算")) return "至少列出 3 个候选着，并说明每个候选防住了什么反击。";
  return "赢棋也复盘：只要出现高亏分着法，就把原因写成下一次训练动作。";
}

export function isTrainingSystemCard(card: {
  courseName?: string;
  sourceBook?: string;
  tags?: string[];
}) {
  return card.courseName === TRAINING_METHOD_LABEL
    || card.sourceBook?.includes("方法论参考")
    || card.tags?.some((tag) => TRAINING_METHOD_TAGS.includes(tag as typeof TRAINING_METHOD_TAGS[number]));
}

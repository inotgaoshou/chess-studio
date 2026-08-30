import { moveThoughtHint } from "./coachInsights";
import type { MoveItem, ReportIssuePresentationDto } from "./platform/types";

export type MoveThoughtSource = "manual" | "flyknife" | "report" | "fallback";

export type MoveThought = {
  source: MoveThoughtSource;
  sourceLabel: string;
  purpose: string;
  risk: string;
  nextAction: string;
  comparison?: string;
  confidenceNote?: string;
};

const sourceLabels: Record<MoveThoughtSource, string> = {
  manual: "人工注释",
  flyknife: "飞刀标注",
  report: "整局报告",
  fallback: "轻量提示",
};

function isFlyknifeComment(comment: string) {
  return comment.startsWith("飞刀方案：") || comment.includes("【飞刀标注】");
}

function commentField(comment: string, labels: string[]) {
  for (const label of labels) {
    const match = comment.match(new RegExp(`(?:^|\\n)\\s*${label}[：:]\\s*([^\\n]+)`));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function stripThoughtPrefix(text: string) {
  return text.replace(/^思路[：:]\s*/, "").trim();
}

function fromManualComment(move: MoveItem): MoveThought | undefined {
  if (!move.comment || isFlyknifeComment(move.comment)) return undefined;
  const purpose = commentField(move.comment, ["意图", "目的", "思路"]);
  if (!purpose) return undefined;
  const risk = commentField(move.comment, ["风险", "注意"]);
  const nextAction = commentField(move.comment, ["建议", "下一步", "计划"]);
  return {
    source: "manual",
    sourceLabel: sourceLabels.manual,
    purpose,
    risk: risk ?? "人工注释已记录目的；风险点可继续在本步注释里补充。",
    nextAction: nextAction ?? "可在本步注释继续写入“计划：…”，形成自己的复盘语言。",
  };
}

function fromFlyknifeComment(move: MoveItem): MoveThought | undefined {
  if (!move.comment || !isFlyknifeComment(move.comment)) return undefined;
  const intent = commentField(move.comment, ["意图"]);
  const mainline = commentField(move.comment, ["主变"]);
  const risk = commentField(move.comment, ["风险"]);
  const defense = commentField(move.comment, ["最佳防守"]);
  return {
    source: "flyknife",
    sourceLabel: sourceLabels.flyknife,
    purpose: intent ?? (mainline ? `围绕主变「${mainline}」设计诱导线路。` : "已保存飞刀线路，可查看节点注释了解详情。"),
    risk: risk ?? "飞刀线路需要重点确认对方是否有更强防守或反击候选。",
    nextAction: defense ? `优先验证最佳防守「${defense}」后的局面是否仍可用。` : "建议用引擎或实战样本复核对方最佳防守。",
  };
}

function fromReportIssue(issue: ReportIssuePresentationDto): MoveThought {
  return {
    source: "report",
    sourceLabel: sourceLabels.report,
    purpose: issue.coach.intent,
    risk: issue.coach.weakness,
    nextAction: issue.coach.solution,
    comparison: issue.bestNotation ? `可比较：实战「${issue.notation}」 vs 推荐「${issue.bestNotation}」` : undefined,
  };
}

function fallbackThought(move: MoveItem, issue?: ReportIssuePresentationDto): MoveThought {
  return {
    source: "fallback",
    sourceLabel: sourceLabels.fallback,
    purpose: stripThoughtPrefix(moveThoughtHint({
      notation: move.notation,
      movedBy: move.movedBy,
      grade: issue?.grade,
      missedMate: issue?.missedMate,
      opening: issue?.opening,
      bestNotation: issue?.bestNotation,
      deltaCp: issue?.deltaCp,
    })),
    risk: issue?.missedMate
      ? "走前可能已有强制杀棋，风险是被普通着法错过直接胜机。"
      : issue
        ? `报告标记为「${issue.grade}」，需要复核对方直接反击点。`
        : "未分析时先检查三件事：对方将军、吃子和反先手。",
    nextAction: issue?.bestNotation
      ? `先试走推荐「${issue.bestNotation}」，再和实战「${move.notation}」比较 3–6 个半回合。`
      : "等待报告/分析后可补齐更准确解释。",
    comparison: issue?.bestNotation ? `可比较：实战「${move.notation}」 vs 推荐「${issue.bestNotation}」` : undefined,
    confidenceNote: "未分析时显示的是规则化轻量提示，生成整局报告后会更准确。",
  };
}

export function buildMoveThought(move: MoveItem, issue?: ReportIssuePresentationDto): MoveThought {
  return fromManualComment(move) ?? fromFlyknifeComment(move) ?? (issue ? fromReportIssue(issue) : undefined) ?? fallbackThought(move, issue);
}

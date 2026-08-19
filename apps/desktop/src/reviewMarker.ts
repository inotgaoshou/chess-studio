const reviewMarker = "【复盘标记】";

export type FlyknifeMarker = {
  label: "设局" | "中刀条件" | "飞刀" | "最佳防守" | "飞刀研究";
  intent?: string;
};

export function hasReviewMarker(comment: string) {
  return comment.includes(reviewMarker);
}

export function toggleReviewMarker(comment: string) {
  if (hasReviewMarker(comment)) {
    return comment
      .replace(reviewMarker, "")
      .replace(/^\s*\n/, "")
      .trim();
  }
  return [reviewMarker, comment.trim()].filter(Boolean).join("\n");
}

export function flyknifeMarker(comment: string): FlyknifeMarker | undefined {
  if (!comment.includes("飞刀方案：") && !comment.includes("【飞刀标注】")) return undefined;
  const field = (name: string) => comment.split("\n").find((line) => line.startsWith(`${name}：`))?.slice(name.length + 1).trim();
  const role = field("阶段");
  const label = role === "setup" ? "设局"
    : role === "lure" ? "中刀条件"
      : role === "knife" ? "飞刀"
        : role === "bestDefense" ? "最佳防守"
          : "飞刀研究";
  return { label, intent: field("意图") };
}

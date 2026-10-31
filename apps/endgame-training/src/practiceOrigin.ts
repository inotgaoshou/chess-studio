export type PracticeOrigin = { section: "题库" | "练习"; label?: string; totalProblems?: number | null };

const CACHE_KEY = "qixi-practice-origins-v1";
function origins(): Record<string, PracticeOrigin> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
export function savePracticeOrigin(scope: string, sessionId: string, origin: PracticeOrigin) {
  try {
    const saved = origins(), key = JSON.stringify([scope, sessionId]);
    delete saved[key];
    saved[key] = origin;
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(saved).slice(-80))));
  } catch { /* Presentation context must not prevent starting a practice session. */ }
}
export function loadPracticeOrigin(scope: string, sessionId: string): PracticeOrigin | undefined {
  const value = origins()?.[JSON.stringify([scope, sessionId])];
  return value && ["题库", "练习"].includes(value.section)
    && (value.label === undefined || typeof value.label === "string") ? value : undefined;
}

export function practiceBreadcrumb(options: {
  origin?: PracticeOrigin;
  sourceKind?: string;
  learning?: boolean;
  assignment?: boolean;
}): string {
  if (options.assignment || options.sourceKind === "assignment") return "作业 / 详情 / 做题";
  if (options.sourceKind === "mistakes") return "练习 / 错题 / 重练";
  const label = ({ daily: "今日练习", random: "随机练习", favorites: "收藏", topic: "自选练习" } as Record<string, string>)[options.sourceKind ?? ""];
  const origin = options.origin ?? (options.sourceKind ? { section: "练习", label } : { section: "题库" });
  return [origin.section, origin.label, options.learning ? "学习" : "做题"].filter(Boolean).join(" / ");
}

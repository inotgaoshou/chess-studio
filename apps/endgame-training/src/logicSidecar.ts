import type { CblLibrary, TrainingProblem, TrainingProblemLogic } from "./types";

type LogicSidecarProblem = Partial<TrainingProblemLogic> & {
  sourceIndex?: number;
  title?: string;
  logic?: Partial<TrainingProblemLogic>;
};

type LogicSidecar = {
  problems?: LogicSidecarProblem[] | Record<string, Partial<TrainingProblemLogic>>;
};

const compact = (value: unknown) => typeof value === "string" ? value.trim() : "";
const compactList = (value: unknown) => Array.isArray(value) ? value.map(compact).filter(Boolean).slice(0, 8) : undefined;

function compactRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rows = Object.entries(value)
    .flatMap(([key, item]) => {
      const text = compact(item);
      return key.trim() && text ? [[key.trim(), text] as const] : [];
    })
    .slice(0, 80);
  return rows.length ? Object.fromEntries(rows) : undefined;
}

function normalizeLogic(value: Partial<TrainingProblemLogic> | undefined): TrainingProblemLogic | undefined {
  if (!value) return undefined;
  const logic: TrainingProblemLogic = {
    themes: compactList(value.themes),
    goal: compact(value.goal) || undefined,
    firstMoveIdea: compact(value.firstMoveIdea) || undefined,
    keyDefense: compact(value.keyDefense) || undefined,
    failureReason: compact(value.failureReason) || undefined,
    review: compact(value.review) || undefined,
    hints: compactList(value.hints),
    mistakes: compactRecord(value.mistakes),
  };
  return Object.values(logic).some(Boolean) ? logic : undefined;
}

function sidecarEntries(sidecar: LogicSidecar) {
  if (Array.isArray(sidecar.problems)) {
    return sidecar.problems.flatMap((entry) => {
      const logic = normalizeLogic(entry.logic ?? entry);
      return logic ? [{ sourceIndex: entry.sourceIndex, title: entry.title, logic }] : [];
    });
  }
  if (sidecar.problems && typeof sidecar.problems === "object") {
    return Object.entries(sidecar.problems).flatMap(([key, value]) => {
      const logic = normalizeLogic(value);
      if (!logic) return [];
      const sourceIndex = /^\d+$/.test(key) ? Number(key) : undefined;
      const title = sourceIndex == null ? key : undefined;
      return [{ sourceIndex, title, logic }];
    });
  }
  return [];
}

export function applyTrainingLogicSidecar(library: CblLibrary, rawJson: string): CblLibrary {
  const sidecar = JSON.parse(rawJson) as LogicSidecar;
  const entries = sidecarEntries(sidecar);
  if (!entries.length) return library;
  const byIndex = new Map(entries.flatMap((entry) => entry.sourceIndex == null ? [] : [[entry.sourceIndex, entry.logic] as const]));
  const byTitle = new Map(entries.flatMap((entry) => entry.title ? [[entry.title.trim(), entry.logic] as const] : []));
  return {
    ...library,
    problems: library.problems.map((problem) => ({
      ...problem,
      logic: byIndex.get(problem.sourceIndex) ?? byTitle.get(problem.title.trim()),
    })),
  };
}

export function trainingLogicHint(problem: TrainingProblem, level: 1 | 2 | 3, leadNotation?: string) {
  const logic = problem.logic;
  if (!logic) return undefined;
  const hinted = logic.hints?.[level - 1];
  if (hinted) return hinted;
  if (level === 1) {
    if (logic.goal) return `目标：${logic.goal}`;
    if (logic.themes?.length) return `主题：${logic.themes.join("、")}`;
  }
  if (level === 2) {
    if (logic.firstMoveIdea) return `思路：${logic.firstMoveIdea}`;
    if (logic.keyDefense) return `注意防守：${logic.keyDefense}`;
  }
  if (level === 3) {
    if (leadNotation && logic.firstMoveIdea) return `首着：${leadNotation}。${logic.firstMoveIdea}`;
    if (logic.review) return logic.review;
  }
  return undefined;
}

export function trainingLogicMiss(problem: TrainingProblem, iccs: string, legal: boolean) {
  const logic = problem.logic;
  if (!legal) return "该走法不合法，局面没有改变。";
  const direct = logic?.mistakes?.[iccs];
  if (direct) return direct;
  if (logic?.failureReason) return `这步合法，但暂不符合题解主线：${logic.failureReason}`;
  if (logic?.goal) return `这步合法，但没有完成本题目标：${logic.goal}`;
  return "这步不在题解分支中，局面没有改变，可以继续尝试。";
}

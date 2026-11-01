/** Shared with admin-web by scripts/sync-teacher-authoring.mjs. */
export type AnswerNode = {
  iccs: string;
  comment: string;
  children: AnswerNode[];
};
export type AuthoringGoal = {
  kind: "mate" | "gain_material" | "endgame_win" | "draw";
  description: string;
  solverSide: "w" | "b";
  reviewMethod: "forced_mate" | "reviewed_solution";
  verification?: {
    horizonPlies: number;
    maxCpLoss: number;
    minMaterialGain?: number;
    minScoreCp?: number;
  };
};
export type QuestionBody = {
  title: string;
  startingFen: string;
  note: string;
  solution: AnswerNode[];
  trainingGoal?: AuthoringGoal | null;
  targetMateMoves?: number | null;
  difficulty?: number | null;
  source?: unknown;
};
export type AuthoredQuestion = {
  id: string;
  subjectId?: string;
  kind?: "authored" | "source";
  revision: number;
  publishedRevision?: number;
  contentFingerprint?: string;
  publishedProblemId?: string;
  canEdit: boolean;
  archived: boolean;
  status: "draft" | "revising" | "published" | "archived" | "source";
  body: QuestionBody;
};
export type AuthoringDirectory = {
  id: string;
  title: string;
  revision: number;
  sortOrder: number;
  canEdit: boolean;
  itemCount?: number;
  publishedCount?: number;
  draftCount?: number;
  items: AuthoredQuestion[];
};
export type AuthoringSource = {
  id: string;
  title: string;
  fen: string;
  authored?: boolean;
  category?: string;
  duplicateKey?: string;
  alreadyAdded?: boolean;
  sourceScope?: string;
  sourceTitle?: string;
  sourceCount?: number;
};
export type AuthoringSourcePage = {
  items: AuthoringSource[];
  totalCount?: number;
  categories?: string[];
  nextCursor?: string | null;
  sourcePickerVersion?: number;
};
export function sourceIdentity(item: Pick<AuthoringSource, "id" | "authored" | "duplicateKey">): string {
  return item.duplicateKey || `${item.authored ? "authored" : "source"}:${item.id}`;
}
export function mergeSources(previous: AuthoringSource[], incoming: AuthoringSource[]): AuthoringSource[] {
  const seen = new Set(previous.map(sourceIdentity));
  return [...previous,...incoming.filter(item => {
    const key = sourceIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}
export type AuthoringApi = {
  scopeKey?: string;
  request<T>(path: string, init?: RequestInit): Promise<T>;
  classes(): Promise<{ id: string; name: string }[]>;
  students(
    id: string,
  ): Promise<{ id: string; displayName: string; loginName: string }[]>;
};
export const AUTHORING_BASE = "/api/v1/admin/authoring";
export const START_FEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
export const EMPTY_FEN = "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1";
export const LABELS: Record<string, string> = {
  K: "帅",
  A: "仕",
  B: "相",
  N: "马",
  R: "车",
  C: "炮",
  P: "兵",
  k: "将",
  a: "士",
  b: "象",
  n: "马",
  r: "车",
  c: "炮",
  p: "卒",
};
export function fenCells(fen: string): string[] {
  const ranks = fen.trim().split(/\s+/)[0].split("/");
  if (ranks.length !== 10) throw new Error("FEN 必须包含10行");
  return ranks.flatMap((rank) => {
    const cells = [...rank].flatMap((c) =>
      /^[1-9]$/.test(c)
        ? Array(Number(c)).fill("")
        : LABELS[c]
          ? [c]
          : (() => {
              throw new Error("FEN 包含未知棋子");
            })(),
    );
    if (cells.length !== 9) throw new Error("FEN 每行必须为9格");
    return cells;
  });
}
export function cellsFen(cells: string[], side = "w"): string {
  return (
    Array.from({ length: 10 }, (_, row) => {
      let empty = 0,
        text = "";
      for (const c of cells.slice(row * 9, row * 9 + 9)) {
        if (!c) empty++;
        else {
          if (empty) text += empty;
          empty = 0;
          text += c;
        }
      }
      return text + (empty || "");
    }).join("/") + ` ${side} - - 0 1`
  );
}
export function positionWarnings(fen: string): string[] {
  let cells: string[];
  try {
    cells = fenCells(fen);
  } catch (e) {
    return [String(e)];
  }
  const warnings: string[] = [];
  for (const side of ["red", "black"]) {
    for (const [kind, max] of Object.entries({
      k: 1,
      a: 2,
      b: 2,
      n: 2,
      r: 2,
      c: 2,
      p: 5,
    })) {
      const code = side === "red" ? kind.toUpperCase() : kind;
      const count = cells.filter((c) => c === code).length;
      if (count > max || (kind === "k" && count !== 1))
        warnings.push(
          `${side === "red" ? "红" : "黑"}${LABELS[code]}数量应${kind === "k" ? "为1" : "不超过" + max}`,
        );
    }
  }
  cells.forEach((code, i) => {
    if (!code) return;
    const row = Math.floor(i / 9),
      col = i % 9,
      red = code === code.toUpperCase();
    if (
      /[ka]/i.test(code) &&
      (!(col >= 3 && col <= 5) || !(red ? row >= 7 : row <= 2))
    )
      warnings.push(`${LABELS[code]}须在九宫内`);
    const r = red ? 9 - row : row;
    if (
      /[a]/i.test(code) &&
      ![
        [0, 3],
        [0, 5],
        [1, 4],
        [2, 3],
        [2, 5],
      ].some(([y, x]) => y === r && x === col)
    )
      warnings.push(`${LABELS[code]}须在九宫斜线交点`);
    if (
      /[b]/i.test(code) &&
      ![
        [0, 2],
        [0, 6],
        [2, 0],
        [2, 4],
        [2, 8],
        [4, 2],
        [4, 6],
      ].some(([y, x]) => y === r && x === col)
    )
      warnings.push(`${LABELS[code]}位置不合法`);
    if (/[p]/i.test(code) && (r < 3 || (r < 5 && col % 2 !== 0)))
      warnings.push(`${LABELS[code]}位置不合法`);
  });
  return [...new Set(warnings)];
}
export function choicesAt(tree: AnswerNode[], path: string[]): AnswerNode[] {
  let nodes = tree;
  for (const move of path) {
    const n = nodes.find((n) => n.iccs === move);
    if (!n) return [];
    nodes = n.children;
  }
  return nodes;
}
export function addAnswer(
  tree: AnswerNode[],
  path: string[],
  move: string,
): AnswerNode[] {
  const copy = structuredClone(tree);
  const nodes = choicesAt(copy, path);
  if (!nodes.some((n) => n.iccs === move))
    nodes.push({ iccs: move, comment: "", children: [] });
  return copy;
}
export function removeAnswer(tree: AnswerNode[], path: string[]): AnswerNode[] {
  if (!path.length) return tree;
  const copy = structuredClone(tree),
    nodes = choicesAt(copy, path.slice(0, -1));
  const i = nodes.findIndex((n) => n.iccs === path.at(-1));
  if (i >= 0) nodes.splice(i, 1);
  return copy;
}
export function goalFor(
  kind: AuthoringGoal["kind"],
  fen: string,
): AuthoringGoal {
  return {
    kind,
    description: {
      mate: "在规定步数内杀棋",
      gain_material: "通过正确着法获得子力优势",
      endgame_win: "找到取胜的方法",
      draw: "找到守和的方法",
    }[kind],
    solverSide: fen.split(/\s+/)[1] === "b" ? "b" : "w",
    reviewMethod: kind === "mate" ? "forced_mate" : "reviewed_solution",
    ...(kind !== "mate"
      ? {
          verification: {
            horizonPlies: 12,
            maxCpLoss: 50,
            ...(kind === "gain_material"
              ? { minMaterialGain: 100 }
              : { minScoreCp: kind === "draw" ? -50 : 300 }),
          },
        }
      : {}),
  };
}
export function assignable(q: AuthoredQuestion) {
  return (
    !!q.publishedProblemId &&
    !q.archived &&
    (q.status === "published" || q.status === "source")
  );
}
export function itemRef(q: AuthoredQuestion) {
  return { subjectId: q.subjectId || q.id, kind: q.kind || "authored" };
}
export function shiftQuestions<T extends { id: string }>(items: T[], selected: string[], direction: -1 | 1): T[] {
  const result = [...items], ids = new Set(selected);
  for (let step = 0; step < result.length; step++) {
    const index = direction === -1 ? step : result.length - 1 - step;
    const next = index + direction;
    if (next >= 0 && next < result.length && ids.has(result[index].id) && !ids.has(result[next].id)) {
      [result[index], result[next]] = [result[next], result[index]];
    }
  }
  return result;
}
export function splitAssignments<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error("每批题数必须为正整数");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}
export function toIccs(index: number) {
  return `${String.fromCharCode(97 + (index % 9))}${9 - Math.floor(index / 9)}`;
}

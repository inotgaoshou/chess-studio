import type { LocalManualAnalysisSummary, LocalManualFolder, LocalManualGame } from "./types";

export const TTXQ_MIRROR_FOLDER = "天天象棋云镜像";

export type PersonalManualSyncKind = "game" | "folder" | "analysis";
export type PersonalManualSyncRequestRecord = {
  kind: PersonalManualSyncKind;
  id: string;
  baseRevision: number;
  deleted: boolean;
  payload: LocalManualGame | LocalManualFolder | LocalManualAnalysisSummary | Record<string, never>;
};

function recordKey(kind: PersonalManualSyncKind, id: string) {
  return `${kind}:${id}`;
}

function parseRecordKey(key: string): { kind: PersonalManualSyncKind; id: string } | undefined {
  const separator = key.indexOf(":");
  if (separator < 1) return undefined;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  return id && (kind === "game" || kind === "folder" || kind === "analysis")
    ? { kind, id }
    : undefined;
}

export function isProviderMirrorGame(game: LocalManualGame) {
  return game.readOnly === true || game.origin?.kind === "providerMirror";
}

export function assertManualGameEditable(game?: LocalManualGame) {
  if (game && isProviderMirrorGame(game)) {
    throw new Error("天天象棋云镜像为只读棋谱，请先复制到我的棋谱再编辑。");
  }
}

export function copyProviderMirrorToEditable(game: LocalManualGame, id: string, now: string): LocalManualGame {
  const { origin: _origin, readOnly: _readOnly, ...editable } = game;
  return {
    ...editable,
    id,
    title: `${game.title}（副本）`,
    folderPath: undefined,
    branches: (game.branches ?? []).map((branch) => ({
      ...branch,
      parentPath: [...branch.parentPath],
      moves: [...branch.moves],
      notation: [...branch.notation],
    })),
    comments: { ...(game.comments ?? {}) },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPersonalManualSyncRecords(
  games: LocalManualGame[],
  folders: LocalManualFolder[],
  analyses: LocalManualAnalysisSummary[],
  revisions: Record<string, number>,
): PersonalManualSyncRequestRecord[] {
  const local = new Map<string, Pick<PersonalManualSyncRequestRecord, "kind" | "id" | "payload">>();
  const providerMirrorGameIds = new Set(games.filter(isProviderMirrorGame).map((game) => game.id));
  for (const game of games) {
    if (isProviderMirrorGame(game)) continue;
    local.set(recordKey("game", game.id), { kind: "game", id: game.id, payload: game });
  }
  for (const folder of folders) {
    if (folder.path === TTXQ_MIRROR_FOLDER || folder.path.startsWith(`${TTXQ_MIRROR_FOLDER}/`)) continue;
    local.set(recordKey("folder", folder.path), { kind: "folder", id: folder.path, payload: folder });
  }
  for (const analysis of analyses) {
    if (providerMirrorGameIds.has(analysis.gameId) || analysis.gameId.startsWith("ttxq:")) continue;
    const id = `${analysis.gameId}:${analysis.nodeId}`;
    local.set(recordKey("analysis", id), { kind: "analysis", id, payload: analysis });
  }
  const records: PersonalManualSyncRequestRecord[] = [...local.values()].map((record) => ({
    ...record,
    baseRevision: revisions[recordKey(record.kind, record.id)] || 0,
    deleted: false,
  }));
  for (const [key, revision] of Object.entries(revisions)) {
    if (local.has(key)) continue;
    const record = parseRecordKey(key);
    if (!record
      || (record.kind === "game" && record.id.startsWith("ttxq:"))
      || (record.kind === "folder" && (record.id === TTXQ_MIRROR_FOLDER || record.id.startsWith(`${TTXQ_MIRROR_FOLDER}/`)))
      || (record.kind === "analysis" && record.id.startsWith("ttxq:"))) continue;
    records.push({ ...record, baseRevision: revision, deleted: true, payload: {} });
  }
  return records;
}

import assert from "node:assert/strict";
import test from "node:test";
import { assertManualGameEditable, buildPersonalManualSyncRecords, copyProviderMirrorToEditable } from "../src/providerMirrors.ts";
import type { LocalManualGame } from "../src/types.ts";

function game(id: string, mirror = false): LocalManualGame {
  return {
    id,
    title: mirror ? "云镜像" : "个人棋谱",
    note: "",
    folderPath: mirror ? "天天象棋云镜像" : "训练",
    startingFen: "start",
    currentNodeId: "root",
    currentFen: "start",
    moves: ["h2e2"],
    cursor: 1,
    branches: [{ id: "branch", parentCursor: 0, parentPath: [], moves: ["h2e2"], notation: ["炮二平五"], createdAt: 1 }],
    comments: { "0": "注解" },
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
    ...(mirror ? {
      readOnly: true,
      origin: { kind: "providerMirror" as const, provider: "ttxq" as const, externalId: "778899", payloadHash: "sha256:1" },
    } : {}),
  };
}

test("copying a cloud mirror creates an independent editable game", () => {
  const mirror = game("ttxq:778899", true);
  const copy = copyProviderMirrorToEditable(mirror, "new-uuid", "2026-10-10T01:00:00Z");
  assert.equal(copy.id, "new-uuid");
  assert.equal(copy.readOnly, undefined);
  assert.equal(copy.origin, undefined);
  assert.equal(copy.folderPath, undefined);
  assert.notEqual(copy.branches, mirror.branches);
  assert.notEqual(copy.comments, mirror.comments);
});

test("cloud mirrors are rejected by the shared editing guard", () => {
  assert.throws(
    () => assertManualGameEditable(game("ttxq:778899", true)),
    /只读棋谱/,
  );
  assert.doesNotThrow(() => assertManualGameEditable(game("personal")));
});

test("personal sync excludes mirrors and never creates mirror tombstones", () => {
  const records = buildPersonalManualSyncRecords(
    [game("personal"), game("ttxq:778899", true)],
    [{ path: "训练", createdAt: "2026-10-10T00:00:00Z" }, { path: "天天象棋云镜像", createdAt: "2026-10-10T00:00:00Z" }],
    [
      { gameId: "personal", nodeId: "root", fen: "start", depth: 12, bestMove: "h2e2", pv: [], updatedAt: "2026-10-10T00:00:00Z" },
      { gameId: "ttxq:778899", nodeId: "root", fen: "start", depth: 12, bestMove: "h2e2", pv: [], updatedAt: "2026-10-10T00:00:00Z" },
    ],
    { "game:personal": 2, "game:ttxq:778899": 3, "folder:天天象棋云镜像": 1, "analysis:ttxq:778899:root": 1 },
  );
  assert.deepEqual(records.map((record) => `${record.kind}:${record.id}:${record.deleted}`), [
    "game:personal:false",
    "folder:训练:false",
    "analysis:personal:root:false",
  ]);
});

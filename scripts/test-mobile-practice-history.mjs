import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(new URL("../apps/endgame-training/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/endgame-training/src/practiceHistory.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
vm.runInNewContext(outputText, { exports, Date });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("calendar combines sessions on the same date without changing source data", () => {
  const history = [
    { localDate: "2026-10-02", completedCount: 3, correctCount: 2, sessionId: "a" },
    { localDate: "2026-10-01", completedCount: 2, correctCount: 1, sessionId: "b" },
    { localDate: "2026-10-02", completedCount: 5, correctCount: 4, sessionId: "c" },
  ];
  const before = structuredClone(history);
  assert.deepEqual(plain(exports.practiceHistoryByDay(history)), [
    { localDate: "2026-10-02", completedCount: 8, correctCount: 6 },
    { localDate: "2026-10-01", completedCount: 2, correctCount: 1 },
  ]);
  assert.deepEqual(history, before);
});

test("seven calendar dates cross month and year boundaries and fill empty dates", () => {
  const days = plain(exports.recentPracticeDays([
    { localDate: "2025-12-31", completedCount: 2, correctCount: 1, sessionId: "a" },
    { localDate: "2025-12-01", completedCount: 9, correctCount: 9, sessionId: "old" },
  ], new Date(2026, 0, 2, 0, 1)));
  assert.deepEqual(days.map((day) => day.localDate), ["2025-12-27", "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  assert.equal(days[4].completedCount, 2);
  assert.equal(days[6].completedCount, 0);
  assert.equal(days[6].correctCount, 0);
});

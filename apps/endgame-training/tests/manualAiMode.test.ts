import assert from "node:assert/strict";
import test from "node:test";
import { analysisEntryPhase, manualAiLabel, manualAiMode, nextManualAiPhase, type ManualAiPhase } from "../src/manualAiMode.ts";

test("cycles through both evaluation phases for two complete rounds", () => {
  let phase: ManualAiPhase = 0;
  const labels = [manualAiLabel(manualAiMode(phase))];
  for (let index = 0; index < 8; index++) {
    phase = nextManualAiPhase(phase);
    labels.push(manualAiLabel(manualAiMode(phase)));
  }
  assert.deepEqual(labels, ["AI 禁用", "AI 局势", "AI 提示", "AI 局势", "AI 禁用", "AI 局势", "AI 提示", "AI 局势", "AI 禁用"]);
});

test("analysis entry enables hints only from disabled and preserves evaluation direction", () => {
  assert.equal(analysisEntryPhase(0), 2);
  for (const phase of [1, 2, 3] as const) assert.equal(analysisEntryPhase(phase), phase);
  const afterEntry = nextManualAiPhase(analysisEntryPhase(0));
  assert.equal(manualAiMode(afterEntry), "evaluation");
  assert.equal(manualAiMode(nextManualAiPhase(afterEntry)), "disabled");
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { teachingRead } from "../src/teachingDeadline.ts";

test("a stalled verification settles and aborts transport at its deadline", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(teachingRead(s => {
    signal = s;
    return new Promise(() => {});
  }, undefined, undefined, 10), /超时/);
  assert.equal(signal?.aborted, true);
});

test("changing problem, session or account cancels even an unresponsive transport", async () => {
  let current = true;
  let signal: AbortSignal | undefined;
  const request = teachingRead(s => {
    signal = s;
    return new Promise(() => {});
  }, undefined, () => current);
  current = false;
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(signal?.aborted, true);
});

test("a caller abort cancels immediately while successful responses keep their value", async () => {
  const controller = new AbortController();
  const request = teachingRead(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.deepEqual(await teachingRead(async () => ({ outcome: "correct" })), { outcome: "correct" });
});

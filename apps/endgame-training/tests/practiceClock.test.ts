import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PracticeClock } from "../src/practiceClock.ts";

test("thinking starts when ready; engine waits and background time do not count", () => {
  let now = 0;
  const clock = new PracticeClock(() => now);
  now = 5_000; // loading
  assert.equal(clock.read(), 0);
  clock.setRunning(true);
  now += 12_000; // thinking before first move
  assert.equal(clock.read(), 12_000);
  clock.setRunning(false);
  now += 15_000; // verification
  assert.equal(clock.read(), 12_000);
  clock.setRunning(true);
  now += 3_000;
  clock.setRunning(false);
  now += 60_000; // background
  assert.equal(clock.read(), 15_000);
});

test("each question resets, restored drafts retain time, completion freezes", () => {
  let now = 100;
  const clock = new PracticeClock(() => now);
  clock.reset(8_000);
  clock.setRunning(true);
  now += 2_000;
  clock.setRunning(false);
  assert.equal(clock.read(), 10_000);
  now += 99_000;
  assert.equal(clock.read(), 10_000);
  clock.reset();
  clock.setRunning(true);
  now += 500;
  assert.equal(clock.read(), 500);
});

test("repeated resume does not restart time and invalid restored values are safe", () => {
  let now = 0;
  const clock = new PracticeClock(() => now);
  clock.setRunning(true);
  now = 500;
  clock.setRunning(true);
  now = 1_000;
  assert.equal(clock.read(), 1_000);
  for (const saved of [-5, NaN, Infinity]) { clock.reset(saved); assert.equal(clock.read(), 0); }
});

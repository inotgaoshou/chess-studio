import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EngineCoordinator, EngineBusyError } from "../src/engineCoordinator.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("commentary cannot stop an AI reply or manual analysis", async () => {
  let stops = 0;
  const engine = new EngineCoordinator(async () => { stops++; });
  const reply = deferred<string>();
  const pending = engine.run(3, () => reply.promise);
  await tick();
  await assert.rejects(engine.run(1, async () => "commentary"), EngineBusyError);
  assert.equal(stops, 0); reply.resolve("reply"); assert.equal(await pending, "reply");
});

test("AI reply preempts commentary and waits for native cancellation before starting", async () => {
  const events: string[] = [], comment = deferred<string>(), stop = deferred<void>();
  const engine = new EngineCoordinator(async () => { events.push("stop"); comment.resolve("obsolete"); await stop.promise; events.push("stopped"); });
  const first = engine.run(1, () => comment.promise);
  const rejected = assert.rejects(first, { name: "AbortError" });
  await tick();
  const reply = engine.run(3, async () => { events.push("reply"); return "ok"; });
  await tick(); assert.deepEqual(events, ["stop"]);
  stop.resolve(); assert.equal(await reply, "ok"); await rejected;
  assert.deepEqual(events, ["stop", "stopped", "reply"]);
});

test("aborting the old commentary owner cannot stop a newer analysis", async () => {
  let stops = 0;
  const comment = deferred<string>(), analysis = deferred<string>();
  const engine = new EngineCoordinator(async () => { stops++; comment.resolve("old"); });
  const owner = new AbortController();
  const first = engine.run(1, () => comment.promise, owner.signal);
  const rejected = assert.rejects(first, { name: "AbortError" });
  await tick();
  const second = engine.run(2, () => analysis.promise);
  await tick(); owner.abort(); await tick();
  assert.equal(stops, 1); analysis.resolve("new"); assert.equal(await second, "new"); await rejected;
});

test("cancelled queued work never starts after a later request", async () => {
  const active = deferred<void>(), stopping = deferred<void>();
  const engine = new EngineCoordinator(async () => { active.resolve(); await stopping.promise; });
  const first = engine.run(1, () => active.promise); const rejected1 = assert.rejects(first, { name: "AbortError" });
  await tick(); let obsolete = 0;
  const second = engine.run(2, async () => { obsolete++; }); const rejected2 = assert.rejects(second, { name: "AbortError" });
  const third = engine.run(3, async () => "reply"); stopping.resolve();
  await Promise.all([rejected1, rejected2]); assert.equal(await third, "reply"); assert.equal(obsolete, 0);
});

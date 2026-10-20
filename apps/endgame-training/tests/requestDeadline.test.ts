import {strict as assert} from "node:assert";
import {test} from "node:test";
import {withRequestDeadline} from "../src/requestDeadline.ts";

test("stalled native callback or response body times out even when it ignores abort", async () => {
  let transport: AbortSignal | undefined;
  await assert.rejects(withRequestDeadline(signal => {transport=signal;return new Promise(() => {});}, undefined, "超时", 5), /超时/);
  assert.equal(transport?.aborted,true);
});
test("cancel before starting prevents writes, and cancellation after starting rejects late values", async () => {
  const before=new AbortController();before.abort();let writes=0;
  await assert.rejects(withRequestDeadline(async () => ++writes,before.signal), {name:"AbortError"});
  assert.equal(writes,0);
  const after=new AbortController();let finish!: (value:number)=>void;
  const pending=withRequestDeadline(() => new Promise<number>(resolve => {finish=resolve;}),after.signal);
  after.abort();finish(42);
  await assert.rejects(pending,{name:"AbortError"});
});
test("successful completion releases its timeout without cancelling transport later", async () => {
  let transport:AbortSignal | undefined;
  assert.equal(await withRequestDeadline(async signal => {transport=signal;return 42;},undefined,undefined,5),42);
  await new Promise(resolve => setTimeout(resolve,15));
  assert.equal(transport?.aborted,false);
});

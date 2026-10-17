import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mergePracticeDrafts, mergePracticeAttempts, practiceContent } from "../src/practiceProgress.ts";
import type { PracticeSession } from "../src/teaching.ts";
const session = { id: "s", currentItemId: "z", items: [{ id:"z", status:"pending", problem:{ startingFen:"fen", solution:[], trainingGoal:{ goal:"win" } } }, { id:"a", status:"pending", problem:{ startingFen:"fen2", solution:[] } }] } as unknown as PracticeSession;
function draft(id: string, revision: string, moves = ["a1a2"]) {
  return {cacheKey:id,sessionKey:"scope::s",sessionId:"s",currentItemId:id,revision,draft:{ moves, verificationContent: practiceContent(session.items.find(i=>i.id===id)!.problem) }};
}
test("offline route survives switching items and keeps latest navigation", () => {
  const result = mergePracticeDrafts(session,[draft("a","002"),draft("z","001")]);
  assert.equal(result.currentItemId,"a"); assert.deepEqual(result.items[0].draft?.moves,["a1a2"]);
});
test("changed problem conditions invalidate route", () => {
  const changed = structuredClone(session); changed.items[0].problem.startingFen="changed";
  assert.equal(mergePracticeDrafts(changed,[draft("z","001")]).items[0].draft,undefined);
});
test("offline completed attempt restores pending-server result without grade", () => {
  const result = mergePracticeAttempts(session,[{ itemId:"z", elapsedMs:100, hintsUsed:1,mistakes:0,outcome:"completed",clientAttemptId:"once",moves:["a1a2"] }]);
  assert.equal(result.items[0].status,"completed"); assert.equal(result.items[0].verificationState,"pending_server"); assert.equal(result.items[0].grade,undefined); assert.deepEqual(result.items[0].draft?.moves,["a1a2"]);
});
test("server confirmation replaces optimistic result after queue removed", () => {
  const confirmed=structuredClone(session); confirmed.items[0].status="completed"; confirmed.items[0].grade={score:100,stars:5,attemptNumber:1,firstTryCorrect:true,mistakes:0,hintsUsed:0};
  assert.equal(mergePracticeAttempts(confirmed,[]).items[0].verificationState,undefined); assert.equal(mergePracticeAttempts(confirmed,[]).items[0].grade?.score,100);
});
test("old unflushed item draft cannot override acknowledged recent navigation", () => {
  const atA={ ...session,currentItemId:"a" };
  assert.equal(mergePracticeDrafts(atA,[draft("z","001")],"002").currentItemId,"a");
  assert.deepEqual(mergePracticeDrafts(atA,[draft("z","001")],"002").items[0].draft?.moves,["a1a2"]);
});
test("latest offline attempt follows saved revision regardless of random id order", () => {
  const common={ itemId:"z",elapsedMs:20,hintsUsed:0,mistakes:0,moves:["a1a2"] };
  const result=mergePracticeAttempts(session,[{ ...common,clientAttemptId:"aaa-new",outcome:"completed",queuedRevision:"002" },{ ...common,clientAttemptId:"zzz-old",outcome:"abandoned",queuedRevision:"001" }]);
  assert.equal(result.items[0].status,"completed");
});
test("new retry progress survives an older completed attempt still awaiting sync", () => {
  const retry=mergePracticeDrafts(session,[draft("z","003",[])]);
  const result=mergePracticeAttempts(retry,[{ itemId:"z",elapsedMs:20,hintsUsed:0,mistakes:0,moves:["a1a2"],clientAttemptId:"previous",outcome:"completed",queuedRevision:"002" }]);
  assert.equal(result.items[0].status,"pending"); assert.deepEqual(result.items[0].draft?.moves,[]);
});

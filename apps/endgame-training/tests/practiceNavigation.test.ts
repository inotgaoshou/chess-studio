import { strict as assert } from "node:assert";
import { test } from "node:test";
import { currentListNumbers, initialPracticeItem, practiceGroupIds, practiceGroupSummary } from "../src/practiceNavigation.ts";

test("display ordinals span deduplicated pages and restart for a different filter", () => {
  const first = Array.from({length: 50}, (_, i) => ({id: `p${i}`}));
  const next = [...first, first[49], {id: "p50"}];
  assert.equal(currentListNumbers(next).p50, 51);
  assert.equal(currentListNumbers([next[50], next[51]]).p50, 2);
  assert.equal(currentListNumbers([{id: "p50"}]).p50, 1);
});

test("catalog groups retain list order, remove duplicates, and include the clicked problem", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
  assert.deepEqual(practiceGroupIds([...items, items[22]], "p22"), items.slice(20, 40).map(p => p.id));
  assert.deepEqual(practiceGroupIds(items, "p49"), items.slice(40).map(p => p.id));
  assert.deepEqual(practiceGroupIds(items, "missing"), []);
});

test("selected problem opens even when the server returns a different item order", () => {
  const items = [{ id: "i1", problem: { id: "p1" }, status: "pending" }, { id: "i2", problem: { id: "p2" }, status: "completed" }];
  assert.equal(initialPracticeItem(items, "i1", undefined, "p2")?.id, "i2");
  assert.equal(initialPracticeItem(items, "i1", "i2")?.id, "i2");
  assert.equal(initialPracticeItem(items, "i2")?.id, "i2");
  assert.equal(initialPracticeItem([], undefined), undefined);
  assert.equal(initialPracticeItem(items, "i1", undefined, "unavailable"), undefined);
});

test("groups after 20 retain list ordinals and can reach adjacent loaded groups", async () => {
  const { adjacentPracticeGroup, numberedProblemTitle } = await import("../src/practiceNavigation.ts");
  const items=Array.from({length:50},(_,i)=>({id:`p${i+1}`})),numbers=currentListNumbers(items);
  assert.equal(numbers.p21,21);assert.equal(numbers.p22,22);
  assert.deepEqual(adjacentPracticeGroup(numbers,"p22",-1),items.slice(0,20).map(p=>p.id));
  assert.deepEqual(adjacentPracticeGroup(numbers,"p22",1),items.slice(40).map(p=>p.id));
  assert.deepEqual(adjacentPracticeGroup(numbers,"p1",-1),[]);
  assert.deepEqual(adjacentPracticeGroup(numbers,"p50",1),[]);
  assert.equal(numberedProblemTitle("第 1 题 · 两步杀"),"两步杀");
  assert.equal(numberedProblemTitle("0002-两步杀"),"两步杀");
  assert.equal(numberedProblemTitle("2步杀"),"2步杀");
});


test("group totals include a partial last group and share navigation order", () => {
  const numbers=currentListNumbers(Array.from({length:50},(_,i)=>({id:`p${i+1}`})));
  assert.deepEqual(practiceGroupSummary(numbers,"p1",50),{current:1,total:3,problemCount:50,complete:true});
  assert.deepEqual(practiceGroupSummary(numbers,"p22",50),{current:2,total:3,problemCount:50,complete:true});
  assert.deepEqual(practiceGroupSummary(numbers,"p50",50),{current:3,total:3,problemCount:50,complete:true});
  assert.deepEqual(practiceGroupSummary({p:1},"p",1),{current:1,total:1,problemCount:1,complete:true});
  assert.deepEqual(practiceGroupSummary(currentListNumbers(Array.from({length:20},(_,i)=>({id:String(i)}))),"19",20),{current:1,total:1,problemCount:20,complete:true});
  assert.equal(practiceGroupSummary(numbers,"missing",50),undefined);
});

test("catalog total is independent of loaded pages; unknown counts are labelled incomplete", () => {
  const numbers=currentListNumbers(Array.from({length:50},(_,i)=>({id:`p${i+1}`})));
  assert.deepEqual(practiceGroupSummary(numbers,"p22",501),{current:2,total:26,problemCount:501,complete:true});
  for(const count of [undefined,null,NaN,Infinity,0,20,50.5]) {
    assert.deepEqual(practiceGroupSummary(numbers,"p22",count),{current:2,total:3,problemCount:50,complete:false});
  }
  assert.deepEqual(practiceGroupSummary({p:1,invalid:NaN,zero:0,negative:-1},"p",1),{current:1,total:1,problemCount:1,complete:true});
  assert.deepEqual(practiceGroupSummary(currentListNumbers([{id:"p50"}]),"p50",1),{current:1,total:1,problemCount:1,complete:true});
});


test("source-only ordinals leave no second ordinal while meaningful titles remain",async()=>{
 const {numberedProblemTitle}=await import("../src/practiceNavigation.ts");
 for(const title of ["第 1 题","第2局","图 1","题3"]) assert.equal(numberedProblemTitle(title),"");
 assert.equal(numberedProblemTitle("第 1 题 · 车兵巧胜"),"车兵巧胜");
 assert.equal(numberedProblemTitle("3步杀"),"3步杀");
});


test("unreviewed local success remains separate from confirmed completion",async()=>{
 const {navigationStatus,numberedProblemLabel}=await import("../src/practiceNavigation.ts");
 assert.equal(navigationStatus("completed","pending_server"),"verifying");
 assert.equal(navigationStatus("completed"),"completed");
 assert.equal(navigationStatus("revealed"),"revealed");
 assert.equal(navigationStatus("abandoned"),"pending");
 assert.equal(numberedProblemLabel(22,"第 1 题"),"第 22 题");
 assert.equal(numberedProblemLabel(22,"第 1 题 · 车兵巧胜"),"第 22 题 · 车兵巧胜");
 assert.equal(numberedProblemLabel(undefined,"图1"),"图1");
});

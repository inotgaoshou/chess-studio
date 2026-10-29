import { describe, expect, it } from "vitest";
import { manualContinuations, preserveManualMainline } from "../src/manualContinuation";
import type { LocalManualGame } from "../src/types";
const game = ():LocalManualGame => ({id:"source",title:"测试",note:"",startingFen:"initial",currentFen:"root",currentNodeId:"root",cursor:0,moves:["h2e2","h9g7"],branches:[{id:"first",parentCursor:0,parentPath:[],moves:["b0c2","b9c7"],notation:["马八进七","马2进3"],branchOrder:2,createdAt:1},{id:"nested",parentCursor:1,parentPath:["b0c2"],moves:["h9g7"],notation:["马8进7"],branchOrder:1,createdAt:2}],comments:{"h2e2":"原注释"},createdAt:"2026-10-29T00:00:00Z",updatedAt:"2026-10-29T00:00:00Z"});
describe("mobile direct branch navigation", () => {
  it("merges shared first moves and includes nested paths only under their exact parent", () => {
    const source=game(),before=structuredClone(source);
    const root=manualContinuations(source.moves,["炮二平五","马8进7"],source.branches,[]);
    expect(root.map(c=>c.move)).toEqual(["b0c2","h2e2"]);
    const nested=manualContinuations(source.moves,[],source.branches,["b0c2"],["b0c2","b9c7"]);
    expect(nested.map(c=>c.move)).toEqual(["h9g7","b9c7"]);
    expect(nested.find(c=>c.move==="b9c7")?.selected).toBe(true);
    expect(manualContinuations(source.moves,[],source.branches,["unrelated"])).toEqual([]);
    expect(source).toEqual(before);
  });
  it("respects the existing order of a mainline represented by a saved branch", () => {
    const source=game(); source.branches.push({id:"main-copy",parentCursor:0,parentPath:[],moves:source.moves,notation:["炮二平五","马8进7"],branchOrder:10,createdAt:3});
    expect(manualContinuations(source.moves,["炮二平五","马8进7"],source.branches,[]).map(c=>c.move)).toEqual(["b0c2","h2e2"]);
    source.branches[0].branchOrder=20;
    expect(manualContinuations(source.moves,["炮二平五","马8进7"],source.branches,[]).map(c=>c.move)).toEqual(["h2e2","b0c2"]);
  });
  it("keeps mainline, annotations and order when viewing an existing variation", () => {
    const source=game(),before=structuredClone(source);
    const projected={...source,moves:["b0c2","b9c7"],cursor:1,currentFen:"branch"};
    const saved=preserveManualMainline(projected,source,["马八进七","马2进3"]);
    expect(saved).toEqual(source); expect(source).toEqual(before);
  });
  it("persists a new continuation as a variation without promoting the viewed route", () => {
    const source=game();
    const saved=preserveManualMainline({...source,moves:["b0c2","a9a8"],cursor:2},source,["马八进七","车1进1"]);
    expect(saved.moves).toEqual(source.moves);expect(saved.comments).toEqual(source.comments);
    expect(saved.branches.slice(0,2)).toEqual(source.branches);
    expect(saved.branches[2]).toMatchObject({parentPath:["b0c2"],moves:["a9a8"]});
  });
});

it("projects a saved sole continuation after 5/5 without promoting it into the canonical mainline",async()=>{
 const {extendManualContinuation}=await import("../src/manualContinuation");
 const source=game();source.moves=["b0c2","b9c7","h0g2","h9g7","a3a4"];
 source.branches=[{id:"tail",parentCursor:5,parentPath:source.moves,moves:["a6a5","c3c4","c6c5","g3g4"],notation:[],createdAt:1}];
 const before=structuredClone(source),projected=extendManualContinuation(source,source.moves);
 expect(projected).toHaveLength(9);expect(projected.slice(0,5)).toEqual(source.moves);expect(source).toEqual(before);
 expect(preserveManualMainline({...source,moves:projected},source,[])).toEqual(source);
});
it("stops a projected tail at the first undecided fork and respects the previously browsed route",async()=>{
 const {extendManualContinuation}=await import("../src/manualContinuation");
 const source=game();source.moves=["a3a4"];
 source.branches=[{id:"a",parentCursor:1,parentPath:source.moves,moves:["a6a5","c3c4"],notation:[],createdAt:1},{id:"b",parentCursor:2,parentPath:["a3a4","a6a5"],moves:["g3g4"],notation:[],createdAt:2}];
 expect(extendManualContinuation(source,source.moves)).toEqual(["a3a4","a6a5"]);
 expect(extendManualContinuation(source,["a3a4","a6a5","c3c4"])).toEqual(["a3a4","a6a5","c3c4"]);
});

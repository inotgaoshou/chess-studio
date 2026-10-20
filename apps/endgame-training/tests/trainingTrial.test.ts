import { strict as assert } from "node:assert";
import { test } from "node:test";
import { advanceTrainingTrial, type TrainingTrialPosition } from "../src/trainingTrial.ts";
import type { BoardState } from "../src/types.ts";

const board = (path: string[], status = "正常"): BoardState => ({ fen: path.join(" "), pieces: [], sideToMove: "red", status });
test("a legal trial move is shown before the engine replies, without mutating the accepted path", async () => {
  const accepted = ["accepted"], shown: TrainingTrialPosition[] = [], searched: string[] = [];
  const result = await advanceTrainingTrial("initial", accepted, "mistake", {
    boardAt: async (_fen, path) => board(path),
    reply: async fen => { assert.equal(shown.length, 1); searched.push(fen); return "defence"; },
  }, () => true, p => shown.push(p));
  assert.equal(result, "ready");assert.deepEqual(accepted, ["accepted"]);
  assert.deepEqual(searched, ["accepted mistake"]);
  assert.deepEqual(shown.map(p => p.path), [["accepted", "mistake"], ["accepted", "mistake", "defence"]]);
  assert.equal(shown.at(-1)?.awaitingReply, false);
  await advanceTrainingTrial("initial", shown.at(-1)!.path, "try-again", {
    boardAt: async (_fen, path) => board(path), reply: async fen => { assert.equal(fen, "accepted mistake defence try-again");return "defence2"; },
  }, () => true, p => shown.push(p));
  assert.deepEqual(shown.at(-1)?.path, ["accepted", "mistake", "defence", "try-again", "defence2"]);
  assert.deepEqual(accepted, ["accepted"]);
});
test("engine failure preserves the player position, and retry does not replay the player move", async () => {
  const shown: TrainingTrialPosition[] = [];
  assert.equal(await advanceTrainingTrial("initial", [], "mistake", {boardAt:async (_f,p)=>board(p),reply:async()=>{throw Error("offline");}},()=>true,p=>shown.push(p)), "unavailable");
  assert.equal(shown.at(-1)?.awaitingReply,true);
  await advanceTrainingTrial("initial",shown.at(-1)!.path,undefined,{boardAt:async (_f,p)=>board(p),reply:async()=>"reply"},()=>true,p=>shown.push(p));
  assert.deepEqual(shown.at(-1)?.path,["mistake","reply"]);
});
test("illegal player or engine moves never appear on the board", async () => {
  for(const playerIllegal of [true,false]) {
    const shown: TrainingTrialPosition[] = [];let replies=0;
    await advanceTrainingTrial("initial",[],"mistake",{boardAt:async (_f,p)=>{if(playerIllegal||p.length>1)throw Error("illegal");return board(p);},reply:async()=>{replies++;return "illegal-reply";}},()=>true,p=>shown.push(p));
    assert.equal(shown.length,playerIllegal?0:1);assert.equal(replies,playerIllegal?0:1);
  }
});
test("terminal trial positions are displayed but never trigger an engine search", async () => {
  const shown:TrainingTrialPosition[]=[];
  assert.equal(await advanceTrainingTrial("initial",[],"finish",{boardAt:async(_f,p)=>board(p,"将死"),reply:async()=>{assert.fail("terminal search");}},()=>true,p=>shown.push(p)),"ended");
  assert.equal(shown[0].terminal,true);assert.equal(shown[0].awaitingReply,false);
});
test("switching problems and stalled callbacks discard late replies", async () => {
  for(const timeout of [false,true]) {
    let current=true,release!:(reply:string)=>void;const shown:TrainingTrialPosition[]=[];
    const pending=advanceTrainingTrial("initial",[],"mistake",{boardAt:async(_f,p)=>board(p),reply:()=>new Promise(resolve=>{release=resolve;})},()=>current,p=>shown.push(p),timeout?10:1000);
    await new Promise(resolve=>setTimeout(resolve,0));
    if(timeout){assert.equal(await pending,"unavailable");release("late");}else{current=false;release("late");assert.equal(await pending,"cancelled");}
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(shown.length,1);
  }
});

// Exercise the shipped WASM rules with the user's screenshot position.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync, WebGame, verifyTrainingMove } from "../apps/endgame-training/public/wasm/xiangqi_web_core.js";

initSync({ module: readFileSync(new URL("../apps/endgame-training/public/wasm/xiangqi_web_core_bg.wasm", import.meta.url)) });
const fen = "3a5/2P1n1N2/3k1a3/9/9/9/9/3A5/9/4K4 w - - 0 1";
function game(position, moves = []) {
  const board = new WebGame(position, "domestic2020");
  for (const move of moves) board.playMove(move);
  return board;
}
assert.equal(JSON.parse(game(fen, ["g8f6"]).stateJson()).status, "将军");
const capture = JSON.parse(game(fen, ["g8f6", "e8f6"]).stateJson());
assert.equal(capture.pieces.find(p => p.row === 3 && p.col === 5).color, "black");
for (const move of ["g8f7", "g8f8", "g8e8"]) {
  const board = game(fen);
  const before = board.stateJson();
  assert.throws(() => board.playMove(move), undefined, move);
  assert.equal(board.stateJson(), before, "illegal moves cannot change the position");
}
const redBlocked = "3a5/2P1n1N2/3k1aP2/9/9/9/9/3A5/9/4K4 w - - 0 1";
assert.throws(() => game(redBlocked, ["g8f6"]));
const blackBlocked = "3a5/2P1n1N2/3kpa3/9/9/9/9/3A5/9/4K4 w - - 0 1";
const blockedReply = game(blackBlocked, ["g8f6"]);
const beforeReply = blockedReply.stateJson();
assert.throws(() => blockedReply.playMove("e8f6"));
assert.equal(blockedReply.stateJson(), beforeReply);

const result = JSON.parse(verifyTrainingMove(
  JSON.stringify({ startingFen: fen, path: [], candidate: "g8f6", solution: [] }),
  JSON.stringify({ engineFingerprint: "", lines: {} }),
));
assert.equal(result.outcome, "pending_review");
assert.deepEqual(result.path, []);
assert.deepEqual(result.autoMoves, []);
assert.equal(result.completed, false);
console.log("PASS screenshot moves and recapture legal; non-L moves and both blocked legs rejected without mutation; missing conditions never accept a solution or AI reply.");

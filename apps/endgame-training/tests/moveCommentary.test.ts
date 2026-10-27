import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeCommentary, createLocalCommentaryProvider, type CommentaryRequest, type MoveFacts } from "../../../packages/move-commentary/index.ts";

function fact(move = "h2e2", side: "Red" | "Black" = "Red"): MoveFacts {
  return { beforeFen: "before", afterFen: "after", iccs: move, notation: move === "h2e2" ? "炮二平五" : "马８进７",
    mover: { color: side, kind: "Cannon" }, from: { row: 7, col: 7 }, to: { row: 7, col: 4 },
    captured: null, wasInCheck: false, resolvesCheck: false, givesCheck: false, status: "Ongoing",
    attacksBefore: [], attacksAfter: [], opponentCapturesAfter: [], materialBefore: [], materialAfter: [] };
}
const request: CommentaryRequest = { beforeFen: "before", move: "h2e2", ruleMode: "domestic2020", engineIdentity: "engine:v1", moveTimeMs: 2000, multiPv: 3, accessScope: "local:teacher" };

test("actual non-best move is followed by analysis of its own resulting position", async () => {
  const analyzed: string[] = [], lines: string[][] = [];
  const provider = createLocalCommentaryProvider({ facts: async (_, moves) => { lines.push(moves); return moves.map((move, i) => fact(move, i % 2 ? "Black" : "Red")); }, analyze: async fen => { analyzed.push(fen); return { depth: 18, pv: ["h9g7"] }; } });
  const result = await provider.explain({ ...request, reference: { fen: "before", line: { depth: 20, pv: ["b0c2", "h9g7"] } } }, new AbortController().signal);
  assert.deepEqual(analyzed, ["after"]);
  assert.deepEqual(lines[1], ["h2e2", "h9g7"]);
  assert.equal(result.move, "h2e2");
  assert.match(result.sections[2].text, /黑方/);
});

test("matching candidate reuses legal PV, caps it at twelve half moves and scopes cache", async () => {
  let analyses = 0, facts = 0;
  const provider = createLocalCommentaryProvider({ facts: async (_, moves) => { facts++; return moves.map(m => fact(m)); }, analyze: async () => { analyses++; return undefined; } });
  const candidate = { ...request, reference: { fen: "before", line: { depth: 26, pv: [request.move, ...Array(30).fill("h9g7")] } } };
  const first = await provider.explain(candidate, new AbortController().signal);
  assert.equal(first.reference.length, 12); assert.equal(analyses, 0);
  await provider.explain(candidate, new AbortController().signal); assert.equal(facts, 2);
  for (const changed of [{ accessScope: "other-user" }, { engineIdentity: "engine:v2" }, { ruleMode: "asianAxf" }, { moveTimeMs: 4000 }]) {
    await provider.explain({ ...candidate, ...changed }, new AbortController().signal);
  }
  assert.equal(facts, 10);
  provider.clear(); await provider.explain(candidate, new AbortController().signal); assert.equal(facts, 12);
});

test("invalid PV falls back to facts and a subsequent retry is not poisoned", async () => {
  let failed = true;
  const provider = createLocalCommentaryProvider({ facts: async (_, moves) => {
    if (moves.length > 1 && failed) throw Error("illegal");
    return moves.map(m => fact(m));
  }, analyze: async () => ({ depth: 8, pv: ["h9g7"] }) });
  const first = await provider.explain(request, new AbortController().signal);
  assert.equal(first.facts.length, 1); assert.equal(first.depth, undefined);
  assert.match(first.sections[4].text, /未通过校验/);
  failed = false;
  assert.equal((await provider.explain(request, new AbortController().signal)).facts.length, 2);
});

test("aborted analysis cannot publish or cache a late response", async () => {
  let finish!: () => void;
  const provider = createLocalCommentaryProvider({ facts: async (_, moves) => moves.map(m => fact(m)), analyze: () => new Promise(resolve => { finish = () => resolve({ depth: 26, pv: ["h9g7"] }); }) });
  const controller = new AbortController();
  const pending = provider.explain(request, controller.signal);
  await Promise.resolve(); controller.abort(); finish();
  await assert.rejects(pending, { name: "AbortError" });
});

test("direct attack and reference capture never imply a forced material gain", () => {
  const target = fact(); target.attacksAfter = [{ iccs: "e2e7", attacker: target.mover, target: { color: "Black", kind: "Rook" } }];
  target.wasInCheck = true; target.resolvesCheck = true;
  const next = fact("h9g7", "Black");
  const capture = fact("e2e7"); capture.captured = { color: "Black", kind: "Rook" };
  const result = composeCommentary(target, [target, next, capture], 8);
  assert.match(result.sections[1].text, /解除己方将军/);
  assert.match(result.sections[1].text, /不代表赢子/);
  assert.match(result.sections[3].text, /红方「.*」吃掉黑车/);
  assert.match(result.sections[3].text, /比较其他防守/);
});

test("teaching text uses Chinese moves and concise position facts instead of coordinates or ply jargon", () => {
  const target = fact();
  target.attacksAfter = [{ iccs: "e2e7", attacker: target.mover, target: { color: "Black", kind: "Rook" } }];
  const result = composeCommentary(target, [target, fact("h9g7", "Black")], 18, undefined, "h2e2 后，留意 e2e7");
  assert.equal(result.sections[0].text, "己方未被将军，暂无直接吃子机会。");
  assert.match(result.sections[1].text, /新增攻击：黑车/);
  assert.match(result.sections[1].text, /原注（未核验）：炮二平五/);
  const text = result.sections.map(s => s.text).join("") + result.reference.join("");
  assert.doesNotMatch(text, /\b[a-i][0-9](?:[a-i][0-9])?\b|半回合|参考线第|走前子力/);
  assert(result.sections.every(s => s.text.length < 120));
});

test("a stale reference from a different FEN cannot be reused", async () => {
  let analyses = 0;
  const provider = createLocalCommentaryProvider({ facts: async (_, moves) => moves.map(m => fact(m)), analyze: async () => { analyses++; return undefined; } });
  await provider.explain({ ...request, reference: { fen: "different", line: { depth: 26, pv: [request.move] } } }, new AbortController().signal);
  assert.equal(analyses, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogReadingItems } from "../src/catalogContent.ts";

const hash = "ab".repeat(32);
test("merge duplicate imports across loaded pages, retaining first published identity and order", () => {
  const first = {id:"a",contentFingerprint:hash,title:"同名题"};
  const other = {id:"b",contentFingerprint:"cd".repeat(32),title:"同名题"};
  const rows = [first,other,{...first,id:"alias",contentFingerprint:hash.toUpperCase()}];
  assert.deepEqual(catalogReadingItems(rows),[first,other]);
  assert.equal(catalogReadingItems(rows)[0],first);
  assert.equal(rows.length,3,"do not mutate cached raw pages or training/assignment identities");
});
test("same name or starting position with different solutions/versions is retained", () => {
  const rows = [hash,"cd".repeat(32)].map((contentFingerprint,i)=>({id:String(i),contentFingerprint,title:"同名",startingFen:"same fen"}));
  assert.deepEqual(catalogReadingItems(rows),rows);
});
test("old servers, missing and malformed fingerprints fall back to identity", () => {
  const rows = [undefined,null,"", "bad", "bad", "a".repeat(63),"a".repeat(65)].map((contentFingerprint,i)=>({id:String(i),contentFingerprint}));
  assert.deepEqual(catalogReadingItems([...rows,rows[0]]),rows);
  assert.equal(catalogReadingItems([]).length,0);
});

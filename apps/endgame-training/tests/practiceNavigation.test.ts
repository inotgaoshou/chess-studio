import { strict as assert } from "node:assert";
import { test } from "node:test";
import { initialPracticeItem, practiceGroupIds } from "../src/practiceNavigation.ts";

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

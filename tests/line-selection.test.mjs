import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLineSelection } from "../src/utils/lineSelection.ts";

test("全文和起止行给出确切行数，空结果仅接受全文", () => {
  assert.deepEqual(parseLineSelection("all", "", "", 0), { selection: { mode: "all" }, count: 0 });
  assert.deepEqual(parseLineSelection("range", " 2 ", "4", 4), {
    selection: { mode: "range", start: 2, end: 4 }, count: 3,
  });
  assert.equal(parseLineSelection("range", "1", "1", 1).count, 1);
  for (const [a, b] of [["", "4"], ["-1", "4"], ["1e2", "4"], ["0", "1"], ["2", "1"], ["1", "5"], ["1.5", "4"]]) {
    assert.ok(parseLineSelection("range", a, b, 4).error);
  }
  assert.ok(parseLineSelection("range", "1", "1", 0).error);
  assert.ok(parseLineSelection("headTail", "1", "0", 0).error);
});

test("首尾取并集，允许单侧为零，超出时裁到实际行数", () => {
  assert.ok(parseLineSelection("headTail", "0", "0", 4).error);
  assert.ok(parseLineSelection("headTail", "9007199254740992", "1", 4).error);
  for (let n = 1; n <= 12; n++) {
    for (let head = 0; head <= n + 1; head++) {
      for (let tail = 0; tail <= n + 1; tail++) {
        if (!head && !tail) continue;
        const result = parseLineSelection("headTail", String(head), String(tail), n);
        const kept = Array.from({ length: n }, (_, i) => i + 1).filter(i => i <= head || i > n - tail);
        assert.deepEqual(result, {
          selection: { mode: "headTail", head: Math.min(n, head), tail: Math.min(n, tail) },
          count: kept.length,
        });
      }
    }
  }
});

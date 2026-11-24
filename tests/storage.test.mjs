import assert from "node:assert/strict";
import { test } from "node:test";
import readStorageSnapshot from "../src/utils/readStorageSnapshot.ts";

test("缓存快照保留文本、空键值和 JSON，并把特殊键作为普通条目读取", () => {
  const entries = new Map([
    ["theme", "light"], ["", ""], ["space", "  "], ["flag", "false"], ["count", "0"],
    ["nil", "null"], ["config", '{"names":["中文"]}'], ["__proto__", '{"marked":true}'],
    ["constructor", "普通文本"], ["toString", '"false"'],
  ]);
  const keys = [...entries.keys()];
  const snapshot = readStorageSnapshot({
    length: keys.length,
    key: (index) => keys[index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
  });
  assert.deepEqual(Object.entries(snapshot), [
    ["theme", "light"], ["", ""], ["space", "  "], ["flag", false], ["count", 0],
    ["nil", null], ["config", { names: ["中文"] }], ["__proto__", { marked: true }],
    ["constructor", "普通文本"], ["toString", "false"],
  ]);
  assert.equal(Object.getPrototypeOf(snapshot), null);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).__proto__, { marked: true });
});

test("枚举时已删除的键不会变成 JSON null", () => {
  const snapshot = readStorageSnapshot({ length: 2, key: (i) => i === 0 ? "removed" : null, getItem: () => null });
  assert.deepEqual(Object.keys(snapshot), []);
});

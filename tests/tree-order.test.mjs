import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import moveFileTreeItem from "../src/utils/moveFileTreeItem.ts";
import selectedFilePaths from "../src/utils/selectedFilePaths.ts";
import { createSourceWorkspace } from "../src/hooks/useSourceWorkspace.ts";

const file = (path) => Object.freeze({ path, name: path.split("/").at(-1), is_dir: false, children: Object.freeze([]) });
const dir = (path, children) => Object.freeze({ ...file(path), is_dir: true, children: Object.freeze(children) });
const tree = Object.freeze([
  dir("src", [file("src/one"), dir("src/sub", [file("src/sub/two")])]),
  file("first"),
  dir("other", [file("other/three")]),
  file("last"),
]);
const paths = (items, ignored = []) => selectedFilePaths(items, new Set(ignored));

test("同级文件和目录可以交错排序，其他节点沿用原引用", () => {
  const reordered = moveFileTreeItem(tree, "src", "first", "after");
  assert.deepEqual(paths(reordered), ["first", "src/one", "src/sub/two", "other/three", "last"]);
  assert.equal(reordered[1], tree[0]);
  assert.equal(reordered[2], tree[2]);
  const again = moveFileTreeItem(reordered, "last", "src", "before");
  assert.deepEqual(paths(again), ["first", "last", "src/one", "src/sub/two", "other/three"]);
  assert.deepEqual(paths(tree), ["src/one", "src/sub/two", "first", "other/three", "last"]);
});

test("跨层移动整个目录，节点仍指向原来的文件，排除按新树继承", () => {
  const moved = moveFileTreeItem(tree, "src/sub", "other", "inside");
  assert.equal(moved[2].children[1], tree[0].children[1]);
  assert.notEqual(moved[0], tree[0]);
  assert.notEqual(moved[2], tree[2]);
  assert.equal(moved[1], tree[1]);
  assert.deepEqual(paths(moved), ["src/one", "first", "other/three", "src/sub/two", "last"]);
  assert.deepEqual(paths(moved, ["other"]), ["src/one", "first", "last"]);
  assert.deepEqual(paths(moved, ["src", "src/sub/two"]), ["first", "other/three", "last"]);
  const backAtRoot = moveFileTreeItem(moved, "src/sub/two", "src", "before");
  assert.deepEqual(paths(backAtRoot), ["src/sub/two", "src/one", "first", "other/three", "last"]);
  assert.equal(moveFileTreeItem(moved, "other", "src/sub/two", "before"), moved);
});

test("重放当前位置、目标失效、自落、落入文件及落到后代时保持原数组", () => {
  for (const args of [
    ["src", "first", "before"], ["first", "src", "after"], ["src/sub", "src", "inside"],
    ["src", "src", "inside"], ["src", "src/sub/two", "after"], ["src", "src/sub", "inside"],
    ["first", "last", "inside"], ["missing", "src", "before"], ["first", "missing", "after"],
    ["last", "first", "unknown"],
  ]) assert.equal(moveFileTreeItem(tree, ...args), tree);
  const empty = dir("empty", []);
  const filled = moveFileTreeItem([empty, tree[1]], "first", "empty", "inside");
  assert.deepEqual(filled[0].children, [tree[1]]);
});

test("实际移动释放旧预览，迟到的输出只释放自身，整理按新树跳过排除项", async (t) => {
  globalThis.window = {};
  t.after(() => { clearMocks(); delete globalThis.window; });
  const pending = [];
  const released = [];
  mockIPC((cmd, args) => {
    if (cmd === "get_files") return { files: tree, skipped: [] };
    if (cmd === "release_trim_result") { released.push(args.id); return; }
    assert.equal(cmd, "trim_source_codes");
    const job = Promise.withResolvers();
    pending.push({ ...job, files: args.files });
    return job.promise;
  });
  const workspace = createSourceWorkspace();
  const result = (id) => ({ result: id, processed: 3, skipped: [], byteCount: 10, lineCount: 1, exportId: id });
  workspace.setOption("path", "root");
  await workspace.scanFiles();
  workspace.toggleIgnored("other");
  const initialTrim = workspace.trimFiles();
  pending[0].resolve(result("initial"));
  await initialTrim;
  const before = workspace.getSnapshot();
  assert.equal(workspace.moveFile("src", "first", "before"), false);
  assert.equal(workspace.getSnapshot(), before);
  assert.deepEqual(released, []);
  assert.equal(workspace.moveFile("src/sub", "other", "inside"), true);
  assert.deepEqual(released, ["initial"]);
  assert.equal(workspace.getSnapshot().trimReport, null);
  const obsolete = workspace.trimFiles();
  assert.deepEqual(pending[1].files, ["src/one", "first", "last"]);
  workspace.moveFile("last", "src", "before");
  const current = workspace.trimFiles();
  assert.deepEqual(pending[2].files, ["last", "src/one", "first"]);
  pending[2].resolve(result("current"));
  await current;
  pending[1].resolve(result("obsolete"));
  await obsolete;
  assert.equal(workspace.getSnapshot().content, "current");
  assert.deepEqual(released, ["initial", "obsolete"]);
});

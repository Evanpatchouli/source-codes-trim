import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSourceWorkspace } from "../src/hooks/useSourceWorkspace.ts";

const largeResult = (id) => ({
  result: "预览", processed: 1, skipped: [], byteCount: 500000, lineCount: 3000, truncated: true, exportId: id,
  fileRanges: [{ path: "A/source.ts", startLine: 1, endLine: 3000, byteCount: 500000 }],
});

async function setup(t) {
  globalThis.window = {};
  t.after(() => { clearMocks(); delete globalThis.window; });
  const io = { released: [], writes: [], dialogs: 0 };
  mockIPC(async (cmd, args) => {
    switch (cmd) {
      case "get_files": return { files: [{ path: "A/source.ts", name: "source.ts", is_dir: false, children: [] }], skipped: [] };
      case "trim_source_codes": return io.result;
      case "release_trim_result": io.released.push(args.id); return;
      case "plugin:dialog|save": io.dialogs++; return io.path;
      case "export_trim_result": io.writes.push(args); return io.write();
      default: throw new Error(cmd);
    }
  });
  const workspace = createSourceWorkspace();
  workspace.setOption("path", "A");
  await workspace.scanFiles();
  async function trim(id) {
    io.result = largeResult(id);
    await workspace.trimFiles();
  }
  return { workspace, io, trim };
}

test("替换、勾选、清除、重新扫描、换根和卸载各释放一次当前临时结果", async (t) => {
  const { workspace, io, trim } = await setup(t);
  await trim("first");
  await trim("second");
  workspace.toggleIgnored("A/source.ts");
  workspace.toggleIgnored("A/source.ts");
  await trim("third");
  workspace.clearOutput();
  workspace.clearOutput();
  await trim("fourth");
  await workspace.scanFiles();
  await trim("fifth");
  workspace.setOption("path", "B");
  await workspace.scanFiles();
  await trim("sixth");
  workspace.dispose();
  workspace.dispose();
  assert.deepEqual(io.released, ["first", "second", "third", "fourth", "fifth", "sixth"]);
});

test("迟到的整理结果释放自身句柄，当前预览保留后端的完整行数", async (t) => {
  const { workspace, io, trim } = await setup(t);
  const delayed = Promise.withResolvers();
  io.result = delayed.promise;
  const first = workspace.trimFiles();
  await trim("current");
  delayed.resolve(largeResult("obsolete"));
  await first;
  assert.deepEqual(io.released, ["obsolete"]);
  assert.equal(workspace.getSnapshot().trimReport.lineCount, 3000);
  assert.equal(workspace.getSnapshot().trimReport.exportId, "current");
});

test("取消保存保持当前结果，写入失败可以重试，重复点击只打开一个对话框", async (t) => {
  const { workspace, io, trim } = await setup(t);
  await trim("current");
  io.path = null;
  await Promise.all([workspace.exportResult(), workspace.exportResult()]);
  assert.equal(io.dialogs, 1);
  assert.deepEqual(io.writes, []);
  assert.equal(workspace.getSnapshot().exportFeedback, null);
  assert.equal(workspace.getSnapshot().exporting, false);
  io.path = "full.txt";
  io.write = () => { throw new Error("空间不足"); };
  await workspace.exportResult();
  assert.match(workspace.getSnapshot().exportFeedback.message, /空间不足/);
  io.write = () => {};
  await workspace.exportResult();
  assert.deepEqual(io.writes, Array(2).fill({ id: "current", path: "full.txt", selection: { mode: "all" } }));
  assert.equal(workspace.getSnapshot().exportFeedback.ok, true);
  assert.equal(workspace.getSnapshot().trimReport.exportId, "current");
});

test("短文本与零字节文件可导出，取消和失败保留当前句柄，替换后会释放", async (t) => {
  const { workspace, io } = await setup(t);
  for (const [result, id] of [["你好 🌱\n", "short"], ["", "empty"]]) {
    io.result = {
      result, processed: 1, skipped: [], byteCount: Buffer.byteLength(result),
      lineCount: result ? 1 : 0, truncated: false, exportId: id,
      fileRanges: [{ path: "A/source.ts", startLine: result ? 1 : null, endLine: result ? 1 : null, byteCount: Buffer.byteLength(result) }],
    };
    await workspace.trimFiles();
    assert.equal(workspace.getSnapshot().trimReport.truncated, false);
    assert.equal(workspace.getSnapshot().content, result);
    const before = io.writes.length;
    io.path = null;
    await workspace.exportResult();
    assert.equal(io.writes.length, before);
    io.path = id + ".txt";
    io.write = () => { throw new Error("无法写入"); };
    await workspace.exportResult();
    assert.match(workspace.getSnapshot().exportFeedback.message, /无法写入/);
    io.write = () => {};
    await workspace.exportResult();
    assert.deepEqual(io.writes.at(-1), { id, path: io.path, selection: { mode: "all" } });
    assert.equal(workspace.getSnapshot().exportFeedback.ok, true);
  }
  workspace.clearOutput();
  assert.deepEqual(io.released, ["short", "empty"]);
});

test("每种范围都绑定打开时的结果，取消、写入失败和重试保留所选行", async (t) => {
  const { workspace, io, trim } = await setup(t);
  await trim("current");
  for (const selection of [
    { mode: "all" }, { mode: "range", start: 3, end: 7 }, { mode: "headTail", head: 0, tail: 2 },
  ]) {
    const writes = io.writes.length;
    io.path = null;
    assert.equal(await workspace.exportResult(selection, "current"), undefined);
    assert.equal(io.writes.length, writes);
    io.path = selection.mode + ".txt";
    io.write = () => { throw new Error("不能覆盖"); };
    const failure = await workspace.exportResult(selection, "current");
    assert.equal(failure.ok, false);
    assert.match(failure.message, /不能覆盖/);
    io.write = () => {};
    assert.equal((await workspace.exportResult(selection, "current")).ok, true);
    assert.deepEqual(io.writes.slice(-2), Array(2).fill({ id: "current", path: io.path, selection }));
  }
  const dialogs = io.dialogs;
  await trim("new");
  await workspace.exportResult({ mode: "range", start: 1, end: 1 }, "current");
  assert.equal(io.dialogs, dialogs);
  const delayed = Promise.withResolvers();
  io.path = delayed.promise;
  const pending = workspace.exportResult({ mode: "headTail", head: 1, tail: 1 }, "new");
  const writes = io.writes.length;
  workspace.clearOutput();
  delayed.resolve("过期.txt");
  assert.equal(await pending, undefined);
  assert.equal(io.writes.length, writes);
});

test("过期对话框不会开始写入，已经开始的写入结束后释放且不回填旧反馈", async (t) => {
  const { workspace, io, trim } = await setup(t);
  await trim("one");
  const dialog = Promise.withResolvers();
  io.path = dialog.promise;
  const delayedDialog = workspace.exportResult();
  await trim("two");
  dialog.resolve("obsolete.txt");
  await delayedDialog;
  assert.deepEqual(io.writes, []);
  const writing = Promise.withResolvers();
  const started = Promise.withResolvers();
  io.path = "two.txt";
  io.write = () => { started.resolve(); return writing.promise; };
  const exportTwo = workspace.exportResult();
  await started.promise;
  await trim("three");
  assert.deepEqual(io.released, ["one"]);
  writing.reject("旧写入失败");
  await exportTwo;
  assert.deepEqual(io.released, ["one", "two"]);
  assert.equal(workspace.getSnapshot().exportFeedback, null);
  assert.equal(workspace.getSnapshot().trimReport.exportId, "three");
});

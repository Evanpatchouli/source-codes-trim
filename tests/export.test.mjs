import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSourceWorkspace } from "../src/hooks/useSourceWorkspace.ts";

const largeResult = (id) => ({ result: "预览", processed: 1, skipped: [], byteCount: 500000, lineCount: 3000, exportId: id });

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
  assert.deepEqual(io.writes, Array(2).fill({ id: "current", path: "full.txt" }));
  assert.equal(workspace.getSnapshot().exportFeedback.ok, true);
  assert.equal(workspace.getSnapshot().trimReport.exportId, "current");
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

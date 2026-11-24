import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSourceWorkspace } from "../src/hooks/useSourceWorkspace.ts";

function setup(t) {
  globalThis.window = {};
  t.after(() => { clearMocks(); delete globalThis.window; });
  const pending = [];
  mockIPC((cmd, args) => {
    if (cmd === "release_trim_result") return;
    return new Promise((resolve, reject) => { pending.push({ cmd, args, resolve, reject }); });
  });
  const workspace = createSourceWorkspace();
  workspace.setOption("path", "A");
  return { workspace, pending };
}

const scanResult = (path) => ({
  files: [{ path, name: path.split("/").at(-1), is_dir: false, children: [] }],
  skipped: [],
});
const trimResult = (result) => ({
  result, processed: 1, skipped: [], byteCount: Buffer.byteLength(result), lineCount: result ? 1 : 0,
  truncated: false, exportId: "result-" + result,
  fileRanges: [{ path: "A/main.ts", startLine: result ? 1 : null, endLine: result ? 1 : null, byteCount: Buffer.byteLength(result) }],
});

test("将原先排除的目录设为新根后可整理其中的文件", async (t) => {
  const { workspace, pending } = setup(t);
  const child = scanResult("A/lib/main.ts").files[0];
  const scan = workspace.scanFiles();
  pending[0].resolve({ files: [{ path: "A/lib", name: "lib", is_dir: true, children: [child] }], skipped: [] });
  await scan;
  workspace.toggleIgnored("A/lib");
  workspace.setOption("path", "A/lib");
  const rescan = workspace.scanFiles();
  pending[1].resolve({ files: [child], skipped: [] });
  await rescan;
  const trim = workspace.trimFiles();
  assert.deepEqual(pending[2].args.files, ["A/lib/main.ts"]);
  pending[2].resolve(trimResult("ok"));
  await trim;
});

test("目录 A→B→A、扫描逆序和过期错误均不影响当前扫描", async (t) => {
  const { workspace, pending } = setup(t);
  const firstA = workspace.scanFiles();
  workspace.setOption("path", "B");
  const scanB = workspace.scanFiles();
  workspace.setOption("path", "A");
  const lastA = workspace.scanFiles();
  assert.deepEqual(pending.map(({ args }) => args.path), ["A", "B", "A"]);
  pending[1].reject("旧扫描失败");
  await scanB;
  assert.equal(workspace.getSnapshot().treeLoading, true);
  assert.equal(workspace.getSnapshot().scanError, "");
  pending[2].resolve(scanResult("A/new.ts"));
  await lastA;
  pending[0].resolve(scanResult("A/old.ts"));
  await firstA;
  assert.deepEqual(workspace.getSnapshot().files, scanResult("A/new.ts").files);
});

test("勾选、清空和编辑筛选条件会使已有整理失效", async (t) => {
  const { workspace, pending } = setup(t);
  const scan = workspace.scanFiles();
  pending[0].resolve(scanResult("A/main.ts"));
  await scan;
  const first = workspace.trimFiles();
  assert.deepEqual(pending[1].args.files, ["A/main.ts"]);
  workspace.toggleIgnored("A/main.ts");
  pending[1].resolve(trimResult("过期结果"));
  await first;
  assert.equal(workspace.getSnapshot().content, "");
  assert.equal(workspace.getSnapshot().trimReport, null);
  const second = workspace.trimFiles();
  assert.deepEqual(pending[2].args.files, []);
  workspace.clearOutput();
  pending[2].reject("过期错误");
  await second;
  assert.equal(workspace.getSnapshot().contentState, "loaded");
  workspace.setOption("includes", "*.rs");
  assert.deepEqual(workspace.getSnapshot().files, []);
  assert.equal(workspace.getSnapshot().ignoredPaths.size, 0);
  await workspace.trimFiles();
  assert.equal(pending.length, 3);
  const filtered = workspace.scanFiles();
  assert.equal(pending[3].args.includes, "*.rs");
  workspace.setOption("excludeEmptyDirs", false);
  pending[3].resolve(scanResult("A/wrong.rs"));
  await filtered;
  assert.deepEqual(workspace.getSnapshot().files, []);
});

test("整理失败可重试，后到的历史整理不能覆盖成功结果，卸载后忽略回调", async (t) => {
  const { workspace, pending } = setup(t);
  const scan = workspace.scanFiles();
  pending[0].resolve(scanResult("A/main.ts"));
  await scan;
  const first = workspace.trimFiles();
  const failed = workspace.trimFiles();
  pending[2].reject("读取失败");
  await failed;
  assert.match(workspace.getSnapshot().content, /读取失败/);
  const retry = workspace.trimFiles();
  pending[3].resolve(trimResult("当前结果"));
  await retry;
  pending[1].resolve(trimResult("旧结果"));
  await first;
  assert.equal(workspace.getSnapshot().content, "当前结果");
  assert.equal(workspace.getSnapshot().contentState, "loaded");
  const final = workspace.trimFiles();
  workspace.dispose();
  const beforeUnmount = workspace.getSnapshot();
  pending[4].reject("卸载后的错误");
  await final;
  assert.equal(workspace.getSnapshot(), beforeUnmount);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import invoke from "../src/utils/invoke.ts";

const trimArgs = { files: [], trimComments: true, trimWhitespace: true, trimNewlines: true };

afterEach(() => {
  clearMocks();
  delete globalThis.window;
});

test("整理命令透传成功结果和逐文件错误", async () => {
  globalThis.window = {};
  const response = { result: "ok\n", byteCount: 3, lineCount: 1, truncated: false, exportId: "short",
    fileRanges: [{ path: "main.ts", startLine: 1, endLine: 1, byteCount: 3 }],
    processed: 1, skipped: [{ path: "missing.ts", reason: "找不到文件" }] };
  mockIPC(async (command, args) => {
    assert.equal(command, "trim_source_codes");
    assert.deepEqual(args, trimArgs);
    return response;
  });
  assert.deepEqual(await invoke("trim_source_codes", trimArgs), response);
});

test("整理命令保留 IPC 拒绝，调用方可以重试", async () => {
  globalThis.window = {};
  mockIPC(async () => { throw "读取失败"; });
  await assert.rejects(invoke("trim_source_codes", trimArgs), (error) => error === "读取失败");

  const response = { result: "", processed: 0, skipped: [], byteCount: 0, lineCount: 0, truncated: false, exportId: "empty", fileRanges: [] };
  mockIPC(async () => response);
  assert.deepEqual(await invoke("trim_source_codes", trimArgs), response);
});

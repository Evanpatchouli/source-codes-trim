import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createFilePager, describeFileRange } from "../src/utils/filePreview.ts";

test("区分单行、多行与零行文件", () => {
  assert.equal(describeFileRange({ startLine: 2, endLine: 2 }), "第 2 行");
  assert.equal(describeFileRange({ startLine: 3, endLine: 900 }), "第 3–900 行");
  assert.equal(describeFileRange({ startLine: null, endLine: null }), "0 行");
});

function setup(t) {
  globalThis.window = {};
  t.after(() => { clearMocks(); delete globalThis.window; });
  const requests = [];
  const pages = [];
  mockIPC((cmd, args) => {
    assert.equal(cmd, "read_trim_file");
    assert.equal(args.id, "snapshot");
    assert.equal(args.index, 5);
    const request = Promise.withResolvers();
    requests.push({ ...request, offset: args.offset });
    return request.promise;
  });
  const reader = createFilePager("snapshot", 5, (page) => pages.push(page));
  return { reader, requests, pages };
}

test("按后端的 UTF-8 字节偏移前进和后退，失败可重试同一页", async (t) => {
  const { reader, requests, pages } = setup(t);
  const first = reader.read();
  requests[0].resolve({ text: "🌱", nextOffset: 4 });
  await first;
  assert.equal(pages.at(-1).text, "🌱");
  const second = reader.next();
  assert.equal(requests[1].offset, 4);
  requests[1].reject("读取暂时失败");
  await second;
  assert.deepEqual(pages.at(-1), { status: "error", number: 2, message: "读取暂时失败" });
  const retry = reader.read();
  assert.equal(requests[2].offset, 4);
  requests[2].resolve({ text: "尾页", nextOffset: null });
  await retry;
  assert.deepEqual(pages.at(-1), { status: "loaded", number: 2, text: "尾页", hasNext: false });
  await reader.next();
  assert.equal(requests.length, 3);
  const back = reader.previous();
  assert.equal(requests[3].offset, 0);
  requests[3].resolve({ text: "🌱", nextOffset: 4 });
  await back;
  assert.equal(pages.at(-1).number, 1);
});

test("后退或关闭文件预览后，迟到的读取无法覆盖当前页面", async (t) => {
  const { reader, requests, pages } = setup(t);
  const first = reader.read();
  requests[0].resolve({ text: "开始", nextOffset: 6 });
  await first;
  const delayed = reader.next();
  const back = reader.previous();
  requests[2].resolve({ text: "开始", nextOffset: 6 });
  await back;
  const current = pages.at(-1);
  requests[1].resolve({ text: "旧页", nextOffset: null });
  await delayed;
  assert.equal(pages.at(-1), current);
  const closing = reader.next();
  const length = pages.length;
  reader.dispose();
  requests[3].reject("结果已释放");
  await closing;
  assert.equal(pages.length, length);
});

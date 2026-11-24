import assert from "node:assert/strict";
import { test } from "node:test";
import { readAvailableRelease } from "../src/utils/latestRelease.ts";

const repository = "https://github.com/Evanpatchouli/source-codes-trim";
const publishedAt = "2026-03-01T12:34:56Z";

function release(tag = "v1.3.0") {
  return {
    tag_name: tag,
    published_at: publishedAt,
    html_url: `${repository}/releases/tag/${tag}`,
    url: "https://api.github.com/repos/Evanpatchouli/source-codes-trim/releases/42",
  };
}

test("403 和 404 均作为检查失败处理", async () => {
  for (const status of [403, 404]) {
    const response = Response.json({ message: "GitHub API error" }, { status });
    await assert.rejects(readAvailableRelease(response, "1.2.0"), new RegExp(String(status)));
  }
});

test("无效 JSON、缺失字段和无效版本或日期均不能成为可用更新", async () => {
  const payload = release();
  for (const response of [
    new Response("<!doctype html>"),
    Response.json(null),
    Response.json({}),
    Response.json({ ...payload, tag_name: "unknown" }),
    Response.json({ ...payload, published_at: "not a date" }),
    Response.json({ ...payload, html_url: null }),
  ]) {
    await assert.rejects(readAvailableRelease(response, "1.2.0"));
  }
});

test("下载链接必须指向当前仓库的 HTTPS 发布页", async () => {
  const payload = release();
  for (const address of [
    payload.url,
    "https://github.com/example/source-codes-trim/releases/tag/v1.3.0",
    `${repository}/issues/42`,
    payload.html_url.replace("https:", "http:"),
  ]) {
    await assert.rejects(readAvailableRelease(Response.json({ ...payload, html_url: address }), "1.2.0"));
  }
});

test("相同版本和较旧版本均返回空结果", async () => {
  for (const tag of ["v1.2.0", "v1.1.9"]) {
    assert.equal(await readAvailableRelease(Response.json(release(tag)), "1.2.0"), null);
  }
});

test("新版保留原始标签和发布时间，下载目标是网页地址", async () => {
  const payload = release("v1.3.0");
  assert.deepEqual(await readAvailableRelease(Response.json(payload), "1.2.0"), {
    version: payload.tag_name,
    publishedAt,
    htmlUrl: payload.html_url,
  });
});

test("预发布序号按数值排序，正式版优先于预发布版，构建元数据不参与比较", async () => {
  const releaseCandidate = release("v1.3.0-rc.10");
  assert.equal(
    (await readAvailableRelease(Response.json(releaseCandidate), "1.3.0-rc.2"))?.version,
    releaseCandidate.tag_name,
  );
  assert.equal(await readAvailableRelease(Response.json(releaseCandidate), "1.3.0"), null);
  assert.equal(await readAvailableRelease(Response.json(release("v1.3.0+build.9")), "1.3.0+build.2"), null);
});

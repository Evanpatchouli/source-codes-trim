import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChakraProvider } from "@chakra-ui/react";
import { createServer } from "vite";

test("跳过面板仅在有记录时显示按钮，折叠时不读取明细", async (t) => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    esbuild: { jsx: "automatic" },
  });
  t.after(() => server.close());
  const { default: FileIssues } = await server.ssrLoadModule("/src/components/FileIssues.tsx");
  const render = (...panels) => renderToStaticMarkup(createElement(ChakraProvider, null, ...panels));
  const issue = { get path() { assert.fail("折叠时读取了文件路径"); }, reason: "读取失败" };
  const panel = (label, issues) => createElement(FileIssues, { label, issues, key: label });

  assert.doesNotMatch(render(panel("扫描", [])), /<button\b|<ul\b|扫描跳过/);
  const html = render(panel("扫描", Array(1000).fill(issue)), panel("整理", [issue]));
  assert.match(html, /扫描跳过 1000 项/);
  assert.match(html, /整理跳过 1 项/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<ul\b/);
});

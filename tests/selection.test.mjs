import assert from "node:assert/strict";
import { test } from "node:test";
import selectedFilePaths from "../src/utils/selectedFilePaths.ts";

const file = (path) => ({ path, name: path.split("/").at(-1), is_dir: false, children: [] });
const dir = (path, children) => ({ ...file(path), is_dir: true, children });

test("排除只命中完整路径，子目录继承排除，其余文件保留扫描顺序", () => {
  const items = [
    dir("root/lib", [dir("root/lib/sub", [file("root/lib/sub/hidden")])]),
    dir("root/library", [file("root/library/first"), file("root/library/second")]),
    file("root/a.ts"),
    file("root/a.tsx"),
  ];
  assert.deepEqual(selectedFilePaths(items, new Set(["root/lib", "root/a.ts"])),
    ["root/library/first", "root/library/second", "root/a.tsx"]);
});

test("一万文件的树仅进入未排除的目录", () => {
  const roots = [];
  const ignored = new Set();
  const entered = [];
  for (let i = 0; i < 100; i++) {
    const path = "root/dir" + i;
    const children = Array.from({ length: 100 }, (_, f) => file(path + "/f" + f));
    const node = dir(path, children);
    Object.defineProperty(node, "children", { get() { entered.push(path); return children; } });
    roots.push(node);
    if (i < 5) ignored.add(path);
  }
  const selected = selectedFilePaths(roots, ignored);
  assert.deepEqual(entered, roots.slice(5).map((item) => item.path));
  assert.equal(selected.length, 9500);
  assert.equal(selected[0], "root/dir5/f0");
  assert.equal(selected.at(-1), "root/dir99/f99");
});

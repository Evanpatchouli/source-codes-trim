import assert from "node:assert/strict";
import { test } from "node:test";
import { applySourcePlan, createSourcePlan, parseSourcePlan } from "../src/utils/sourcePlan.ts";

const filters = { includes: "*.ts", excludes: "build/", excludeEmptyDirs: true };
const file = (path) => ({ path, name: path.split("/").at(-1), is_dir: false, children: [] });
const dir = (path, children) => ({ ...file(path), is_dir: true, children });
const roundTrip = (plan) => parseSourcePlan(JSON.stringify(plan));
const names = (nodes) => nodes.map((n) => n.name);

test("50 个文件迁移后保留拖动顺序和明确排除，列出新增 2 项、缺失 1 项", () => {
  const old = "C:\\work\\old";
  const paths = Array.from({ length: 50 }, (_, i) => "f" + String(i).padStart(2, "0") + ".ts");
  const oldFiles = paths.map((name, i) => ({ ...file(name), path: old + "\\" + (i < 40 ? "src" : "lib") + "\\" + name }));
  const oldLib = dir(old + "\\lib", [oldFiles[39], ...oldFiles.slice(40)]);
  const oldSrc = dir(old + "\\src", oldFiles.slice(0, 39).reverse());
  const oldTree = [oldLib, oldSrc];
  const plan = createSourcePlan(old, oldTree, new Set([oldLib.path, oldFiles[1].path]), { ...filters, path: old });
  assert.deepEqual(plan.filters, filters);
  assert.ok(!JSON.stringify(plan).includes("work"));

  const root = "/new/project";
  const newLib = dir(root + "/lib", paths.slice(40).map((name) => file(root + "/lib/" + name)));
  const newSrc = dir(root + "/src", [
    file(root + "/src/new.ts"), ...paths.slice(0, 40).filter((_, i) => i !== 25).map((name) => file(root + "/src/" + name)),
  ]);
  const scanned = [newSrc, newLib, file(root + "/new-root.ts")];
  const result = applySourcePlan(root, scanned, roundTrip(plan));
  assert.deepEqual(names(result.files), ["lib", "src", "new-root.ts"]);
  assert.deepEqual(names(result.files[0].children), [paths[39], ...paths.slice(40)]);
  assert.equal(result.files[0].children[0].path, root + "/src/" + paths[39]);
  assert.deepEqual(names(result.files[1].children), [...paths.slice(0, 39).filter((_, i) => i !== 25).reverse(), "new.ts"]);
  assert.deepEqual(result.added, ["src/new.ts", "new-root.ts"]);
  assert.deepEqual(result.missing, ["src/f25.ts"]);
  assert.deepEqual(result.ignoredPaths, new Set([root + "/lib", root + "/src/f01.ts"]));
  assert.equal(scanned[0].children[0].name, "new.ts");
  assert.equal(scanned[0].children.length, 40);
});

test("新增文件随已移动的实体父目录，消失的虚拟目录保留存活子项的位置", () => {
  const tree = [
    file("/old/first"), dir("/old/gone", [file("/old/live/keep")]), file("/old/last"),
    dir("/old/container", [dir("/old/live", [])]),
  ];
  const original = createSourcePlan("/old", tree, new Set(["/old/gone"]), filters);
  const scanned = [
    dir("/new/live", [file("/new/live/keep"), dir("/new/live/sub", [file("/new/live/sub/new")])]),
    dir("/new/container", []), file("/new/first"), file("/new/last"),
  ];
  const result = applySourcePlan("/new", scanned, original);
  assert.deepEqual(names(result.files), ["first", "keep", "last", "container"]);
  assert.equal(result.files[1].path, "/new/live/keep");
  assert.deepEqual(names(result.files[3].children[0].children), ["sub"]);
  assert.deepEqual(result.added, ["live/sub/new"]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.ignoredPaths.size, 0);
});

test("文件目录互换类型时旧勾选不套到新对象，仍可提升存活子项", () => {
  const plan = createSourcePlan("root", [
    dir("root/will-file", [file("root/keep")]), file("root/will-dir"),
  ], new Set(["root/will-file", "root/will-dir"]), filters);
  const applied = applySourcePlan("root", [
    dir("root/will-dir", [file("root/will-dir/new")]), file("root/will-file"), file("root/keep"),
  ], plan);
  assert.deepEqual(names(applied.files), ["keep", "will-dir", "will-file"]);
  assert.deepEqual(applied.missing, ["will-dir"]);
  assert.deepEqual(applied.added, ["will-dir/new", "will-file"]);
  assert.equal(applied.ignoredPaths.size, 0);
});

test("POSIX 反斜线及百分号是文件名的一部分，UNC 路径可迁移", () => {
  const old = [
    file("/project/a\\b"), file("/project/%5C"), file("/project/C:notes"),
    dir("/project/a", [file("/project/a/b")]),
  ];
  const plan = roundTrip(createSourcePlan("/project/", old, new Set(["/project/a\\b"]), filters));
  const migrated = applySourcePlan("/new/", [
    dir("/new/a", [file("/new/a/b")]), file("/new/a\\b"), file("/new/new\\file"),
  ], plan);
  assert.equal(migrated.files[0].path, "/new/a\\b");
  assert.equal(migrated.files[1].children[0].path, "/new/a/b");
  assert.deepEqual(migrated.ignoredPaths, new Set(["/new/a\\b"]));
  assert.deepEqual(migrated.added, ["new\\file"]);
  assert.deepEqual(migrated.missing, ["%5C", "C:notes"]);
  const uncPlan = createSourcePlan("\\\\server\\share\\", [file("\\\\server\\share\\ok")], new Set(), filters);
  const unc = applySourcePlan("E:/new/", [file("E:\\new\\ok")], uncPlan);
  assert.deepEqual(unc.added, []);
  assert.deepEqual(unc.missing, []);
  assert.equal(unc.files[0].path, "E:\\new\\ok");
});

test("无效方案报告错误，无法利用绝对路径、父级跳转、重复项或循环创建节点", () => {
  const good = createSourcePlan("/old", [dir("/old/a", [file("/old/a/x")])], new Set(), filters);
  assert.throws(() => parseSourcePlan("not JSON"), /JSON/);
  for (const modify of [
    (p) => { p.version = 2; },
    (p) => { p.filters.includes = null; },
    (p) => { p.entries.push({ ...p.entries[0] }); },
    (p) => { p.entries[0].parent = "missing"; },
    (p) => { p.entries[0].parent = "a"; },
    (p) => { p.entries[0].parent = "a/x"; },
    (p) => { p.entries[0].ignored = "false"; },
    ...["", "../a", "a/../x", "/absolute", "C:\\absolute", "\\\\server\\share", "a//x", "%2Fetc", "a\0b"]
      .map((bad) => (p) => { p.entries[0].path = bad; }),
  ]) {
    const malformed = structuredClone(good);
    modify(malformed);
    assert.throws(() => parseSourcePlan(JSON.stringify(malformed)));
    assert.throws(() => applySourcePlan("/new", [], malformed));
  }
  assert.throws(() => createSourcePlan("/one", [file("/one-more/file")], new Set(), filters), /根目录/);
  const withUnknown = { ...good, filters: { ...filters, path: "/outside" }, root: "/outside" };
  assert.deepEqual(roundTrip(withUnknown), good);
  const empty = applySourcePlan("/new", [], good);
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.missing, ["a/x"]);
});

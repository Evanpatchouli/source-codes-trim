import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSourceWorkspace } from "../src/hooks/useSourceWorkspace.ts";

const firstRoot = "/projects/first";
const secondRoot = "/projects/second";
const planPath = "/plans/review.sctplan";
const file = (path) => ({ path, name: path.split("/").at(-1), is_dir: false, children: [] });

function tree(root, sibling) {
  return [
    { ...file(root + "/src"), is_dir: true, children: [file(root + "/src/a.ts"), file(root + "/src/" + sibling)] },
    file(root + "/main.ts"),
  ];
}

function setup(t) {
  globalThis.window = {};
  t.after(() => { clearMocks(); delete globalThis.window; });
  const io = {
    dialog: () => planPath,
    scan: ({ path }) => ({ files: tree(path, "old.ts"), skipped: [] }),
    saved: null,
    calls: [],
  };
  mockIPC(async (cmd, args) => {
    io.calls.push({ cmd, args });
    switch (cmd) {
      case "plugin:dialog|save":
      case "plugin:dialog|open": return io.dialog();
      case "read_source_plan": return io.saved;
      case "write_source_plan": io.saved = args.content; return;
      case "get_files": return io.scan(args);
      case "trim_source_codes": return { result: "ok", processed: 1, skipped: [], lineCount: 1, byteCount: 2, truncated: false, exportId: "short" };
      case "release_trim_result": return;
      default: throw new Error(cmd);
    }
  });
  const workspace = createSourceWorkspace();
  workspace.setOption("path", firstRoot);
  return { workspace, io };
}

test("保存后在另一根目录载入筛选、跨目录排序与排除，报告增删文件", async (t) => {
  const { workspace, io } = setup(t);
  workspace.setOption("includes", "*.ts");
  workspace.setOption("excludes", "dist/");
  workspace.setOption("excludeEmptyDirs", false);
  await workspace.scanFiles();
  workspace.moveFile(firstRoot + "/main.ts", firstRoot + "/src/a.ts", "before");
  workspace.toggleIgnored(firstRoot + "/src/a.ts");
  await workspace.savePlan();
  assert.ok(workspace.getSnapshot().planFeedback.ok);
  assert.ok(!io.saved.includes(firstRoot));
  workspace.setOption("path", secondRoot);
  workspace.setOption("includes", "*.rs");
  io.scan = ({ path }) => ({ files: tree(path, "new.ts"), skipped: [] });
  await workspace.openPlan();
  const state = workspace.getSnapshot();
  assert.deepEqual(state.options, { path: secondRoot, includes: "*.ts", excludes: "dist/", excludeEmptyDirs: false });
  assert.deepEqual(state.files[0].children.map((item) => item.path), [
    secondRoot + "/main.ts", secondRoot + "/src/a.ts", secondRoot + "/src/new.ts",
  ]);
  assert.deepEqual([...state.ignoredPaths], [secondRoot + "/src/a.ts"]);
  assert.deepEqual(state.planChanges, { added: ["src/new.ts"], missing: ["src/old.ts"] });
  assert.deepEqual(io.calls.find(({ cmd }) => cmd === "plugin:dialog|open").args.options.defaultPath, secondRoot);
});

test("同根重扫保留拖放和排除，切换根目录不沿用上个目录的布局", async (t) => {
  const { workspace, io } = setup(t);
  await workspace.scanFiles();
  workspace.moveFile(firstRoot + "/main.ts", firstRoot + "/src", "before");
  workspace.toggleIgnored(firstRoot + "/src/a.ts");
  io.scan = ({ path }) => ({ files: tree(path, "new.ts"), skipped: [] });
  await workspace.scanFiles();
  assert.equal(workspace.getSnapshot().files[0].name, "main.ts");
  assert.ok(workspace.getSnapshot().ignoredPaths.has(firstRoot + "/src/a.ts"));
  assert.deepEqual(workspace.getSnapshot().planChanges, { added: ["src/new.ts"], missing: ["src/old.ts"] });
  workspace.setOption("path", secondRoot);
  await workspace.scanFiles();
  assert.equal(workspace.getSnapshot().files[0].name, "src");
  assert.equal(workspace.getSnapshot().ignoredPaths.size, 0);
  assert.equal(workspace.getSnapshot().planChanges, null);
});

test("取消、损坏文件或方案扫描失败保留现有树、筛选和有效预览", async (t) => {
  const { workspace, io } = setup(t);
  await workspace.scanFiles();
  await workspace.trimFiles();
  await workspace.savePlan();
  const valid = io.saved;
  const original = workspace.getSnapshot();
  io.dialog = () => null;
  await workspace.openPlan();
  assert.equal(workspace.getSnapshot().planFeedback, original.planFeedback);
  io.dialog = () => planPath;
  io.saved = "{";
  await workspace.openPlan();
  assert.equal(workspace.getSnapshot().planFeedback.ok, false);
  assert.equal(io.calls.filter(({ cmd }) => cmd === "get_files").length, 1);
  io.saved = valid;
  io.scan = () => { throw new Error("无法读取目录"); };
  await workspace.openPlan();
  assert.match(workspace.getSnapshot().planFeedback.message, /无法读取目录/);
  await workspace.scanFiles();
  const state = workspace.getSnapshot();
  assert.match(state.scanError, /无法读取目录/);
  assert.equal(state.files, original.files);
  assert.equal(state.options, original.options);
  assert.equal(state.trimReport, original.trimReport);
  assert.equal(state.content, "ok");
  assert.equal(state.treeLoading, false);
});

test("旧保存对话框和旧方案扫描在输入或选择变更后无副作用", async (t) => {
  const { workspace, io } = setup(t);
  await workspace.scanFiles();
  const dialog = Promise.withResolvers();
  io.dialog = () => dialog.promise;
  const staleSave = workspace.savePlan();
  workspace.setOption("includes", "*.ts");
  dialog.resolve(planPath);
  await staleSave;
  assert.equal(io.saved, null);
  await workspace.scanFiles();
  io.dialog = () => planPath;
  await workspace.savePlan();
  const scan = Promise.withResolvers();
  const started = Promise.withResolvers();
  io.scan = () => { started.resolve(); return scan.promise; };
  const staleOpen = workspace.openPlan();
  await started.promise;
  const files = workspace.getSnapshot().files;
  workspace.toggleIgnored(firstRoot + "/main.ts");
  scan.resolve({ files: [], skipped: [] });
  await staleOpen;
  assert.equal(workspace.getSnapshot().files, files);
  assert.deepEqual([...workspace.getSnapshot().ignoredPaths], [firstRoot + "/main.ts"]);
  assert.equal(workspace.getSnapshot().planFeedback, null);
  assert.equal(workspace.getSnapshot().planBusy, null);
});

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const yauzl = require("yauzl");
const { collectRelease } = require("../scripts/collect-release.cjs");

const script = require.resolve("../scripts/collect-release.cjs");
const base = "example-tool_1.2.3_x64";
const inputs = {
  "example-tool.exe": Buffer.from([0, 255, 80, 69, 13, 10]),
  "README.md": Buffer.from("安装说明\n", "utf8"),
  LICENSE: Buffer.from("License text\n"),
  [`bundle/msi/${base}_en-US.msi`]: Buffer.from("current MSI"),
  [`bundle/nsis/${base}-setup.exe`]: Buffer.from("current NSIS"),
};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "collect-release-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(root, "src-tauri", "target", "release");
  for (const [relative, content] of Object.entries(inputs)) {
    const file = path.join(source, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "example-tool", version: "1.2.3" }));
  const release = path.join(root, "release");
  await fs.mkdir(release);
  await fs.writeFile(path.join(release, "previous.zip"), "previous release");
  return { root, source, release };
}

async function assertPrevious(directory) {
  assert.deepEqual(await fs.readdir(directory), ["previous.zip"]);
  assert.equal(await fs.readFile(path.join(directory, "previous.zip"), "utf8"), "previous release");
}

async function zipContents(file) {
  const entries = {};
  const zip = await yauzl.openPromise(file);
  for await (const entry of zip.eachEntry()) {
    const chunks = [];
    for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
    entries[entry.fileName] = Buffer.concat(chunks);
  }
  return entries;
}

test("CLI builds exactly the three verified ZIPs using its own project root", async (t) => {
  const { root, source, release } = await fixture(t);
  const scripts = path.join(root, "scripts");
  await fs.mkdir(scripts);
  const isolatedScript = path.join(scripts, "collect-release.cjs");
  await fs.copyFile(script, isolatedScript);
  const run = () => spawnSync(process.execPath, [isolatedScript], {
    cwd: source,
    env: { ...process.env, NODE_PATH: path.resolve(__dirname, "../node_modules") },
    encoding: "utf8",
  });
  const currentMsi = `${base}_en-US.msi`;
  const currentNsis = `${base}-setup.exe`;
  const oldMsi = path.join(source, "bundle/msi/example-tool_1.2.2_x64_en-US.msi");
  const msi = path.join(source, "bundle/msi", currentMsi);
  await fs.rename(msi, oldMsi);
  const failed = run();
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /1\.2\.3_x64_en-US\.msi/);
  await assertPrevious(release);
  await fs.copyFile(oldMsi, msi);

  const success = run();
  assert.equal(success.status, 0, success.stderr);
  const expected = {
    [`${base}_windows_10_portable.zip`]: {
      "example-tool.exe": inputs["example-tool.exe"], "README.md": inputs["README.md"], LICENSE: inputs.LICENSE,
    },
    [`${base}_windows_10_msi.zip`]: { [currentMsi]: inputs[`bundle/msi/${currentMsi}`] },
    [`${base}_windows_10_nsis.zip`]: { [currentNsis]: inputs[`bundle/nsis/${currentNsis}`] },
  };
  assert.deepEqual((await fs.readdir(release)).sort(), Object.keys(expected).sort());
  for (const [name, entries] of Object.entries(expected)) {
    assert.deepEqual(await zipContents(path.join(release, name)), entries);
  }
});

test("every required input is checked before the previous release is touched", async (t) => {
  const { root, source, release } = await fixture(t);
  for (const [relative, contents] of Object.entries(inputs)) {
    const file = path.join(source, relative);
    await fs.unlink(file);
    await assert.rejects(collectRelease(root), { code: "ENOENT" });
    await assertPrevious(release);
    await fs.writeFile(file, contents);
  }
});

test("a changed source fails content verification before publication", async (t) => {
  const { root, source, release } = await fixture(t);
  const mkdir = fs.mkdir;
  t.mock.method(fs, "mkdir", async (...args) => {
    const result = await mkdir(...args);
    if (args[0] === path.join(root, ".collect-release", "next")) {
      await fs.writeFile(path.join(source, "example-tool.exe"), "changed");
    }
    return result;
  });
  await assert.rejects(collectRelease(root), /条目内容校验失败/);
  await assertPrevious(release);
});

test("losing a source or failing to open a ZIP output leaves the old release intact", async (t) => {
  const { root, source, release } = await fixture(t);
  const next = path.join(root, ".collect-release", "next");
  const mkdir = fs.mkdir;
  for (const fail of [
    () => fs.unlink(path.join(source, "LICENSE")),
    () => fs.writeFile(path.join(next, `${base}_windows_10_msi.zip`), "occupied"),
  ]) {
    const mock = t.mock.method(fs, "mkdir", async (...args) => {
      const result = await mkdir(...args);
      if (args[0] === next) await fail();
      return result;
    });
    try {
      await assert.rejects(collectRelease(root), /ENOENT|EEXIST/);
      await assertPrevious(release);
    } finally {
      mock.mock.restore();
      await fs.writeFile(path.join(source, "LICENSE"), inputs.LICENSE);
    }
  }
});

test("failed directory exchange restores the old release", async (t) => {
  const { root, release } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (from, to) => {
    if (path.basename(from) === "next") throw new Error("cannot publish");
    return rename(from, to);
  });
  await assert.rejects(collectRelease(root), /cannot publish/);
  await assertPrevious(release);
  await assert.rejects(fs.stat(path.join(root, ".collect-release")), { code: "ENOENT" });
});

test("an existing file or linked directory at the release path is preserved", async (t) => {
  const { root, release } = await fixture(t);
  const unrelated = path.join(root, "unrelated");
  await fs.rename(release, unrelated);
  await fs.writeFile(release, "standalone file");
  await assert.rejects(collectRelease(root), /必须是实际目录/);
  assert.equal(await fs.readFile(release, "utf8"), "standalone file");
  await fs.unlink(release);
  await fs.symlink(unrelated, release, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(collectRelease(root), /必须是实际目录/);
  assert.ok((await fs.lstat(release)).isSymbolicLink());
  await assertPrevious(unrelated);
});

test("failed rollback keeps the only backup and stops another run from touching it", async (t) => {
  const { root } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (from, to) => {
    if (["next", "previous"].includes(path.basename(from))) throw new Error("rename denied");
    return rename(from, to);
  });
  await assert.rejects(collectRelease(root), /旧产物保留/);
  const backup = path.join(root, ".collect-release", "previous");
  await assertPrevious(backup);
  await assert.rejects(collectRelease(root), /中断的事务/);
  await assertPrevious(backup);
});

test("a concurrent collector cannot switch another collector's release", async (t) => {
  const { root, release } = await fixture(t);
  const rename = fs.rename;
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  t.mock.method(fs, "rename", async (from, to) => {
    if (from === release) {
      entered.resolve();
      await resume.promise;
    }
    return rename(from, to);
  });
  const first = collectRelease(root);
  await Promise.race([entered.promise, first]);
  try {
    await assert.rejects(collectRelease(root), /已有收集任务/);
    await assertPrevious(release);
  } finally {
    resume.resolve();
    await first;
  }
});

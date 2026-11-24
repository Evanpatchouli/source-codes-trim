const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const archiver = require("archiver");
const yauzl = require("yauzl");

async function digest(stream) {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function planArchives(root) {
  const { name, version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const base = `${name}_${version}_x64`;
  const sourceDir = path.join(root, "src-tauri", "target", "release");
  const inputs = {
    portable: [`${name}.exe`, "README.md", "LICENSE"],
    msi: [`bundle/msi/${base}_en-US.msi`],
    nsis: [`bundle/nsis/${base}-setup.exe`],
  };
  const archives = [];
  for (const [kind, relativePaths] of Object.entries(inputs)) {
    const files = new Map();
    for (const relative of relativePaths) {
      const source = path.join(sourceDir, relative);
      const stat = await fs.stat(source);
      if (!stat.isFile() || !stat.size) throw new Error(`发布输入不是有效的非空文件：${source}`);
      files.set(path.basename(source), { source, hash: await digest(createReadStream(source)) });
    }
    archives.push({ name: `${base}_windows_10_${kind}.zip`, files });
  }
  return archives;
}

async function writeZip(destination, files) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("warning", (error) => archive.destroy(error));
  const output = createWriteStream(destination, { flags: "wx" });
  const written = pipeline(archive, output);
  const sources = [];
  try {
    for (const [name, { source }] of files) {
      const input = createReadStream(source);
      sources.push(input);
      input.on("error", (error) => archive.destroy(error));
      archive.append(input, { name });
    }
    await Promise.all([archive.finalize(), written]);
  } catch (error) {
    for (const input of sources) input.destroy();
    archive.abort();
    archive.destroy(error);
    await written.catch(() => {});
    throw error;
  }
}

async function verifyZip(archivePath, files) {
  const missing = new Map(files);
  const zip = await yauzl.openPromise(archivePath, { autoClose: false });
  try {
    for await (const entry of zip.eachEntry()) {
      const expected = missing.get(entry.fileName);
      if (!expected) throw new Error(`ZIP 包含意外或重复条目：${entry.fileName}`);
      const actual = await digest(await zip.openReadStreamPromise(entry));
      if (actual !== expected.hash) throw new Error(`ZIP 条目内容校验失败：${entry.fileName}`);
      missing.delete(entry.fileName);
    }
    if (missing.size) throw new Error(`ZIP 缺少条目：${[...missing.keys()].join("、")}`);
  } finally {
    const closed = once(zip, "close");
    zip.close();
    await closed;
  }
}

async function collectRelease(root = path.resolve(__dirname, "..")) {
  const release = path.join(root, "release");
  const work = path.join(root, ".collect-release");
  const next = path.join(work, "next");
  const previous = path.join(work, "previous");
  // mkdir 独占本次事务；进程若中途退出，后续发布会保留备份并提示恢复。
  try {
    await fs.mkdir(work);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`已有收集任务或中断的事务：${work}。确认没有任务运行后，若 release 缺失，请先将 ${previous} 恢复为 ${release}；核对已有产物后移走事务目录再重试。`);
  }

  let preserveBackup = false;
  let published = false;
  try {
    const archives = await planArchives(root);
    await fs.mkdir(next);
    for (const archive of archives) {
      const destination = path.join(next, archive.name);
      await writeZip(destination, archive.files);
      await verifyZip(destination, archive.files);
    }

    const existing = await fs.lstat(release).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing && !existing.isDirectory()) {
      throw new Error(`发布目标必须是实际目录：${release}`);
    }
    if (existing) await fs.rename(release, previous);
    try {
      await fs.rename(next, release);
      published = true;
    } catch (publishError) {
      if (existing) {
        try {
          await fs.rename(previous, release);
        } catch (restoreError) {
          preserveBackup = true;
          throw new Error(`发布失败（${publishError.message}），恢复失败（${restoreError.message}）。旧产物保留在 ${previous}，请将其恢复为 ${release}。`);
        }
      }
      throw publishError;
    }
  } finally {
    if (!preserveBackup) {
      try {
        await fs.rm(work, { recursive: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        if (!published) throw error;
        console.warn(`新版本已发布；清理事务目录 ${work} 失败：${error.message}`);
      }
    }
  }
  return release;
}

module.exports = { collectRelease };

if (require.main === module) {
  collectRelease()
    .then((directory) => console.log(`已校验并发布到 ${directory}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

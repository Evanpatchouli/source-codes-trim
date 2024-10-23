const fs = require("fs");
const path = require("path");
const fse = require("fs-extra");
const archiver = require('archiver');
const pkg = require('../package.json');

const sourceDir = "./src-tauri/target/release";
const targetDir = "./release/portable";
const bundleSourceDir = path.join(sourceDir, "bundle");
const releaseDir = "./release";

// 清空 releaseDir 目录
if (fs.existsSync(releaseDir)) {
  fse.emptyDirSync(releaseDir);
}

// 要收集的文件和文件夹列表
const itemsToCollect = ["source-codes-trim.exe", "README.md", "LICENSE"];

// 创建目标目录，如果不存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 复制文件和文件夹
itemsToCollect.forEach((item) => {
  const sourcePath = path.join(sourceDir, item);
  const targetPath = path.join(targetDir, item);

  if (fs.existsSync(sourcePath)) {
    if (fs.lstatSync(sourcePath).isDirectory()) {
      fse.copySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
    console.log(`Copied ${item} to ${targetPath}`);
  } else {
    console.error(`Source item ${item} does not exist`);
  }
});

// 复制 bundle/msi 和 bundle/nsis 中的 .msi 和 .exe 文件
const copyFilesFromDir = (sourceDir, targetDir, extensions) => {
  if (fs.existsSync(sourceDir)) {
    const files = fs.readdirSync(sourceDir);
    files.forEach((file) => {
      const ext = path.extname(file);
      if (extensions.includes(ext)) {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`Copied ${file} to ${targetPath}`);
      }
    });
  } else {
    console.error(`Source directory ${sourceDir} does not exist`);
  }
};

const msiDir = path.join(bundleSourceDir, "msi");
const nsisDir = path.join(bundleSourceDir, "nsis");

copyFilesFromDir(msiDir, releaseDir, [".msi"]);
copyFilesFromDir(nsisDir, releaseDir, [".exe"]);

async function zipDir(sourceDir, outPath) {
  const output = fs.createWriteStream(outPath);
  const arch = archiver('zip', {
    zlib: { level: 9 } // 设置压缩级别
  });

  output.on('close', () => {
    console.log(`Compression finished, totally ${arch.pointer()} bytes.`);
  });

  arch.on('error', (err) => {
    throw err;
  });

  arch.pipe(output);

  arch.directory(sourceDir, false);

  await arch.finalize();
}

async function zipFile(sourcePath, outPath) {
  const output = fs.createWriteStream(outPath);
  const arch = archiver('zip', {
    zlib: { level: 9 } // 设置压缩级别
  });

  output.on('close', () => {
    console.log(`Compression finished, totally ${arch.pointer()} bytes.`);
  });

  arch.on('error', (err) => {
    throw err;
  });

  arch.pipe(output);

  arch.append(fs.createReadStream(sourcePath), { name: path.basename(sourcePath) });

  await arch.finalize();
}

const portable = path.resolve(targetDir);
const msi = path.resolve(releaseDir, `${pkg.name}_${pkg.version}_x64_en-US.msi`);
const nsis = path.resolve(releaseDir, `${pkg.name}_${pkg.version}_x64-setup.exe`);

zipDir(portable, path.resolve(releaseDir, `${pkg.name}_${pkg.version}_x64_windows_10_portable.zip`))
  .then(() => {
    // 删除 portable 目录
    fse.removeSync(portable);
  }).catch(err => {
    console.error(err);
  });

zipFile(msi, path.resolve(releaseDir, `${pkg.name}_${pkg.version}_x64_windows_10_msi.zip`))
  .then(() => {
    // 删除 msi 文件
    fse.removeSync(msi);
  }).catch(err => {
    console.error(err);
  });

zipFile(nsis, path.resolve(releaseDir, `${pkg.name}_${pkg.version}_x64_windows_10_nsis.zip`))
  .then(() => {
    // 删除 nsis 文件
    fse.removeSync(nsis);
  }).catch(err => {
    console.error(err);
  });

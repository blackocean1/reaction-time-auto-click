'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inject } = require('postject');

const distDirectory = path.join(__dirname, 'dist');
const outputPath = path.join(distDirectory, 'reaction-time-auto-click.exe');
const seaSentinelFuse = 'NODE_SEA' + '_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const runtimeAssetPrefix = 'runtime/';

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function buildAssets() {
  const assets = {};
  const addAsset = filePath => {
    const relativePath = path.relative(__dirname, filePath)
      .split(path.sep)
      .join('/');
    assets[`${runtimeAssetPrefix}${relativePath}`] = filePath;
  };

  addAsset(path.join(__dirname, 'desktop-runner.js'));
  addAsset(path.join(__dirname, 'reaction-time-auto-click.user.js'));

  for (const filePath of collectFiles(path.join(
    __dirname,
    'node_modules',
    'playwright-core'
  ))) {
    addAsset(filePath);
  }

  return assets;
}

function runSeaPreparation(configPath) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-sea-config', configPath],
    {
      cwd: __dirname,
      stdio: 'inherit'
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`SEA 资源准备失败，退出码：${result.status ?? '未知'}`);
  }
}

async function build() {
  fs.mkdirSync(distDirectory, { recursive: true });
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reaction-time-auto-click-build-')
  );
  const blobPath = path.join(tempDirectory, 'sea-prep.blob');
  const configPath = path.join(tempDirectory, 'sea-config.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify({
      main: path.join(__dirname, 'sea-entry.js'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: buildAssets()
    }));

    runSeaPreparation(configPath);
    fs.copyFileSync(process.execPath, outputPath);
    await inject(outputPath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
      sentinelFuse: seaSentinelFuse,
      overwrite: true
    });
    console.log(`EXE 已生成：${outputPath}`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

build().catch(error => {
  console.error(`EXE 打包失败：${error.message}`);
  process.exitCode = 1;
});

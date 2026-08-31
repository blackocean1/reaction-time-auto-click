'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const sea = require('node:sea');

const ASSET_PREFIX = 'runtime/';

function extractRuntimeAssets() {
  if (!sea.isSea()) {
    throw new Error('此入口只能从打包后的 EXE 运行。');
  }

  const runtimeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reaction-time-auto-click-')
  );

  try {
    const runtimePrefix = `${runtimeRoot}${path.sep}`;
    for (const assetKey of sea.getAssetKeys()) {
      if (!assetKey.startsWith(ASSET_PREFIX)) continue;

      const relativePath = assetKey.slice(ASSET_PREFIX.length)
        .split('/')
        .join(path.sep);
      const outputPath = path.resolve(runtimeRoot, relativePath);
      if (outputPath !== runtimeRoot && !outputPath.startsWith(runtimePrefix)) {
        throw new Error(`内置资源路径无效：${assetKey}`);
      }

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from(sea.getAsset(assetKey)));
    }

    return runtimeRoot;
  } catch (error) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

async function run() {
  let runtimeRoot;
  try {
    runtimeRoot = extractRuntimeAssets();
    const runnerPath = path.join(runtimeRoot, 'desktop-runner.js');
    const runner = createRequire(runnerPath)(runnerPath);
    return await runner.main(process.argv.slice(2));
  } finally {
    if (runtimeRoot) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  run()
    .then(code => {
      process.exitCode = Number.isInteger(code) ? code : 0;
    })
    .catch(error => {
      console.error(`运行失败：${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  extractRuntimeAssets,
  run
};

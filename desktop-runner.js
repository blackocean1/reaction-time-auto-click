'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const DEFAULT_URL = 'https://humanbenchmark.me/zh/tests/reactiontime';
const USERSCRIPT_NAME = 'reaction-time-auto-click.user.js';
const PANEL_ID = 'reaction-auto-click-panel';

function parseOptions(argv = []) {
  return {
    check: argv.includes('--check'),
    headless: argv.includes('--headless')
  };
}

function getBrowserLaunchOptions({ executablePath, headless = false } = {}) {
  const options = { executablePath, headless };
  if (!headless) options.args = ['--start-maximized'];
  return options;
}

function getPageOptions() {
  return { viewport: null };
}

function waitForVisiblePageClose(page, browser, timers = {}) {
  const setIntervalFn = typeof timers.setInterval === 'function'
    ? timers.setInterval
    : setInterval;
  const clearIntervalFn = typeof timers.clearInterval === 'function'
    ? timers.clearInterval
    : clearInterval;

  return new Promise((resolve, reject) => {
    const keepAliveTimer = setIntervalFn(() => {}, 1000);
    let settled = false;

    const removeListener = (target, event, listener) => {
      if (typeof target.off === 'function') {
        target.off(event, listener);
      } else {
        target.removeListener(event, listener);
      }
    };

    const cleanup = () => {
      clearIntervalFn(keepAliveTimer);
      removeListener(page, 'close', onPageClose);
      removeListener(browser, 'disconnected', onBrowserDisconnect);
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const onPageClose = () => finish(resolve);
    const onBrowserDisconnect = () => finish(
      reject,
      new Error('Edge 浏览器连接已断开，窗口无法继续保持。')
    );

    page.once('close', onPageClose);
    browser.once('disconnected', onBrowserDisconnect);
    if (typeof page.isClosed === 'function' && page.isClosed()) onPageClose();
  });
}

function getEdgeCandidates(env = {}) {
  const roots = [
    env.PROGRAMFILES,
    env['PROGRAMFILES(X86)'],
    env.LOCALAPPDATA
  ];

  return roots
    .filter(Boolean)
    .map(root => path.join(
      root,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe'
    ));
}

function findEdgeExecutable(env = process.env, exists = fs.existsSync) {
  return getEdgeCandidates(env).find(candidate => exists(candidate)) || null;
}

function resolveUserScriptPath(baseDir = __dirname, exists = fs.existsSync) {
  const candidate = path.join(baseDir, USERSCRIPT_NAME);
  return exists(candidate) ? candidate : null;
}

function checkEnvironment(env = process.env, exists = fs.existsSync, baseDir = __dirname) {
  const edgePath = findEdgeExecutable(env, exists);
  if (!edgePath) {
    throw new Error('未找到 Microsoft Edge，请先安装 Edge。');
  }

  const scriptPath = resolveUserScriptPath(baseDir, exists);
  if (!scriptPath) {
    throw new Error(`未找到 ${USERSCRIPT_NAME}，请确认它与程序位于同一目录。`);
  }

  return { edgePath, scriptPath };
}

function resolveRunEnvironment(options) {
  const edgePath = options.executablePath || findEdgeExecutable();
  if (!edgePath) {
    throw new Error('未找到 Microsoft Edge，请先安装 Edge。');
  }

  const scriptPath = options.scriptPath || resolveUserScriptPath();
  if (!scriptPath) {
    throw new Error(`未找到 ${USERSCRIPT_NAME}，请确认它与程序位于同一目录。`);
  }

  return { edgePath, scriptPath };
}

async function run(options = {}) {
  const {
    headless = false,
    executablePath,
    scriptPath,
    url = DEFAULT_URL
  } = options;
  const environment = resolveRunEnvironment({ executablePath, scriptPath });
  const browser = await chromium.launch(getBrowserLaunchOptions({
    executablePath: environment.edgePath,
    headless
  }));

  try {
    const page = await browser.newPage(getPageOptions());
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const script = fs.readFileSync(environment.scriptPath, 'utf8');
    await page.addScriptTag({ content: script });

    await page.waitForFunction(
      () => document.querySelector('#reaction-auto-click-panel')?.shadowRoot
        ?.querySelector('[data-action="start"]'),
      null,
      { timeout: 15000 }
    );

    await page.evaluate(() => {
      const panel = document.querySelector('#reaction-auto-click-panel');
      const startButton = panel?.shadowRoot?.querySelector('[data-action="start"]');
      if (!startButton) throw new Error('自动点击面板未准备好。');
      startButton.click();
    });

    await page.waitForFunction(
      () => document.querySelector('#reaction-auto-click-panel')?.shadowRoot
        ?.querySelector('[data-role="status"]')?.textContent.includes('已完成'),
      null,
      { timeout: 30000 }
    );

    console.log('已完成 5 轮，结果已显示。');
    if (!headless) await waitForVisiblePageClose(page, browser);
  } finally {
    await browser.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseOptions(argv);
    if (options.check) {
      const { edgePath, scriptPath } = checkEnvironment();
      console.log(`Microsoft Edge: ${edgePath}`);
      console.log(`Userscript: ${scriptPath}`);
      return 0;
    }

    await run(options);
    return 0;
  } catch (error) {
    console.error(`运行失败：${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  parseOptions,
  getEdgeCandidates,
  findEdgeExecutable,
  resolveUserScriptPath,
  checkEnvironment,
  getBrowserLaunchOptions,
  getPageOptions,
  waitForVisiblePageClose,
  run,
  main
};

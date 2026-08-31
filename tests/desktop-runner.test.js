'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  parseOptions,
  getEdgeCandidates,
  findEdgeExecutable,
  resolveUserScriptPath,
  checkEnvironment,
  getBrowserLaunchOptions,
  getPageOptions,
  waitForVisiblePageClose
} = require('../desktop-runner.js');

test('parses check and headless flags', () => {
  assert.deepEqual(parseOptions(['--check', '--headless']), {
    check: true,
    headless: true
  });
  assert.deepEqual(parseOptions([]), { check: false, headless: false });
});

test('starts the visible browser maximized with a resizable page viewport', () => {
  assert.deepEqual(
    getBrowserLaunchOptions({
      executablePath: 'C:\\Edge\\msedge.exe',
      headless: false
    }),
    {
      executablePath: 'C:\\Edge\\msedge.exe',
      headless: false,
      args: ['--start-maximized']
    }
  );
  assert.deepEqual(getPageOptions(), { viewport: null });
});

test('keeps the visible runner alive until the page closes', async () => {
  const page = new EventEmitter();
  const browser = new EventEmitter();
  let keepAliveTimer;
  let clearedTimer;

  const waitForClose = waitForVisiblePageClose(page, browser, {
    setInterval(callback) {
      keepAliveTimer = callback;
      return 'keep-alive-timer';
    },
    clearInterval(timer) {
      clearedTimer = timer;
    }
  });

  assert.equal(typeof keepAliveTimer, 'function');
  page.emit('close');
  await waitForClose;
  assert.equal(clearedTimer, 'keep-alive-timer');
});

test('reports an unexpected Edge disconnect while keeping the page open', async () => {
  const page = new EventEmitter();
  const browser = new EventEmitter();
  let clearedTimer;

  const waitForClose = waitForVisiblePageClose(page, browser, {
    setInterval() {
      return 'keep-alive-timer';
    },
    clearInterval(timer) {
      clearedTimer = timer;
    }
  });

  browser.emit('disconnected');
  await assert.rejects(waitForClose, /Edge 浏览器连接已断开/);
  assert.equal(clearedTimer, 'keep-alive-timer');
});

test('builds Edge candidates in priority order', () => {
  const env = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
  };
  assert.deepEqual(getEdgeCandidates(env), [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Users\\tester\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'
  ]);
});

test('resolves the first existing Edge candidate', () => {
  const env = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
  };
  const expected = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findEdgeExecutable(env, candidate => candidate === expected), expected);
});

test('returns null when Edge is not installed', () => {
  assert.equal(findEdgeExecutable({}, () => false), null);
});

test('resolves the injected userscript asset', () => {
  const baseDir = 'C:\\snapshot';
  const expected = 'C:\\snapshot\\reaction-time-auto-click.user.js';
  assert.equal(resolveUserScriptPath(baseDir, candidate => candidate === expected), expected);
});

test('reports missing Edge through check mode', () => {
  assert.throws(
    () => checkEnvironment({}, () => false, 'C:\\snapshot'),
    /Microsoft Edge/
  );
});

test('reports a missing userscript asset through check mode', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files' };
  const edgePath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.throws(
    () => checkEnvironment(env, candidate => candidate === edgePath, 'C:\\snapshot'),
    /reaction-time-auto-click\.user\.js/
  );
});

test('returns both resolved paths when the environment is valid', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files' };
  const edgePath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const scriptPath = 'C:\\snapshot\\reaction-time-auto-click.user.js';
  const exists = candidate => candidate === edgePath || candidate === scriptPath;

  assert.deepEqual(checkEnvironment(env, exists, 'C:\\snapshot'), {
    edgePath,
    scriptPath
  });
});

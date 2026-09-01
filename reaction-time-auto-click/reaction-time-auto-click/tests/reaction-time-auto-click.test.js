'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const createRuntimeApi = require('../reaction-time-auto-click.user.js');

function fixture() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div class="game-container"></div></body></html>',
    {
      pretendToBeVisual: true,
      url: 'https://humanbenchmark.me/zh/tests/reactiontime'
    }
  );

  return {
    dom,
    window: dom.window,
    root: dom.window.document.querySelector('.game-container')
  };
}

function setState(root, className, html = '<div id="game-content"></div>') {
  root.className = className;
  root.innerHTML = html;
}

function panelQuery(panel, selector) {
  const container = panel.element.shadowRoot || panel.element;
  return container.querySelector(selector);
}

test('classifies the reaction-time DOM states', () => {
  const { dom, window, root } = fixture();
  const api = createRuntimeApi(window);

  assert.equal(api.classifyGameState(root), 'initial');
  root.className = 'game-container state-wait';
  assert.equal(api.classifyGameState(root), 'waiting');
  root.className = 'game-container state-ready';
  assert.equal(api.classifyGameState(root), 'ready');
  root.className = 'game-container state-too-early';
  assert.equal(api.classifyGameState(root), 'too-early');
  root.className = 'game-container';
  root.innerHTML = '<div class="round-counter"></div><div id="game-content"></div>';
  assert.equal(api.classifyGameState(root), 'round-result');
  root.innerHTML = '<div id="game-content"></div>';
  assert.equal(api.classifyGameState(root), 'final-result');
  assert.equal(api.classifyGameState(null), 'unknown');

  dom.window.close();
});

test('dispatches one mousedown for one ready state', () => {
  const { dom, window, root } = fixture();
  root.className = 'game-container state-ready';
  const api = createRuntimeApi(window);
  const controller = new api.AutoClickController(window);
  let clicks = 0;
  root.addEventListener('mousedown', () => { clicks += 1; });

  controller.start();
  controller.scan();
  controller.scan();

  assert.equal(clicks, 1);
  assert.equal(controller.snapshot().roundsCompleted, 1);
  controller.stop();
  dom.window.close();
});

test('advances from a round result into the next waiting round', () => {
  const { dom, window, root } = fixture();
  const api = createRuntimeApi(window);
  const controller = new api.AutoClickController(window);
  let clicks = 0;
  root.addEventListener('mousedown', () => {
    clicks += 1;
    if (clicks === 1) {
      setState(root, 'game-container state-wait');
    }
  });

  controller.start();
  assert.equal(clicks, 1);
  controller.scan();
  setState(root, 'game-container state-ready');
  controller.scan();
  setState(
    root,
    'game-container',
    '<div class="round-counter"></div><div id="game-content"></div>'
  );
  controller.scan();

  assert.equal(clicks, 3);
  assert.equal(controller.snapshot().roundsCompleted, 1);
  controller.stop();
  dom.window.close();
});

test('completes exactly five reaction rounds', () => {
  const { dom, window, root } = fixture();
  const api = createRuntimeApi(window);
  const controller = new api.AutoClickController(window);
  let clicks = 0;
  let readyClicks = 0;
  root.addEventListener('mousedown', () => {
    clicks += 1;
    if (root.classList.contains('state-ready')) readyClicks += 1;
  });

  controller.start();
  setState(root, 'game-container state-wait');
  controller.scan();

  for (let round = 0; round < 5; round += 1) {
    setState(root, 'game-container state-ready');
    controller.scan();

    if (round < 4) {
      setState(
        root,
        'game-container',
        '<div class="round-counter"></div><div id="game-content"></div>'
      );
      controller.scan();
      setState(root, 'game-container state-wait');
      controller.scan();
    }
  }

  assert.equal(readyClicks, 5);
  assert.equal(clicks, 10);
  assert.equal(controller.snapshot().status, 'completed');
  assert.equal(controller.snapshot().roundsCompleted, 5);
  assert.equal(controller.isRunning(), false);
  dom.window.close();
});

test('stop prevents later state changes from dispatching events', () => {
  const { dom, window, root } = fixture();
  const api = createRuntimeApi(window);
  const controller = new api.AutoClickController(window);
  let clicks = 0;
  root.addEventListener('mousedown', () => { clicks += 1; });

  controller.start();
  controller.stop('manual');
  setState(root, 'game-container state-ready');
  controller.scan();

  assert.equal(clicks, 1);
  assert.equal(controller.snapshot().status, 'idle');
  assert.equal(controller.isRunning(), false);
  dom.window.close();
});

test('reports an error after bounded game-root lookup retries', () => {
  const { dom, window } = fixture();
  const root = window.document.querySelector('.game-container');
  root.remove();
  const api = createRuntimeApi(window);
  const pendingTimers = [];
  const controller = new api.AutoClickController(window, {
    maxRootAttempts: 1,
    retryIntervalMs: 1,
    timers: {
      setTimeout(callback) {
        pendingTimers.push(callback);
        return callback;
      },
      clearTimeout() {},
      requestAnimationFrame(callback) {
        callback();
        return 0;
      },
      cancelAnimationFrame() {}
    }
  });

  controller.start();
  assert.equal(controller.snapshot().status, 'searching');
  assert.equal(pendingTimers.length, 1);
  pendingTimers.shift()();
  assert.equal(controller.snapshot().status, 'error');
  assert.equal(controller.isRunning(), false);
  dom.window.close();
});

test('Esc stops a booted controller', () => {
  const { dom, window } = fixture();
  const api = createRuntimeApi(window);
  const app = api.boot(window);

  app.controller.start();
  assert.equal(app.controller.isRunning(), true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

  assert.equal(app.controller.isRunning(), false);
  assert.equal(app.controller.snapshot().status, 'idle');
  app.destroy();
  dom.window.close();
});

test('boot creates one panel and cleans it up', () => {
  const { dom, window, root } = fixture();
  const api = createRuntimeApi(window);
  const first = api.boot(window);
  const second = api.boot(window);

  assert.equal(first, second);
  assert.equal(window.document.querySelectorAll('#reaction-auto-click-panel').length, 1);

  let clicks = 0;
  root.addEventListener('mousedown', () => { clicks += 1; });
  panelQuery(first.panel, '[data-action="start"]').click();
  assert.equal(first.controller.isRunning(), true);
  panelQuery(first.panel, '[data-action="stop"]').click();
  setState(root, 'game-container state-ready');
  first.controller.scan();
  assert.equal(clicks, 1);

  first.destroy();
  assert.equal(window.document.querySelector('#reaction-auto-click-panel'), null);
  dom.window.close();
});

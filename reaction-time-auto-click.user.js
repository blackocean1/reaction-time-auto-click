// ==UserScript==
// @name         Human Benchmark Reaction Time Auto Click
// @namespace    local.reaction-auto-click
// @version      1.0.0
// @description  自动完成 Human Benchmark 反应时间测试的五轮点击
// @match        https://humanbenchmark.me/*/tests/reactiontime*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function (root, createRuntimeApi) {
  if (typeof module === 'object' && module.exports) {
    module.exports = createRuntimeApi;
    return;
  }

  if (root && root.document) {
    createRuntimeApi(root).boot();
  }
})(typeof globalThis === 'object' ? globalThis : this, function createRuntimeApi(env) {
  'use strict';

  const SELECTORS = Object.freeze({
    gameRoot: '.game-container',
    ready: '.state-ready',
    waiting: '.state-wait',
    tooEarly: '.state-too-early',
    roundCounter: '.round-counter',
    gameContent: '#game-content'
  });

  const PANEL_ID = 'reaction-auto-click-panel';
  const BOOT_KEY = '__reactionAutoClickApp__';
  const DEFAULT_TARGET_ROUNDS = 5;
  const DEFAULT_RETRY_INTERVAL_MS = 250;
  const DEFAULT_MAX_ROOT_ATTEMPTS = 20;

  function classifyGameState(root, selectors = SELECTORS) {
    if (!root || root.isConnected === false || !root.classList || !root.querySelector) {
      return 'unknown';
    }

    if (root.classList.contains(selectors.ready.slice(1))) return 'ready';
    if (root.classList.contains(selectors.waiting.slice(1))) return 'waiting';
    if (root.classList.contains(selectors.tooEarly.slice(1))) return 'too-early';
    if (root.querySelector(selectors.roundCounter)) return 'round-result';
    if (root.querySelector(selectors.gameContent)) return 'final-result';
    return 'initial';
  }

  function defaultTimers(runtime) {
    const fallbackSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
    const fallbackClearTimeout = typeof clearTimeout === 'function' ? clearTimeout : null;

    return {
      setTimeout: typeof runtime.setTimeout === 'function'
        ? runtime.setTimeout.bind(runtime)
        : fallbackSetTimeout,
      clearTimeout: typeof runtime.clearTimeout === 'function'
        ? runtime.clearTimeout.bind(runtime)
        : fallbackClearTimeout,
      requestAnimationFrame: typeof runtime.requestAnimationFrame === 'function'
        ? runtime.requestAnimationFrame.bind(runtime)
        : callback => fallbackSetTimeout(callback, 0),
      cancelAnimationFrame: typeof runtime.cancelAnimationFrame === 'function'
        ? runtime.cancelAnimationFrame.bind(runtime)
        : id => fallbackClearTimeout(id)
    };
  }

  class AutoClickController {
    constructor(runtime, options = {}) {
      this.env = runtime;
      this.document = runtime.document;
      this.selectors = options.selectors || SELECTORS;
      this.targetRounds = options.targetRounds || DEFAULT_TARGET_ROUNDS;
      this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
      this.maxRootAttempts = options.maxRootAttempts ?? DEFAULT_MAX_ROOT_ATTEMPTS;
      this.timers = { ...defaultTimers(runtime), ...(options.timers || {}) };
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

      this.running = false;
      this.gameRoot = null;
      this.observer = null;
      this.retryTimer = null;
      this.frameId = null;
      this.lifecycleToken = 0;
      this.rootAttempts = 0;
      this.roundsCompleted = 0;
      this.lastHandledState = null;
      this.status = 'idle';
      this.message = '待机';
    }

    snapshot() {
      return {
        status: this.status,
        message: this.message,
        roundsCompleted: this.roundsCompleted,
        lastHandledState: this.lastHandledState
      };
    }

    isRunning() {
      return this.running;
    }

    start() {
      if (this.running) return;

      this.lifecycleToken += 1;
      const token = this.lifecycleToken;
      this.running = true;
      this.gameRoot = null;
      this.observer = null;
      this.rootAttempts = 0;
      this.roundsCompleted = 0;
      this.lastHandledState = null;
      this.setStatus('searching', '正在查找测试区域');

      const findRoot = () => {
        if (!this.running || token !== this.lifecycleToken) return;

        const root = this.document && this.document.querySelector
          ? this.document.querySelector(this.selectors.gameRoot)
          : null;

        if (root) {
          this.retryTimer = null;
          this.gameRoot = root;
          if (!this.attachObserver()) return;
          this.setStatus('running', '运行中');
          this.scan();
          return;
        }

        if (this.rootAttempts >= this.maxRootAttempts) {
          this.fail('未找到测试区域');
          return;
        }

        this.rootAttempts += 1;
        this.retryTimer = this.timers.setTimeout(findRoot, this.retryIntervalMs);
      };

      findRoot();
    }

    stop(message = '已停止') {
      this.lifecycleToken += 1;
      this.running = false;
      this.disconnect();
      this.clearTimers();
      this.gameRoot = null;
      this.lastHandledState = null;
      this.setStatus('idle', message);
    }

    scan() {
      if (!this.running || !this.gameRoot) return;

      const root = this.gameRoot;
      const documentRoot = this.document && this.document.documentElement;
      if (!documentRoot || !documentRoot.contains(root)) {
        this.fail('测试区域已离开页面');
        return;
      }

      const state = classifyGameState(root, this.selectors);
      if (state === 'unknown') {
        this.fail('无法识别测试页面状态');
        return;
      }

      if (state === this.lastHandledState) return;
      this.lastHandledState = state;

      switch (state) {
        case 'initial':
          this.dispatchMouseDown();
          break;
        case 'waiting':
          this.setStatus('running', '等待变绿');
          break;
        case 'ready':
          if (!this.dispatchMouseDown()) return;
          this.roundsCompleted += 1;
          if (this.roundsCompleted >= this.targetRounds) {
            this.complete();
          } else {
            this.setStatus('running', '已点击，等待结果');
          }
          break;
        case 'round-result':
          if (this.roundsCompleted === 0 || this.roundsCompleted >= this.targetRounds) {
            this.fail('回合状态异常');
            return;
          }
          this.dispatchMouseDown();
          break;
        case 'too-early':
          this.fail('检测到过早点击，已停止');
          break;
        case 'final-result':
          if (this.roundsCompleted >= this.targetRounds) {
            this.complete();
          } else if (this.roundsCompleted === 0) {
            this.dispatchMouseDown();
          } else {
            this.fail('测试提前结束，已停止');
          }
          break;
        default:
          this.fail('无法识别测试页面状态');
      }
    }

    attachObserver() {
      if (typeof this.env.MutationObserver !== 'function') {
        this.fail('当前浏览器不支持 MutationObserver');
        return false;
      }

      this.observer = new this.env.MutationObserver(() => this.scheduleScan());
      this.observer.observe(this.gameRoot, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      });
      return true;
    }

    scheduleScan() {
      if (!this.running || this.frameId !== null) return;

      let callbackRan = false;
      const callback = () => {
        callbackRan = true;
        this.frameId = null;
        this.scan();
      };
      const frameId = this.timers.requestAnimationFrame(callback);
      if (!callbackRan) this.frameId = frameId;
    }

    dispatchMouseDown() {
      if (!this.gameRoot || typeof this.env.MouseEvent !== 'function') {
        this.fail('当前浏览器不支持鼠标事件');
        return false;
      }

      try {
        const event = new this.env.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: this.env
        });
        this.gameRoot.dispatchEvent(event);
        return true;
      } catch (error) {
        this.fail('鼠标事件派发失败');
        return false;
      }
    }

    complete() {
      this.running = false;
      this.lifecycleToken += 1;
      this.disconnect();
      this.clearTimers();
      this.gameRoot = null;
      this.setStatus('completed', '已完成');
    }

    fail(message) {
      this.running = false;
      this.lifecycleToken += 1;
      this.disconnect();
      this.clearTimers();
      this.gameRoot = null;
      this.setStatus('error', message);
    }

    disconnect() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
    }

    clearTimers() {
      if (this.retryTimer !== null && typeof this.timers.clearTimeout === 'function') {
        this.timers.clearTimeout(this.retryTimer);
      }
      if (this.frameId !== null && typeof this.timers.cancelAnimationFrame === 'function') {
        this.timers.cancelAnimationFrame(this.frameId);
      }
      this.retryTimer = null;
      this.frameId = null;
    }

    setStatus(status, message) {
      this.status = status;
      this.message = message;
      this.onStatus(this.snapshot());
    }
  }

  function createControlPanel(document, handlers = {}) {
    const existing = document.getElementById(PANEL_ID);
    if (existing && existing.__reactionAutoClickPanel) {
      return existing.__reactionAutoClickPanel;
    }

    const element = document.createElement('div');
    element.id = PANEL_ID;
    const container = typeof element.attachShadow === 'function'
      ? element.attachShadow({ mode: 'open' })
      : element;

    container.innerHTML = `
      <style>
        :host, #reaction-auto-click-panel {
          all: initial;
        }
        .panel {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          min-width: 190px;
          box-sizing: border-box;
          padding: 12px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.96);
          color: #e2e8f0;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.24);
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .title {
          margin-bottom: 8px;
          color: #f8fafc;
          font-weight: 700;
        }
        .status {
          min-height: 20px;
          margin-bottom: 10px;
          color: #cbd5e1;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        button {
          flex: 1;
          min-height: 30px;
          padding: 5px 9px;
          border: 0;
          border-radius: 6px;
          color: #fff;
          cursor: pointer;
          font: inherit;
        }
        button[data-action="start"] { background: #16a34a; }
        button[data-action="stop"] { background: #dc2626; }
        button:disabled { cursor: not-allowed; opacity: 0.45; }
      </style>
      <div class="panel">
        <div class="title">反应时间自动点击</div>
        <div class="status" data-role="status" aria-live="polite">待机</div>
        <div class="actions">
          <button type="button" data-action="start">开始</button>
          <button type="button" data-action="stop" disabled>停止</button>
        </div>
      </div>
    `;

    const startButton = container.querySelector('[data-action="start"]');
    const stopButton = container.querySelector('[data-action="stop"]');
    const statusElement = container.querySelector('[data-role="status"]');
    const onStart = () => {
      if (typeof handlers.onStart === 'function') handlers.onStart();
    };
    const onStop = () => {
      if (typeof handlers.onStop === 'function') handlers.onStop();
    };

    startButton.addEventListener('click', onStart);
    stopButton.addEventListener('click', onStop);
    document.body.appendChild(element);

    const panel = {
      element,
      setStatus(snapshot) {
        const active = snapshot.status === 'running' || snapshot.status === 'searching';
        const showCount = snapshot.status === 'running' || snapshot.status === 'completed';
        const count = showCount ? ` (${snapshot.roundsCompleted}/${DEFAULT_TARGET_ROUNDS})` : '';
        statusElement.textContent = `${snapshot.message}${count}`;
        startButton.disabled = active;
        stopButton.disabled = !active;
      },
      destroy() {
        startButton.removeEventListener('click', onStart);
        stopButton.removeEventListener('click', onStop);
        element.__reactionAutoClickPanel = null;
        element.remove();
      }
    };

    element.__reactionAutoClickPanel = panel;
    return panel;
  }

  function boot(runtime = env) {
    if (runtime[BOOT_KEY]) return runtime[BOOT_KEY];

    let panel;
    const controller = new AutoClickController(runtime, {
      onStatus: snapshot => {
        if (panel) panel.setStatus(snapshot);
      }
    });

    panel = createControlPanel(runtime.document, {
      onStart: () => controller.start(),
      onStop: () => controller.stop('已停止')
    });
    panel.setStatus(controller.snapshot());

    const onKeyDown = event => {
      if (event.key === 'Escape' && controller.isRunning()) {
        controller.stop('已停止');
      }
    };
    runtime.addEventListener('keydown', onKeyDown);

    const app = {
      controller,
      panel,
      destroy() {
        runtime.removeEventListener('keydown', onKeyDown);
        controller.stop('已停止');
        panel.destroy();
        if (runtime[BOOT_KEY] === app) delete runtime[BOOT_KEY];
      }
    };

    runtime[BOOT_KEY] = app;
    return app;
  }

  return {
    classifyGameState,
    AutoClickController,
    createControlPanel,
    boot
  };
});

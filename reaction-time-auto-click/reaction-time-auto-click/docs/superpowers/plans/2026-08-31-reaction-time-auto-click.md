# Reaction Time Auto-Click Userscript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Tampermonkey userscript that starts the Human Benchmark reaction-time test and automatically completes its five rounds.

**Architecture:** Keep the userscript self-contained and make its runtime factory testable in Node. A controller observes the `.game-container` DOM, classifies page states, dispatches one bubbling `mousedown` per actionable transition, and owns stop/completion behavior. A small panel only binds controls and displays status.

**Tech Stack:** Plain JavaScript userscript, Tampermonkey metadata, Node.js built-in `node:test`, and JSDOM for deterministic DOM tests.

**Spec:** `docs/superpowers/specs/2026-08-31-reaction-time-auto-click-design.md`

## Global Constraints

- Match only `https://humanbenchmark.me/*/tests/reactiontime*`.
- Use DOM state and a bubbling `mousedown` event; do not use screen capture, pixel sampling, coordinate clicks, network requests, or native mouse drivers.
- Start only after the user presses the userscript panel's Start control.
- Complete exactly five reaction rounds, then disconnect the observer and report completion.
- Stop on the panel Stop control or the `Esc` key.
- Keep page selectors in one configuration object.
- Do not submit scores or interact with leaderboard controls.
- The workspace is not a Git repository, so implementation checkpoints use `git status` only and do not initialize or commit a repository.

---

## File Structure

- Create `reaction-time-auto-click.user.js`: the copyable Tampermonkey file, including metadata, state classifier, controller, panel, and the CommonJS test hook.
- Create `tests/reaction-time-auto-click.test.js`: deterministic controller and panel tests using a JSDOM fixture.
- Create `package.json`: the Node test command and the JSDOM development dependency.
- Create `README.md`: installation, usage, stop behavior, and current page-selector limitation.
- Existing `docs/superpowers/specs/2026-08-31-reaction-time-auto-click-design.md`: the approved design; do not change unless implementation reveals a genuine contract mismatch.

## Public Testable Interfaces

The userscript file must export a factory only when loaded by Node; Tampermonkey must still auto-boot in the browser:

```js
const createRuntimeApi = require('../reaction-time-auto-click.user.js');
const api = createRuntimeApi(dom.window);
const controller = new api.AutoClickController(dom.window, options);
```

The factory returns:

- `classifyGameState(root, selectors) -> GameState`
- `AutoClickController`
- `createControlPanel(document, handlers) -> { element, setStatus, destroy }`
- `boot(env) -> { controller, panel, destroy }`

`GameState` is one of `initial`, `waiting`, `ready`, `round-result`,
`too-early`, `final-result`, or `unknown`. The controller exposes
`start()`, `stop(message)`, `scan()`, `snapshot()`, and `isRunning()`.
`snapshot()` returns `{ status, message, roundsCompleted, lastHandledState }`.

---

### Task 1: Set Up the Failing Test Harness

**Files:**
- Create: `package.json`
- Create: `tests/reaction-time-auto-click.test.js`

**Interfaces:**
- Consumes: the factory and interfaces defined above, which are intentionally absent at the start of this task.
- Produces: failing tests that specify state classification, one-shot ready handling, round progression, five-round completion, stop behavior, retry failure, and keyboard stop behavior.

- [ ] **Step 1: Create the test package definition**

Create `package.json` with this exact test command and dependency:

```json
{
  "name": "reaction-time-auto-click",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "test": "node --test tests"
  },
  "devDependencies": {
    "jsdom": "^26.1.0"
  }
}
```

- [ ] **Step 2: Install the test dependency**

Run:

```powershell
npm install
```

Expected: npm creates `node_modules` and `package-lock.json` without modifying any production file.

- [ ] **Step 3: Write the failing state-classification test**

Use `node:test`, `node:assert/strict`, and `jsdom`. The first test must assert the complete page contract:

```js
test('classifies the reaction-time DOM states', () => {
  const { window, root } = fixture();
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
});
```

The `fixture()` helper must create a JSDOM document containing a `.game-container` root with no special state class, and return both `window` and `root`.

- [ ] **Step 4: Write the failing controller behavior tests**

Add tests with these exact behavioral assertions:

```js
test('dispatches one mousedown for one ready state', () => {
  const { window, root } = fixture();
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
});

test('advances from a round result into the next waiting round', () => {
  const { window, root } = fixture();
  const api = createRuntimeApi(window);
  const controller = new api.AutoClickController(window);
  let clicks = 0;
  root.addEventListener('mousedown', () => {
    clicks += 1;
    if (clicks === 1) {
      root.className = 'game-container state-wait';
      root.innerHTML = '<div id="game-content"></div>';
    }
  });

  controller.start();
  assert.equal(clicks, 1);
  controller.scan();
  root.className = 'game-container state-ready';
  root.innerHTML = '<div id="game-content"></div>';
  controller.scan();
  root.className = 'game-container';
  root.innerHTML = '<div class="round-counter"></div><div id="game-content"></div>';
  controller.scan();

  assert.equal(clicks, 3);
  assert.equal(controller.snapshot().roundsCompleted, 1);
});
```

The fixture's initial root state is deliberately classified as `initial`, so the first `start()` event is also tested as the automatic test start.

- [ ] **Step 5: Write the failing completion, stop, retry, and Esc tests**

Simulate each round by changing the root between `state-ready`, `round-result`, and `state-wait`, then assert five ready events and `status === 'completed'` after the fifth ready event. Count ready-state events separately from all controller events because each of the first four result states also receives one event to begin the next round. Add these separate assertions:

```js
assert.equal(readyClicks, 5); // exactly one event for each green state
assert.equal(clicks, 10); // one initial start, five ready events, four next-round starts
assert.equal(controller.snapshot().status, 'completed');
assert.equal(controller.isRunning(), false);
```

For stop, call `controller.stop('manual')`, change the root to `state-ready`, call `scan()`, and assert the event count does not change. For retry failure, inject a timer queue through `options.timers.setTimeout`, use `maxRootAttempts: 1`, run the queued callback, and assert `status === 'error'`. For Esc, call `api.boot(window)`, dispatch `new window.KeyboardEvent('keydown', { key: 'Escape' })`, and assert the returned controller is no longer running.

- [ ] **Step 6: Run the tests to verify they fail for the intended reason**

Run:

```powershell
npm test
```

Expected: FAIL because `reaction-time-auto-click.user.js` does not exist yet. If the tests fail earlier due to malformed test code or dependency errors, fix the harness and rerun until the missing implementation is the cause.

---

### Task 2: Implement the State Classifier and Auto-Click Controller

**Files:**
- Create: `reaction-time-auto-click.user.js`
- Test: `tests/reaction-time-auto-click.test.js`

**Interfaces:**
- Consumes: the JSDOM fixtures and assertions from Task 1.
- Produces: `createRuntimeApi`, `classifyGameState`, and `AutoClickController` with the exact signatures listed above.

- [ ] **Step 1: Add the userscript metadata and dual runtime wrapper**

Begin the file with metadata for Tampermonkey:

```js
// ==UserScript==
// @name         Human Benchmark Reaction Time Auto Click
// @namespace    local.reaction-auto-click
// @version      1.0.0
// @description  自动完成 Human Benchmark 反应时间测试的五轮点击
// @match        https://humanbenchmark.me/*/tests/reactiontime*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
```

Wrap the implementation so Node receives `createRuntimeApi`, while a browser with `window.document` calls `createRuntimeApi(window).boot()` automatically. Do not use `eval`, `@require`, or page network requests.

- [ ] **Step 2: Add the selector configuration and classifier**

Keep these selectors and constants in one frozen object:

```js
const SELECTORS = Object.freeze({
  gameRoot: '.game-container',
  ready: '.state-ready',
  waiting: '.state-wait',
  tooEarly: '.state-too-early',
  roundCounter: '.round-counter',
  gameContent: '#game-content'
});
```

Implement `classifyGameState(root, selectors = SELECTORS)` in priority order `ready`, `waiting`, `too-early`, `round-result`, `final-result`, `initial`. Return `unknown` for a null or detached root. `round-result` requires `.round-counter`; `final-result` requires `#game-content` without the round counter; an otherwise valid game root with neither is `initial`.

- [ ] **Step 3: Add controller lifecycle and bounded root lookup**

Implement `new AutoClickController(env, options = {})` with defaults `targetRounds: 5`, `retryIntervalMs: 250`, and `maxRootAttempts: 20`. Accept injected `timers` and `onStatus` in `options` so tests do not need real time. `start()` must reset the round count, set status to `searching`, retry `env.document.querySelector(SELECTORS.gameRoot)` for the bounded number of attempts, and attach the observer once the root is found. `stop(message = '已停止')` must clear the retry timer, cancel a pending animation frame, disconnect the observer, set status to `idle`, and invalidate the current lifecycle token.

- [ ] **Step 4: Add the observer and one-shot state guard**

Observe the game root's `class` attribute and subtree child-list changes. Coalesce mutation bursts through one `requestAnimationFrame` callback. `scan()` must ignore a repeated `lastHandledState`; update the guard before dispatching an event. Handle state transitions as follows:

```text
initial       -> dispatch mousedown once to start
waiting       -> record the state and wait
ready         -> dispatch mousedown once and increment roundsCompleted
round-result  -> dispatch mousedown once to start the next round
too-early     -> stop with an error status
final-result  -> complete if five rounds are counted, otherwise stop with an error
unknown       -> stop with an error status
```

When the fifth `ready` event is dispatched, disconnect immediately after dispatching and report `completed`. Use `new env.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: env })` and `root.dispatchEvent(event)` so React's root `onMouseDown` handler receives the event.

- [ ] **Step 5: Run the controller tests to verify they pass**

Run:

```powershell
npm test
```

Expected: PASS for classifier, one-shot ready handling, round progression, five-round completion, stop, retry failure, and no post-stop events. Do not change the assertions to match an implementation detail.

---

### Task 3: Implement the Control Panel, Boot Function, and Keyboard Stop

**Files:**
- Modify: `reaction-time-auto-click.user.js`
- Modify: `tests/reaction-time-auto-click.test.js`

**Interfaces:**
- Consumes: `AutoClickController` from Task 2 and its `onStatus(snapshot)` callback.
- Produces: `createControlPanel(document, handlers)` and `boot(env)` with the exact return shapes listed above.

- [ ] **Step 1: Add the panel markup and isolated styles**

Create a fixed panel with id `reaction-auto-click-panel`, a status element with `data-role="status"`, and buttons with `data-action="start"` and `data-action="stop"`. Use a shadow root when available, and otherwise scope styles under the panel id. Do not insert duplicate panels if `boot()` is called twice.

- [ ] **Step 2: Bind panel actions and status rendering**

`createControlPanel` must call `handlers.onStart` and `handlers.onStop` from the matching button events, update the status text from each controller snapshot, and return `destroy()` that removes the panel and all listeners. The panel's visible status must include the current round count while running or completed.

- [ ] **Step 3: Bind and clean up the Esc listener**

`boot(env)` must create the controller and panel, register one `keydown` listener on `env`, and call `controller.stop('已停止')` only when `event.key === 'Escape'` and the controller is running. `destroy()` must remove the key listener, destroy the panel, and stop the controller.

- [ ] **Step 4: Add panel lifecycle tests**

Test that `boot()` creates one panel, clicking Start starts the controller, clicking Stop prevents later ready events, Esc stops it, and `destroy()` removes the panel. Call `boot()` twice and assert only one element with id `reaction-auto-click-panel` exists.

- [ ] **Step 5: Run all tests**

Run:

```powershell
npm test
```

Expected: PASS with no unhandled JSDOM errors or duplicate-listener warnings.

---

### Task 4: Add User Instructions and Perform Final Verification

**Files:**
- Create: `README.md`
- Modify: `reaction-time-auto-click.user.js` only if final verification finds a concrete mismatch with the approved spec.

**Interfaces:**
- Consumes: the completed userscript and test command from Tasks 2 and 3.
- Produces: concise installation instructions and evidence that the file is route-scoped and testable.

- [ ] **Step 1: Write the installation instructions**

Document these exact user steps in `README.md`: install Tampermonkey, create a new userscript, paste `reaction-time-auto-click.user.js`, save it, open the provided reaction-time URL, press the panel's Start button, and use Stop or Esc to interrupt. State that the script completes five rounds and that synthetic events can make scores invalid or non-human.

- [ ] **Step 2: Run the automated verification**

Run:

```powershell
npm test
node --check reaction-time-auto-click.user.js
```

Expected: all tests pass and `node --check` exits successfully.

- [ ] **Step 3: Run static route and selector checks**

Run:

```powershell
rg -n "@match|game-container|state-ready|round-counter|mousedown|Escape|targetRounds" reaction-time-auto-click.user.js README.md
```

Expected: the metadata contains only the reaction-time route, the configured selectors are present once in the implementation, and the stop/completion behavior is visible in the source and instructions.

- [ ] **Step 4: Perform the manual browser check**

Install the script in Tampermonkey and open `https://humanbenchmark.me/zh/tests/reactiontime`. Confirm the panel appears, Start begins the test, each green state advances immediately, the next round begins after each result, the final result appears after five rounds, and Esc stops the controller. Confirm that refreshing the page creates only one panel.

- [ ] **Step 5: Verify the workspace state**

Run:

```powershell
git status --short --branch
```

Expected: because this workspace is not a Git repository, the command reports that fact; no repository is initialized and no unrelated files are touched.

---

## Plan Self-Review

- Spec coverage: the page contract is implemented in Task 2; the state flow and five-round guard are covered by Tasks 1 and 2; controls and error handling are covered by Tasks 1 and 3; installation and manual verification are covered by Task 4.
- Placeholder scan: no `TBD`, `TODO`, `FIXME`, or unspecified implementation step is used in the plan.
- Interface consistency: `createRuntimeApi`, `classifyGameState`, `AutoClickController`, `createControlPanel`, `boot`, and `snapshot()` use the same names and return shapes in every task.
- Scope: one userscript, one test harness, and one instruction file; no leaderboard, network, screen-capture, or native-input subsystem is introduced.

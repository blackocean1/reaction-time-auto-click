# Reaction Time Desktop EXE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows EXE launcher that uses Node.js and Playwright to open the installed Microsoft Edge, run the existing reaction-time userscript, and leave the five-round result visible.

**Architecture:** Keep `reaction-time-auto-click.user.js` as the single page-state implementation. `desktop-runner.js` launches Edge with `playwright-core`, injects that userscript as content, clicks its Start control through the open shadow root, and waits for the completed status. `build-exe.js` uses Node 24 SEA and `postject` to embed the runner, userscript, and Playwright runtime files in a single Windows executable.

**Tech Stack:** Node.js, `playwright-core`, Microsoft Edge, Node.js SEA, `postject`, Node.js built-in `node:test`, and the existing JSDOM tests.

**Spec:** `docs/superpowers/specs/2026-08-31-reaction-time-exe-design.md`

## Global Constraints

- The executable requires Microsoft Edge to be installed and does not bundle Chromium.
- The default run is visible and keeps the result window open; `--headless` exits after completion.
- Visible mode starts Edge maximized with a resizable, window-sized page viewport.
- `--check` validates Edge and the userscript asset without opening a browser.
- Reuse `reaction-time-auto-click.user.js`; do not duplicate its state machine in the desktop runner.
- Use `page.addScriptTag({ content })` so the userscript works from the normal file extracted by the SEA entry point.
- Do not reuse the user's Edge profile or cookies, intercept network requests, submit leaderboard scores, or use screen coordinates.
- Build with the local Node 24 SEA runtime so the output does not depend on a separate Node.js installation.
- The workspace is not a Git repository; verification replaces commit or branch integration steps and must not initialize Git.

---

## File Structure

- Modify `package.json`: add Playwright runtime dependency, `postject`, and test/build scripts.
- Modify `package-lock.json`: record the installed dependencies.
- Create `desktop-runner.js`: Edge discovery, CLI parsing, Playwright lifecycle, userscript injection, and testable helper exports.
- Create `sea-entry.js`: extract embedded runtime assets and dispatch to the desktop runner.
- Create `build-exe.js`: create the SEA blob, inject it into Node, and produce the EXE.
- Create `tests/desktop-runner.test.js`: unit tests for CLI parsing, Edge resolution, asset lookup, and check-mode validation.
- Modify `README.md`: document both Tampermonkey and EXE usage plus the build command.
- Generate `dist/reaction-time-auto-click.exe`: the final local build artifact; do not hand-edit it.

## Testable Interfaces

`desktop-runner.js` must export these CommonJS helpers without launching a browser during `require`:

```js
parseOptions(argv) -> { check: boolean, headless: boolean }
getEdgeCandidates(env) -> string[]
findEdgeExecutable(env, exists) -> string | null
resolveUserScriptPath(baseDir, exists) -> string | null
checkEnvironment(env, exists, baseDir) -> { edgePath, scriptPath }
run(options) -> Promise<void>
main(argv) -> Promise<number>
```

The executable entry point calls `main(process.argv.slice(2))`, sets
`process.exitCode` on failure, and prints one actionable error instead of a
stack trace for expected missing-Edge or missing-asset cases.

---

### Task 1: Extend the Test Harness with Desktop Runner Expectations

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` through npm
- Create: `tests/desktop-runner.test.js`

**Interfaces:**
- Consumes: the helper signatures listed above, which are intentionally absent at the start of this task.
- Produces: failing tests for the desktop entry point and a package script that runs both test files explicitly on Windows.

- [ ] **Step 1: Add the Playwright and SEA injection dependencies**

Run:

```powershell
npm install playwright-core
npm install --save-dev postject
```

Expected: `package.json` lists `playwright-core` under `dependencies`, `postject` under `devDependencies`, and npm updates `package-lock.json` without changing the existing JSDOM dependency.

- [ ] **Step 2: Update the test and build scripts**

Set these scripts in `package.json`:

```json
{
  "test": "node --test tests/reaction-time-auto-click.test.js tests/desktop-runner.test.js",
  "check": "node --check reaction-time-auto-click.user.js && node --check desktop-runner.js && node --check build-exe.js",
  "build:exe": "npm test && npm run check && node build-exe.js"
}
```

Do not add the `build:exe` script until `build-exe.js` exists if npm is invoked before Task 3; the final package definition must contain all three commands.

- [ ] **Step 3: Write failing helper tests**

Create `tests/desktop-runner.test.js` with `node:test` and `node:assert/strict`. Cover these concrete cases:

```js
test('parses check and headless flags', () => {
  assert.deepEqual(parseOptions(['--check', '--headless']), {
    check: true,
    headless: true
  });
  assert.deepEqual(parseOptions([]), { check: false, headless: false });
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
```

Import the exported helpers from `../desktop-runner.js` at the top of the test. Keep the file free of browser launches and real filesystem dependencies by injecting `env` and `exists` as shown.

- [ ] **Step 4: Run the tests to verify the new tests fail correctly**

Run:

```powershell
npm test
```

Expected: the original 8 userscript tests still pass, while the desktop test file fails because `desktop-runner.js` does not exist. The failure must be a missing implementation module, not a malformed fixture.

---

### Task 2: Implement the Playwright Edge Runner

**Files:**
- Create: `desktop-runner.js`
- Test: `tests/desktop-runner.test.js`

**Interfaces:**
- Consumes: the red helper tests from Task 1 and `reaction-time-auto-click.user.js`.
- Produces: the exported helper functions and `run(options)`/`main(argv)` described above.

- [ ] **Step 1: Add CLI parsing and Edge candidate resolution**

Implement `parseOptions(argv)` with only `--check` and `--headless` recognized. Implement `getEdgeCandidates(env)` in this exact order:

```text
${PROGRAMFILES}\Microsoft\Edge\Application\msedge.exe
${PROGRAMFILES(X86)}\Microsoft\Edge\Application\msedge.exe
${LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe
```

Skip empty environment roots. Implement `findEdgeExecutable(env = process.env, exists = fs.existsSync)` to return the first existing candidate or `null`.

- [ ] **Step 2: Add packaged userscript resolution and check mode**

Implement `resolveUserScriptPath(baseDir = __dirname, exists = fs.existsSync)` using `path.join(baseDir, 'reaction-time-auto-click.user.js')`. Implement `checkEnvironment` to throw an `Error` containing `Microsoft Edge` when Edge is missing and an `Error` containing `reaction-time-auto-click.user.js` when the asset is missing; on success return `{ edgePath, scriptPath }`.

- [ ] **Step 3: Add the Playwright browser flow**

Require `chromium` from `playwright-core`. Implement `run({ headless = false, executablePath, url = 'https://humanbenchmark.me/zh/tests/reactiontime', scriptPath } = {})` as:

```js
const browser = await chromium.launch({
  executablePath: executablePath || findEdgeExecutable(),
  headless
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const script = fs.readFileSync(scriptPath || resolveUserScriptPath(), 'utf8');
  await page.addScriptTag({ content: script });
  await page.waitForFunction(
    () => document.querySelector('#reaction-auto-click-panel')?.shadowRoot
      ?.querySelector('[data-action="start"]'),
    null,
    { timeout: 15000 }
  );
  await page.evaluate(() => {
    document.querySelector('#reaction-auto-click-panel')
      .shadowRoot.querySelector('[data-action="start"]').click();
  });
  await page.waitForFunction(
    () => document.querySelector('#reaction-auto-click-panel')?.shadowRoot
      ?.querySelector('[data-role="status"]')?.textContent.includes('已完成'),
    null,
    { timeout: 30000 }
  );
  if (!headless) await page.waitForEvent('close');
} finally {
  await browser.close();
}
```

Use a friendly error when Edge or the userscript asset is missing. Navigation, panel, and completion timeouts may include the original message but must close the browser through `finally`.

- [ ] **Step 4: Add the executable entry point guard**

Export the helpers and guard the process entry point:

```js
if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
```

`main(['--check'])` must call `checkEnvironment`, print the resolved Edge path and asset path, and return `0`. Normal mode must call `run`; `--headless` must pass `headless: true`.

- [ ] **Step 5: Run the desktop and existing tests**

Run:

```powershell
npm test
```

Expected: all 8 existing userscript tests plus the desktop helper tests pass. No test may open a browser.

---

### Task 3: Implement EXE Packaging

**Files:**
- Create: `build-exe.js`
- Modify: `package.json`
- Test: `tests/desktop-runner.test.js` only if a packaging helper is exposed for testing

**Interfaces:**
- Consumes: `desktop-runner.js`, `reaction-time-auto-click.user.js`, `playwright-core`, and the local Node 24 executable.
- Produces: `dist/reaction-time-auto-click.exe` and a repeatable `npm run build:exe` command.

- [ ] **Step 1: Add the SEA entry point**

Create `sea-entry.js`. It should extract all `runtime/` assets exposed by
Node's SEA API to a temporary directory, load the extracted
`desktop-runner.js` with `createRequire`, forward the command-line arguments,
and remove the temporary directory after the runner exits.

- [ ] **Step 2: Write the build wrapper**

Create `build-exe.js` that collects the runner, userscript, and complete
`node_modules/playwright-core` tree as SEA assets. Generate a SEA preparation
blob with the local Node 24 executable, copy that executable to
`dist/reaction-time-auto-click.exe`, and inject the blob with `postject` using
the Node SEA sentinel fuse. Keep the temporary blob/config files outside the
workspace and remove them after the build.

- [ ] **Step 3: Run the package syntax and check commands**

Run:

```powershell
npm run check
node desktop-runner.js --check
```

Expected: all three syntax checks pass; check mode reports the installed Edge path and the userscript path without opening a browser.

- [ ] **Step 4: Build the executable**

Run:

```powershell
npm run build:exe
```

Expected: the existing tests pass before packaging, `dist/reaction-time-auto-click.exe` is created, and the command exits with code `0`. Do not delete or overwrite any file outside `dist`.

---

### Task 4: Add Desktop Usage Instructions and Perform Runtime Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the built executable, `--check` mode, and existing Tampermonkey instructions.
- Produces: clear user instructions for both launch modes and verification evidence from a real Edge smoke run.

- [ ] **Step 1: Add EXE installation and usage instructions**

Add a section explaining that `dist/reaction-time-auto-click.exe` requires Microsoft Edge but not Node.js or Tampermonkey. Tell the user to double-click it, wait for Edge to open the page, and close the browser window after the final result is shown. Document `--check` for diagnostics and state that `--headless` is for verification only.

- [ ] **Step 2: Run the full automated verification**

Run:

```powershell
npm test
npm run check
node desktop-runner.js --check
```

Expected: 8 userscript tests plus all desktop tests pass, every syntax check exits `0`, and check mode finds the installed Edge and userscript asset.

- [ ] **Step 3: Run a real Playwright headless smoke test**

Run:

```powershell
node desktop-runner.js --headless
```

Expected: Playwright launches the installed Edge in headless mode, opens the live URL, injects the userscript, completes all five rounds, prints completion, and exits with code `0`.

- [ ] **Step 4: Verify the generated EXE exists**

Run:

```powershell
Get-Item 'dist\reaction-time-auto-click.exe' | Select-Object FullName,Length,LastWriteTime
```

Expected: the file exists with a non-zero size. The final visible-mode check is a manual double-click because the default run intentionally keeps the browser open until the user closes it.

- [ ] **Step 5: Verify workspace state**

Run:

```powershell
git status --short --branch
```

Expected: Git reports that `E:\奇思妙想` is not a repository; no branch or commit operation is attempted.

---

## Plan Self-Review

- Spec coverage: Edge-only runtime and limitations are covered by Tasks 2 and 4; the runtime flow and userscript reuse are covered by Task 2; packaged asset handling is covered by Task 3; verification requirements are covered by Task 4.
- Placeholder scan: no `TBD`, `TODO`, `FIXME`, or unspecified implementation step is present.
- Interface consistency: `parseOptions`, `getEdgeCandidates`, `findEdgeExecutable`, `resolveUserScriptPath`, `checkEnvironment`, `run`, and `main` retain the same names and return shapes in every task.
- Scope: the change adds one desktop launcher and one build wrapper while preserving the existing userscript; it does not add a second page state machine or a bundled browser.

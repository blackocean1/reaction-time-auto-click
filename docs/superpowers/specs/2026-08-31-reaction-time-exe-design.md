# Reaction Time Desktop EXE Design

## Goal

Provide a Windows executable that the user can launch by double-clicking.
The executable starts the Microsoft Edge installation already present on the
computer, opens the Human Benchmark reaction-time page, injects the existing
reaction-time userscript, starts the test, and leaves the final result visible
after five rounds.

The executable is a convenience launcher for local experimentation. Synthetic
events do not represent human reaction time and may be rejected by the site.
It must not submit scores to a leaderboard.

## Scope

Included:

- A Node.js desktop runner using `playwright-core`.
- Automatic discovery of the standard Windows Edge installation paths.
- A visible, non-headless Edge window by default.
- The visible Edge window starts maximized and its page viewport follows window resizing.
- Injection and reuse of `reaction-time-auto-click.user.js`.
- Automatic activation of the userscript panel and five-round completion.
- A `--check` command that validates the local setup without opening a browser.
- A `--headless` command for automated smoke verification; it closes after the
  test completes.
- A build command that packages the runner and injected script as
  `dist/reaction-time-auto-click.exe` using Node.js SEA.

Excluded:

- Bundling Chromium or downloading a browser at runtime.
- Reusing the user's existing Edge profile or cookies.
- Native screen capture, coordinate clicks, or network interception.
- Leaderboard submission or score manipulation.
- A background service or system-wide global hotkey.

## Runtime Flow

```text
double-click exe
    -> locate Edge executable
    -> launch visible Edge with a temporary Playwright context
    -> navigate to the reaction-time URL
    -> inject reaction-time-auto-click.user.js
    -> click the userscript Start button
    -> wait until the panel reports five completed rounds
    -> keep the result window open
    -> user closes the window
    -> close Playwright and exit
```

The desktop runner does not duplicate the page state machine. It injects the
already-tested userscript so the browser and Tampermonkey paths use the same
selectors, event handling, stop behavior, and five-round guard.

## Components

### `desktop-runner.js`

Responsibilities:

- Parse `--check` and `--headless` flags.
- Resolve Edge from `PROGRAMFILES`, `PROGRAMFILES(X86)`, and `LOCALAPPDATA`.
- Read the userscript from a normal file. The SEA entry point extracts the
  embedded runtime files to a temporary directory before loading the runner.
- Launch Edge with `chromium.launch({ executablePath, headless })`.
- Navigate, inject the userscript, click its open-shadow-root Start button,
  and wait for the completed status.
- Print actionable errors and close the browser in a `finally` block.
- Export small helpers for unit tests without launching a browser on `require`.

The default run keeps the page open after completion. Headless mode exits
after completion so CI or local smoke checks do not hang.

### `build-exe.js`

Creates `dist` if needed, generates a Node SEA preparation blob, copies the
local Node 24 executable, and injects the blob with `postject`. The blob
contains the runner, userscript, and complete `playwright-core` runtime. The
result is a standalone Windows EXE that still uses the installed Edge binary.

### Package configuration

`package.json` will add `playwright-core` as a runtime dependency and
`postject` as a development dependency. The existing JSDOM test setup remains
unchanged. The build command runs the test suite and JavaScript syntax checks
before packaging.

## Edge Resolution

Candidate paths are checked in this order:

1. `PROGRAMFILES\Microsoft\Edge\Application\msedge.exe`
2. `PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe`
3. `LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe`

The resolver accepts an injected `exists` function for tests. If no candidate
exists, the runner exits with a message telling the user to install Edge or
use the browser-script version.

## Browser Interaction Contract

The runner waits for `#reaction-auto-click-panel` and its open shadow root,
then clicks `[data-action="start"]`. It waits for the panel status element to
contain `已完成`. Missing panel, missing controls, navigation failure, and
timeout are treated as errors and close the browser cleanly.

The runner uses `page.addScriptTag({ content })` rather than a filesystem path
inside the browser. This allows the same source to be read from the normal
file extracted by the SEA entry point.

## Verification

- Existing JSDOM tests continue to cover the injected state machine.
- New unit tests cover Edge path resolution, CLI option parsing, packaged
  userscript path resolution, and command error handling without opening Edge.
- `node --check desktop-runner.js` and `node --check build-exe.js` validate
  syntax.
- `node desktop-runner.js --check` validates Edge and the userscript asset.
- `node desktop-runner.js --headless` performs a real Playwright smoke run
  against the current page and exits after five rounds.
- `npm run build:exe` produces the requested executable; its file size and
  existence are checked after the command finishes.

## Limitations

The executable requires Microsoft Edge to be installed. It launches a fresh
temporary browser context, so it does not share the user's existing browser
profile or extensions. The runner depends on the current page DOM contract
documented by the userscript; a site markup change can require updating the
injected script.

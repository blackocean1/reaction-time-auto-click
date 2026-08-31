# Reaction Time Auto-Click Userscript Design

## Goal

Provide a Tampermonkey userscript for the reaction-time page at
`https://humanbenchmark.me/*/tests/reactiontime`.

After the user presses the script's Start control, the script starts the
test, automatically clicks when the game enters its green-ready state, and
starts the next round after each result until all five rounds are complete.

The script is intended for local experimentation. Automatically generated
scores may not represent a human reaction time and may be rejected by the
site's rules or anti-cheat checks.

## Scope

Included:

- One standalone Tampermonkey userscript.
- A small fixed control panel with Start and Stop actions.
- `Esc` as a keyboard stop shortcut.
- Automatic progression through five rounds.
- A status label for idle, running, completed, and error states.
- A guard that prevents repeated events for the same game state.

Excluded:

- Screen capture or pixel sampling.
- Browser extensions or native mouse drivers.
- Submission to a leaderboard.
- Automation for other tests on the site.

## Page Contract

The current reaction-time page exposes the following observable behavior:

- The clickable game root uses the `.game-container` class.
- The green state adds the `.state-ready` class.
- The waiting state adds `.state-wait`.
- The early-click state adds `.state-too-early`.
- A completed round renders `.round-counter` while the game is in the
  `round-result` state.
- The game's React handler responds to a bubbling `mousedown` event on the
  game root. This event is used instead of a coordinate-dependent click.

The selectors are kept in one configuration section so a later page markup
change can be updated in one place.

## Architecture

The userscript has four small responsibilities:

1. `findGameRoot` locates the game root, retrying briefly while the page is
   still rendering.
2. `classifyGameState` maps the current DOM to `initial`, `waiting`,
   `ready`, `round-result`, `too-early`, `final-result`, or `unknown`.
3. `AutoClickController` owns the enabled flag, observer, state guard, round
   count, and event dispatching.
4. `createControlPanel` renders controls and reports controller status.

The controller uses a `MutationObserver` on the game root, with a single
`requestAnimationFrame` scan scheduled for bursts of DOM mutations. This
avoids polling continuously while still reacting quickly to React state
updates.

## State Flow

```text
idle --Start--> initial/waiting
waiting --page becomes ready--> ready --mousedown--> round-result
round-result --mousedown--> waiting
waiting --page becomes ready--> ready --mousedown--> round-result
... repeat until round 5 ...
round 5 result --> completed
any state --Stop or Esc--> idle
unknown/error --> error, observer stopped
```

The controller records the last handled state and only handles each
transition once. It dispatches at most one `mousedown` while `ready` is
visible, then waits for the DOM to leave that state before it can act again.
For `round-result`, it dispatches one `mousedown` to begin the next round.
After the fifth result it stops observing and reports completion.

## Error Handling

- If the game root is missing, the panel reports that the test area is not
  available and retries for a bounded period.
- If the page enters a state not covered by the contract, the controller
  pauses and reports that the page structure may have changed.
- Stop clears the observer, pending animation-frame work, and retry timer.
- The script does not override native page functions or send network
  requests.

## Verification

The implementation will include deterministic tests against a small DOM
fixture. The tests will verify:

- The ready state causes exactly one `mousedown` event.
- The same ready state does not cause duplicate events.
- A round result starts the next round.
- The fifth round stops the controller.
- Stop and `Esc` prevent further events.
- Missing or unknown DOM state reports an error.

A manual browser check will also confirm the userscript loads only on the
reaction-time route and works with the current page markup.

## Limitations

This approach depends on the page's current DOM class names and event model.
If the site changes its markup or stops accepting synthetic mouse events, the
script must be updated. It also does not attempt to bypass browser security,
site protections, or leaderboard validation.

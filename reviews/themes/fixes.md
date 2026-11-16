# Fix Report

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: current task. Findings CR-1 and CR-2 come from `reviews/themes/review.md`. TW-1, TW-2 and TW-3 come from `reviews/themes/tests.md`.

## Fixed findings

### CR-2, TW-1, TW-2, TW-3: ThemeService ordering under overlapping requests

Files changed:
- `packages/renderer/src/app/theme/theme.service.ts`
- `packages/renderer/src/app/theme/theme.service.spec.ts` (one regression test added for CR-2; Prettier formatting)

Problem:
- `change()` took a snapshot of both style and mode, and a failed save restored the whole snapshot. That snapshot could hold another call's unsaved value (CR-2), and the restore could also overwrite the other key after it was saved (TW-3).
- Every `app.settings.set` answer was applied unconditionally. An older answer that arrived last could override a newer choice (TW-2).
- The initial `app.settings.get` answer was also applied unconditionally. A late answer could undo a choice the user made in the meantime (TW-1).

Fix:
- The service now tracks two counters per key: a generation, raised on each local choice, and an in-flight count of saves still waiting for an answer. It also tracks `confirmed`, the last value per key known to be stored in main.
- An answer from main (`get` or `set`) is applied to a key only if two things hold:
    - no newer local choice was made for that key since the request was sent;
    - no other save of that key is still pending, unless this answer belongs to the latest save of that key.
- A failed save reverts only the keys that call changed. It reverts a key only while that call is still the latest choice for it and the key still shows the value the call set. The key goes back to `confirmed`, not to a snapshot.
- `app.settings.changed` broadcasts are still applied unconditionally and update `confirmed`.
- The public API (`init`, `setStyle`, `setMode`, `style`, `mode`, `effective`) is unchanged.
- New regression test: `two overlapping failed saves end on the stored values, not an unsaved one`. It covers the exact CR-2 sequence and fails against the old snapshot logic.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`: Pass. 2 files, 44 tests; the 3 TW tests and the new CR-2 test all pass.

### CR-1: Evidence screenshots taken during CSS transitions

Files changed:
- `apps/desktop/test/theme.electron.spec.ts`
- `reviews/themes/screenshots/explorer-business-dark.png`, `explorer-tron-light.png`, `explorer-tron-dark.png` (regenerated). `explorer-business-light.png` was copied as well and came out byte-identical, since nothing was transitioning when it was taken.

Problem:
Screenshots were taken right after the theme attributes changed, while the explorer controls were still in their 0.15 s color transitions. This left the buttons grey in the screenshots.

Fix:
Before each screenshot, the test now waits for `Promise.all(document.getAnimations().map((a) => a.finished))` inside the page. It also passes `animations: 'disabled'` to `page.screenshot`. The four PNGs were copied from `apps/desktop/test-results/screenshots/` into `reviews/themes/screenshots/` and inspected visually. Every control shows its final theme colors; for example, the Strict, Context and "Go to edit mode" buttons in Tron light are white with readable text.

Validation:
- `npm run test:electron --prefix /home/eric/work/mongo-db-client-agents/agent-1`: `theme.electron.spec.ts` passes. Overall: 26 tests, 22 passed, 4 failed. All 4 failures are the known ones that also fail on main: 3 in `app.electron.spec.ts` (thicket://app with CSP, window.open/navigation, will-frame-navigate) and 1 in `dev.electron.spec.ts` (dev server URL). They expect a URL without `#/` and are not related to this task.

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`: Pass (44/44)
- `npm run test:electron --prefix /home/eric/work/mongo-db-client-agents/agent-1`: `theme.electron.spec.ts` Pass. The 4 failures are the known ones outside this task, listed above.

Full test suite:
- `npm run check` (repo root): Pass. ESLint, Prettier and typecheck all pass. Root vitest: 33 files, 2099 tests passed. Renderer: 29 files, 485 tests passed.

Lint/type-check/build:
- Included in `npm run check`: Pass.

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Fix Report (round 2)

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: current task. Finding CR-3 from `reviews/themes/review.md` (second review), which is the same issue as TW-4 in `reviews/themes/tests.md`.

## Fixed findings

### CR-3 / TW-4: A skipped answer from main left `confirmed` stale, so a later failed save reverted to a value main does not store

Files changed:
- `packages/renderer/src/app/theme/theme.service.ts`
- `packages/renderer/src/app/theme/theme.service.spec.ts` (two regression tests added; the TW-4 test is unchanged)

Problem:
`takeAnswer` dropped a skipped key completely, both for display and for `confirmed`. Example: Tron is stored, the startup `app.settings.get` is still pending, the user picks Business, and the save fails. The window kept Business because the late `get` answer (Tron) was discarded. The same gap existed for an earlier `set` that succeeded after a later save of the same key had failed.

Fix:
- Every answer from main is now recorded in `confirmed`, also when it is not shown. Requests are numbered in sending order, and a key's `confirmed` value is only replaced by an answer to a later request. This way a stale `get` that arrives after a newer `set` answer does not overwrite it. Broadcasts behave as before.
- The display gate is the same as before: a key is shown if no newer local choice exists for it and no other save of it is pending, or if the answer belongs to the latest save of that key.
- New: per key, the service remembers whether the latest local choice failed. If an answer arrives after a newer choice and that choice failed, with no other save of the key still pending, the window shows the stored (`confirmed`) value again.
- The public API is unchanged.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`: Pass (51/51). This covers TW-4, the regression tests for TW-1..3 and CR-2, the broadcast tests, and two new regression tests: `an earlier save that succeeds after a later one failed ends on its stored value` (the set-answer variant in CR-3) and `a stale app.settings.get answer does not replace a newer stored value for a later revert` (guards the request ordering).

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`: Pass (51/51)

Full test suite:
- `npm run check` (repo root): Pass. ESLint and Prettier are clean and typecheck passes. Root vitest: 34 files, 2166 tests passed. Renderer: 29 files, 492 tests passed.

Lint/type-check/build:
- Included in `npm run check`: Pass.

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

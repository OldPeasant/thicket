# Fix Report

Date: 2026-11-17

Task: shell-ui - M4: mongosh console

Scope: current task; findings CR-1 to CR-5 of `reviews/shell-ui/review.md` (reviewed range 17f4bd0..f9c9726, fixes applied on top of 39c5d99 in the working tree, uncommitted)

## Fixed findings

### CR-1 — Open completion list is applied at a caret that moved since the request

Files changed:
- `packages/renderer/src/app/console/shell-console.ts`
- `packages/renderer/src/app/console/shell-console.html`
- `packages/renderer/src/app/console/shell-console.spec.ts`

Problem:
`choose()` applied the completion at the current `el.selectionStart`, so moving the caret (ArrowLeft, click) while the list was open turned `db.or` into `db.ordersr`.

Fix:
The input and caret a multi-entry list was requested for are stored with the list (`completionAt`). `choose()` applies at that stored code and cursor, and only closes the list if the input text differs. A new `onCaret` handler on the textarea's `keyup`, `click` and `select` closes the list as soon as the caret, the selection or the input no longer matches the stored one. `closeCompletions()` clears the stored position. New specs cover: caret moved by ArrowLeft (keyup) closes the list and Enter runs `db.or` unchanged; caret moved by a click closes it; caret moved without any event still applies at the requested caret (`db.orders`, not `db.ordersr`); a keyup that leaves the caret in place (Tab, ArrowDown) keeps the list open.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (85 tests)

### CR-2 — Regex literals with brackets or `//` keep Enter from running the input

Files changed:
- `packages/renderer/src/app/console/console-input.ts`
- `packages/renderer/src/app/console/console-input.spec.ts`

Problem:
`isInputComplete` did not recognise regex literals, so `/^\(/` left `(` open and `/\//` started a line comment.

Fix:
`isInputComplete` now tracks the last significant character and skips a regex literal when `/` follows an operator, opening bracket, `,`, `:`, `;` or the start of input. It uses the same heuristic as the backend `packages/backend/src/shell/split.ts` (`regexMayStart`, plus a `regexEnd` that honours escapes, `[...]` classes and flags; an unterminated literal ends at its line). Whitespace is now skipped explicitly so it does not count as the last character. Specs: `db.c.find({ name: /^\(/ })`, `db.c.find({ p: /\// })`, `/[/(]/i`, an unclosed bracket after a regex, divisions (`a / b / (c`, `(a) / 2 / (3)`), and a leading regex `/{/.test(s)`.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass

### CR-3 — "Open new session" ends up out of view after the backend loses the session

Files changed:
- `packages/renderer/src/app/console/shell-console.html`
- `packages/renderer/src/app/console/shell-console.css`
- `packages/renderer/src/app/console/shell-console.spec.ts`

Problem:
The failure notice with the only reopen button was rendered at the top of the scrolling transcript, so it scrolled out of view.

Fix:
The `shell-failed` notice (role="alert", with `shell-reopen`) now renders between the transcript and the input row, outside the scroll container, styled with the `--danger-text` / `--danger-bg` / `--danger-border` tokens. The "Starting mongosh…" note stays in the transcript. The unused `.note.error` selector was removed. The lost-session spec now asserts that the notice is not inside `shell-transcript`.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass
- `npm run test:e2e -- shell` — Pass

### CR-4 — Combobox/live-region ARIA details

Files changed:
- `packages/renderer/src/app/console/shell-console.ts`
- `packages/renderer/src/app/console/shell-console.html`
- `packages/renderer/src/app/console/shell-console.css`
- `packages/renderer/src/app/console/shell-console.spec.ts`

Problem:
`aria-controls` pointed to a listbox id that exists only while the list is open. `aria-live` on the whole transcript made screen readers read entire result grids.

Fix:
`aria-controls` is bound to `null` while the list is closed. `aria-live` was removed from the transcript. A visually hidden `role="status"` / `aria-live="polite"` element (`shell-announce`, local `.sr-only` class) announces a short summary when a run ends. The new exported `announce(run)` gives "Run stopped", "Run failed: <first error, cut to 200 chars>" or "Run finished[: <result type>]". New and extended specs check: no `aria-live` on the transcript, no `aria-controls` while closed but set while open, "Run finished: Cursor", "Run stopped", and the failure announcement on a lost session.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass

### CR-5 — Session race paths and Ctrl+C have no tests; e2e opens the shell from the database, not the connection

Files changed:
- `test/e2e/shell.e2e.ts`

Problem:
SPEC demo step 11 opens the console on the connection, but the e2e used the database item's "Open shell".

Fix:
`openShell` takes a `from: 'conn' | 'db'` source. The demo step 11 test opens the shell from the connection node's context menu (`menu-open-shell`). It waits for a prompt in the default database, then runs `use shell_e2e`, waits for the `shell_e2e>` prompt, and runs `db.orders.countDocuments()` (137). The read-only test keeps the database menu path, so both entries are exercised. The unit-spec part of this finding was already covered by the test-writer (`shell-console.spec.ts` "session lifecycle": late open after destroy, an overtaken open, an older failure after a newer success; "stop, clear and the transcript": Ctrl+C with and without a selection), so no specs were duplicated.

Validation:
- `npm run test:e2e -- shell` — Pass (2 passed: demo step 11 from the connection menu, read-only from the database menu)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (2 files, 85 tests)
- `npm run test:e2e -- shell` — Pass (2 tests, real backend and Mongo fixture)

Full test suite:
- `npm run check` — Pass (root vitest 3866 tests, renderer 2548 tests)

Lint/type-check/build:
- `npm run check` (eslint, prettier, tsc/ngc for every workspace) — Pass. `prettier --write` was applied once to `shell-console.ts` for formatting only.
- The e2e run built the renderer and the desktop app — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run directly above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

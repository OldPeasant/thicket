# Fix Report

Date: 2026-11-17

Task: shell-scripts (run a script file in the mongosh console)

Scope: current task; findings CR-1, CR-2 (reviews/shell-scripts/review.md) and TW-2 (reviews/shell-scripts/tests.md), as passed on by the parent worker. Base c1d702aa, reviewed HEAD 688d871a.

## Fixed findings

### CR-1 — A chosen script is silently not run when a run starts or the session ends while the file is read

Files changed:
- `packages/renderer/src/app/console/shell-console.ts`
- `packages/renderer/src/app/console/shell-console.spec.ts`

Problem:
After `readScriptFile` resolved, `runScript` returned without any message when the session was no longer open or another input had started running during the read.

Fix:
`runScript` still returns silently when the component was destroyed (`this.closed`). Otherwise it now sets `scriptProblem` (shown in the existing `role="alert"` element) to "<name> was not run: the session is not open" or "<name> was not run: the shell is busy". Added two unit tests that use a deferred `text()`: one starts a typed run during the read, the other ends the session (`NOT_FOUND` on the eval stream) during the read. The existing test "is disabled while something runs and sends no second run" now also checks the busy message. The existing test for a destroyed tab still checks that nothing is sent.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (3 files, 142 tests)

### CR-2 — Script runs keep the full script text in the transcript, which never displays it

Files changed:
- `packages/renderer/src/app/console/shell-console.ts`
- `packages/renderer/src/app/console/shell-console.spec.ts`

Problem:
`evaluate` stored the whole script text (up to 5 MB) in `Run.code` for script runs, even though the template shows only `run.script` (name and lines) for them.

Fix:
`evaluate` now stores `code: ''` for script runs. The text is still sent to `shell.eval` through the `code` parameter. The `Run.script` doc comment was updated to match. Nothing else reads `Run.code`: the only reader is `shell-console.html`, in the `@else` branch for non-script runs, and `Run` is not exported from `console/index.ts`. The unit test now expects `runs()[0].code` to be `''`. The test "runs the file text in the session with shell.eval" still checks that the full text is sent.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass

### TW-2 — "(5.0 MB; at most 5.0 MB)" for a file just over the limit

Files changed:
- `packages/renderer/src/app/console/scripts/script-file.ts`
- `packages/renderer/src/app/console/scripts/script-file.spec.ts`

Problem:
`formatSize` rounded to one decimal, so a file one byte over the 5 MB limit was reported as 5.0 MB with a limit of 5.0 MB.

Fix:
The message is now "<name> is too large to run: it is larger than 5 MB". The limit comes from `MAX_SCRIPT_BYTES`, so the value is exact. `formatSize`, now unused, was removed. This also removes its unreachable B and KB branches, which `tests.md` had listed as a coverage gap. The spec expectations for `MAX_SCRIPT_BYTES + 1` and for 12 MB were updated. No e2e test asserts this text (checked with grep).

Validation:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (3 files, 142 tests)
- `npx prettier --write` / `--check` on the 4 changed files — Pass (formatted)
- `npx eslint` on the 4 changed files — Pass (after renaming an unused parameter in the new test helper)

Full test suite:
- `npm run check` — Pass (root: 87 files, 4457 tests; renderer: 103 files, 3424 tests)

Lint/type-check/build:
- Part of `npm run check` — Pass

`.taskcheck`:
- Pass (`sh .taskcheck`, exit 0)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

---

# Round 2

Date: 2026-11-17

Task: shell-scripts (run a script file in the mongosh console)

Scope: current task; finding CR-3 (reviews/shell-scripts/review.md "Round 2"), as passed on by the parent worker. Reviewed HEAD b32e49cc.

## Fixed findings

### CR-3 — The byte order mark check uses an invisible literal character

Files changed:
- `packages/renderer/src/app/console/scripts/script-file.ts`
- `packages/renderer/src/app/console/scripts/script-file.spec.ts`

Problem:
`code.startsWith(...)` in `readScriptFile` held a raw U+FEFF character (bytes EF BB BF) between the quotes, so it read as `startsWith('')`. The spec used the same invisible literal in three test strings.

Fix:
Replaced the literal character with the JavaScript escape sequence for U+FEFF (backslash, `uFEFF`) in the production check (1 occurrence) and in the spec (3 occurrences: the BOM-drop test and the two BOM-only empty-file cases). Behavior is unchanged; both files are now ASCII-only.

Validation:
- `grep -cP '\x{FEFF}'` on both files — 0 matches; `od -c script-file.ts | grep '357 273 277'` — no match; Node scan for any non-ASCII character in both files — 0
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (3 files, 143 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` — Pass (3 files, 143 tests)
- `npx prettier --check` on the 2 changed files — Pass
- `npx eslint` on the 2 changed files — Pass

Full test suite:
- Not run (escape-only change in one string comparison and its spec; the parent worker runs `.taskcheck` before `done`)

Lint/type-check/build:
- prettier and eslint on the changed files — Pass; full type check not run (no type-relevant change)

`.taskcheck`:
- Not run (left to the parent worker)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

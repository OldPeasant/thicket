# Test Report

Date: 2026-11-17

Task: connection-ui (M1: Connection editor and manager), second pass on the fixed code

Scope: task base 9d2524478e7bf26f37e1ec73ebb4f721753be056 (supplied by the parent); after the parent's rebase the current merge base with `origin/main` is fda71f94e3a52a1b5d760a23a58fcacd7a959f64 and the task commits on `main` are c0c0d72, 3ce5528, 14881ea, 2ffe107, 5aa43a1 (the rebased b36d7dd, 123af50, a4388a3, 8ca68f6, dd51ff0) plus 26608b8 (fixes.md only). The supplied final code revision dd51ff076c1ef0f5450b108b46fe15f11edfc3bc and HEAD 26608b8991f29302729acd18f17332416c236467 have identical `packages/`, `test/` and `docs/` trees (`git diff dd51ff0 HEAD -- packages test docs` is empty; 5aa43a1 differs from dd51ff0 only in `tasks/`). Production paths in scope: `packages/renderer/src/app/connections/` (connection-form.model.ts, connection-editor.ts/html/css, connections-page.ts/html/css, index.ts), `src/shared-array-buffer-stub.ts`, `src/main.ts`, `sidebar/sidebar-tree.ts/html`, `layout/navigation.ts`, `app.routes.ts`, `app.config.ts`, `packages/core/package.json`, `packages/renderer/angular.json`. This pass focuses on the fixer's changes in dd51ff0 (TW-1/CR-1, CR-2, CR-3, CR-5, CR-6). Working tree at measurement: only the two spec files below modified by the test-writer, plus `reviews/connection-ui/review.md` being written by the concurrent code-reviewer (not touched, not measured).

Requirements:
- `tasks/connection-ui.md` acceptance criteria and recorded assumptions (incl. the 01:11 assumption that secret URI options are dropped with a visible note)
- `SPEC.md` (profiles in `connections.json` without secrets; secrets only in `secrets.bin`)
- `docs/ARCHITECTURE.md` "Coverage"
- `reviews/connection-ui/fixes.md` (behavior the fixes claim)
- Parent instructions

## Test files changed

- `packages/renderer/src/app/connections/connection-editor.spec.ts` (6 tests added in `review fixes`; existing tests unchanged)
- `packages/renderer/src/app/connections/connection-form.model.spec.ts` (6 tests added in `secret URI options (review fix CR-1)`; existing tests unchanged)

## Tests added or updated

Count: 12 (6 editor, 6 model). Focused suite went from 112 to 124 tests.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: form edits update the URI and vice versa; masked password | existing editor `form ⇄ connection string` and `secret mode` suites, model `applyConnectionString` / `connectionStringText` suites | `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/**/*.spec.ts'` | Pass (124/124) |
| TW-1 / CR-1: secret URI options never in a saved or tested draft, never shown, user told they were not stored | previously failing `profileDraftFromState > never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)`; fixer's per-option cases; added model `stripUriSecrets removes a lower-case AWS_SESSION_TOKEN and an emptied property map`, `stripUriSecrets keeps the other mechanism properties`, `stripUriSecrets cleans unparsed options in extra, keeping what is not secret`, `stripUriSecrets removes an unparsed authMechanismProperties that holds only the token`, `stripUriSecrets leaves an unparsed authMechanismProperties without secrets alone`, `the connection-string tab never shows a secret option a model still holds in extra`; added editor `a saved profile holding a secret option loads without it and says it is not stored` | same | Pass |
| CR-2: a failed setSecret keeps the saved profile; a retry updates it, no duplicate | fixer's `a failed setSecret keeps the new profile…`; added `a failed setSecret on an existing profile stays on its page; a retry stores the password` | same | Pass |
| CR-3: Save results are tied to the current load | fixer's `switching to another profile while Save runs…` (save succeeds late); added `a Save that fails after switching to another profile shows no error on the new one`, `a password store that succeeds after switching profiles leaves the new profile alone`, `a password store that fails after switching profiles leaves the new profile alone`, `edits made while the password is being stored are kept when Save finishes` | same | Pass |
| CR-6: level-1 heading in the ready editor | fixer's `the ready editor has a level-1 page heading` | same | Pass |
| AC2 e2e: profile for the int-harness fixture, Test connection succeeds; wrong password shows AUTH_FAILED | `create a profile for the fixture: Test connection succeeds, a wrong password is AUTH_FAILED` | `npm run test:e2e -- test/e2e/connections.e2e.ts` (renderer + desktop build, Playwright Electron, int-harness MongoDB fixture) | Pass |
| AC3 e2e: ask-each-time prompts on connect, `secrets.bin` unchanged (with CR-5 control that a saved password does change it) | `ask each time: connecting prompts for the password and stores nothing` | same | Pass |
| No regressions in the rest of the repository | whole suite | `npm run check` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --watch=false --include='src/app/connections/**/*.spec.ts'`

Result:

Pass: 3 files, 124 tests.

## Full test execution

Command:

`npm run check` (repo root: eslint --max-warnings 0, prettier --check, tsc + workspace type checks, root `vitest run`, renderer `ng test`), run after the last test addition.

Result:

Pass: lint and formatting clean, type checks pass, root Vitest 48 files / 2989 tests, renderer 64 files / 1593 tests.

`npm run test:e2e -- test/e2e/connections.e2e.ts`: Pass, 2 passed (5.7 s). The renderer build prints the existing initial-bundle budget warning (1.35 MB vs 1.00 MB), not a failure.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above).

## Bugs found

None in this pass. TW-1 from the first pass is resolved:

### Secret URI options (proxyPassword, tlsCertificateKeyFilePassword) saved in the profile's connectionString

Finding ID:

`TW-1`

Test:

`connection-form.model > profileDraftFromState > never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)`

Production source:

`packages/renderer/src/app/connections/connection-form.model.ts` (`stripUriSecrets`, called from `editorStateFromProfile`, `applyConnectionString` and `uriModel`)

Requirement:

SPEC.md: profiles without secrets; secrets only in `secrets.bin`.

Expected behavior:

Secret URI options never reach the `ProfileDraft` sent to `profiles.save` or `conn.test`, and are not shown.

Actual behavior:

Fixed in dd51ff0: the test passes unchanged, plus the per-option and added edge-case tests above. Status: resolved.

Severity:

Medium (at the time it was found)

Fix required:

`No — fixed in dd51ff0 (fixer report reviews/connection-ui/fixes.md); verified by the passing test.`

## Coverage

Status: verified. The full task-scoped command ran without the earlier TW-1 `--filter`, all 1593 renderer tests passed and a fresh report was written.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: connection-ui; base 9d2524478e7bf26f37e1ec73ebb4f721753be056 as supplied (current merge base fda71f9 after the rebase); measured HEAD 26608b8991f29302729acd18f17332416c236467, whose code equals the supplied final revision dd51ff0; commits and file list from the parent, checked with `git log` / `git diff --stat` against the base.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD (`git diff --quiet HEAD` on the connection sources; no uncommitted production change). Uncommitted specs (sha256): `connection-editor.spec.ts` 0f7f0f7c…dda9, `connection-form.model.spec.ts` a1ce0d7a…dec7. Other in-scope specs unchanged from HEAD (`connections-page.spec.ts` 5004f5f1…88f7, `sidebar-tree.spec.ts` 27acf949…146c). Same hashes before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included and measured `src/app/connections/connection-form.model.ts`, `connection-editor.ts`, `connections-page.ts`, `src/shared-array-buffer-stub.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/layout/navigation.ts`, `src/app/app.routes.ts`, `src/app/app.config.ts` (all present in the report). Excluded: `*.html` / `*.css` (templates and styles are not instrumented by v8; exercised through the component specs and e2e), `connections/index.ts` (re-exports only), `src/main.ts` (bootstrap, not loaded by unit tests; exercised by the e2e), `packages/core/package.json`, `angular.json` (configuration), `test/e2e/*.e2e.ts` (tests), `docs/ARCHITECTURE.md` (documentation). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0 via `ng test`; working directory `packages/renderer`; `npx ng test --watch=false --coverage --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=json --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/connections-page.ts' --coverage-include='src/shared-array-buffer-stub.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/layout/navigation.ts' --coverage-include='src/app/app.routes.ts' --coverage-include='src/app/app.config.ts'`; whole renderer suite (64 files, 1593 tests), no filter.
- Run start/completion time and exit status: 2026-11-17T01:17:32+01:00 to 01:17:46+01:00, exit 0 (1593 passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 67f61b36…2540, `coverage-final.json` sha256 217438f7…93de03 (Git-ignored), both written 01:17:46.9; the directory was recreated by the run.
- Evidence outputs are fresh and inputs stayed unchanged: yes (spec hashes and `git status` identical before and after; the report hashes differ from the earlier run of this pass at 01:15:39, which preceded the last 2 tests).
- Final run after latest test additions and production fixes: yes (after dd51ff0 and after the last test was added).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/connections/connection-form.model.ts` | 243/245 (99.18%) | 207/212 (97.64%) | 32/32 (100%) | 196/197 (99.49%) |
| `src/app/connections/connection-editor.ts` | 305/310 (98.38%) | 147/164 (89.63%) | 82/82 (100%) | 253/255 (99.21%) |
| `src/app/connections/connections-page.ts` | 50/51 (98.03%) | 23/24 (95.83%) | 15/15 (100%) | 43/43 (100%) |
| `src/shared-array-buffer-stub.ts` | 10/10 (100%) | 3/3 (100%) | 5/5 (100%) | 9/9 (100%) |
| `src/app/sidebar/sidebar-tree.ts` (whole file, mostly pre-existing) | 398/407 (97.78%) | 238/272 (87.50%) | 90/90 (100%) | 340/341 (99.70%) |
| `src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |
| `src/app/app.routes.ts` | 5/11 (45.45%) | N/A (0/0) | 4/10 (40%) | 3/6 (50%) |
| `src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Aggregate (summed counters, 8 files above)** | 1014/1037 (97.78%) | 618/675 (91.56%) | 229/235 (97.45%) | 847/854 (99.18%) |

The aggregate leaves out the excluded files named above; no in-scope file is unmeasured. The first run of this pass (before the two profile-switch store tests) had 616/675 branches; `connection-editor.ts` branches 540#1 and 547#1 (setSecret outcome after a profile switch) are now covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `connection-form.model.ts:270` (non-Error thrown), `:331` (URI error when no other problem), branches 269, 270, 331, 402 | Defensive fallbacks; `toConnectionString` throws only `ConnectionStringError`, and the other problems already catch the invalid models | Justified gap |
| `connection-editor.ts:151` (saved notice from navigation state) | "Saved." on the new editor instance after creating a profile | Checked by the e2e (`saved-notice` visible after Save in the AC3 test). Low risk |
| `connection-editor.ts:178`, branch 194 | Stale `profiles.secretStorage` answer after a route switch | Same generation guard as the covered `profiles.get` race. Low risk |
| `connection-editor.ts:204` (`draftKey` catch), `:271`, `:361` (allowInvalidHostnames off), branches 136, 213, 253-264, 286, 305, 360, 413, 467, 479, 521 (`storage()` missing on save) | Defensive guards and `??` fallbacks not reachable through the UI in normal use; 361 is switching `tlsAllowInvalidHostnames` off again (low risk: same pattern as the other TLS flag) | Justified gap |
| `connections-page.ts:98` (`run()` busy guard) | Double action while busy | Buttons are disabled while busy (tested); the guard is defensive |
| `app.routes.ts:28,35,55` (lazy `loadComponent`) | Lazy loading of the manager and editor routes | Not unit-tested; exercised by the passing `test/e2e/connections.e2e.ts`. Line 28 is pre-existing |
| `sidebar-tree.ts` 9 statements / 34 branches | Pre-existing sidebar code; the task's `edit-conn` item is covered | Out of task scope |

## Unable to test

- Whether the backend itself would strip secret URI options sent by another client was not tested (outside this renderer task; the renderer no longer sends them).
- After a successful Save whose password store finished while the user was editing, the "Saved." notice is shown although the newer edits are unsaved. Observed while writing `edits made while the password is being stored are kept when Save finishes`; no requirement defines this, so it is not reported as a defect and no test asserts it.

## Summary

Tests added and all validation passed. TW-1 is resolved; the fixes for CR-2, CR-3 and CR-6 are covered by tests including the added edge cases (failed Save or password store after a profile switch, edits during the password store, setSecret retry on an existing profile, secret options in a saved profile and in unparsed URI options). `npm run check`, the connections e2e and task-scoped coverage (verified, no filter) pass on the final code.

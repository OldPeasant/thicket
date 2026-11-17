# Test Report

Date: 2026-11-17

Task: connection-ui (M1: Connection editor and manager)

Scope: base a59b2e2d5d8739329eef5c13bb945385b053b9ed .. HEAD f4164af7b1ea7ce2f8e123d72fda12073e53cb45 on `main`; task commits dba5cf8, d1dd886, f4164af (supplied by the parent worker, checked with `git log --oneline a59b2e2..HEAD`, which lists exactly these three). Production changes: `packages/renderer/src/app/connections/` (connection-form.model.ts, connection-editor.ts/html, connections-page.ts/html, index.ts), `packages/renderer/src/shared-array-buffer-stub.ts`, `packages/renderer/src/main.ts`, `sidebar/sidebar-tree.ts/html`, `layout/navigation.ts`, `app.routes.ts`, `app.config.ts`, `packages/core/package.json`, `packages/renderer/angular.json`; e2e `test/e2e/connections.e2e.ts`, `test/e2e/layout.e2e.ts`. At measurement time the working tree held only the test-writer's uncommitted spec changes listed below, plus `reviews/connection-ui/review.md` from the code-reviewer (not touched).

Requirements:
- `tasks/connection-ui.md` acceptance criteria and recorded assumptions
- `SPEC.md` (profiles without secrets in `connections.json`; secrets only in `secrets.bin`)
- `docs/ARCHITECTURE.md` "Connection editor" and "Coverage"
- `packages/contract/src/profiles.ts` (`profileDraft` schema, `proxyPassword` is a secret kind)
- Parent instructions (edge cases to cover)

## Test files changed

- `packages/renderer/src/app/connections/connection-form.model.spec.ts` (new)
- `packages/renderer/src/app/connections/connections-page.spec.ts` (new)
- `packages/renderer/src/app/connections/connection-editor.spec.ts` (13 tests added; existing tests unchanged)
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (3 tests added, `Router` import added)

## Tests added or updated

Count: 77 (46 model, 15 page incl. 3 `groupByFolder`, 13 editor, 3 sidebar)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: editing the form updates the URI | existing `shows the connection string of the form fields…`, `switching to SRV…`; added `color, folder, hosts, direct connection and the CA file end up in the saved draft`, `clearing fields removes their options again`, `No authentication clears user, password and auth source` | `cd packages/renderer && npx ng test --include='src/app/connections/**/*.spec.ts' --include='src/app/sidebar/sidebar-tree.spec.ts' --include='src/shared-array-buffer-stub.spec.ts'` | Pass |
| AC1: editing the URI updates the form | existing `the connection-string tab shows the form state…`, `an invalid connection string is reported…`; added model `applyConnectionString` suite (7 tests), `arrow keys switch between the form and the connection-string tab` | same | Pass |
| AC1: masked password (MASK in the URI, never in a saved draft) | existing `is a masked input…`, `a pasted password moves…`; added `shows a typed password as MASK, never in clear`, `MASK keeps the password already typed`, `a URI without password clears the typed one`, `never contains the typed password`, `never contains a password pasted into the connection-string tab`, `hostSummary never shows credentials` | same | Pass |
| No secrets in a saved profile (SPEC: `connections.json` without secrets) | `profileDraftFromState > never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)` | same | **Fail (TW-1)** |
| Round trip keeps SSH, tls.keyFile, readPreferenceTags, writeConcern, proxy (fields the form does not edit) | `keeps every profile field, including SSH, tls.keyFile, tags, write concern and proxy` (also validated against contract `profileDraft`), `is stable…`, `keeps tls.keyFile only together with a client certificate` | same | Pass |
| NONE mechanism clears user / auth source / secret mode | `NONE clears user, auth source and the secret mode`, `drops the user name of a NONE profile`, `NONE shows neither the user nor…`, editor `No authentication clears…` | same | Pass |
| Validation (name, hosts, ports 1..65535, SRV one host without port, user name) | `editorProblems` suite (7 tests incl. boundaries 0/1/65535/65536/fraction) | same | Pass |
| Folder path normalization | `normalizes the folder path` | same | Pass |
| Invalid saved connectionString | `falls back to localhost for an invalid saved connection string but keeps the profile fields`, `hostSummary is empty for an invalid connection string`, `returns an error and no state for an invalid connection string` | same | Pass |
| Ask each time: typed password used for Test, never stored (renderer side of AC3) | existing `ask each time saves no password`; added `Test connection in ask-each-time mode sends the typed password but never stores it` | same | Pass |
| Test connection with explained errors (renderer side of AC2) | existing `a failed test shows…`, `…uses the stored secrets`; added `Test connection of an edited saved profile sends the draft`, `a running test can be cancelled`, `a CANCELLED answer resets the test without an error` | same | Pass |
| Profile list grouped by folder, colors, flags; edit / duplicate / delete with inline confirm | `groupByFolder` (3), `ConnectionsPage` (12: rendering, empty/error states, edit, duplicate ok/fail, confirm/Keep, delete disconnected/connected (closes connection and its tabs)/close failure/delete failure, busy guard) | same | Pass |
| Sidebar "Edit connection…" and "Manage connections" | `opens the connection editor from the context menu, also on a read-only profile`, `encodes the profile id in the editor URL`, `links to the connection manager` | same | Pass |
| Save errors, load errors, profile switch race | `a failed save is shown…`, `shows the load error…`, `switching to another profile while one loads shows only the latest`, `switching a saved password profile to ask each time…` | same | Pass |
| AC2 e2e (int-harness fixture, Test connection ok, AUTH_FAILED) | `test/e2e/connections.e2e.ts` (parent's) | not rerun by the test-writer | Not run: unchanged by the test-writer; the parent reports it passed (`npm run test:e2e -- test/e2e/connections.e2e.ts`) |
| AC3 e2e (secrets.bin unchanged after ask-each-time) | `test/e2e/connections.e2e.ts` (parent's) | not rerun by the test-writer | Not run: same reason as above |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/connections/**/*.spec.ts' --include='src/app/sidebar/sidebar-tree.spec.ts' --include='src/shared-array-buffer-stub.spec.ts'`

Result:

Fail: 169 passed, 1 failed (TW-1, a legitimate requirement test; kept failing on purpose).

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc + workspace type checks, root `vitest run`, renderer `ng test`)

Result:

Fail: lint pass, type check pass, root Vitest 2989/2989 pass, renderer 1555 passed / 1 failed (only TW-1).

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; result above, failing only on TW-1).

## Bugs found

### Secret URI options (proxyPassword, tlsCertificateKeyFilePassword) are saved in the profile's connectionString

Finding ID:

`TW-1`

Test:

`connection-form.model > profileDraftFromState > never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)` in `packages/renderer/src/app/connections/connection-form.model.spec.ts`

Production source:

`packages/renderer/src/app/connections/connection-form.model.ts:173` (`uriModel()` deletes only `model.password`); also `applyConnectionString` (line 207) and `editorStateFromProfile` (line 104) keep `model.proxy.password` / `model.tls.certificateKeyFilePassword`.

Requirement:

SPEC.md: `connections.json` holds profiles without secrets, secrets live in `secrets.bin`; contract `profileProxy` says the proxy password is the `proxyPassword` secret; task assumption "the saved connectionString holds the whole URI from the form (without password)".

Expected behavior:

A connection string pasted into the URI tab with `proxyPassword=…` or `tlsCertificateKeyFilePassword=…` never ends up in the `ProfileDraft` sent to `profiles.save` (strip them, or move them to the secret flow).

Actual behavior:

The draft's `connectionString` is `mongodb://alice@db1.example.test/?authMechanism=SCRAM-SHA-256&tls=true&tlsCertificateKeyFile=/fictitious/c.pem&tlsCertificateKeyFilePassword=fictitious-Pa55&proxyHost=socks.example.test&proxyUsername=pat&proxyPassword=fictitious-Pa55`. The contract's `hasPassword` only rejects `user:pass@`, so `profiles.save` accepts it and the secret would be written to `connections.json` in clear. The URI tab also shows these values unmasked (only the user password is shown as `****`).

Severity:

Medium (secret persisted in plain text; needs a user to paste such a URI)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed. The full task-scoped coverage command exits 1 because of the TW-1 test and then writes no report (the `coverage/` directory was left empty). The numbers below come from a fresh, otherwise identical run that deselects only that one test with `--filter` (exit 0). They are diagnostic until TW-1 is fixed and coverage is rerun without the filter.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: connection-ui; base a59b2e2d5d8739329eef5c13bb945385b053b9ed; HEAD f4164af7b1ea7ce2f8e123d72fda12073e53cb45; commits dba5cf8, d1dd886, f4164af and the file list given by the parent, checked against `git diff --stat a59b2e2..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD f4164af (no uncommitted production changes). Uncommitted specs (sha256): connection-editor.spec.ts 36017d7c…0bfa, connection-form.model.spec.ts fc1bc90e…84a4, connections-page.spec.ts 5004f5f1…88f7, sidebar-tree.spec.ts 27acf949…146c, shared-array-buffer-stub.spec.ts 899128e1…aba (unchanged). The same hashes were taken before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/connections/connection-form.model.ts`, `connection-editor.ts`, `connections-page.ts`, `src/shared-array-buffer-stub.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/layout/navigation.ts`, `src/app/app.routes.ts`, `src/app/app.config.ts` (all measured, all present in the report). Excluded: `*.html`/`*.css` templates and styles (not instrumented by v8; template behavior is exercised through the component specs), `connections/index.ts` (re-exports only), `src/main.ts` (bootstrap, not loaded by unit tests), `packages/core/package.json` and `angular.json` (configuration), `test/e2e/*.e2e.ts` (tests), `docs/ARCHITECTURE.md` (documentation). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0 via `ng test`; working directory `packages/renderer`; `npx ng test --coverage --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=json --filter='^(?!.*never contains secret URI options).*$' --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/connections-page.ts' --coverage-include='src/shared-array-buffer-stub.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/layout/navigation.ts' --coverage-include='src/app/app.routes.ts' --coverage-include='src/app/app.config.ts'`; the whole renderer suite (64 files) minus the one TW-1 test.
- Run start/completion time and exit status: 2026-11-17T01:03:23+01:00 to 01:03:43+01:00, exit 0 (1555 passed, 1 deselected). The unfiltered run at 00:58:36 exited 1 with no report.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 18115b33…2989, `coverage-final.json` sha256 6a1ad396…0857 (Git-ignored). Both files are stamped 01:03:43, and the directory was recreated by the run (`clean`).
- Evidence outputs are fresh and inputs stayed unchanged: yes (the spec hashes match before and after; `git status` is unchanged).
- Final run after latest test additions and production fixes: yes after the latest test additions; no production fixes exist yet (TW-1 is open). Coverage must be rerun after the fix.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/connections/connection-form.model.ts` | 197/199 (98.99%) | 176/182 (96.70%) | 27/27 (100%) | 156/157 (99.36%) |
| `src/app/connections/connection-editor.ts` | 286/291 (98.28%) | 130/148 (87.84%) | 80/80 (100%) | 239/241 (99.17%) |
| `src/app/connections/connections-page.ts` | 50/51 (98.04%) | 23/24 (95.83%) | 15/15 (100%) | 43/43 (100%) |
| `src/shared-array-buffer-stub.ts` | 10/10 (100%) | 3/3 (100%) | 5/5 (100%) | 9/9 (100%) |
| `src/app/sidebar/sidebar-tree.ts` (whole file, mostly pre-existing) | 398/407 (97.79%) | 238/272 (87.50%) | 90/90 (100%) | 340/341 (99.71%) |
| `src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |
| `src/app/app.routes.ts` | 5/11 (45.45%) | N/A (0/0) | 4/10 (40%) | 3/6 (50%) |
| `src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Aggregate (summed counters, 8 files above)** | 949/972 (97.63%) | 570/629 (90.62%) | 222/228 (97.37%) | 793/800 (99.13%) |

The aggregate leaves out the excluded files named above. It contains no unmeasured file. Before the test-writer's additions, the same scope measured 894/972 statements and 530/629 branches. connection-editor.ts alone was at 231/291 statements and 91/148 branches.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `connection-form.model.ts:191` (non-Error thrown), `:247` (URI error when no other problem), branches 144, 190, 318 | Defensive fallbacks; `toConnectionString` throws only `ConnectionStringError` and the other problems already catch invalid models | Justified gap |
| `connection-editor.ts:150` (saved notice from navigation state) | "Saved." after creating a profile | Not covered here: covered indirectly by `a pasted password moves…` navigation; the notice on the new instance is checked by the e2e. Low risk |
| `connection-editor.ts:177`, branch 193 | Stale `profiles.secretStorage` answer after a route switch | Profile-switch race covered for `profiles.get` (`switching to another profile while one loads…`); the storage-answer race is the same guard. Low risk |
| `connection-editor.ts:203` (`draftKey` catch), `:270` (port on a missing host), branches 135, 212, 252-255, 263, 285, 304, 359, 412, 466, 478, 510, 521, 547 | Defensive guards and `??` fallbacks (no storage loaded, missing host index, a test answer arriving after cancel) | Justified gap: not reachable through the UI in normal use |
| `connections-page.ts:98` (`run()` busy guard) | Double action while busy | The buttons are disabled while busy (`ignores a second action while one is running`); the guard itself is defensive |
| `app.routes.ts:28,35,55` (lazy `loadComponent` for dev/safety, /connections, /connections/:id) | Lazy route loading of the manager and editor | Not unit-testable without the router harness; exercised by `test/e2e/connections.e2e.ts` (not rerun by the test-writer). Line 28 is pre-existing |
| `sidebar-tree.ts` 9 statements / 34 branches | Pre-existing sidebar code outside this task; the task's `edit-conn` item (lines 419-423) is covered | Out of task scope |

## Unable to test

- AC2 and AC3 end to end (real Electron + MongoDB fixture, `secrets.bin` unchanged): the test-writer did not rerun `npm run test:e2e -- test/e2e/connections.e2e.ts` because neither the spec nor the production code changed after the parent's passing run. Follow-up: the parent should rerun it after fixing TW-1, because the fix touches the draft the e2e saves.
- Whether the backend strips secret URI options on `profiles.save` was checked only by reading the code (`packages/contract/src/profiles.ts` `hasPassword` checks only the userinfo; no other filter was found). It was not run against the backend.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1: `proxyPassword` / `tlsCertificateKeyFilePassword` from a pasted URI are saved in the profile's connectionString). Task-scoped coverage is partial-failed: the numbers are diagnostic because they deselect the TW-1 test, and coverage needs a rerun without the filter after the fix.

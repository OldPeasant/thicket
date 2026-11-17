# Test Report

Date: 2026-11-17

Task: connection-ui (M1: Connection editor and manager), third pass on the final code after fixer round 2

Scope: task base `git merge-base HEAD origin/main` = fda71f94e3a52a1b5d760a23a58fcacd7a959f64 (originally 9d2524478e7bf26f37e1ec73ebb4f721753be056 before the parent's rebase). Task commits on `main`: c0c0d72, 3ce5528, 14881ea, 2ffe107, 5aa43a1, 26608b8 (fixes.md), 1562057 (tests/review), 55339c5 (round-2 fix), 27f6b76 (fixes.md only). Measured HEAD 27f6b76 (`main`); its `packages/`, `test/` and `docs/` trees equal 55339c51d415303829347f5b55909c85e4e1471f, the latest code commit (27f6b76 changes only `reviews/connection-ui/fixes.md`). This pass focuses on 55339c5 (`connection-editor.ts`: the destroy hook increments `loadGeneration`; "Saved." is set only when the form still equals the state Save set). Production paths in scope are unchanged from the previous pass: `packages/renderer/src/app/connections/` (connection-form.model.ts, connection-editor.ts/html/css, connections-page.ts/html/css, index.ts), `src/shared-array-buffer-stub.ts`, `src/main.ts`, `sidebar/sidebar-tree.ts/html`, `layout/navigation.ts`, `app.routes.ts`, `app.config.ts`, `packages/core/package.json`, `packages/renderer/angular.json`. Working tree at measurement: only `connection-editor.spec.ts` modified by the test-writer, plus `reviews/connection-ui/review.md` being written by the concurrent code-reviewer (not touched, not measured).

Requirements:
- `tasks/connection-ui.md` acceptance criteria and recorded assumptions
- `SPEC.md` (profiles in `connections.json` without secrets; secrets only in `secrets.bin`)
- `docs/ARCHITECTURE.md` "Coverage"
- `reviews/connection-ui/fixes.md` "Round 2" (behavior the fix claims)
- Parent instructions

## Test files changed

- `packages/renderer/src/app/connections/connection-editor.spec.ts` (2 tests added in `review fixes`; existing tests unchanged)

## Tests added or updated

Count: 2. Focused suite went from 125 to 127 tests.

- `leaving a new profile while its password is stored keeps the store but stays on the new page`: the fixer's spec covers leaving while `profiles.save` runs; this one leaves after `profiles.save` answered while `profiles.setSecret` is still pending (the other `await` in `save()`). It asserts the URL stays on the page the user moved to and that the typed password is still stored once for `new-id` (leaving must not lose the password of a profile that now exists). Without the destroy-hook change this path would reach `router.navigate(['/connections', 'new-id'])` and fail the URL assertion.
- `a new profile saved without edits during the store navigates to its page with the Saved notice state`: guards the other side of the round-2 `unchanged` check, i.e. the normal create flow still navigates to `/connections/new-id` with the `thicketProfileSaved` navigation state that makes the next editor show "Saved." (that notice on the next instance was previously only checked by e2e).

The rest of round 2 is already covered: the fixer's `leaving a new profile while Save runs does not navigate back to it` (fails with the fix disabled, per fixes.md), the extended `edits made while the password is being stored are kept when Save finishes` (no `saved-notice`), and `a failed setSecret on an existing profile stays on its page; a retry stores the password` (notice shown when nothing was edited during the store).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: form edits update the URI and vice versa; masked password | editor `form ⇄ connection string` and `password` suites, model `applyConnectionString` / `connectionStringText` suites | `npm run test -w packages/renderer -- --watch=false --include='src/app/connections/**/*.spec.ts'` (runs `ng test` in `packages/renderer`) | Pass (127/127) |
| Secret URI options never saved or shown (TW-1 / round-1 CR-1) | model `profileDraftFromState > never contains secret URI options`, `stripUriSecrets …` cases; editor `secret URI options are masked…`, `a saved profile holding a secret option loads without it…` | same | Pass |
| Save robustness (round-1 CR-2, CR-3) | `a failed setSecret keeps the new profile…`, `a failed setSecret on an existing profile…`, `switching to another profile while Save runs…`, `a Save that fails after switching…`, `a password store that succeeds/fails after switching profiles…` | same | Pass |
| Round-2 CR-1: leaving the page while Save runs does not navigate back | fixer's `leaving a new profile while Save runs does not navigate back to it`; added `leaving a new profile while its password is stored keeps the store but stays on the new page` | same | Pass |
| Round-2: "Saved." only when the form equals what was saved | `edits made while the password is being stored are kept when Save finishes` (no notice), `a failed setSecret on an existing profile…` (notice after an unedited retry); added `a new profile saved without edits during the store navigates to its page with the Saved notice state` | same | Pass |
| Level-1 heading (round-1 CR-6) | `the ready editor has a level-1 page heading` | same | Pass |
| AC2 e2e: profile for the int-harness fixture, Test connection succeeds; wrong password is AUTH_FAILED | `create a profile for the fixture: Test connection succeeds, a wrong password is AUTH_FAILED` | `npm run test:e2e -- test/e2e/connections.e2e.ts` (renderer + desktop build, Playwright Electron, int-harness MongoDB fixture) | Pass |
| AC3 e2e: ask-each-time prompts on connect, `secrets.bin` unchanged (with the saved-password control) | `ask each time: connecting prompts for the password and stores nothing` | same | Pass |
| No regressions in the rest of the repository | whole suite | `npm run check` | Pass |

## Focused test execution

Command:

`npm --prefix /home/felix/work/thicket-agents/agent-2 run test -w packages/renderer -- --watch=false --include='src/app/connections/**/*.spec.ts'`

Result:

Pass: 3 files, 127 tests.

## Full test execution

Command:

`npm run check` (repo root: eslint --max-warnings 0, prettier --check, tsc + workspace type checks, root `vitest run`, renderer `ng test`), run after the last test addition.

Result:

Pass: lint and formatting clean, type checks pass, root Vitest 48 files / 2989 tests, renderer 64 files / 1596 tests.

`npm run test:e2e -- test/e2e/connections.e2e.ts`: Pass, 2 passed (6.1 s), on the final code with the added specs. The renderer build prints the existing initial-bundle budget warning (1.35 MB vs 1.00 MB), not a failure.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above).

## Bugs found

None in this pass. TW-1 from the first pass stays resolved (`connection-form.model > profileDraftFromState > never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)` passes; fixed in dd51ff0).

## Coverage

Status: verified. Whole renderer suite with task-scoped `--coverage-include`, exit 0, fresh report.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode; not reconstructed by hand). The round-2 lines in `connection-editor.ts` (`save()` lines 562-565 and the destroy hook 152-156) have no uncovered statement or branch in the report.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: connection-ui; base fda71f94e3a52a1b5d760a23a58fcacd7a959f64 (merge base with `origin/main`; original base 9d25244 before rebase); measured HEAD 27f6b76, code identical to 55339c51d415303829347f5b55909c85e4e1471f; commits and file list from the parent and the previous passes, checked with `git log` and `git diff --stat 26608b8 55339c5 -- packages test docs` (only connection-editor.ts/spec and connection-form.model.spec.ts changed since the previous measurement).
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD (no uncommitted production change; `git status --short` shows only the editor spec and the reviewer's review.md). Uncommitted spec sha256 `connection-editor.spec.ts` 57c4cf51…0fdf; committed specs `connection-form.model.spec.ts` a1ce0d7a…3f0, `connections-page.spec.ts` 5004f5f1…88f7, `sidebar-tree.spec.ts` 27acf949…146c. The editor spec hash was the same before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: measured `src/app/connections/connection-form.model.ts`, `connection-editor.ts`, `connections-page.ts`, `src/shared-array-buffer-stub.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/layout/navigation.ts`, `src/app/app.routes.ts`, `src/app/app.config.ts` (all in the report). Excluded: `*.html` / `*.css` (not instrumented by v8; exercised by component specs and e2e), `connections/index.ts` (re-exports only), `src/main.ts` (bootstrap, not loaded by unit tests; exercised by the e2e), `packages/core/package.json`, `angular.json` (configuration), `test/e2e/*.e2e.ts` (tests), `docs/ARCHITECTURE.md` (documentation). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0 via `ng test`; working directory `packages/renderer` (npm workspace script); `npm --prefix /home/felix/work/thicket-agents/agent-2 run test -w packages/renderer -- --watch=false --coverage --coverage-reporters=text-summary --coverage-reporters=json-summary --coverage-reporters=json --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/connections-page.ts' --coverage-include='src/shared-array-buffer-stub.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/layout/navigation.ts' --coverage-include='src/app/app.routes.ts' --coverage-include='src/app/app.config.ts'`; whole renderer suite (64 files, 1596 tests), no filter.
- Run start/completion time and exit status: 2026-11-17T01:26:21+01:00 to 01:26:58+01:00, exit 0 (1596 passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 e2a16121…a5ba221, `coverage-final.json` sha256 3b43203d…66c8ec (Git-ignored), both written 01:26:58.68; the `coverage` directory was recreated by the run (01:26:33).
- Evidence outputs are fresh and inputs stayed unchanged: yes (report hashes differ from the previous pass, file times are inside this run, spec hash and `git status` unchanged).
- Final run after latest test additions and production fixes: yes (after 55339c5 and after both added tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/connections/connection-form.model.ts` | 243/245 (99.18%) | 207/212 (97.64%) | 32/32 (100%) | 196/197 (99.49%) |
| `src/app/connections/connection-editor.ts` | 307/312 (98.39%) | 147/164 (89.63%) | 81/81 (100%) | 256/258 (99.22%) |
| `src/app/connections/connections-page.ts` | 50/51 (98.03%) | 23/24 (95.83%) | 15/15 (100%) | 43/43 (100%) |
| `src/shared-array-buffer-stub.ts` | 10/10 (100%) | 3/3 (100%) | 5/5 (100%) | 9/9 (100%) |
| `src/app/sidebar/sidebar-tree.ts` (whole file, mostly pre-existing) | 398/407 (97.78%) | 238/272 (87.50%) | 90/90 (100%) | 340/341 (99.70%) |
| `src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |
| `src/app/app.routes.ts` | 5/11 (45.45%) | N/A (0/0) | 4/10 (40%) | 3/6 (50%) |
| `src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Aggregate (summed counters, 8 files above)** | 1016/1039 (97.78%) | 618/675 (91.55%) | 228/234 (97.43%) | 850/857 (99.18%) |

The aggregate leaves out the excluded files named above; no in-scope file is unmeasured. Line numbers in `connection-editor.ts` moved by +4 from the previous pass because of the larger destroy hook.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `connection-form.model.ts:270` (non-Error thrown), `:331`, branches 269#1, 270#0/1, 331#0, 402#1 | Defensive fallbacks; `toConnectionString` throws only `ConnectionStringError` and other problems already catch the invalid models | Justified gap |
| `connection-editor.ts:151` (branch 151#0, saved notice from navigation state) | "Saved." on the new editor instance after creating a profile | The navigation state is now unit-tested (added `a new profile saved without edits…`); the notice on the next instance is checked by the e2e. `currentNavigation()` is null when a TestBed fixture is created, so the read itself is not unit-reachable. Low risk |
| `connection-editor.ts:182` (branch 182#0), `198#1` | Stale `profiles.secretStorage` answer / stale load error after a route switch or destroy | Same generation guard as the covered `profiles.get` race. Low risk |
| `connection-editor.ts:208` (`draftKey` catch), `:275`, `:365` (allowInvalidHostnames off), branches 136#1, 217#1, 257-268, 275#0, 290#1, 309#1, 364#1, 417#1, 471#1, 483#0, 526#1 (`storage()` missing on save) | Defensive guards and `??` fallbacks not reachable through the UI in normal use; 365 is switching `tlsAllowInvalidHostnames` off again (same pattern as the covered TLS flags) | Justified gap |
| `connections-page.ts:98` (`run()` busy guard) | Double action while busy | Buttons are disabled while busy (tested); the guard is defensive |
| `app.routes.ts:28,35,55` (lazy `loadComponent`) | Lazy loading of the manager and editor routes | Not unit-tested; exercised by the passing `test/e2e/connections.e2e.ts`. Line 28 is pre-existing |
| `sidebar-tree.ts` 9 statements / 34 branches | Pre-existing sidebar code; the task's `edit-conn` item is covered | Out of task scope |

## Unable to test

- Whether the backend would strip secret URI options sent by another client (outside this renderer task; the renderer no longer sends them).
- For a new profile, edits made while its password is being stored are lost because the editor then navigates to `/connections/:id`, which loads the saved profile (noted and deliberately left as is in fixes.md Round 2). No requirement defines this; no test asserts either outcome.
- A pending profile load answering after the editor is destroyed has no observable effect in a destroyed fixture, so the new guard on that path is not asserted directly (covered indirectly by the same generation guard tests).

## Summary

Tests added and all validation passed. The round-2 fix (destroyed editor ignores a finishing Save, including one finishing in the password store; "Saved." only when nothing was edited during the store) is covered by the fixer's specs and two added specs. `npm run check`, the connections e2e and task-scoped coverage (verified, fresh, final code) pass. No production defects found.

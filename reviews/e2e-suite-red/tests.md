# Test Report

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: base 99822f17381bb12183df3ac07f81791afd91c511 .. HEAD 8d46a2d2d2b4313f98c496b9ff5cdb984e63bdc9 on `main`. Task commits: 19f1b5f6 (splitter drag), 0afc4384 (LDAP fixture unsupported-kernel handling), 91295397 (first-round tests and reports), 8d46a2d2 (fixer CR-2: document listeners only during a drag, fixes report). This round adds uncommitted test changes in `app-shell.spec.ts`. This is round 2, on the final code after the fixer's change. `test/integration/fixtures/ldap.ts` and `test/e2e/ldap.e2e.ts` have not changed since round 1, so their results below are carried over from round 1 (HEAD 0afc4384) and say so.

Requirements:
- `tasks/e2e-suite-red.md` acceptance criteria and its three ASSUMPTION notes
- `reviews/e2e-suite-red/review.md` CR-2 and `reviews/e2e-suite-red/fixes.md` (final drag-listener behaviour)
- `docs/ARCHITECTURE.md` ("Coverage", commands), `docs/QUALITY.md` (report contract), `AGENTS.md`
- Parent instructions (round 1: cancel keeps the last move, a second pointer's document events are ignored, a drag after a completed drag; round 2: check that the tests still cover the final behaviour, run the app-shell spec and task-scoped coverage for app-shell.ts, no Playwright)

## Test files changed

- `packages/renderer/src/app/layout/app-shell.spec.ts` (round 1: 8 tests; fixer: 1 test; round 2: 2 tests and a `trackDocumentPointerListeners` helper)
- `test/integration/ldap-fixture-start.int.spec.ts` (round 1, new, 6 tests; unchanged in round 2)

## Tests added or updated

Count: 16 by the test-writer (14 in round 1, 2 in round 2), plus 1 by the fixer

Round 2 (app-shell.spec.ts, "AppShell > sidebar width edge cases"):
- `creating the shell attaches no document pointer listeners`: the spy is installed before the shell is created. The fixer's test installs its spy only after `start()`, so a listener registered at creation, such as the removed `(document:pointermove)` host binding, would have gone uncounted. This test also checks that a move outside a drag changes nothing and that destroying the shell without a drag leaves no listeners.
- `another pointer's release or cancel and a secondary press keep the drag's listeners`: covers the early-return paths of `dragEnd` (other pointer id) and `dragStart` (non-primary button) during a running drag. The drag listeners must stay attached and stay single. The drag then continues, its release saves once, and the listeners are removed.

Fixer (CR-2): `listens on the document only during a drag, without duplicates (fixer)`. I reviewed it: it covers attach on a primary press, none on a secondary press, no duplicates on a second press, removal on pointerup, pointercancel and destroy mid-drag.

Round 1 app-shell.spec.ts ("AppShell > sidebar width edge cases"). All of these still pass unchanged against the listener-based code:
- `a cancel off the splitter keeps the last move, not the cancel position`
- `a cancel without moves saves nothing`
- `ignores another pointer's moves, release and cancel on the document`
- `a release on the document itself (outside the shell) ends the drag, clamped`
- `a second drag starts from the width the first one saved`
- `pointer events on the document without a splitter press change nothing`
- `a secondary-button press leaves document moves and releases without effect`
- `stops listening on the document once the shell is destroyed`

Round 1 ldap-fixture-start.int.spec.ts ("startLdapFixture when a container does not start"; testcontainers and `os.release()` are fakes, no containers):
- `reports an Enterprise start failure on an affected Linux kernel as unsupported` (the message names the image, the kernel, SERVER-121912 and the original reason; the started OpenLDAP container and the network are stopped)
- `keeps the original error on a Linux kernel outside the affected range`
- `keeps the original error off Linux, whatever the release says`
- `keeps the OpenLDAP error when only OpenLDAP failed, also on an affected kernel` (the started Enterprise container is stopped)
- `reports unsupported when both failed on an affected kernel`
- `reports the OpenLDAP error first when both failed on an unaffected kernel`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: the three e2e tests pass (layout.e2e.ts:36, :61, ldap.e2e.ts:33/43) | layout.e2e.ts (6 tests incl. "welcome buttons navigate ... Compass import", "the sidebar width is dragged, saved and restored after a restart"), ldap.e2e.ts "an LDAP profile ..." | `npx playwright test layout.e2e.ts ldap.e2e.ts` (repo root, existing build, this host's display session) | Round 1 (pre-fix revision 0afc4384): Pass (7 passed). Final revision 8d46a2d2: Not run by me, the parent instructed me not to run Playwright and runs the full e2e suite on it |
| AC1 (LDAP, affected-kernel host): the fixture reports an unsupported host instead of a log-wait failure; e2e skips with that reason | ldap-fixture-start.int.spec.ts (6), ldap-fixture.int.spec.ts (`kernelBreaksMongo80`, error class) | `npx vitest run --config test/integration/vitest.config.ts ldap-fixture` | Pass in round 1 (19 passed); the files are unchanged since then. The skip branch in ldap.e2e.ts itself on an affected kernel: Not run, this host runs kernel 7.1.3 (unaffected) |
| AC2: app bug (drag stops when the pointer leaves the splitter) covered by a test | "follows the pointer after it left the splitter (no pointer capture)", "a release takes the width at the release position, also without moves", plus the round-1 edge cases | `cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts` | Pass (75 passed, final revision) |
| CR-2 final behaviour: document pointer listeners only during a drag, none at creation, no duplicates, removed on release, cancel and destroy, kept for another pointer's release/cancel and a secondary press | "listens on the document only during a drag, without duplicates (fixer)", "creating the shell attaches no document pointer listeners", "another pointer's release or cancel and a secondary press keep the drag's listeners", "stops listening on the document once the shell is destroyed" | same | Pass |
| Drag edge cases: cancel keeps the last move; second pointer ignored; drag after a completed drag; release outside the shell; no drag without a splitter press | the round-1 app-shell tests | same | Pass (final revision) |
| LDAP fixture real start still works (regression) | ldap.int.spec.ts | `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.include='fixtures/ldap.ts' ... ldap` | Pass in round 1 (27 passed, 3 files, real containers); the fixture is unchanged since then |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts`

Result:

Pass: 75 passed (final revision 8d46a2d2 plus the round-2 spec changes; 73 before them)

Command:

`npx prettier --check packages/renderer/src/app/layout/app-shell.spec.ts && npx eslint --max-warnings 0 packages/renderer/src/app/layout/app-shell.spec.ts` (repo root)

Result:

Pass

Round 1 only (pre-fix revision 0afc4384; these inputs are unchanged): `npx vitest run --config test/integration/vitest.config.ts ldap-fixture` passed (2 files, 19 tests). `npx playwright test layout.e2e.ts ldap.e2e.ts` passed (7 tests).

## Full test execution

Command:

`npm run check`

Result:

Not run in round 2: the permission to run it was denied in this session. In round 1 (pre-fix), my run passed. The fixer also reports a pass on 8d46a2d2 (renderer 3398 tests). Round 2 adds only two spec tests, which pass in the focused run and pass Prettier and ESLint; the type check of the spec ran as part of the `ng test` build. The parent should run `.taskcheck` on the final tree. Integration (`npm run test:int`) and e2e were not run by me in round 2.

## .taskcheck

Result:

Not run in round 2 (it runs `npm run check`, see above). Round 1: Pass.

## Bugs found

None. All the added tests pass against the final production code.

Observations (no test fails, no fix required):
- `dragStart` with the primary button while a drag of another pointer is running replaces that drag (the first pointer's release is then ignored). This was already the behaviour before the task, and no requirement covers multi-touch, so I added no test for it.
- `dragStart` calls `setPointerCapture` before `listenToDrag()`. If `setPointerCapture` threw, the drag would be set but no document listeners attached. For a real `pointerdown`, the pointer is active and the call does not throw. Before CR-2, such a throw also surfaced as an error. This is not a requirement, so I added no test.

## Coverage

Status: verified for `app-shell.ts` on the final revision. `fixtures/ldap.ts` numbers are from round 1 and still apply: the file is unchanged since 0afc4384 and its tests are unchanged since round 1.

Metric: whole-file coverage of task-changed production files.

Changed-line coverage: measured by hand from the provider's lcov `DA`/`BRDA` records, limited to the added/modified executable lines of the task diff (99822f17..8d46a2d2).
- `app-shell.ts`: 20/20 lines covered: 185, 187, 190 (the `DestroyRef.onDestroy` hook), 250, 262-273 (`listenToDrag`), 278-279 (`stopDragListeners`), 290 (`if (atPointer) ...`) and 292. The branches on line 290 are 2/2. The changed functions (`listenToDrag`, its three handlers, the remover, `stopDragListeners`, the onDestroy callback) are all hit. The removed document host bindings no longer appear in the function list; only `AppShell_keydown_HostBindingHandler` remains.
- `fixtures/ldap.ts` (round 1): changed executable lines (38-46, 54, 181-195) 14/14; branches on those lines 16/16.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: e2e-suite-red; base 99822f17381bb12183df3ac07f81791afd91c511 and final revision 8d46a2d2 (HEAD) from the parent. The task commits 19f1b5f6, 0afc4384, 91295397 and 8d46a2d2 match `git log 99822f17..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): round 2 sha256: app-shell.ts 0844f33b9898dd2e36b43acb18384176ea3c67b62b76951d2ca77d69360fba34 (committed in 8d46a2d2), app-shell.spec.ts 425dab8a4f4b37c9eab3303f9711ecef45c69906c045a4e6d6016f3c2f89ca75 (uncommitted, includes the round-2 tests). Both were identical before and after the coverage run. Round 1 (still current): fixtures/ldap.ts 230d2b63...4a3bd1, ldap-fixture.int.spec.ts b5fefd19...febc96, ldap-fixture-start.int.spec.ts 6da09634...e1e9, test/e2e/ldap.e2e.ts 3e9e9da5...59f.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/layout/app-shell.ts` and `test/integration/fixtures/ldap.ts`. Excluded: `test/e2e/ldap.e2e.ts` (a Playwright spec with no coverage instrumentation for e2e; its change is the try/catch skip), spec files, `reviews/`, `tasks/`. No renames or deletions.
- Provider/version, command, working directory, and test selection: (1, round 2) `@vitest/coverage-v8` with vitest 5.1.0 through `@angular/build:unit-test`, `npx ng test --include=src/app/layout/app-shell.spec.ts --coverage --coverage-include='src/app/layout/app-shell.ts'` in `packages/renderer`. (2, round 1) `@vitest/coverage-v8` 5.1.0 / vitest 5.1.0, `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.include='fixtures/ldap.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcov ldap` in the repo root (ldap.int.spec.ts, ldap-fixture.int.spec.ts, ldap-fixture-start.int.spec.ts).
- Run start/completion time and exit status: (1) 2026-11-17, tests started 07:06:46 +01:00, reports written 07:06:50; 75 passed, success. (2) Round 1: 06:55:09-06:55:22 +01:00, 27 passed, success.
- Generated report paths and report hashes/run identifier: (1) `packages/renderer/coverage/renderer/lcov.info` sha256 97e9a9a462937ac2c5cdad5c7b6eaf2d1e084aa5e253f6d6eefe684fae4dfa7f and `coverage-summary.json` 8fca1491a554a04c7cc196635a85051cf77b354931eddadf896d781a7169e914, written 07:06:50. (2) Round 1: `test/integration/coverage/lcov.info` b39b5c34...69a3, `coverage-summary.json` c192185b...a3. All are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The app-shell report was written by this run, and the input hashes were the same before and after it. The ldap report is from round 1, and its inputs have not changed since.
- Final run after latest test additions and production fixes: yes for app-shell.ts; the run used the final production code and all round-2 tests. For fixtures/ldap.ts: no production or test change since its round-1 run.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/layout/app-shell.ts` (final, round 2) | 153/154 (99.35%) | 88/88 (100%) | 30/31 (96.77%) | 115/115 (100%) |
| `test/integration/fixtures/ldap.ts` (round 1, unchanged) | 59/65 (90.76%, provider-rounded) | 17/20 (85%) | 8/11 (72.72%, provider-rounded) | 53/56 (94.64%) |
| Aggregate (summed counters, both files; no files unmeasured) | 212/219 (96.80%) | 105/108 (97.22%) | 38/42 (90.48%) | 168/171 (98.25%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `app-shell.ts:134` function `(anonymous_30)` | Compiler-generated callback of `viewChild.required(TabBar)`, not task code (line 141 in round 1) | Justified gap: generated code, not changed by the task |
| `fixtures/ldap.ts:156-160` (`seedDirectory` retry: `ldapadd` non-zero exit, deadline, 500 ms wait) | Retry while slapd finishes its bootstrap; existing code, not changed by the task | Justified gap: outside the task diff, and it depends on container timing |
| `fixtures/ldap.ts:173-174` (`.catch(() => undefined)` on container/network stop) | Ignoring stop failures during cleanup; existing code | Justified gap: outside the task diff |

## Unable to test

- The final revision's e2e behaviour (layout.e2e.ts sidebar drag with the listener-based code): not run by me, as the parent instructed. The parent runs the full e2e suite on 8d46a2d2.
- That pointer moves outside a drag schedule no change detection (CR-2's goal): not observed directly. The tests check its cause instead: no document pointer listeners exist outside a drag, including at creation.
- The ldap.e2e.ts skip path (`LdapFixtureUnsupportedError` turns into `test.skip` with its message) on a host whose kernel is between 6.19.0 and 7.0.13: this host runs 7.1.3. The fixture side of that path is covered with fakes (ldap-fixture-start.int.spec.ts). Follow-up: an e2e run on an affected host (dell26) would confirm the skip.
- The original e2e sidebar failure (no pointer capture in the window) could not be reproduced here. The jsdom tests dispatch moves and releases off the splitter to simulate it.
- `npm run check` / `.taskcheck` in round 2: denied in this session; the parent runs it.

## Summary

Tests added and all validation passed: the focused app-shell suite on the final revision passed 75/75, and Prettier and ESLint pass on the spec. Task-scoped coverage is sufficient: every changed executable line and branch of app-shell.ts is covered on the final code, and no production defects were found. The full `npm run check` and e2e on the final revision remain for the parent.

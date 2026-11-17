# Test Report

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: base 99822f17381bb12183df3ac07f81791afd91c511 .. HEAD 0afc438492cfcde840e1e9669a5659206a37ff39 on `main` (task commits 19f1b5f6 splitter drag, 0afc4384 LDAP fixture unsupported-kernel handling), plus this report's uncommitted test changes.

Requirements:
- `tasks/e2e-suite-red.md` acceptance criteria and its three ASSUMPTION notes
- `docs/ARCHITECTURE.md` ("Coverage", commands), `docs/QUALITY.md` (report contract), `AGENTS.md`
- Parent instructions (cases to cover: pointercancel keeps the last move, a second pointer's document events are ignored, a drag after a completed drag)

## Test files changed

- `packages/renderer/src/app/layout/app-shell.spec.ts` (8 tests added in "sidebar width edge cases")
- `test/integration/ldap-fixture-start.int.spec.ts` (new, 6 tests)

## Tests added or updated

Count: 14

app-shell.spec.ts ("AppShell > sidebar width edge cases"):
- `a cancel off the splitter keeps the last move, not the cancel position`
- `a cancel without moves saves nothing`
- `ignores another pointer's moves, release and cancel on the document`
- `a release on the document itself (outside the shell) ends the drag, clamped`
- `a second drag starts from the width the first one saved`
- `pointer events on the document without a splitter press change nothing`
- `a secondary-button press leaves document moves and releases without effect`
- `stops listening on the document once the shell is destroyed`

ldap-fixture-start.int.spec.ts ("startLdapFixture when a container does not start"; testcontainers and `os.release()` are fakes, no containers):
- `reports an Enterprise start failure on an affected Linux kernel as unsupported` (message names image, kernel, SERVER-121912 and the original reason; the started OpenLDAP container and the network are stopped)
- `keeps the original error on a Linux kernel outside the affected range`
- `keeps the original error off Linux, whatever the release says`
- `keeps the OpenLDAP error when only OpenLDAP failed, also on an affected kernel` (started Enterprise container stopped)
- `reports unsupported when both failed on an affected kernel`
- `reports the OpenLDAP error first when both failed on an unaffected kernel`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: the three e2e tests pass (layout.e2e.ts:36, :61, ldap.e2e.ts:33/43) | layout.e2e.ts (6 tests incl. "welcome buttons navigate ... Compass import", "the sidebar width is dragged, saved and restored after a restart"), ldap.e2e.ts "an LDAP profile ..." | `npx playwright test layout.e2e.ts ldap.e2e.ts` (repo root, existing build, this host's display session) | Pass (7 passed). Headless run (DISPLAY/WAYLAND_DISPLAY unset) and the full `npm run test:e2e`: Not run by me, the parent ran them |
| AC1 (LDAP, affected-kernel host): fixture reports an unsupported host instead of a log-wait failure; e2e skips with that reason | ldap-fixture-start.int.spec.ts (6), ldap-fixture.int.spec.ts (`kernelBreaksMongo80`, error class) | `npx vitest run --config test/integration/vitest.config.ts ldap-fixture` | Pass (19 passed). The skip branch in ldap.e2e.ts itself on an affected kernel: Not run, this host runs kernel 7.1.3 (unaffected) |
| AC2: app bug (drag stops when the pointer leaves the splitter) covered by a test | "follows the pointer after it left the splitter (no pointer capture)", "a release takes the width at the release position, also without moves" (task commit) + the 8 added edge cases | `cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts` | Pass (72 passed) |
| Drag edge cases: cancel keeps the last move; second pointer ignored; drag after a completed drag; release outside the shell; no drag without a splitter press; listeners removed on destroy | the 8 added app-shell tests | same | Pass |
| LDAP fixture real start still works (regression) | ldap.int.spec.ts | `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.include='fixtures/ldap.ts' ... ldap` | Pass (27 passed, 3 files, real containers) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts`

Result:

Pass: 72 passed (64 before my additions)

Command:

`npx vitest run --config test/integration/vitest.config.ts ldap-fixture` (repo root)

Result:

Pass: 2 files, 19 passed

Command:

`npx playwright test layout.e2e.ts ldap.e2e.ts` (repo root, prebuilt app)

Result:

Pass: 7 passed (27.7 s)

## Full test execution

Command:

`npm run check` (lint + Prettier, typecheck, root Vitest projects, renderer `ng test`)

Result:

Pass: root Vitest 87 files / 4457 tests passed; renderer 102 files / 3397 tests passed (lint and typecheck run first in the `&&` chain and passed). The full integration suite (`npm run test:int`) and the full e2e suite were not run (slow; the parent ran the e2e suite).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run as `npm run check`, result above)

## Bugs found

None. All the added tests passed against the task's production code.

Observations (no test fails, no fix required):
- `dragStart` with the primary button while a drag of another pointer is running replaces that drag (the first pointer's release is then ignored). This is how the code behaved before the task too, and no requirement covers multi-touch, so I added no test for it.

## Coverage

Status: verified (both task-changed production files measured on the final test snapshot)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by hand from the provider's lcov `DA`/`BRDA` records, limited to the added/modified lines of the task diff. `app-shell.ts`: changed executable line 263 (`if (atPointer) this.dragMove(event)`) 1/1, its branches 2/2. The changed host-binding metadata (lines 67-73) has no source-mapped line records of its own (it compiles into the host-binding handler at line 137), so the four document handlers are covered only behaviourally, by the tests above. `fixtures/ldap.ts`: changed executable lines (38-46, 54, 181-195) 14/14, branches on those lines 16/16.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: e2e-suite-red; base 99822f17381bb12183df3ac07f81791afd91c511 (from the parent); HEAD 0afc438492cfcde840e1e9669a5659206a37ff39; task commits 19f1b5f6 and 0afc4384 (from the parent, matching `git log 99822f17..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 app-shell.ts c383b779...57ebc5, app-shell.spec.ts 167f752e...298bb, fixtures/ldap.ts 230d2b63...4a3bd1, ldap-fixture.int.spec.ts b5fefd19...febc96, ldap-fixture-start.int.spec.ts 6da09634...e1e9, test/e2e/ldap.e2e.ts 3e9e9da5...59f; identical before and after all runs.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/layout/app-shell.ts`, `test/integration/fixtures/ldap.ts`. Excluded: `test/e2e/ldap.e2e.ts` (Playwright spec, no coverage instrumentation for e2e; its change is the try/catch skip), spec files. No renames or deletions.
- Provider/version, command, working directory, and test selection: (1) `@vitest/coverage-v8` 5.1.0 through `@angular/build:unit-test`, `npx ng test --include=src/app/layout/app-shell.spec.ts --coverage --coverage-include='src/app/layout/app-shell.ts'` in `packages/renderer`; (2) `@vitest/coverage-v8` 5.1.0 / vitest 5.1.0, `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.include='fixtures/ldap.ts' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcov ldap` in the repo root (ldap.int.spec.ts, ldap-fixture.int.spec.ts, ldap-fixture-start.int.spec.ts).
- Run start/completion time and exit status: (1) 2026-11-17 06:54:37-06:54:45 +01:00, 72 passed, success; (2) 06:55:09-06:55:22 +01:00, 27 passed, success.
- Generated report paths and report hashes/run identifier: (1) `packages/renderer/coverage/renderer/lcov.info` sha256 c8cd85cb...16b4c7, `coverage-summary.json` 8fa9f9d2...e86d (written 06:54:44); (2) `test/integration/coverage/lcov.info` sha256 b39b5c34...69a3, `coverage-summary.json` c192185b...a3 (written 06:55:20). All are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files were written during the runs above, and the input hashes were the same before and after.
- Final run after latest test additions and production fixes: yes. No production fixes were made after these runs.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/layout/app-shell.ts` | 133/134 (99.25%) | 88/88 (100%) | 23/24 (95.83%) | 96/96 (100%) |
| `test/integration/fixtures/ldap.ts` | 59/65 (90.76%, provider-rounded) | 17/20 (85%) | 8/11 (72.72%, provider-rounded) | 53/56 (94.64%) |
| Aggregate (summed counters, both files; no files unmeasured) | 192/199 (96.48%) | 105/108 (97.22%) | 31/35 (88.57%) | 149/152 (98.03%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `app-shell.ts:141` function `(anonymous_23)` | compiler-generated callback of `viewChild.required(TabBar)`, not task code | Justified gap: generated, not changed by the task |
| `fixtures/ldap.ts:156-160` (`seedDirectory` retry: `ldapadd` non-zero exit, deadline, 500 ms wait) | Retry while slapd finishes its bootstrap; existing code, not changed by the task | Justified gap: outside the task diff, and it depends on container timing |
| `fixtures/ldap.ts:173-174` (`.catch(() => undefined)` on container/network stop) | Ignoring stop failures during cleanup; existing code | Justified gap: outside the task diff |

## Unable to test

- The ldap.e2e.ts skip path (`LdapFixtureUnsupportedError` turns into `test.skip` with its message) on a host whose kernel is between 6.19.0 and 7.0.13: this host runs 7.1.3. The fixture side of that path is covered with fakes (ldap-fixture-start.int.spec.ts). Follow-up: an e2e run on an affected host (dell26) would confirm the skip.
- The original e2e sidebar failure (no pointer capture in the window) could not be reproduced here. The jsdom tests dispatch moves and releases off the splitter, which simulates it. No follow-up beyond the e2e runs the parent already did.
- Headless e2e (DISPLAY/WAYLAND_DISPLAY unset): not run by me; the parent ran it.

## Summary

Tests added and all validation passed. Task-scoped coverage is sufficient: every changed executable line and branch is covered, and no production defects were found.

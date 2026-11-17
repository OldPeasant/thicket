# Test Report

Date: 2026-11-17

Task: final-demo - Release: full demo script end to end (second pass, after the fixer's CR-1, CR-2
and TW-1 changes)

Scope: the parent supplied merge-base `91218ed8e8f0b763fd2ff7dd6cc545d995ee3ced` .. HEAD
`287f9b85f151283db7c0a7e98b8fa3892fdfdfa9` (task commits 8baa8d8, c39ca5f, fb2b298, 7dd35af,
59266c1, 8348a54, 287f9b8). While this pass ran, at 04:58:33Z, the parent rebased the branch onto
main `7808dbac73d619370931cbe62916e531868d1ce4`. The new HEAD is
`3c1b0197808fefbe13019d20af0906994e3aa83d` (task commits fbde1c7, ae42f56, 5f5d44a, dec7648,
f157888, e0c120e, 3c1b019). The task's code did not change in the rebase:
`git diff 91218ed 287f9b8 -- ':!reviews' ':!tasks' | git patch-id --stable` and
`git diff 7808dba 3c1b019 -- ':!reviews' ':!tasks' | git patch-id --stable` both give
`a225bd2dfe6b6dfc3e7e81195300c6678ecc7594`. The changed code is `test/e2e/demo/demo.e2e.ts`,
`test/e2e/demo/ssh-x509.ts` (new), `test/e2e/harness/app.ts`, `test/e2e/harness/fixtures.ts`,
`test/integration/fixtures.int.spec.ts`, `test/integration/fixtures/mongo.ts`, `socks.ts` and
`ssh.ts`. There are no production source changes. The rest is 44 screenshots under
`reviews/final-demo/`. Since the first pass, the only code change is the fixer's commit to
`demo.e2e.ts` (8348a54, rebased as e0c120e).

Requirements:
- `tasks/final-demo.md` acceptance criteria 1 and 2
- `SPEC.md` section 2 (demo script, steps 1-11)
- `reviews/final-demo/review.md` (CR-1, CR-2) and `reviews/final-demo/fixes.md`
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`; `AGENTS.md` "Evidence"

## Test files changed

- `test/integration/fixtures.int.spec.ts` (added in the first pass and committed in 59266c1/f157888).
  This pass changes no test files.

## Tests added or updated

Count: 0 in this pass. The first pass added 1 parameterised test with 5 cases:
`MongoDB fixtures > %s runs with TCMalloc background thread off on 8.x only`.

I re-checked the fixer's changes and added no tests for them:
- CR-1 (`shot(window, name, scrollTo?)` scrolls after every theme switch): the output is the
  screenshot itself. I checked the regenerated `reviews/final-demo/tron-dark/step-02-production.png`,
  and the checked Production box is visible above the fold. I also checked
  `tron-dark/step-10-ssh-x509-form.png`, and "Connect through an SSH tunnel" is checked and visible.
  Each theme has 22 PNGs (steps 01-11).
- CR-2 (`Promise.allSettled` in `beforeAll`, which stops whichever fixture did start and then
  rethrows the first rejection): I reviewed the code. TypeScript narrows both results to
  `fulfilled` after the throw, and typecheck passes. A test would need fault injection into the
  e2e `beforeAll`, which runs only against containers and an AppImage. Playwright has no unit
  harness for this in the project, so I left it untested (see "Unable to test").
- TW-1 (AppImage path and mtime logged and annotated): the parent's run printed
  `demo: AppImage …/thicket-0.0.0-linux-x86_64.AppImage, mtime 2026-11-17T04:56:49.217Z`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:e2e -- demo` passes against the AppImage | `test/e2e/demo/demo.e2e.ts` "release demo, steps 2–11, against the AppImage"; `test/e2e/m1/demo.e2e.ts` (matched by the filter) | Parent: `npm run dist` at 287f9b8 (AppImage rebuilt 04:56:49Z), then `npm run test:e2e -- demo`. I did not rerun it, because I was told not to rebuild and a rerun on the same AppImage adds nothing | Pass (parent's run): 2 passed (release demo 49.2 s, m1 demo 10.0 s). The AppImage predates the later rebase onto main, which brought in saved-pipelines. See TW-4 |
| AC2: screenshots of every step in Business light and Tron dark | `shot()` in demo.e2e.ts | `ls reviews/final-demo/{business-light,tron-dark}`; looked at the tron-dark step-02 and step-10 images | Pass: 22 + 22 PNGs, steps 01-11 in both themes. CR-1 is fixed in the committed tron-dark step-02 |
| SPEC steps 2-11 (the per-step checks in the first pass) | the same e2e steps "2." to "11." | the parent's e2e run above | Pass. The step assertions did not change. The fixer only changed the screenshot scroll, fixture start/cleanup and the AppImage log |
| Fixture change (`MONGOD_8_ARGS`): 8.x fixtures without the TCMalloc background thread, 7.0 unchanged | `fixtures.int.spec.ts` (5 tcmalloc cases + 6 existing) | `npx vitest run --config test/integration/vitest.config.ts fixtures.int.spec.ts --reporter=verbose` | Pass: 11/11 |
| Test code passes lint, typecheck and unit tests | the whole `npm run check` | `npm run check` | Pass |

## Focused test execution

Command:

`npx vitest run --config test/integration/vitest.config.ts fixtures.int.spec.ts --reporter=verbose`

Result:

Pass: 1 file, 11 tests (04:59:42Z-04:59:46Z, on HEAD 3c1b019). All 5 tcmalloc cases (mongo8,
mongo8rs, mongo7, mongo8tls, mongo7tls) passed.

## Full test execution

Command:

`npm run check`

Result:

Pass (05:59 local, i.e. 04:59Z, on HEAD 3c1b019). eslint + prettier and typecheck passed (root
tsconfig including `test/e2e`, plus every workspace). Vitest: 79 files, 4288 tests. Renderer:
100 files, 3273 tests.

Command:

`npm run test:int` (full)

Result:

Not run in this pass. Since the first pass, the fixtures and integration tests have not changed,
and the first pass's full run passed for every user of the changed fixtures. ldap and oidc failed
there for a host reason (SERVER-121912, kernel 6.19.10) that this task does not affect.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed above on HEAD 3c1b019.

## Bugs found

No production defects. The task changes no production code. Earlier findings and their
disposition:

- TW-1 (AppImage selection does not check freshness), Low: fixed by the fixer in 8348a54/e0c120e.
  The test now logs and annotates the AppImage path and mtime. There is still no hard staleness
  check, as agreed.
- TW-2 (evidence AppImage predated the earlier rebased main), Low: resolved for HEAD 287f9b8. The
  parent rebuilt the AppImage at 04:56:49Z and the demo passed. See TW-4 for the newer rebase.
- TW-3 (step 4 reaches page 3 by typing, not by one click), Low: recorded by the parent as an
  assumption in `tasks/final-demo.md`. No code change.

New in this pass:

### Evidence AppImage predates the saved-pipelines merge

Finding ID:

`TW-4`

Test:

`release demo, steps 2–11, against the AppImage`

Production source:

`apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage` (mtime 2026-11-17T04:56:49Z)

Requirement:

AC1: the demo passes against the packaged app of the code that `done` merges.

Expected behavior:

The AC1 evidence uses an AppImage built from the final HEAD.

Actual behavior:

At 04:58:33Z the branch was rebased onto main 7808dba. That brought in `saved-pipelines` (done at
04:57:33Z), which changes `packages/renderer/src/app/aggregation/aggregation-view.{ts,html,css}`,
`apps/desktop/src/pipelines/*`, `apps/desktop/src/main/{handlers,index}.ts` and
`packages/contract/src/pipelines.ts`. Demo step 8 runs in the aggregation view. The AppImage was
built before these changes, so the parent's passing e2e run did not include them. The diff of
`aggregation-view.{ts,html}` only adds code, apart from one comment and one `closeExplain()` call
it removes or moves. No `data-testid` the demo uses was removed, so I expect the demo to still
pass, but nobody has run it.

Severity:

Low

Fix required:

`No` code fix. To make the AC1 evidence match the merged code, the parent can run `npm run dist`
on 3c1b019 (or later) and rerun `npm run test:e2e -- demo`. Alternatively, the parent can accept
the patch-id rule: the task's own code is unchanged and fresh, but the packaged-app evidence is not.

## Coverage

Status: not applicable. The task changes no production source files, only e2e and integration test
code plus screenshots, so task-scoped production coverage has an empty scope. N/A is not 100%.

Metric: whole-file coverage of task-changed production files. Not measured because the scope is
empty.
Changed-line coverage: not measured, for the same reason. The changed files are test code. Vitest
coverage (`@vitest/coverage-v8`) instruments workspace sources and not `test/e2e` or
`test/integration`. The e2e suite runs a packaged AppImage, which has no coverage instrumentation.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: final-demo.
  The parent supplied base 91218ed and HEAD 287f9b8. After the rebase during this pass, the base is
  7808dba and HEAD is 3c1b019. Ownership comes from the parent's commit range, and the identical
  patch-id `a225bd2d...` confirms it.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 3c1b019. The task's test
  files are committed. Their sha256 hashes, taken before and unchanged by the rebase:
  `demo.e2e.ts` `6d62341e...020c09`, `ssh-x509.ts` `23fc315f...fcfe`, `fixtures.int.spec.ts`
  `0959b495...fb43b`, `fixtures/mongo.ts` `8c9c9cfa...5c5c`. The working tree also has uncommitted
  `reviews/final-demo/review.md` (reviewer output, not a test input) and this report.
- Exact included files; renamed/deleted/excluded files and reasons: production files included:
  none. Excluded as test code: `test/e2e/demo/*`, `test/e2e/harness/{app,fixtures}.ts`,
  `test/integration/fixtures.int.spec.ts`, `test/integration/fixtures/{mongo,socks,ssh}.ts`.
  Excluded as artifacts: `reviews/final-demo/**/*.png`.
- Provider/version, command, working directory, and test selection: no coverage command run, because
  the scope is empty.
- Run start/completion time and exit status: N/A
- Generated report paths and report hashes/run identifier: N/A
- Evidence outputs are fresh and inputs stayed unchanged: `npm run check` (started 04:59:03Z) and
  the fixture spec (04:59:42Z-04:59:46Z) both ran after the 04:58:33Z rebase, on 3c1b019. The e2e
  evidence is the parent's run on 287f9b8 with an AppImage built before the rebase (TW-4).
- Final run after latest test additions and production fixes: yes for check and the fixture spec.
  The e2e run is on the same task code but not on the rebased production code (TW-4). No
  production fixes were made. Coverage is N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/integration/fixtures/mongo.ts` (8.x branch of `MONGOD_8_ARGS`) | The 8.x fixtures must run without the TCMalloc background thread, and 7.0 must not get the parameter | Covered by the fixture test: 5/5 pass |
| `test/e2e/demo/demo.e2e.ts` `beforeAll` rejected-start branch (CR-2) | A fixture that started is stopped when the other one fails to start | Not exercised. It needs a fixture start to fail, and there is no harness to inject that. I reviewed the code and found it correct |
| `test/e2e/demo/demo.e2e.ts` skip without an AppImage or container runtime | A run without `npm run dist` skips | Not exercised, because an AppImage exists. The path and mtime are now logged (TW-1) |

## Unable to test

- The CR-2 cleanup path: it needs fault injection into the e2e `beforeAll`. No follow-up beyond
  the code review.
- The demo against an AppImage built from 3c1b019: I was told not to rebuild here (TW-4). The
  parent can rebuild and rerun.
- SPEC step 1 "download the release from GitHub, install" and `mongodb+srv://` with real SRV
  records (Atlas): outside the task's fixtures-only scope, unchanged from the first pass.
- The LDAP and OIDC integration suites cannot start on this host (SERVER-121912), so they were not
  run. They are unrelated to this task.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's CR-1, CR-2
and TW-1 changes are correct. CR-1 can be seen in the regenerated Tron dark screenshots, and
`npm run check` and the fixture integration spec pass on the final rebased HEAD 3c1b019. One new
Low observation, TW-4: the AC1 e2e evidence used an AppImage built before the saved-pipelines
merge that the last rebase brought in. To match the merged code, the parent should rebuild the
AppImage and rerun the demo, or else accept and record that the evidence predates the merge.

# Test Report

Date: 2026-11-17

Task: final-demo - Release: full demo script end to end

Scope: task commits on top of the merge-base with origin/main. Supplied by the parent: base
`2c3fefc051082e79d617638d0626aaf0181b71fe`, commits ef4c06c, 56e6e1b, 440356d, a751b3d. While this
review ran, the branch was rebased. The new base is `d6a2fdab5cfd18b8fec3a1734e60888620ba7e76` and
the new HEAD is `1b29213fdb446d26007422986482d7438a258540` (commits 1b98fdd, 4527cd3, c6949e6,
1b29213). The task's code did not change in the rebase: `git diff 2c3fefc a751b3d -- test | git
patch-id --stable` and `git diff d6a2fda 1b29213 -- test | git patch-id --stable` both give
`9e4f8bcaecb70d7bca16a8e74443d0035858af93`. Changed code (`git diff d6a2fda 1b29213 -- ':!reviews'`): `test/e2e/demo/demo.e2e.ts`,
`test/e2e/demo/ssh-x509.ts` (new), `test/e2e/harness/app.ts`, `test/e2e/harness/fixtures.ts`,
`test/integration/fixtures/mongo.ts`, `socks.ts`, `ssh.ts`. There are no production source changes.
The remaining changes are 44 screenshots under `reviews/final-demo/`.

Requirements:
- `tasks/final-demo.md` acceptance criteria 1 and 2
- `SPEC.md` section 2 (demo script, steps 1-11)
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`; `AGENTS.md` "Evidence"

## Test files changed

- `test/integration/fixtures.int.spec.ts`

## Tests added or updated

Count: 1 (a parameterised test with 5 cases, one per integration fixture)

- `MongoDB fixtures > %s runs with TCMalloc background thread off on 8.x only` checks the running
  containers. On the 8.x fixtures (mongo8, mongo8rs, mongo8tls),
  `getParameter tcmallocEnableBackgroundThread` must be `false`. On the 7.0 fixtures (mongo7,
  mongo7tls), `getCmdLineOpts` must not contain the parameter, because 7.0 lacks it. This guards
  the task's fixture change (`MONGOD_8_ARGS`): it applies to every 8.x fixture and leaves 7.0 alone.
  If `MONGOD_8_ARGS` is dropped, the test fails at once instead of tests crashing 30 s later with
  ECONNREFUSED.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:e2e -- demo` passes against the AppImage | `test/e2e/demo/demo.e2e.ts` "release demo, steps 2–11, against the AppImage"; `test/e2e/m1/demo.e2e.ts` (matched by the filter) | `npm run test:e2e -- demo` (headless Ozone, no xvfb on this host; AppImage `apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage`, mtime 05:46) | Pass: 2 passed (55.5 s + 10.6 s, 1.2 min). See TW-2: this AppImage predates the main commits the rebase brought in |
| AC2: screenshots of every step in Business light and Tron dark | `shot()` in demo.e2e.ts | inspected `git diff --stat` | Pass: 22 PNGs in `reviews/final-demo/business-light/` and 22 in `tron-dark/`. Steps 01-11 are present in both, with the same file names |
| SPEC step 1 welcome: "New connection" and "Import from Compass" | step "1." (`welcome-new`, `welcome-import`, `app.isPackaged` true) | same e2e run | Pass |
| SPEC step 2: paste URI; form fills host, user and options; password to keychain; production; connect | step "2." Host, port, user, masked password, TLS + CA, replica set; password not in `connections.json` and not in plain text in `secrets.bin`; Production checked; Test connection; Save; connect | same e2e run | Pass. The URI is `mongodb://` and not `mongodb+srv://` (a container has no SRV records). This deviation is documented in the suite header |
| SPEC step 3: sidebar databases and collections with counts and sizes; open orders | step "3." `node-stats` matches `40,000 docs, ` followed by a size; tab opens; `app-shell.production` is the red accent | same e2e run | Pass. The stats appear after the context-menu "stats" action, not on their own |
| SPEC step 4: 50 per page, page 3 one click away, filter and sort | step "4." 1–50 of ~40,000; page 3 = 101–150; filter + sort: only open orders with total > 100, descending; exact count equals the driver's | same e2e run | Pass. Page 3 is reached by typing 3 + Enter in the page field, which is not literally "one click" (TW-3) |
| SPEC step 5: nested items page inside the document; ObjectId, Date and Decimal128 | step "5." `data-bson-type` objectId/date/decimal; items 1–100 and 101–200 of 2,000 | same e2e run | Pass |
| SPEC step 6: edit total + new field, "2 changes", production confirm lists `$set`, saved | step "6." The confirm shows `updateOne(` with `$set` of `total` and `reviewed`; the driver reads the saved values; items intact | same e2e run | Pass |
| SPEC step 7: concurrent change → conflict side by side | step "7." The change is made with a driver update (the SPEC allows "or mongosh"); `conflict-local` and `conflict-server` rows for total and status; the server value is kept | same e2e run | Pass |
| SPEC step 8: $match → $group → $sort, preview per stage, export shell and Node | step "8." Each stage has its own preview; Run matches the driver's aggregate (first 3 rows); shell and Node export; no password in the code | same e2e run | Pass |
| SPEC step 9: create an index, Explain the earlier query: IXSCAN instead of COLLSCAN | step "9." COLLSCAN first; the index is created in the Indexes tab after the production confirm; then IXSCAN on `status_1_total_1` with no COLLSCAN | same e2e run | Pass |
| SPEC step 10: second profile through an SSH tunnel with a key file and X.509 | step "10." `ssh-x509.ts` fixture: the MongoDB member is reachable only through the bastion; MONGODB-X509 cert and CA from the URI; SSH private key file; host key trusted; the `fleet` collection is read | same e2e run | Pass |
| SPEC step 11: mongosh console, `db.orders.countDocuments()` | step "11." The result equals the driver's count; the console has the production class | same e2e run | Pass |
| Fixture change keeps the integration fixtures' other users working | new fixture test; `ssh.int.spec.ts`; `proxy.int.spec.ts`; full `npm run test:int` | see "Focused test execution" and "Full test execution" | Pass for every user of the changed fixtures (see the notes on ldap, oidc and shell below) |

## Focused test execution

Command:

`npx vitest run --config test/integration/vitest.config.ts fixtures.int.spec.ts ssh.int.spec.ts proxy.int.spec.ts`

Result:

Pass: 3 files, 36 tests (05:48:51-05:49:32). A verbose rerun of `fixtures.int.spec.ts` gave 11
passed, including all 5 new cases.

## Full test execution

Command:

`npm run check`

Result:

Pass: eslint + prettier, typecheck, Vitest 78 files / 4222 tests, renderer 100 files / 3254 tests
(05:49:43-05:51:08). The first attempt failed Prettier on my new test. I formatted it with
`npx prettier --write` before this run.

Command:

`npm run test:int`

Result:

Fail, not caused by this task. 18 of 21 files passed: 588 tests passed, 14 skipped, 1 failed.
- `ldap.int.spec.ts` and `oidc.int.spec.ts` fail in setup with "Log stream ended and message
  /Waiting for connections/ was not received". They use the Enterprise 8.0 image with their own
  mongod command. They do not use `MONGO_IMAGES`, `startFixture` or `MONGOD_8_ARGS`, and this task
  did not touch them. The fixture header names the cause: mongo 8.0 refuses to start on kernels
  6.19.0-7.0.13 (SERVER-121912), and this host runs 6.19.10. It is a host limitation that predates
  this task.
- `shell.int.spec.ts > interrupt > stops while(true){} within 2 s` failed once, when `npm run check`
  ran at the same time (CPU contention against a 2 s deadline). Run alone
  (`npx vitest run --config test/integration/vitest.config.ts shell.int.spec.ts ldap.int.spec.ts oidc.int.spec.ts`),
  shell.int.spec.ts passed with 18 tests. ldap and oidc failed again for the reason above.

Every integration file that uses the changed fixtures passed: `fixtures`, `ssh`, `proxy`, `x509`,
`tls`, `browse`, `indexes` and the global-setup users.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, and the run above passed with the new test in place.

## Bugs found

No production defects. The task changes no production code, and the demo suite passes.
Observations for the parent (no production fix required):

### AppImage selection does not check freshness

Finding ID:

`TW-1`

Test:

`release demo, steps 2–11, against the AppImage`

Production source:

`test/e2e/demo/demo.e2e.ts:80` (`findAppImage`)

Requirement:

AC1: the suite runs against the packaged app of the code under test.

Expected behavior:

The suite fails, or says so clearly, when the AppImage is older than the sources.

Actual behavior:

The suite takes `$THICKET_APPIMAGE` or the newest `*.AppImage` in `apps/desktop/release` without
checking its age. If no AppImage exists, the test is skipped, not failed. A run without
`npm run dist` reports "skipped", and a stale AppImage passes silently.

Severity:

Low

Fix required:

`No`. It is a test-harness robustness note. Record "passed" (not "skipped") as evidence, and
rebuild with `npm run dist` before the evidence run.

### Evidence AppImage predates the rebased main

Finding ID:

`TW-2`

Test:

`release demo, steps 2–11, against the AppImage`

Production source:

`apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage`, built 2026-11-17 05:46

Requirement:

AC1

Expected behavior:

The AC1 evidence covers the code that `done` merges.

Actual behavior:

The rebase brought in main's `query-history` production change at 05:47 (`collection-view.ts`
and `.html`, `apps/desktop/src/history/*`, `packages/contract/src/history.ts`). That is after the
AppImage was built. Both the parent's and my e2e run therefore used a packaged app without
query-history. The query bar in step 4 and step 9 is on the changed collection view.

Severity:

Low

Fix required:

`No` code fix. To make the evidence match the merged code, the parent can rebuild with
`npm run dist` and rerun `npm run test:e2e -- demo`.

### Step 4 "page 3 is one click away" is done with typing

Finding ID:

`TW-3`

Test:

`release demo, steps 2–11, against the AppImage` (step 4)

Production source:

`test/e2e/demo/demo.e2e.ts:369`

Requirement:

SPEC section 2, step 4: "page 3 of ~40 000 is one click away".

Expected behavior:

Page 3 is reached in one user action.

Actual behavior:

The test fills `pager-page` with `3` and presses Enter. This is one action, but not a click. The
pager behavior itself belongs to an earlier task, so this is a reading of the SPEC wording, not a
defect.

Severity:

Low

Fix required:

`No`. Either accept it or record it as an assumption.

## Coverage

Status: not applicable. The task changes no production source files, only e2e and integration test
code plus screenshots, so task-scoped production coverage has an empty scope. N/A is not 100%.

Metric: whole-file coverage of task-changed production files. Not measured because the scope is
empty.
Changed-line coverage: not measured, for the same reason. The changed files are test code. Vitest
coverage (`@vitest/coverage-v8`) instruments workspace sources and not `test/e2e` or
`test/integration`. The e2e suite runs a packaged AppImage, which has no coverage instrumentation.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: final-demo. The
  parent supplied base 2c3fefc and commits ef4c06c..a751b3d. After the rebase, the base is d6a2fda,
  HEAD is 1b29213 and the task commits are 1b98fdd..1b29213. Ownership comes from the parent's
  commit list, and the identical patch-id `9e4f8bca...` confirms it.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 1b29213 plus my uncommitted
  `test/integration/fixtures.int.spec.ts` (sha256 `0959b495...fb43b`). `demo.e2e.ts` sha256 is
  `0a7ea9e9...44d6` and `ssh-x509.ts` sha256 is `23fc315f...fcfe`.
- Exact included files; renamed/deleted/excluded files and reasons: production files included:
  none. Excluded as test code: `test/e2e/demo/*`, `test/e2e/harness/{app,fixtures}.ts`,
  `test/integration/fixtures/{mongo,socks,ssh}.ts`. Excluded as artifacts: `reviews/final-demo/*.png`.
- Provider/version, command, working directory, and test selection: no coverage command run, because
  the scope is empty.
- Run start/completion time and exit status: N/A
- Generated report paths and report hashes/run identifier: N/A
- Evidence outputs are fresh and inputs stayed unchanged: the test runs above (05:48-05:54) ran on
  1b29213 plus the new test. The rebase to 1b29213 happened before the first of them.
- Final run after latest test additions and production fixes: yes for the tests. No production
  fixes were made. Coverage is N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/integration/fixtures/mongo.ts:74` (8.x branch of `MONGOD_8_ARGS`) | The 8.x fixtures must run without the TCMalloc background thread, and 7.0 must not get the parameter | Covered by the new fixture test, which checks each running fixture |
| `test/e2e/demo/demo.e2e.ts:122,274-278` (skip without an AppImage or container runtime) | A run without `npm run dist` skips | Not exercised here, because an AppImage exists. See TW-1 |

## Unable to test

- SPEC step 1 "download the release from GitHub, install": outside the task (steps 2-11). The suite
  only checks that the packaged app starts on the welcome screen. No follow-up.
- `mongodb+srv://` with a real SRV record (Atlas): containers have no SRV records, so the suite
  pastes an equivalent `mongodb://` TLS replica-set URI. The task allows fixtures instead of Atlas.
- LDAP and OIDC integration suites: they cannot start on this host (SERVER-121912, kernel 6.19).
  They are unrelated to this task and need no follow-up from it.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The demo suite covers
SPEC steps 2-11 as its header claims, and it passes against the AppImage. Both themes have
screenshots for steps 1-11. The fixture change is guarded by a new integration test, and every user
of the changed fixtures passes. Three Low observations (TW-1 to TW-3) need no production fix. The
most actionable is TW-2: rebuild the AppImage on the rebased HEAD before the final AC1 evidence.

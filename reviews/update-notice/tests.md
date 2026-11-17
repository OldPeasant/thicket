# Test Report

Date: 2026-11-17

Task: update-notice — Release (Should): Update available notice

Scope: round 2, final code. Task range `71edb3483a5901c8059bb754ca7696bbdd2d4391..e8545506` on `main`. The task-owned code commits are 94b93322, a692c990 and e8545506 (the fixer's CR-1/CR-2 fix). a4afc8ba (round-1 tests and reports) and ffe57830 (heartbeat) are also in the range. The report also covers the uncommitted round-2 test changes listed below. Round-2 focus: `git diff a4afc8ba..e8545506`. In that diff, `windowOpenHandler` moved into `apps/desktop/src/main/security.ts`, `openReleaseLink` was removed and `isReleaseUrl` was narrowed to `.../releases/tag/`.

Requirements:
- `tasks/update-notice.md` acceptance criteria: (1) unit tests with recorded API responses for newer, same, pre-release ignored and network error silent; (2) setting off -> no request made (test)
- Task goal: check the GitHub releases API at start (and daily) unless disabled in settings; show a non-modal notice with a link to the release
- Task assumption: the notice link opens only `https://github.com/OldPeasant/thicket/releases/...` pages and the window is still denied. After CR-2 this is narrowed to `/releases/tag/`.
- `docs/ARCHITECTURE.md` "Update notice", the guards bullet in "Desktop" and "Coverage"; `reviews/update-notice/fixes.md`

## Test files changed

Round 2 (uncommitted):
- `apps/desktop/src/update/checker.spec.ts`
- `apps/desktop/src/main/security.spec.ts`

Round 1 (committed in a4afc8ba; the fixer moved its tests into `security.spec.ts` in e8545506):
- `apps/desktop/src/update/checker.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`, `packages/renderer/src/app/update/update-notice.spec.ts`, `packages/renderer/src/app/layout/app-shell.spec.ts`

## Tests added or updated

Count: 2 added in round 2. Round 1 added 29. No existing test was changed or removed.

- `checker.spec.ts`: `skips a release whose html_url is not a tag page and reports the newest one that is`. This is an end-to-end check of CR-2 through `UpdateChecker.check()`. A newer release whose `html_url` is an asset download URL, and another whose `html_url` is `/releases/latest`, are both skipped. The notice reports the newest release that does have a tag page (0.3.0), not "no update".
- `security.spec.ts`: `opens nothing for non-tag release URLs, http or a path escaping /releases/tag/ (test-writer)`. `windowOpenHandler` denies the window and never calls `openExternal` for these URLs: `/releases/latest`, `/releases/tag/../download/...`, `http://` tag pages, URLs with credentials, and a string that is not a URL. This checks the integrated guard as it is wired in `main/index.ts`, not only `isReleaseUrl`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 recorded responses: newer | `reports a newer release with its page`; `picks the newest stable release by version...`; `skips a release whose html_url is not a tag page...`; `answers app.checkForUpdate over a window port within the contract` | `cd apps/desktop && npx vitest run src/update src/main` | Pass |
| AC1 recorded responses: same | `reports no update when the running version is the latest`; `...newer than every release` | same | Pass |
| AC1 pre-release ignored | `ignores pre-releases (the flag, or a pre-release tag)`; `ignores a pre-release tag published without the pre-release flag, and drafts`; `only pre-releases and drafts: no update and nothing to link` | same | Pass |
| AC1 network error silent | `is silent on a network error`; `...HTTP error (rate limit)`; `...unexpected body`; `...reading the body fails`; `aborts a request that hangs`; `a shared request that fails answers every caller silently...`; `is silent without a log and on a failure that is not an Error`; renderer `is silent when the check fails`, `a failed daily check keeps the notice shown before` | desktop command above; `cd packages/renderer && npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts` | Pass |
| AC2 setting off -> no request | `off: no request is made`; `off: no request is made, also not on repeated checks`; `off: the app.checkForUpdate handler makes no request`; `with the setting off answers "no update" over the port and makes no request`; `with the setting off the global fetch is never called either`; renderer `setting off: no check is requested, not at start and not daily`, `turning the setting off hides the notice and stops the daily check` | both commands above | Pass |
| Goal: check at start and daily | renderer `checks at start and shows a newer release`; `checks again once a day`; `init() again does not start a second check or timer`; `stops the daily check once its injector is destroyed` | renderer command | Pass |
| Goal: non-modal notice with link to the release | `shows the version and a link to the release that opens outside the app`; `closes with the dismiss button`; app-shell `shows the update notice for a newer release without blocking the window` | renderer command | Pass |
| Release link: only Thicket release tag pages are opened externally; the window is always denied (CR-1/CR-2) | `release links > accepts only https tag pages of the Thicket releases`; `never links to a page outside the Thicket releases`; `skips a release whose html_url is not a tag page...`; security.spec `denies every window.open and opens nothing for non-release URLs`, `opens a release page externally and denies every window`, `logs when the browser cannot be opened`, `a browser failure without a log is swallowed`, `opens nothing for non-tag release URLs, http or a path escaping /releases/tag/` | desktop command | Pass |
| Unpackaged app does not check unless `THICKET_UPDATE_CHECK=1`; `setWindowOpenHandler` wiring (`main/index.ts`) | none | — | Not run: the Electron entrypoint has no unit-test harness in this repo; see "Unable to test" |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/update src/main`

Result:

Pass: 6 files, 119 tests passed. The fixer's run before round 2 had 117 tests; round 2 adds 2.

Command:

`cd packages/renderer && npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts` (run with coverage, see below)

Result:

Pass: 2 files, 97 tests passed.

Also: `npx prettier --check` and `npx eslint` on the two changed spec files both passed.

## Full test execution

Command:

`sh .taskcheck` (= `npm run check` = `npm run lint && npm run typecheck && npm run test`)

Result:

Pass. Lint (eslint, prettier) and typecheck passed. The Vitest workspaces passed with 92 files / 4813 tests, and the renderer `ng test` passed with 111 files / 3734 tests. The renderer suite is the last step of the `&&` chain. Integration (`npm run test:int`) and e2e were not run because the criteria do not name them.

## .taskcheck

Result:

Pass (see above).

## Bugs found

None. Testing found no production defect in the final code.

A round-1 observation still applies; it is not a defect against the criteria. In `UpdateNoticeService.check()`, an answer that arrives after the setting was switched off and on again is still applied. Both answers come from main's shared, cached checker, so in practice they are identical. The parent decides whether to act on it.

## Coverage

Status: verified. Fresh desktop and renderer runs were made on the final snapshot. `apps/desktop/src/main/index.ts` measures 0% (see gaps).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: no tool measured it. By inspection, `update/checker.ts`, `update/handlers.ts` and `update-notice*.ts` are new files, so whole-file coverage equals changed-line coverage. `security.ts` is 100% for the whole file, so its changed lines (the `isReleaseUrl` import and `windowOpenHandler`) are covered. The 4 added lines of `main/handlers.ts` run, and the `deps.updates` branch is taken both ways. The 3 added lines of `app-shell.ts` are covered. The added lines of `main/index.ts` do not run.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `update-notice`; base `71edb3483a5901c8059bb754ca7696bbdd2d4391`; HEAD `e8545506`. The parent supplied the base, HEAD and the fixer range a4afc8ba..e8545506. `git diff --stat 71edb348..e8545506` confirms them. `tasks/gridfs.md` in that diff belongs to another task (a board change) and is excluded.
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD, with no production changes in `git status`. sha256 prefixes: `checker.ts` 5901881b4b9e, `update/handlers.ts` 7f02cf912efb, `update/index.ts` 9a86b9d11166, `main/handlers.ts` 1f08d06d48e9, `main/index.ts` 650697321b10, `main/security.ts` e23c2f35c05c, `update-notice.service.ts` 5ad2084013ce, `update-notice.ts` 1f56c8f0dc87, renderer `update/index.ts` 016fbf7f8ba2, `app-shell.ts` 3477cb3c080a. Uncommitted specs: `checker.spec.ts` 21457c50e296, `security.spec.ts` f9f712b68b70. Another process (not this test-writer) modified `reviews/update-notice/review.md` in the working tree; it is not a test input.
- Exact included files: desktop `src/update/checker.ts`, `src/update/handlers.ts`, `src/update/index.ts`, `src/main/handlers.ts`, `src/main/index.ts`, `src/main/security.ts` (new in scope: e8545506 materially changed it); renderer `src/app/update/update-notice.service.ts`, `src/app/update/update-notice.ts`, `src/app/update/index.ts`, `src/app/layout/app-shell.ts`. Excluded: `docs/ARCHITECTURE.md` (docs), `apps/desktop/src/update/fixtures/*.json` (test data), spec files, `tasks/*`, `reviews/*`. There are no renames and no deleted files (`openReleaseLink` was removed from `update/handlers.ts`, which still exists). Both `index.ts` barrels are pure re-exports with 0 counters, shown as N/A.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0. Desktop (`apps/desktop`): `npx vitest run src/update src/main --coverage --coverage.include=src/update/checker.ts --coverage.include=src/update/handlers.ts --coverage.include=src/update/index.ts --coverage.include=src/main/handlers.ts --coverage.include=src/main/index.ts --coverage.include=src/main/security.ts --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`. Renderer (`packages/renderer`): `npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts --coverage --coverage-include=src/app/update/update-notice.service.ts --coverage-include=src/app/update/update-notice.ts --coverage-include=src/app/update/index.ts --coverage-include=src/app/layout/app-shell.ts`.
- Run start/completion time and exit status: the desktop run started 2026-11-17 07:39:06 +01:00 and its report was written at 07:39:09; 119 passed, all files passed. The renderer run started at 07:38:58 and its report was written at 07:39:00; 97 passed, all files passed. Both runs completed and wrote reports, and neither reported a failure.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` sha256 d9a4598027b2…, `apps/desktop/coverage/coverage-final.json` 8eb0534097e2…, `packages/renderer/coverage/renderer/coverage-summary.json` 613afb709d2c…, `packages/renderer/coverage/renderer/lcov.info` 8f0298525160…. All are git-ignored. The renderer hashes match round 1, as expected: no renderer source or spec changed.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Both reports were regenerated by these runs, with mtimes after the last spec edit. The hashes were taken after the runs, and production files still match HEAD.
- Final run after latest test additions and production fixes: yes. This covers the fixer's e8545506 and both round-2 tests.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/update/checker.ts` | 91/91 (100%) | 76/76 (100%) | 15/15 (100%) | 74/74 (100%) |
| `apps/desktop/src/update/handlers.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| `apps/desktop/src/update/index.ts` | N/A | N/A | N/A | N/A |
| `apps/desktop/src/main/security.ts` | 54/54 (100%) | 30/30 (100%) | 14/14 (100%) | 47/47 (100%) |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 21/22 (95.45%) | 6/6 (100%) | 15/15 (100%) |
| `apps/desktop/src/main/index.ts` | 0/85 (0%) | 0/28 (0%) | 0/39 (0%) | 0/77 (0%) |
| `packages/renderer/src/app/update/update-notice.service.ts` | 51/52 (98.08%) | 27/28 (96.43%) | 12/12 (100%) | 39/39 (100%) |
| `packages/renderer/src/app/update/update-notice.ts` | 22/22 (100%) | 12/12 (100%) | 2/2 (100%) | 13/13 (100%) |
| `packages/renderer/src/app/update/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/layout/app-shell.ts` | 154/155 (99.35%) | 88/88 (100%) | 30/31 (96.77%) | 116/116 (100%) |
| **Aggregate (all 10 files, summed counters)** | 392/479 (81.84%) | 254/284 (89.44%) | 81/121 (66.94%) | 306/383 (79.90%) |
| Aggregate without `main/index.ts` | 392/394 (99.49%) | 254/256 (99.22%) | 81/82 (98.78%) | 306/306 (100%) |

Every scoped file appears in the reports, and the two barrels have no executable code. `main/index.ts` dominates the aggregate: it is the whole Electron entry file, and most of it is pre-existing code. Compared with round 1, `update/handlers.ts` is smaller because `openReleaseLink` moved out, and `security.ts` is new in scope.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts:54-266` (whole file) | Task lines: the `updateChecker()` gate (`app.isPackaged \|\| THICKET_UPDATE_CHECK=1`, the `checkForUpdates` setting), wiring `updates` into `mainHandlers`, and `setWindowOpenHandler` -> `windowOpenHandler` | Not unit-testable without Electron: the module's top level calls `app`, `protocol` and `shell`, and no existing spec imports it. The parts it composes are all tested: `UpdateChecker` with `enabled: false`, the default global fetch, `mainHandlers` with `updates`, and `windowOpenHandler`. The `isPackaged` gate is a gap; follow up only if an Electron/e2e harness is wanted. |
| `apps/desktop/src/main/handlers.ts:57` branch (`deps.pipelines` false arm) | Pre-existing pipelines wiring, not part of this task | Out of task scope. The task's line 59 is covered both ways. |
| `packages/renderer/src/app/update/update-notice.service.ts:86` (true arm of `if (!this.enabled) return`) | Defensive guard. The interval is cleared when the setting goes off, so `check()` is never reached while disabled. | Not meaningfully reachable. The observable behavior (no check while off) is tested. |
| `packages/renderer/src/app/layout/app-shell.ts:137` (`viewChild.required(TabBar)` getter) | Pre-existing code, not part of this task | Out of task scope. |

## Unable to test

- `main/index.ts` `updateChecker()`: an unpackaged app should not call GitHub unless `THICKET_UPDATE_CHECK=1`. The Electron `setWindowOpenHandler` wiring to `windowOpenHandler` is also untested. Both need an Electron-level harness, which unit tests here don't have. A follow-up is optional; the composed units are covered.
- Real GitHub API: never called, by design. The tests use recorded fixtures (`apps/desktop/src/update/fixtures/`) and fictitious entries.

## Summary

Tests added and all validation passed. Both acceptance criteria are covered by passing tests that use recorded API responses. The fixer's CR-1 and CR-2 changes are covered, including the end-to-end skip of non-tag `html_url`s and the integrated window-open guard. Task-scoped coverage is 100% for the new update code and `security.ts`, and about 99% for the renderer. No production defects were found. The only meaningful gap is the gate in the Electron entrypoint (`main/index.ts`), which this repo does not unit-test.

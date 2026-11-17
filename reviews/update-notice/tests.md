# Test Report

Date: 2026-11-17

Task: update-notice — Release (Should): Update available notice

Scope: task commits `71edb3483a5901c8059bb754ca7696bbdd2d4391..122e57dd668fedf82f5cda674e6a89cc969f1c53` (9077f6f7, 122e57dd) on `main`, plus the uncommitted test-file changes listed below.

Requirements:
- `tasks/update-notice.md` acceptance criteria (1) unit tests with recorded API responses: newer, same, pre-release ignored, network error silent; (2) setting off -> no request made (test)
- Task goal: check the GitHub releases API at start (and daily) unless disabled in settings; show a non-modal notice with a link to the release
- `docs/ARCHITECTURE.md` "Update notice" and "Coverage" sections; contract `app.checkForUpdate` (`packages/contract/src/app.ts`)

## Test files changed

- `apps/desktop/src/update/checker.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`
- `packages/renderer/src/app/update/update-notice.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

## Tests added or updated

Count: 29 added (20 desktop, 9 renderer); no existing test changed or removed.

- `checker.spec.ts` (+16): newest stable picked by version not list/text order (0.10.0 vs 0.9.0); empty list; only pre-releases/drafts; non-semver running version (`dev`) never claims an update; cache kept until exactly `UPDATE_CACHE_MS`; callers get independent copies (mutation does not poison the cache); a shared failing request answers all callers silently and the next check retries; default global `fetch` is used when none is injected (as `main/index.ts` wires it); setting off never calls the global `fetch`; silent without a log and on a non-Error rejection; no timeout timer left behind; setting off over repeated checks across cache windows; setting turned on later -> next check requests; semver ordering in both directions; unsafe-integer versions rejected; browser-open failure without a log is swallowed.
- `handlers.spec.ts` (+4): `app.checkForUpdate` served only when `updates` is given, routed to main, absent from the privileged handlers; answered over a window port within the contract (real `UpdateChecker`, fake fetch); setting off over the port -> "no update" and no request; unexpected params -> `INVALID_PARAMS` and no request.
- `update-notice.spec.ts` (+7): failed daily check keeps the earlier notice; later "no update" hides it; answer without url/latest shows nothing; `dismiss()` without a notice is a no-op and a later update still shows; `init()` twice starts no second check/timer; destroying the injector stops the daily check; a repeated "on" broadcast does not check again.
- `app-shell.spec.ts` (+2): the shell renders the notice for a newer release, non-modal (no `inert`, Ctrl+W still works) and inert only behind a modal confirm dialog; no notice when `app.checkForUpdate` is unavailable.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 recorded responses: newer | `reports a newer release with its page`; `picks the newest stable release by version...`; `answers app.checkForUpdate over a window port within the contract` | `cd apps/desktop && npx vitest run src/update src/main` | Pass |
| AC1 recorded responses: same | `reports no update when the running version is the latest`; `...newer than every release` | same | Pass |
| AC1 pre-release ignored | `ignores pre-releases (the flag, or a pre-release tag)`; `ignores a pre-release tag published without the pre-release flag, and drafts`; `only pre-releases and drafts: no update and nothing to link` | same | Pass |
| AC1 network error silent | `is silent on a network error`; `...HTTP error (rate limit)`; `...unexpected body`; `...reading the body fails`; `aborts a request that hangs`; `a shared request that fails answers every caller silently...`; `is silent without a log and on a failure that is not an Error`; renderer `is silent when the check fails`, `a failed daily check keeps the notice shown before` | desktop command above; `cd packages/renderer && npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts` | Pass |
| AC2 setting off -> no request | `off: no request is made`; `off: no request is made, also not on repeated checks`; `off: the app.checkForUpdate handler makes no request`; `with the setting off answers "no update" over the port and makes no request`; `with the setting off the global fetch is never called either`; renderer `setting off: no check is requested, not at start and not daily`, `turning the setting off hides the notice and stops the daily check` | both commands above | Pass |
| Goal: check at start and daily | renderer `checks at start and shows a newer release`; `checks again once a day`; `init() again does not start a second check or timer`; `stops the daily check once its injector is destroyed` | renderer command | Pass |
| Goal: non-modal notice with link to the release | `shows the version and a link to the release that opens outside the app`; `closes with the dismiss button`; app-shell `shows the update notice for a newer release without blocking the window` | renderer command | Pass |
| Release link opens only Thicket release pages externally | `accepts only https pages of the Thicket releases`; `opens a release page externally and denies every window`; `never links to a page outside the Thicket releases` | desktop command | Pass |
| Unpackaged app does not check unless `THICKET_UPDATE_CHECK=1` (`main/index.ts` `updateChecker`) | none | — | Not run: Electron entrypoint (`app.isPackaged`, `app.getVersion`, `shell`) has no unit-test harness in this repo; see "Unable to test" |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/update src/main` (baseline before changes: 98 passed)

Result:

Pass — 6 files, 118 tests passed.

Command:

`cd packages/renderer && npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts`

Result:

Pass — 2 files, 97 tests passed.

## Full test execution

Command:

`sh .taskcheck` (= `npm run check`: eslint, prettier --check, typecheck, all Vitest workspaces, renderer `ng test`)

Result:

Pass — after formatting `checker.spec.ts` with Prettier (first run flagged its formatting): 92 files / 4812 tests passed and renderer 111 files / 3734 tests passed. Integration (`npm run test:int`) and e2e were not run: the criteria do not name them.

## .taskcheck

Result:

Pass (see above).

## Bugs found

None. No production defect was found.

Observation (not a defect against the stated criteria, no test asserts it): in `UpdateNoticeService.check()` an answer that arrives after the setting was switched off and on again is still applied, so an older request answering last could overwrite a newer one's result. Both answers come from main's shared/cached checker, so in practice they are the same; left for the parent to judge.

## Coverage

Status: verified (desktop and renderer, fresh runs on the final snapshot); `apps/desktop/src/main/index.ts` measured at 0% (see gaps).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a tool. By inspection: `update/checker.ts`, `update/handlers.ts`, `update-notice.ts` are new files (whole-file = changed-line); the 4 added lines of `main/handlers.ts` are executed (the `deps.updates` branch is hit both ways); the 3 added lines of `app-shell.ts` are exercised by the new app-shell tests; the added lines of `main/index.ts` are not executed.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `update-notice`; base `71edb3483a5901c8059bb754ca7696bbdd2d4391`; HEAD `122e57dd668fedf82f5cda674e6a89cc969f1c53`; commits 9077f6f7, 122e57dd supplied by the parent and confirmed with `git log`/`git diff --stat 71edb348..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production files unchanged from HEAD (sha256 before and after: `checker.ts` a27fe52e…, `update/handlers.ts` c455ffdb…, `main/handlers.ts` 1f08d06d…, `main/index.ts` 601ad05c…, `update-notice.service.ts` 5ad20840…, `update-notice.ts` 1f56c8f0…, `app-shell.ts` 3477cb3c…). Uncommitted tests: `checker.spec.ts` 23c6ca5c…, `main/handlers.spec.ts` 5ed1bf24…, `update-notice.spec.ts` 6f229fd8…, `app-shell.spec.ts` f2e71a31….
- Exact included files: desktop `src/update/checker.ts`, `src/update/handlers.ts`, `src/update/index.ts`, `src/main/handlers.ts`, `src/main/index.ts`; renderer `src/app/update/update-notice.service.ts`, `src/app/update/update-notice.ts`, `src/app/update/index.ts`, `src/app/layout/app-shell.ts`. Excluded: `docs/ARCHITECTURE.md` (docs), `apps/desktop/src/update/fixtures/*.json` (test data), spec files. No renames or deletions. Both `index.ts` barrels are pure re-exports (0 executable counters, reported N/A).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 + @vitest/coverage-v8 5.1.0. Desktop (`apps/desktop`): `npx vitest run src/update src/main --coverage --coverage.include=<each desktop file above> --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary`. Renderer (`packages/renderer`): `npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts --coverage --coverage-include=<each renderer file above>`.
- Run start/completion time and exit status: desktop final run started 2026-11-17 07:34:27 (+01:00), 118 passed, exit 0; renderer final run started 07:32:31, report written 07:32:33, 97 passed, exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` sha256 e027653f…, `apps/desktop/coverage/coverage-final.json` f2cfe5b9…; `packages/renderer/coverage/renderer/coverage-summary.json` 613afb70…, `packages/renderer/coverage/renderer/lcov.info` 8f029852… (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; each report was regenerated by its run (timestamps after the last spec edit). The desktop report was regenerated after the Prettier reformat of `checker.spec.ts` (identical counters and hash to the pre-format run, as expected for a formatting-only change).
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/update/checker.ts` | 91/91 (100%) | 76/76 (100%) | 15/15 (100%) | 74/74 (100%) |
| `apps/desktop/src/update/handlers.ts` | 7/7 (100%) | 3/3 (100%) | 5/5 (100%) | 6/6 (100%) |
| `apps/desktop/src/update/index.ts` | N/A | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 21/22 (95.45%) | 6/6 (100%) | 15/15 (100%) |
| `apps/desktop/src/main/index.ts` | 0/85 (0%) | 0/28 (0%) | 0/39 (0%) | 0/77 (0%) |
| `packages/renderer/src/app/update/update-notice.service.ts` | 51/52 (98.08%) | 27/28 (96.43%) | 12/12 (100%) | 39/39 (100%) |
| `packages/renderer/src/app/update/update-notice.ts` | 22/22 (100%) | 12/12 (100%) | 2/2 (100%) | 13/13 (100%) |
| `packages/renderer/src/app/update/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/layout/app-shell.ts` | 154/155 (99.35%) | 88/88 (100%) | 30/31 (96.77%) | 116/116 (100%) |
| **Aggregate (all 9 files, summed counters)** | 343/430 (79.77%) | 227/257 (88.33%) | 70/110 (63.64%) | 263/340 (77.35%) |
| Aggregate without `main/index.ts` | 343/345 (99.42%) | 227/229 (99.13%) | 70/71 (98.59%) | 263/263 (100%) |

No scoped file is missing from the reports; the two barrels have no executable code. The aggregate is dominated by `main/index.ts` (whole Electron entry file, mostly pre-existing code).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts:53-265` (whole file) | Task lines: `updateChecker()` gating (`app.isPackaged \|\| THICKET_UPDATE_CHECK=1`, `checkForUpdates` setting), wiring `updates` into `mainHandlers`, `setWindowOpenHandler` -> `openReleaseLink` | Not unit-testable without Electron (module top-level calls `app`, `protocol`, `shell`); no existing spec imports it. The pieces it composes are tested (`UpdateChecker` with `enabled: false`, default global fetch, `mainHandlers` with `updates`, `openReleaseLink`). The `isPackaged` gating is a gap: follow-up only if an Electron/e2e harness is wanted. |
| `apps/desktop/src/main/handlers.ts:57` branch (`deps.pipelines` false arm) | Pre-existing pipelines wiring, not this task | Out of task scope; the task's line 59 is covered both ways. |
| `packages/renderer/src/app/update/update-notice.service.ts:86` (`if (!this.enabled) return` true arm) | Defensive guard: the interval is cleared when the setting goes off, so `check()` is not reached while disabled | Not meaningfully reachable; the observable behavior (no check while off) is tested. |
| `packages/renderer/src/app/layout/app-shell.ts:137` (`viewChild.required(TabBar)` getter) | Pre-existing code, not this task | Out of task scope. |

## Unable to test

- `main/index.ts` `updateChecker()`: an unpackaged app does not call GitHub unless `THICKET_UPDATE_CHECK=1`, and the Electron window-open handler wiring. Needs an Electron-level harness (not present for unit tests); follow-up optional, the composed units are covered.
- Real GitHub API: by design not called; recorded fixtures (`apps/desktop/src/update/fixtures/`) and fictitious entries are used.

## Summary

Tests added and all validation passed. Both acceptance criteria are covered by passing tests with recorded API responses; task-scoped coverage of the new update code is 100% (desktop) and ~99% (renderer). No production defects found. The only meaningful gap is the Electron entrypoint (`main/index.ts`) gating, which this repo does not unit-test.

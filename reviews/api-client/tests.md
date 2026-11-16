# Test Report

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: second pass on the final revision. `git diff b93d0f27ec0c9375109365a71c4c820b97163e18..1a78a243ceea440d17c45ea755ccb11c52193055 -- packages docs` on branch `main`. Task commits: 6c069c2 (implementation), 563e443 (first-pass tests and reports) and 1a78a24 (fixes for TW-1 and CR-1/2/3). The parent worker supplied the base and the commits. The first pass ran against the pre-rebase base acc64cf with task commit 22bf57a; that is the same task work before the rebase. Production files in scope: `packages/renderer/src/app/api/api.service.ts` (changed by the fixer), `api-error.ts`, `thicket-bridge.ts` and `testing/fake-thicket-bridge.ts`. `index.ts` and `testing/index.ts` contain only re-exports. Uncommitted inputs: `api.service.spec.ts` (this pass); hashes are below. No production file was changed. `reviews/api-client/review.md` was also modified in the working tree during this pass; that was not done by the test-writer.

Requirements:
- `tasks/api-client.md`: acceptance criteria 1-3 and the two recorded assumptions
- `reviews/api-client/fixes.md` (TW-1, CR-1 null `streamId` and `onStart`, CR-2 early buffer, CR-3 doc) and the JSDoc of `ApiService.stream`, `StreamOptions` and `MAX_EARLY_EVENTS`
- `packages/contract/src/io.ts` (`io.export` result `streamId` is `null` when the dialog was cancelled) and `BROADCAST_STREAMS` (`conn.status`, `app.theme`)
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`

## Test files changed

- `packages/renderer/src/app/api/api.service.spec.ts`

## Tests added or updated

Count: 14 in this pass. The renderer suite went from 167 to 181 tests. Each `it.each` case is counted separately. No existing test was changed, weakened or skipped.

- "request edge cases" (3), for TW-1: the bridge resolving a string, or an object without `ok`, rejects with INTERNAL, message `Malformed response from the bridge for conn.close`, and the response as `detail` (2 cases). A response with `ok: 'yes'` (truthy but not `true`) rejects with INTERNAL instead of resolving.
- "stream edge cases" (1), for TW-1 on `stream()`: the bridge resolving `undefined` errors with the malformed-response INTERNAL error, removes its listener and sends no cancel.
- "stream start result edge cases" (7), for CR-1:
  - `streamId: null` completes without `options`.
  - Events buffered before a `streamId: null` response are dropped, with no cancel.
  - A `streamId: null` response that arrives after an unsubscribe sends only the request-id cancel and does not call `onStart`.
  - `onStart` throwing for a `null` result errors with that error and sends no cancel.
  - `onStart` that unsubscribes and then throws does not surface the error and cancels only `e1`.
  - `onStart` that unsubscribes for a `null` result sends no cancel and does not complete. This covered the previously uncovered branch at `api.service.ts:217`.
  - A result without a `streamId` field errors with INTERNAL and does not call `onStart`.
- "early event buffer edge cases" (3), for CR-2:
  - A buffer filled exactly to `MAX_EARLY_EVENTS` with the stream's own events (9,999 data events plus `end`) is delivered in order, with no error and no cancel.
  - After an overflow, a failed late response is not surfaced and a later unsubscribe sends no second cancel.
  - Events after the response do not count against the limit.

The fixer's 7 tests ("stream start result", "early event buffer") and the 2 first-pass TW-1 tests were reviewed and kept unchanged. All of them now pass.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 typed request/response with the fake | `sends method and params and resolves with the typed result` (`expectTypeOf`), `resolves overlapping requests independently in reverse order`, `rejects with an ApiError carrying code, message and detail` | `npm run test -w packages/renderer` | Pass |
| AC1 stream data/end/error | `emits data payloads and completes on end`, `errors with an ApiError on an error event`, `ignores data and error events after end`, `completes after the response when end arrived before it`, `errors after the response when an error event arrived before it`, `keeps concurrent streams apart` | `npm run test -w packages/renderer` | Pass |
| AC1 unsubscribe sends cancel | `sends cancel with the streamId when unsubscribed while running`, `cancels the request id when unsubscribed before the response, and the late stream`, `cancels the stream when a consumer unsubscribes from inside next (first value)`, `cancels the stream, not the request, when unsubscribed from inside onStart`, `does not cancel after the stream ended` | `npm run test -w packages/renderer` | Pass |
| TW-1: a malformed bridge response rejects with an INTERNAL `ApiError` | `rejects with an INTERNAL ApiError when the bridge resolves undefined/null`, `rejects with a malformed-response INTERNAL error when the bridge resolves a string / an object without ok`, `does not resolve when ok is truthy but not true`, `errors with a malformed-response INTERNAL error when the bridge resolves undefined` (stream) | `npm run test -w packages/renderer` | Pass |
| CR-1: `streamId: null` completes and `onStart` receives the result before any data | `completes without emitting when io.export answers streamId null (dialog cancelled)`, `calls onStart once with the result before the first data, also for buffered data`, `does not call onStart when the request fails or was unsubscribed`, `errors and cancels the stream when onStart throws`, the 7 "stream start result edge cases" tests | `npm run test -w packages/renderer` | Pass |
| CR-2: broadcasts are not buffered, and the buffer is capped at `MAX_EARLY_EVENTS`; an overflow is INTERNAL and cancels | `does not buffer broadcast events while the request is pending`, `fails with INTERNAL and cancels when too many events arrive before the response`, `delivers MAX_EARLY_EVENTS buffered events of its own stream in order`, `ignores a failed late response and a later unsubscribe after an overflow`, `does not count events against the limit once the stream is running` | `npm run test -w packages/renderer` | Pass |
| CR-3: class doc (cold Observable, one request per subscription) | `sends one request per subscription` (behavior). The documentation text itself is not testable. | `npm run test -w packages/renderer` | Pass |
| AC2 every contract error code has a message (enumerated) | `has a readable message for %s` (`it.each(ERROR_CODES)`), `has no messages for codes outside the contract`, `describes %s with its readable message` | `npm run test -w packages/renderer` | Pass |
| AC3 fake exported for other renderer specs | `is exported from api/testing for other renderer specs`, `provideFakeThicket() provides a fresh fake as THICKET_BRIDGE` | `npm run test -w packages/renderer` | Pass |
| Assumption: a missing `window.thicket` answers INTERNAL, and a present one is used | `answers with a readable INTERNAL error instead of crashing`, `uses window.thicket when the preload exposed it`, `streams, cancels and listens without crashing when window.thicket is missing` | `npm run test -w packages/renderer` | Pass |

## Focused test execution

Command:

`npm run test -w packages/renderer` (from the repository root); `npx eslint packages/renderer/src/app/api --max-warnings 0`; `npx prettier --check packages/renderer/src/app/api`; `npm run typecheck -w packages/renderer`

Result:

Pass: 5 files, 181 tests passed. ESLint produced no output, Prettier reported all files formatted, and the type check (`ngc -p tsconfig.app.json --noEmit && tsc -p tsconfig.spec.json`) reported no errors.

## Full test execution

Command:

`npm run check` (ESLint and Prettier on the repository, typecheck of all workspaces, root `vitest run`, `npm run test -w packages/renderer`)

Result:

Pass. Root Vitest: 5 files, 599 tests passed. Renderer: 5 files, 181 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists. That command was run directly (above) on the final snapshot and passed.

## Bugs found

None in this pass. The fix for TW-1 from the first pass is verified: both original TW-1 tests and 4 further malformed-response tests pass.

## Coverage

Status: verified. This was a fresh, unfiltered run with exit 0 on the final snapshot, with all 181 tests run.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All four files are new in this task (added by 6c069c2 and changed by 1a78a24 within the task), so every executable line is a changed line and whole-file line coverage equals changed-line coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `api-client`; base `b93d0f27ec0c9375109365a71c4c820b97163e18`; HEAD `1a78a243ceea440d17c45ea755ccb11c52193055`; commits 6c069c2, 563e443 and 1a78a24, supplied by the parent worker and checked against `git diff --stat b93d0f2..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production files match HEAD (`git diff --name-only HEAD -- packages/renderer/src` lists only `api.service.spec.ts`). sha256 hashes:
  - `api.service.ts` 4bc5e60fc838116ec51897ae23e088486b45743a3234934e41d6e2fec857aa0c
  - `api-error.ts` 8634ba52acbc32331f2741c81e23396ca31b8d20f8c005772ecbbae567ab10d7
  - `thicket-bridge.ts` a3b1aabb26f040072f179fa0db3ff0a6351482073fb48465c58f5784c48a4b97
  - `testing/fake-thicket-bridge.ts` 899b50c10dfb1044d3db349bd0be09fa8eecb774d54a4ab3e57263f4bb7dd1c1
  - `api.service.spec.ts` 95a18379d5412ae667f227679a5329e0d95a5b1dabaa2a462acfbef072ce933b (uncommitted)
  - `api-error.spec.ts` ebd307630ff14bd879a39103843aaea6b8d19c8b511649cf4b49619a05677607
  - `testing/fake-thicket-bridge.spec.ts` 091f9a1552eb7459fb306cefd927b9d5c9b2742b1e1724e0a8b1ca8947838e22
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/api/api.service.ts`, `src/app/api/api-error.ts`, `src/app/api/thicket-bridge.ts` and `src/app/api/testing/fake-thicket-bridge.ts`. Excluded: `index.ts` and `testing/index.ts` (re-exports only), the `*.spec.ts` files, `docs/ARCHITECTURE.md`, `package.json` and `package-lock.json` (configuration and docs). Nothing was renamed or deleted, and no scoped file is missing from the report.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8` (^5.1.0), through the Angular unit-test builder. Working directory `packages/renderer`. Command: `npx ng test --coverage --coverage-include='src/app/api/api.service.ts' --coverage-include='src/app/api/api-error.ts' --coverage-include='src/app/api/thicket-bridge.ts' --coverage-include='src/app/api/testing/fake-thicket-bridge.ts'`. Selection: all 5 renderer spec files, 181 tests, with no filter.
- Run start/completion time and exit status: started 2026-11-16 19:23:06 +0100, reports written at 19:23:07.73 +0100, exit 0 (181 passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 bf806b996359db4e61ea7905ec1212b1d5ce444c7089d4136ef6e488ef03c9a7) and `packages/renderer/coverage/renderer/lcov.info` (sha256 a065f555fbb1895c47734489d5170088a21d118a0c354619c58869b42532d100). Both are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files have the timestamps of this run, the builder regenerated `coverage/`, and `api.service.ts` and `api.service.spec.ts` had the same hashes after the run. An earlier run in this pass, at 19:22:36 with 180 tests, was superseded once the test for line 217 was added.
- Final run after latest test additions and production fixes: yes. It ran on HEAD 1a78a24, which includes all fixes, with this pass's final tests.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/api/api.service.ts` | 134/135 (99.26%) | 70/71 (98.59%) | 23/23 (100%) | 113/113 (100%) |
| `packages/renderer/src/app/api/api-error.ts` | 21/21 (100%) | 16/16 (100%) | 5/5 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/api/thicket-bridge.ts` | 10/10 (100%) | 3/4 (75%) | 6/6 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/api/testing/fake-thicket-bridge.ts` | 40/40 (100%) | 10/10 (100%) | 20/20 (100%) | 33/33 (100%) |
| **Total (summed counters; all 4 scoped files measured, none missing)** | 205/206 (99.51%) | 99/101 (98.02%) | 54/54 (100%) | 173/173 (100%) |

Before this pass's additions (same command at 19:22:36, 180 tests), branches were 98/101 (97.03%); the other metrics were the same as above.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/api/api.service.ts:217` (`else if (!responded)` false branch) | Unsubscribing inside `onStart` for a `streamId: null` result must send no cancel (there is nothing to cancel). | Covered now: `sends no cancel and does not complete when onStart unsubscribes for a streamId null result`. |
| `packages/renderer/src/app/api/api.service.ts:140` (`if (finished) return;` in the `bridge.on` listener, true branch, and its statement) | Defensive guard. `finish()` removes the listener, and `handle()` checks `finished` again. | No test added. It is reachable only when a bridge calls a listener after `off()`. It is not material, unchanged from the first pass. |
| `packages/renderer/src/app/api/thicket-bridge.ts:32` (`typeof window === 'undefined'` true branch) | SSR or non-browser safety for the default token | No test added. jsdom always defines `window`, and the renderer runs only in Electron or a browser. Not material. |

## Unable to test

- The real Electron preload `window.thicket` cannot be tested here: electron-shell is not merged, so `ThicketBridge` is an assumed shape. The tests use `FakeThicketBridge` and a stubbed `window.thicket`. Follow-up: an electron-shell or integration task should check the preload against `ThicketBridge`.
- CR-3 is a documentation change. Its behavior (one request per subscription) is tested, but the wording is not.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's changes for TW-1, CR-1 and CR-2 are verified by 14 new tests plus the fixer's 7 tests. The renderer suite has 181 tests and all pass, `npm run check` / `.taskcheck` pass, and task-scoped coverage is 100% of lines and functions, 99.51% of statements and 98.02% of branches. The only uncovered branches are justified defensive guards.

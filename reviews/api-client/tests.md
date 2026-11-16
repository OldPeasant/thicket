# Test Report

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: `git diff acc64cfde7488407c552414451dba03fa5701ae7..22bf57a727107b6675339e84a4fde12fa6934bfb` on branch `main` (one task commit, 22bf57a "Add renderer API client over window.thicket with fake bridge"). The parent worker supplied the base and the task commit. Production files in scope: `packages/renderer/src/app/api/api.service.ts`, `api-error.ts`, `thicket-bridge.ts`, `testing/fake-thicket-bridge.ts`. The barrel files `index.ts` and `testing/index.ts` contain only re-exports and are covered by the export test. Uncommitted inputs: the three spec files edited by this report (hashes below). No production file was changed.

Requirements:
- `tasks/api-client.md`: acceptance criteria 1-3 and the two recorded assumptions (renderer-chosen ids, `window.thicket` shape; a missing bridge answers INTERNAL)
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- JSDoc contracts in `api.service.ts` ("failures reject with `ApiError`") and `thicket-bridge.ts`

## Test files changed

- `packages/renderer/src/app/api/api.service.spec.ts`
- `packages/renderer/src/app/api/api-error.spec.ts`
- `packages/renderer/src/app/api/testing/fake-thicket-bridge.spec.ts`

## Tests added or updated

Count: 55. The renderer suite went from 105 to 160 tests. Parameterized cases (`it.each`) are counted per case.

- `api.service.spec.ts`, "request edge cases" (9): abort listener removed after settle; late response after abort ignored (CANCELLED, one cancel with the request id); abort after a failure keeps the original error and sends no cancel; overlapping requests answered in reverse order; synchronous bridge throw becomes INTERNAL; malformed `error` in an `ok:false` response becomes INTERNAL; bridge resolves `undefined` / `null` (2, **failing, TW-1**); unique `r-` fallback ids without `crypto.randomUUID`.
- "stream edge cases" (16): data/error after `end` ignored; no cancel when unsubscribed after an error event; `end` buffered before the response completes without cancel; `error` buffered before the response; malformed error event becomes INTERNAL; result `null` / empty streamId / numeric streamId gives INTERNAL with listener cleanup (3); bridge rejection becomes INTERNAL with listener cleanup; listener removed as soon as the subscriber unsubscribes before the response; a failed late response is not surfaced after unsubscribe; a late response without streamId sends no extra cancel; `firstValueFrom` (unsubscribe inside `next`) cancels the stream; buffered replay stops when unsubscribed inside `next`; concurrent streams with interleaved events stay apart; events addressed to the request id are ignored.
- "broadcast edge cases" (2): non-data events of a broadcast stream are filtered; one bridge listener per `events()` subscriber, each removed.
- "THICKET_BRIDGE default" (2): uses `window.thicket` when present; with no bridge, `stream()` errors with INTERNAL, and `cancel`/`events()` do not throw.
- `fake-thicket-bridge.spec.ts` (7): `respond()`/`fail()` responses; a later handler replaces an earlier one; async handlers, including a rejected one (INTERNAL); `cancels` recorded in order; `data`/`end` (default payload)/`failStream` event shapes; a listener unsubscribing another during `emit`; `provideFakeThicket()` with the default and with an explicit fake.
- `api-error.spec.ts` (19): `describeError` for a plain Error, for an ApiError, and for every contract code via `it.each(ERROR_CODES)` (17).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 typed request/response with the fake | `sends method and params and resolves with the typed result` (`expectTypeOf`), `resolves overlapping requests independently in reverse order`, `rejects with an ApiError carrying code, message and detail` | `npm run test -w packages/renderer` | Pass |
| AC1 stream data/end/error | `emits data payloads and completes on end`, `errors with an ApiError on an error event`, `ignores data and error events after end`, `completes after the response when end arrived before it`, `errors after the response when an error event arrived before it`, `keeps concurrent streams apart` | `npm run test -w packages/renderer` | Pass |
| AC1 unsubscribe sends cancel | `sends cancel with the streamId when unsubscribed while running`, `cancels the request id when unsubscribed before the response, and the late stream`, `cancels the stream when a consumer unsubscribes from inside next (first value)`, `stops replaying buffered events when unsubscribed from inside next`, `does not cancel after the stream ended`, `does not cancel when unsubscribed after an error event` | `npm run test -w packages/renderer` | Pass |
| AC1 abort (request cancel) | `cancels the request when the signal aborts and rejects with CANCELLED`, `ignores the late response of an aborted request`, `removes its abort listener once the request settles`, `keeps the original error and does not cancel when aborted after a failure` | `npm run test -w packages/renderer` | Pass |
| Failures reject with `ApiError` (JSDoc contract) on malformed bridge data | `rejects with an INTERNAL ApiError when the bridge resolves undefined`, `... resolves null` | `npm run test -w packages/renderer` | **Fail (TW-1)** |
| Malformed bridge data otherwise mapped to INTERNAL | `rejects with INTERNAL when the bridge throws synchronously`, `rejects with INTERNAL when an error response carries a malformed error`, `turns a malformed error event into an INTERNAL ApiError`, `errors with INTERNAL and cleans up when the result is %s` (3), `errors with INTERNAL when the bridge rejects` | `npm run test -w packages/renderer` | Pass |
| Listener cleanup | `removes its listener at once when unsubscribed before the response`, `keeps one bridge listener per subscriber and removes each`, plus `listenerCount` assertions in the stream tests | `npm run test -w packages/renderer` | Pass |
| AC2 every contract error code has a message (enumerated) | `has a readable message for %s` (`it.each(ERROR_CODES)`), `has no messages for codes outside the contract`, `describes %s with its readable message` (`it.each(ERROR_CODES)`) | `npm run test -w packages/renderer` | Pass |
| AC3 fake exported for other renderer specs | `is exported from api/testing for other renderer specs`, `provideFakeThicket() provides a fresh fake as THICKET_BRIDGE` | `npm run test -w packages/renderer` | Pass |
| Assumption: missing `window.thicket` answers INTERNAL; present one is used | `answers with a readable INTERNAL error instead of crashing`, `uses window.thicket when the preload exposed it`, `streams, cancels and listens without crashing when window.thicket is missing` | `npm run test -w packages/renderer` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test`

Result:

Fail: 158 passed, 2 failed. The 2 failures are the TW-1 defect tests and are expected. Before this change the suite had 105 tests, all passing. `npx eslint packages/renderer/src/app/api --max-warnings 0` passed with no output. `npm run typecheck -w packages/renderer` passed. `npx prettier --check packages/renderer/src/app/api` passed.

## Full test execution

Command:

`npm run check` (lint + Prettier + typecheck of all workspaces + root `vitest run` + `npm run test -w packages/renderer`)

Result:

Fail. Lint, Prettier and typecheck passed. Root Vitest: 5 files, 599 tests passed. Renderer: 158 passed, 2 failed (TW-1 only).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check` (above), which fails only because of the 2 TW-1 tests. It passes once TW-1 is fixed.

## Bugs found

### request() rejects with a raw TypeError instead of an ApiError when the bridge resolves a non-object

Finding ID:

`TW-1`

Test:

`ApiService > request edge cases > rejects with an INTERNAL ApiError when the bridge resolves undefined` and `... when the bridge resolves null`

Production source:

`packages/renderer/src/app/api/api.service.ts:177-185` (`send()`: `if (response.ok)` runs outside the `try`, so a nullish or malformed bridge response throws a TypeError)

Requirement:

The ApiService class JSDoc says "failures reject with `ApiError`". The `send()` JSDoc says it "rejects with an `ApiError`". The task goal maps error codes to user-readable messages, and the assumption says a missing or broken bridge answers INTERNAL "instead of throwing". `api-error.ts` documents "malformed input becomes `INTERNAL`".

Expected behavior:

If `bridge.request()` resolves `undefined`, `null` or another non-Response value, `api.request()` rejects with an `ApiError` with code `INTERNAL`, as it already does for a rejected or throwing bridge and for a malformed `error` field.

Actual behavior:

`api.request()` rejects with `TypeError: Cannot read properties of undefined (reading 'ok')`. `instanceof ApiError` is false and there is no `code`. Callers that branch on `error.code` or `error.explanation` get `undefined`. `stream()` does not have this problem because it wraps with `ApiError.from()`.

Severity:

Low. `window.thicket` is typed to return a `Response`, so this needs a broken or mismatched preload. electron-shell, which provides the preload, is not merged yet, so a mismatch is plausible.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (For example, check the response shape, or wrap `ApiError.from` around the whole body of `send()`.)

## Coverage

Status: partial. The coverage numbers come from a fresh run on the final test snapshot. The two failing TW-1 tests were left out by a test-name filter, because Vitest writes no coverage report when a test fails. The unfiltered run (exit 1) produced an empty `coverage/` directory. No test was skipped in source.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All four files are new in this task (added by 22bf57a), so every executable line is a changed line and whole-file line coverage equals changed-line coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `api-client`; base `acc64cfde7488407c552414451dba03fa5701ae7`; HEAD `22bf57a727107b6675339e84a4fde12fa6934bfb`; task commit 22bf57a and the file list, both supplied by the parent worker and checked against `git diff --stat acc64cf..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production files unchanged from HEAD (`git diff HEAD` on non-spec files in `src/app/api` is empty). sha256 of the inputs: `api.service.ts` f9fc6e4b2b8c124fcc363b62ba268fff4cd1cc5a44435dde326d1ed6e99839b1, `api-error.ts` 8634ba52acbc32331f2741c81e23396ca31b8d20f8c005772ecbbae567ab10d7, `thicket-bridge.ts` a3b1aabb26f040072f179fa0db3ff0a6351482073fb48465c58f5784c48a4b97, `testing/fake-thicket-bridge.ts` 899b50c10dfb1044d3db349bd0be09fa8eecb774d54a4ab3e57263f4bb7dd1c1, `api.service.spec.ts` 447d37fd01e5c454742bdee0ed2309baee7919ca1303ecdfa5d24a46974f0e9d, `api-error.spec.ts` ebd307630ff14bd879a39103843aaea6b8d19c8b511649cf4b49619a05677607, `testing/fake-thicket-bridge.spec.ts` 091f9a1552eb7459fb306cefd927b9d5c9b2742b1e1724e0a8b1ca8947838e22.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/api/api.service.ts`, `src/app/api/api-error.ts`, `src/app/api/thicket-bridge.ts`, `src/app/api/testing/fake-thicket-bridge.ts`. Excluded: `index.ts` and `testing/index.ts` (re-exports only), the `*.spec.ts` files, `docs/ARCHITECTURE.md`, `package.json` and `package-lock.json` (configuration and docs). Nothing was renamed or deleted.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` through the Angular unit-test builder (Vitest v5.1.0). Working directory `packages/renderer`. Command: `npx ng test --coverage --coverage-include='src/app/api/api.service.ts' --coverage-include='src/app/api/api-error.ts' --coverage-include='src/app/api/thicket-bridge.ts' --coverage-include='src/app/api/testing/fake-thicket-bridge.ts' --filter='^(?!.*when the bridge resolves (undefined|null)).*$'`. Selection: all 5 renderer spec files, 158 tests run, 2 filtered out (the TW-1 tests).
- Run start/completion time and exit status: started 2026-11-16 19:16:10 +0100, duration 1.29 s, exit 0 (158 passed, 2 skipped by the filter). The earlier unfiltered run at 19:16:00 exited 1 and wrote no report.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 9b3fc06d07273ed06f5793227890f6672acbcacc294ad337a4622b0b2755b52e) and `packages/renderer/coverage/renderer/lcov.info` (sha256 80754f8f8864eae50a2453c816872ae63c88e496bbb0f942fd750353154c91ee). Both are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files are newer than the last spec edit (`find -newer api.service.spec.ts`). After the unfiltered run, the builder had left `coverage/` empty. No source or spec file was edited between the hash snapshot and the run.
- Final run after latest test additions and production fixes: yes for the test additions. TW-1 is not fixed yet, so coverage must be measured again after the fix, with the filter removed.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/api/api.service.ts` | 94/95 (98.94%) | 46/47 (97.87%) | 23/23 (100%) | 80/80 (100%) |
| `packages/renderer/src/app/api/api-error.ts` | 21/21 (100%) | 16/16 (100%) | 5/5 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/api/thicket-bridge.ts` | 10/10 (100%) | 3/4 (75%) | 6/6 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/api/testing/fake-thicket-bridge.ts` | 40/40 (100%) | 10/10 (100%) | 20/20 (100%) | 33/33 (100%) |
| **Total (summed counters, all 4 files in scope measured, none missing)** | 165/166 (99.39%) | 75/77 (97.40%) | 54/54 (100%) | 140/140 (100%) |

For comparison, before the new tests (same command without the filter, 105 tests): statements 158/166 (95.18%), branches 71/77 (92.2%), functions 50/54 (92.59%), lines 136/140 (97.14%).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/api/api.service.ts:113` (`if (finished) return;` in the `bridge.on` listener, true branch) | Defensive guard. `finish()` removes the listener, and `handle()` checks `finished` again, so an event after finish cannot reach a subscriber. | No test added. It is reachable only when the bridge calls a listener after `off()`. The fake prevents that except within one `emit` snapshot, and even then `handle()` stops the event. Not material. |
| `packages/renderer/src/app/api/thicket-bridge.ts:32` (`typeof window === 'undefined'` true branch) | SSR or non-browser safety for the default token factory | No test added. jsdom always defines `window`, and the renderer only runs in Electron or a browser. Not material. |

## Unable to test

- The real Electron preload `window.thicket` cannot be tested here: electron-shell is not merged, so `ThicketBridge` is an assumed shape. The tests use `FakeThicketBridge` and a stubbed `window.thicket`. Follow-up: an electron-shell or integration task should check the preload against `ThicketBridge`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Low): `ApiService.request()` rejects with a raw TypeError instead of an INTERNAL `ApiError` when the bridge resolves a nullish response. Its 2 failing tests keep `npm run check` / `.taskcheck` red until the fix. All other acceptance criteria pass.

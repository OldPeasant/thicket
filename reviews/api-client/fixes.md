# Fix Report

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: current task. Findings TW-1 (reviews/api-client/tests.md) and CR-1, CR-2, CR-3 (reviews/api-client/review.md), all approved by the parent worker. Base acc64cfde7488407c552414451dba03fa5701ae7, starting HEAD b9ba896. Changes are uncommitted in the working tree (the parent worker commits them).

## Fixed findings

### TW-1 — request() rejects with a raw TypeError when the bridge resolves a non-object

Files changed:
- `packages/renderer/src/app/api/api.service.ts`

Problem:
`send()` read `response.ok` outside the `try`, so a bridge resolving `undefined`/`null` (or a non-Response value) rejected with a `TypeError` instead of an `ApiError`.

Fix:
`send()` now checks that the response is an object with an `ok` field and rejects with `ApiError({ code: 'INTERNAL', message: 'Malformed response from the bridge for <method>', detail: response })` otherwise. Only `ok === true` returns the result; anything else goes through `ApiError.from(error)`. The two test-writer tests were kept unchanged and now pass.

Validation:
- `npm run test -w packages/renderer` — Pass (both "rejects with an INTERNAL ApiError when the bridge resolves undefined/null" pass)

### CR-1 — stream('io.export') turns a cancelled save dialog into an INTERNAL error and drops path

Files changed:
- `packages/renderer/src/app/api/api.service.ts`
- `packages/renderer/src/app/api/api.service.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
A result `{ streamId: null, ... }` (contract: dialog cancelled, packages/contract/src/io.ts) made `stream()` error with INTERNAL, and the request's result (e.g. `path`) was not available to callers.

Fix:
`streamIdOf()` now distinguishes `null` ("nothing to stream") from a missing/invalid field (still INTERNAL). `stream()` takes an optional third argument `options?: StreamOptions<M>` with `onStart?: (result: ResultOf<M>) => void`, called once with the result before any data (buffered data included) and also for the `streamId: null` case; after it, a null streamId completes the Observable without emitting and without a cancel. `onStart` is not called when the request fails or the subscriber already unsubscribed. If `onStart` throws, the stream errors with that error and is cancelled; if it unsubscribes, the stream (not the finished request) is cancelled. `StreamOptions` is exported from the api barrel. ARCHITECTURE.md's renderer-side paragraph documents `onStart`, the null-streamId behaviour and the cold/one-request-per-subscription semantics.

Tests added (describe "stream start result"): completes without emitting for `io.export` answering `{ streamId: null, path: null }` and passes it to onStart; onStart runs once, typed `ResultOf<'io.export'>`, before buffered and live data; not called on failure or after unsubscribe; onStart throwing errors and cancels the stream; unsubscribing inside onStart cancels the streamId.

Validation:
- `npm run test -w packages/renderer` — Pass

### CR-2 — Pre-response buffer collects every bridge event without a bound

Files changed:
- `packages/renderer/src/app/api/api.service.ts`
- `packages/renderer/src/app/api/api.service.spec.ts`

Problem:
While a stream request was pending, every bridge event (broadcasts and other streams' events) was buffered without limit.

Fix:
Events of broadcast streams (`Object.values(BROADCAST_STREAMS)`) are no longer buffered. The buffer is capped at the exported `MAX_EARLY_EVENTS = 10_000`; one more event fails the stream with an INTERNAL `ApiError`, cancels the pending request id, removes the listener, and cancels the late `streamId` when the response still arrives (same path as an unsubscribe while pending). No events are dropped silently.

Tests added (describe "early event buffer"): 10_001 broadcast events plus a broadcast `end` while pending do not fail the stream, and its data is delivered afterwards; exactly `MAX_EARLY_EVENTS` other-stream events are accepted, the next one errors with INTERNAL, cancels the request id, leaves no listener, and the late streamId is cancelled.

Validation:
- `npm run test -w packages/renderer` — Pass

### CR-3 — Class doc describes shared/last-subscriber semantics that do not exist

Files changed:
- `packages/renderer/src/app/api/api.service.ts`

Problem:
The `ApiService` doc said streams cancel "when the last subscriber unsubscribes", but `stream()` is cold.

Fix:
The doc now says each subscription sends its own request and cancels its own server-side stream when it unsubscribes before the end, and points to `share()` to share one stream.

Validation:
- `npx eslint packages/renderer/src/app/api --max-warnings 0` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx prettier --write packages/renderer/src/app/api/api.service.ts packages/renderer/src/app/api/api.service.spec.ts docs/ARCHITECTURE.md` — files already formatted; `npx prettier --check docs/ARCHITECTURE.md` — Pass
- `npx eslint packages/renderer/src/app/api --max-warnings 0` — Pass (no output)
- `npm run typecheck -w packages/renderer` — Pass (ngc app + tsc spec, no errors)
- `npm run test -w packages/renderer` — Pass, 5 files, 167 tests (160 before the fixes, 2 of them failing; 7 tests added)

Full test suite:
- `npm run check` (lint, typecheck, root `vitest run`, renderer tests) — Pass: root 5 files / 599 tests, renderer 5 files / 167 tests

Lint/type-check/build:
- Covered by `npm run check` above — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check` when package.json exists; that command was run directly and passed.

Remaining unresolved findings:
0

Coverage was not re-measured by the fixer; the test-writer report notes it must be measured again after the TW-1 fix.

## Final status

All validated findings fixed and validation passed.

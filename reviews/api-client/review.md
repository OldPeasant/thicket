# Code Review

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: review of the final revision 975252b9f5d6fffa5346b63e36918c1b83941ad8. `git diff b93d0f2..975252b -- packages docs` (task commits 6c069c2, 563e443, 1a78a24, 975252b). Production code was reviewed in full at 1a78a24 (second pass); `git diff 1a78a24 975252b -- packages docs` confirms the only change since then is packages/renderer/src/app/api/api.service.spec.ts (+194 lines, 14 tests from the test-writer's second pass), which was reviewed against api.service.ts. The other task files (api-error.ts, thicket-bridge.ts, index.ts, testing/fake-thicket-bridge.ts, testing/index.ts) have no production changes since the first pass. Context: packages/contract/src/envelope.ts (BROADCAST_STREAMS, cancel routing), io.ts (`io.export` result with nullable `streamId`), common.ts, reviews/api-client/fixes.md, reviews/api-client/tests.md.

Requirements:
- tasks/api-client.md acceptance criteria and recorded assumptions (ThicketBridge shape; no zod validation of results in the renderer; missing window.thicket answers INTERNAL)
- SPEC.md section 4 (API contract)
- docs/ARCHITECTURE.md ("API between parts", renderer-side paragraph added by this task)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: 975252b9f5d6fffa5346b63e36918c1b83941ad8
- Base/start: b93d0f27ec0c9375109365a71c4c820b97163e18
- Commits reviewed: 4 (6c069c2, 563e443, 1a78a24, 975252b); no uncommitted changes

Commands run (at 975252b):
- `npm run test -w packages/renderer` -> 5 test files, 181 tests passed (167 at 1a78a24 + 14 new)
- `npm run typecheck -w packages/renderer` (ngc app + tsc spec) -> no errors

Acceptance criteria:
1. Unit tests with the fake (typed request/response, stream data/end/error, unsubscribe sends cancel): met. Covered in api.service.spec.ts (typed results via `expectTypeOf`, data/end, error events, failed request, cancel by streamId, cancel by request id before the response and of the late streamId, no cancel after end/error, abort signal, listener cleanup).
2. Every contract error code has a message (test enumerates the codes): met. `ERROR_MESSAGES: Record<ErrorCode, string>` plus `it.each(ERROR_CODES)` and a no-extra-keys check in api-error.spec.ts.
3. Fake exported for other renderer tests: met. `app/api/testing/index.ts` exports `FakeThicketBridge` and `provideFakeThicket`, not re-exported from the production barrel.

Spec changes in 975252b: the 14 tests cover malformed bridge responses (a string, an object without `ok`, `ok: 'yes'`, `undefined` for a stream); `io.export` null streamId edge cases (no options, buffered events dropped, null answer after unsubscribe cancels only the request id, onStart throwing with a null result, onStart throwing after it unsubscribed, onStart unsubscribing with a null result, missing streamId field skipping onStart); and buffer edge cases (exactly `MAX_EARLY_EVENTS` own events delivered in order, late failure and later unsubscribe after overflow ignored, no limit once running). Each assertion was traced against api.service.ts and matches its behaviour (e.g. `responded`/`abandoned` in the teardown give exactly one request-id cancel and no streamId cancel for a late null answer; the `finished` check after onStart suppresses the error after an onStart unsubscribe). The tests assert observable behaviour (emissions, errors, `fake.cancels`, `fake.listenerCount`) and no existing test was removed or weakened.

Status of earlier findings:
- CR-1 (P2, `io.export` null streamId / lost `path`): fixed in 1a78a24, unchanged in 975252b. `streamIdOf()` separates an explicit `null` from a missing/invalid field; `options.onStart` receives the typed result before any data; a null streamId completes without emitting and without a cancel. Covered by the "stream start result" suites.
- CR-2 (P3, unbounded pre-response buffer): fixed. Broadcast events are not buffered; the buffer is capped at `MAX_EARLY_EVENTS`, overflow cancels the pending request (and a late streamId) and errors with INTERNAL. Failing loudly instead of dropping events is a deliberate, documented trade-off.
- CR-3 (P3, misleading class doc): fixed. The docs describe cold, one-request-per-subscription semantics and `share()`.
- TW-1 (test-writer, raw TypeError on a non-object response): fixed. `send()` rejects with an INTERNAL `ApiError` for malformed responses; now also covered for strings, `ok`-less objects, non-`true` `ok` and streams.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. Reviewed revision 975252b9f5d6fffa5346b63e36918c1b83941ad8: all three acceptance criteria are met, CR-1..CR-3 and TW-1 are resolved, the 14 added tests are correct and meaningful, and the renderer tests (181 passed) and type check pass.

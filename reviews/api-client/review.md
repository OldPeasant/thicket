# Code Review

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: second review pass on the final revision. `git diff b93d0f2..1a78a24 -- packages docs` (task commits 6c069c2, 563e443, 1a78a24). Reviewed in full: packages/renderer/src/app/api/api.service.ts and api.service.spec.ts (incl. the new "stream start result" and "early event buffer" suites); the other task files (api-error.ts, thicket-bridge.ts, index.ts, testing/fake-thicket-bridge.ts, testing/index.ts) are unchanged in production code since the first pass (only spec additions), which was confirmed with `git diff 6c069c2 1a78a24 --stat`. Context: packages/contract/src/envelope.ts (BROADCAST_STREAMS, cancel routing), io.ts (`io.export` result with nullable `streamId`), common.ts, reviews/api-client/fixes.md, reviews/api-client/tests.md.

Requirements:
- tasks/api-client.md acceptance criteria and recorded assumptions (ThicketBridge shape; no zod validation of results in the renderer; missing window.thicket answers INTERNAL)
- SPEC.md section 4 (API contract)
- docs/ARCHITECTURE.md ("API between parts", renderer-side paragraph added by this task)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: 1a78a24
- Base/start: b93d0f27ec0c9375109365a71c4c820b97163e18
- Commits reviewed: 3 (6c069c2, 563e443, 1a78a24); no uncommitted changes

Commands run:
- `npm run test -w packages/renderer` -> 5 test files, 167 tests passed
- `npm run typecheck -w packages/renderer` (ngc app + tsc spec) -> no errors

Acceptance criteria:
1. Unit tests with the fake (typed request/response, stream data/end/error, unsubscribe sends cancel): met. Covered in api.service.spec.ts (typed results via `expectTypeOf`, data/end, error events, failed request, cancel by streamId, cancel by request id before the response and of the late streamId, no cancel after end/error, abort signal, listener cleanup).
2. Every contract error code has a message (test enumerates the codes): met. `ERROR_MESSAGES: Record<ErrorCode, string>` plus `it.each(ERROR_CODES)` and a no-extra-keys check in api-error.spec.ts.
3. Fake exported for other renderer tests: met. `app/api/testing/index.ts` exports `FakeThicketBridge` and `provideFakeThicket`, not re-exported from the production barrel.

Status of earlier findings:
- CR-1 (P2, `io.export` null streamId / lost `path`): fixed. `streamIdOf()` returns `null` for an explicit null and `undefined` only for a missing/invalid field (api.service.ts:265-270). `stream()` takes `options.onStart` (api.service.ts:25-28, 183-191), called once with the typed `ResultOf<M>` before buffered or live data; a null streamId then completes without emitting and without a cancel (193-198). Verified paths: onStart throwing cancels the streamId and errors the stream; unsubscribing inside onStart cancels the streamId, not the finished request (teardown at 212-218 plus the `finished` check at 192); onStart is not called after failure or unsubscribe (`abandoned` check at 166). Tests in "stream start result" cover each case. ARCHITECTURE.md documents the behaviour.
- CR-2 (P3, unbounded pre-response buffer): fixed. Broadcast events are skipped (146), the buffer is capped at `MAX_EARLY_EVENTS` (147-158); overflow sets `abandoned`, finishes (listener removed), cancels the pending request id and errors with INTERNAL; a late streamId is then cancelled (166-169), a late rejection ignored (206). Covered by the "early event buffer" tests. The overflow fails the stream loudly instead of dropping events, which is a deliberate and documented trade-off.
- CR-3 (P3, misleading class doc): fixed. Class doc (46-51) and method doc (89-98) describe cold, one-request-per-subscription semantics and `share()`.
- TW-1 (test-writer, raw TypeError on a non-object response): fixed. `send()` (240-257) rejects with an INTERNAL `ApiError` for a non-object or `ok`-less response and treats anything but `ok === true` as an error; the test-writer's tests pass.

Teardown logic checked: `responded` prevents cancelling the request id after the response has arrived (only possible for a null streamId or an error, both of which already finished); `abandoned` is set on every teardown and on overflow, so a response arriving afterwards cancels its streamId exactly once and never reaches the subscriber; the teardown is idempotent through `finished`; replay of buffered events stops when a consumer unsubscribes inside `next`.

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

No material issues found. All three acceptance criteria are met, CR-1..CR-3 and TW-1 are resolved in revision 1a78a24, and the renderer tests (167 passed) and type check pass.

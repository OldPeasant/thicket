# Code Review

Date: 2026-11-16

Task: api-client - M0: Renderer API client over window.thicket

Scope: `git diff acc64cf..22bf57a` (one task commit). Reviewed: packages/renderer/src/app/api/ (api.service.ts, api-error.ts, thicket-bridge.ts, index.ts, testing/fake-thicket-bridge.ts, testing/index.ts, all specs), packages/renderer/package.json, package-lock.json, docs/ARCHITECTURE.md note. Context read: packages/contract/src (envelope.ts, errors.ts, index.ts, io.ts, docs.ts, agg.ts, shell.ts, admin.ts).

Requirements:
- tasks/api-client.md acceptance criteria and recorded assumptions (ThicketBridge shape; no zod validation of results in the renderer; missing window.thicket answers INTERNAL)
- SPEC.md section 4 (API contract)
- docs/ARCHITECTURE.md ("API between parts", cancel routing in packages/contract/src/envelope.ts)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: 22bf57a727107b6675339e84a4fde12fa6934bfb
- Base/start: acc64cfde7488407c552414451dba03fa5701ae7
- Commits reviewed: 1 (22bf57a "Add renderer API client over window.thicket with fake bridge"); no uncommitted changes

Commands run:
- `npm run test -w packages/renderer` -> 5 files, 105 tests passed
- `npm run typecheck -w packages/renderer` (ngc app + tsc spec) -> no errors
- Lint was not run by this reviewer (command not permitted in this session); `.taskcheck` covers it.

Acceptance criteria:
1. Unit tests with the fake (typed request/response, stream data/end/error, unsubscribe sends cancel): met. api.service.spec.ts covers typed results (`expectTypeOf`), data/end, error event, failed request, missing streamId, cancel by streamId, cancel by request id before the response plus the late streamId, no cancel after end, abort signal handling, listener cleanup (`listenerCount`).
2. Every contract error code has a message (test enumerates codes): met. `ERROR_MESSAGES` is `Record<ErrorCode, string>` (compile-time completeness), api-error.spec.ts runs `it.each(ERROR_CODES)` and checks there are no extra keys.
3. Fake exported for other renderer tests: met. `app/api/testing/index.ts` exports `FakeThicketBridge` and `provideFakeThicket`; asserted in fake-thicket-bridge.spec.ts; not re-exported from the production `app/api/index.ts`.

Correctness checks done without findings: abort listener is removed on settle and the late backend CANCELLED rejection is consumed (no unhandled rejection); stream teardown is idempotent (`finished` guard), a synchronous unsubscribe from inside `next` (e.g. `take(1)`) while replaying buffered events stops the replay; `end`/`error` events release the bridge listener; unsubscribing while the request is pending cancels the request id and later the returned streamId; bridge rejections and malformed error payloads become `INTERNAL` `ApiError`s; no secrets or paths are handled in the renderer code.

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | `stream('io.export')` turns a cancelled save dialog into an INTERNAL error and drops `path`**
    - File: `packages/renderer/src/app/api/api.service.ts:125`
    - Category: Integration
    - Problem: `io.export` is a `StreamMethodName` (it has a `stream` schema), so `stream()` accepts it with full typing. Its contract result is `{ streamId: string | null, path: string | null }` where `streamId: null` means "the user cancelled the save dialog" (packages/contract/src/io.ts:57-58). `streamIdOf()` returns `undefined` for `null`, and `stream()` then errors with `ApiError({ code: 'INTERNAL', message: 'io.export did not return a streamId' })`, which `describeError` renders as "Something went wrong inside Thicket." A normal user action becomes a reported bug. In addition, `stream()` discards the request result, so a caller has no way to get the chosen `path`; the alternative (`request()` + `events(streamId)`) loses events that arrive before the response and has no cancel-on-unsubscribe.
    - Why it matters: the service claims to type every streaming contract method, but one of them cannot be used correctly through it; the io export task will either show a false internal error on dialog cancel or have to reimplement the early-event buffering and cancel logic.
    - Suggested fix: handle a `null` streamId as a valid "nothing to stream" outcome (e.g. complete immediately without emitting, keeping INTERNAL only for a missing/invalid field), and/or expose the start result (e.g. an option/overload returning `{ result, events$ }`, or a callback with the result) so `path` is available. Add a spec for `io.export` answering `{ streamId: null, path: null }`.

## P3 Low

- [ ] **CR-2 | Pre-response buffer collects every bridge event without a bound**
    - File: `packages/renderer/src/app/api/api.service.ts:114`
    - Category: Correctness
    - Problem: until the response arrives, each stream subscription pushes every event from `bridge.on` into `early`, including broadcasts and data of all other running streams; only after the streamId is known are the unrelated ones discarded. For `io.export`, the response waits for the native save dialog, which the user may leave open for minutes while e.g. `admin.watch`, shell output or a large find stream keeps emitting.
    - Why it matters: memory grows with the traffic of unrelated streams for the duration of a pending stream request; with several pending stream requests each holds its own copy.
    - Suggested fix: skip events whose stream is a known broadcast name (`BROADCAST_STREAMS` values) and cap the buffer (or keep only events of streams not already owned by another active subscription); alternatively document that main delivers the response before the first event of its stream and drop the buffer.

- [ ] **CR-3 | Class doc describes shared/last-subscriber semantics that do not exist**
    - File: `packages/renderer/src/app/api/api.service.ts:35`
    - Category: Quality
    - Problem: the `ApiService` doc says streams "cancel the server-side operation when the last subscriber unsubscribes", but `stream()` is cold: every subscription sends its own request and cancels it on its own unsubscribe (as the method doc and the "sends one request per subscription" spec state).
    - Why it matters: a caller may share one Observable among several subscribers expecting one server operation and get N queries.
    - Suggested fix: reword to "when the subscriber unsubscribes before the stream ended; each subscription starts its own request".

## Review conclusion

Material issues found; fix before completing the task. No P0/P1 findings: all three acceptance criteria are met and the tests and type check pass. CR-1 (P2) is a contract integration gap. Fix it now or defer it with a named follow-up task. CR-2 and CR-3 are minor.

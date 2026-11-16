# Fix Report

Date: 2026-11-16

Task: conn-manager - M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard

Scope: current task; findings CR-1..CR-4 of `reviews/conn-manager/review.md` (all approved by
the parent worker, with the intended fixes it specified).

## Fixed findings

### CR-1 — Cancelling a connect leaves a live MongoClient

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/connections/manager.spec.ts`

Problem:
On cancel, the client was closed at once while `client.connect()` kept running. A driver close
before the topology exists does nothing, so the client could connect afterwards and stay open.

Fix:
- `test()` keeps the driver's connect promise. If the connect didn't finish (cancelled), the
  `finally` closes the client at once and again once the connect settles
  (`connecting.then(() => closeQuietly(client), () => undefined)`).
- `connect()` (used by `open`) no longer races the driver connect against a caller's signal
  (see CR-3). It always awaits `client.connect()` and then closes the client when the entry was
  closed or replaced meanwhile. Cancellation goes through `close(profileId)`, which closes at
  once, so the client is closed both at once and after the connect settles. `connect()` also
  checks the entry again after loading the profile and secrets, so an open closed in that
  window creates no client.

Validation:
- New tests: "a cancelled open closes the client again once the driver connect is over (CR-1)",
  "a cancelled test closes the client again once the driver connect is over (CR-1)", "a test
  whose connect fails is closed only once", "a profile still being loaded when its open is
  closed creates no client".
- `npx vitest run src/connections` (packages/backend) — Pass (135 tests)

### CR-2 — Draft with an id reuses the saved profile's secrets for another endpoint

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/connections/manager.spec.ts`
- `docs/ARCHITECTURE.md` (Connections bullet: documents the rule)

Problem:
`conn.test` with a draft that had an `id` loaded the saved profile's stored secrets even when the
draft pointed to another host or changed TLS/auth/SSH.

Fix:
`secretsFor(profile, storedFrom, password)` now gets the profile id to load stored secrets from
explicitly. `test({ profileId })` and `open` pass the saved profile id, so they work as before.
For a draft, the new `matchesSaved(draft)` loads `deps.loadProfile(draft.id)`. NOT_FOUND means
no stored secrets, and other errors are passed through. Stored secrets are used only when
`connectionString` is equal and `auth`, `tls` and `ssh` are deep-equal (`isDeepStrictEqual`
from `node:util`). Otherwise only the request's `password` is used.

Validation:
- New tests: draft equal to the saved profile (name and readOnly changed) uses the stored
  password; a draft with another host, other auth, changed TLS or added SSH does not call
  `loadSecrets` (4 cases); a changed draft uses only the typed password; a draft whose id has no
  saved profile gets no stored secrets; other `loadProfile` errors fail the test.
- `npx vitest run src/connections` (packages/backend) — Pass

### CR-3 — Concurrent `conn.open` calls share the first caller's signal and password

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/connections/manager.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
The shared connect was bound to the first caller's AbortSignal. If the first caller cancelled,
every caller failed with CANCELLED.

Fix:
The shared `connect()` now runs without a signal. Each `open()` caller (the first one too) waits
through the new `waitFor()`, which counts the waiters on the entry (`Entry.waiters`) and waits on
the shared promise with its own `abortable(opening, signal)`. When a waiter's signal aborts, the
count goes down. When no waiter is left and the entry is still `connecting` (and still the
current one), it calls `close(profileId)`, so the connect ends `CANCELLED` and the client is
closed (see CR-1). A caller without a signal counts as a waiter, so it keeps the connect alive.
An already aborted signal answers `CANCELLED` before anything starts. The `open()` comment now
says that a later caller's `password` is ignored while a connect is in progress.

Validation:
- New tests: first of two concurrent opens cancels and the second still gets `connected` (the
  client is not closed); both cancel, so the entry is gone, the client is closed, and the connect
  that finishes later doesn't bring it back; a caller without a signal keeps the connect alive;
  a later caller's password is ignored.
- Existing "an abort signal cancels a pending open" and "an already aborted signal" tests still
  pass.
- `npx vitest run src/connections` (packages/backend) — Pass

### CR-4 — `conn.close` during a real connect answers NETWORK_ERROR instead of CANCELLED

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/connections/manager.spec.ts`

Problem:
The driver rejects the pending connect with `MongoTopologyClosedError` when it is closed, and
this error was classified as `NETWORK_ERROR`.

Fix:
In `connect()`'s catch, when `this.entries.get(profileId) !== entry` (closed or replaced
meanwhile), the failure is `RpcError('CANCELLED', 'The connection was closed while connecting')`,
whatever the driver error was.

Validation:
- New test: a fake client whose `close()` rejects the pending connect with a
  `MongoTopologyClosedError`-named "Topology is closed" error gives `CANCELLED` with that
  message, state `disconnected`, and a CANCELLED log line.
- The existing test "a failed connect after close does not overwrite the state of a newer open"
  expected `NETWORK_ERROR` for the old, closed open. It now expects `CANCELLED`. This is the
  behavior the approved CR-4 fix requires ("regardless of the driver's error"), and the test
  still checks that the newer open stays `connected`.
- `npx vitest run src/connections` (packages/backend) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run src/connections` in packages/backend — Pass (4 files, 135 tests)

Full test suite:
- `npm run check` (lint, typecheck, root vitest 39 files / 2373 tests, renderer 27 files / 437
  tests) — Pass
- `npm run test:int -- conn-manager` (Podman MongoDB fixtures) — Pass (1 file, 23 tests)

Lint/type-check/build:
- `npm run lint` and `npm run typecheck`, both part of `npm run check` — Pass; Prettier applied
  to the changed files

`.taskcheck`:
- Pass (it runs `npm run check`, see above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

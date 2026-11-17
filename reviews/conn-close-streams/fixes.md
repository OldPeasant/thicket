# Fix Report

Date: 2026-11-17

Task: conn-close-streams - conn.close kills the server ops of the profile's running streams

Scope: current task; finding CR-1 from `reviews/conn-close-streams/review.md`, as directed by the parent worker. Production code not touched.

## Fixed findings

### CR-1 — killOp assertion uses a server-global counter on a shared container

Files changed:
- `test/integration/docs-query.int.spec.ts`

Problem:
The "conn.close during a running find ..." test proved the kill by comparing `serverStatus.metrics.commands.killOp.total` before and after `conn.close`. That counter is server-wide, and the `mongo8rs` fixture is shared by other integration spec files that may run in parallel, so a killOp from another file could make the assertion pass even if `conn.close` stopped killing the operation.

Fix:
`backendFor()` now passes a `createClient` dep to `ConnectionManager` that builds `new MongoClient(uri, { ...options, monitorCommands: true })` (cast to `ClientLike` like the manager's default) and records every `commandStarted` event whose `commandName` is `killOp` in a per-backend `killOps` list, returned from `backendFor()`. The test takes `backend.killOps.length` before `conn.close` and asserts it grew afterwards, so only killOps sent by this backend's own driver client count. The unused `killOpCount` helper was removed.

Validation:
- `npm run test:int -- test/integration/docs-query.int.spec.ts` (Testcontainers, mongo8rs) — Pass (35 passed, including the conn.close test)
- `npx eslint test/integration/docs-query.int.spec.ts` — Pass
- `npx prettier --check test/integration/docs-query.int.spec.ts` — Pass
- `npx tsc -p tsconfig.json` — Pass

## Not fixed

### CR-2 — agg.run and io.export/io.import streams still close the client before their cleanup

Status:
Out of scope

Reason:
The parent worker asked for CR-1 only. CR-2 asks for a follow-up task (`tasks.py new`), which is TFP state the fixer must not change; the parent worker decides on it.

## Validation summary

Focused tests:
- `npm run test:int -- test/integration/docs-query.int.spec.ts` — 35 passed

Full test suite:
- `npm run check` (lint, type check, unit tests) — Pass (3545 + 2418 tests passed)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Not run directly (running the file needed approval in this session); it runs `npm run check`, which passed.

Remaining unresolved findings:
1 (CR-2, out of the fixer's scope)

## Final status

All validated findings fixed and validation passed.

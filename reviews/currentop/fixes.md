# Fix Report

Date: 2026-11-17

Task: currentop - M6 (Should): currentOp and killOp

Scope: current task; findings CR-1, CR-2, CR-3 (all P3) from `reviews/currentop/review.md`, all approved by the parent worker. Picks up partial fixes for CR-1 and CR-2 left uncommitted by an interrupted fixer run. I reviewed those changes and kept them as they were.

## Fixed findings

### CR-1 — Closing the tab while a confirmed kill is in flight restarts polling on a destroyed view

Files changed:
- `packages/renderer/src/app/admin/currentop/currentop-view.ts`
- `packages/renderer/src/app/admin/currentop/currentop-view.spec.ts`

Problem:
`kill()` calls `refresh()` after `admin.killOp` answers. If the tab had already closed, that call started a new `admin.currentOp` read and set a self-renewing auto-refresh timer that nothing could clear.

Fix:
`DestroyRef.onDestroy` now sets a private `destroyed` flag, following the pattern in `collection/bulk/bulk-panel.ts`. `refresh()` and `schedule()` both return early when the flag is set. A new view spec confirms a kill, destroys the fixture while `admin.killOp` is still pending, then answers the kill and advances the clock by 60 s. It checks that no further `admin.currentOp` is sent.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'` — Pass (2 files, 55 tests)

### CR-2 — Every currentOp / `$currentOp` operation is hidden, not only Thicket's own probe

Files changed:
- `packages/backend/src/admin/currentop/currentop.ts`
- `packages/backend/src/admin/currentop/handlers.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`isOwnProbe` dropped every `$currentOp` aggregation, so long-running aggregations from other clients could not be seen or killed. The architecture note said only the tab's own probe was left out.

Fix:
`isOwnProbe` now drops only `currentOp` commands, because the probe Thicket sends is a `currentOp` command. A `currentOp` command cannot be tagged with a `comment`, since its extra fields act as filters. `$currentOp` aggregations stay listed and can be killed. The unit spec now expects the aggregation (opid 2) to stay in the list. The "Current operations" section of `docs/ARCHITECTURE.md` describes the new rule. `test/integration/currentop.int.spec.ts` only asserts that no listed op carries a `currentOp` command ("does not list its own currentOp command"). It does not depend on `$currentOp` aggregations being hidden, so it needed no change.

Validation:
- `cd packages/backend && npx vitest run src/admin/currentop src/docs/query src/browse` — Pass
- `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` — Pass (3 tests)

### CR-3 — `isUnauthorized` duplicated with `docs/query/query.ts`

Files changed:
- `packages/backend/src/browse/browse.ts`
- `packages/backend/src/browse/browse.spec.ts`
- `packages/backend/src/admin/currentop/currentop.ts`
- `packages/backend/src/docs/query/query.ts`

Problem:
`currentop.ts` and `query.ts` each had a private `UNAUTHORIZED = 13` constant and their own Unauthorized predicate for the "`currentOp`, then `$ownOps`" fallback.

Fix:
Added `isUnauthorizedBrowseError(error)` to `browse/browse.ts`, next to `toBrowseError`. It uses the `UNAUTHORIZED` constant that module already has. It returns true for an `RpcError` whose detail has `serverCode` 13 or `codeName` `Unauthorized`. Both callers now use it, and their local constants and predicates are gone. Both callers pass errors that `toBrowseError` has already mapped. The `currentop.ts` version required an `RpcError`; the `query.ts` version read `.detail` from any value without checking it, so it would throw on null. The shared helper requires an `RpcError`, which handles null safely. New `browse.spec.ts` cases cover code 13, the code name alone, other server codes, other `RpcError`s, raw driver errors, and null/undefined. The existing `$ownOps` fallback specs in `admin/currentop/handlers.spec.ts`, `docs/query/query.spec.ts` and `docs/query/read-preference.spec.ts` still pass.

Validation:
- `cd packages/backend && npx vitest run src/admin/currentop src/docs/query src/browse` — Pass (9 files, 386 tests)

## Not fixed

None.

Note for the parent worker: `packages/backend/src/indexes/indexes.ts:59` has a third copy of the same predicate, and `browse/browse.ts` has a private `isUnauthorized` for raw driver errors. Neither is covered by CR-3 or by this task's `touches`, so they were left unchanged. A later cleanup could switch `indexes.ts` to the shared helper.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/admin/currentop src/docs/query src/browse` — Pass (9 files, 386 tests)
- `cd packages/renderer && npx ng test --include='src/app/admin/currentop/**/*.spec.ts'` — Pass (2 files, 55 tests)
- `npx vitest run --config test/integration/vitest.config.ts test/integration/currentop.int.spec.ts` (repo root, container fixture) — Pass (3 tests)

Full test suite:
- `npm run check` (repo root) — Pass: eslint with `--max-warnings 0` and prettier clean; tsc and ngc typecheck clean; root vitest 88 files / 4487 tests; renderer 104 files / 3454 tests.

Lint/type-check/build:
- Included in `npm run check` above — Pass

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

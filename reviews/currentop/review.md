# Code Review

Date: 2026-11-17

Task: currentop - M6 (Should): currentOp and killOp

Scope: the `currentop:` commits in `375764073310b27677a5248cc28decf8bd2da845..0fecf7d28849e6b9f8670b06a2e52c4b81d9cc4b` (other agents' commits and `heartbeat:` commits in the range excluded); committed code only. This is a re-review: it checks the fixes for the earlier findings CR-1..CR-3 in df1263e5, reviews the whole task again, and covers the test-only commit 0fecf7d2 added after the fixes.

Requirements:
- `tasks/currentop.md` acceptance criteria (1: integration test, a slow op is listed and killed; 2: e2e, kill from the UI with confirm) and its recorded assumptions (primary only; namespace prefix on name boundaries; tab kind `currentop`, refresh never/2/5/10 s default 5, kill only for active operations)
- `SPEC.md` M6 "Should" (currentOp filtered by namespace/duration/op type, auto-refresh; killOp with confirm)
- `docs/ARCHITECTURE.md` "Current operations", write safety in the renderer, API between parts
- `packages/contract/src/admin.ts` (`admin.currentOp`, `admin.killOp` with `write: 'always'`)
- `AGENTS.md`; existing conventions (`collection/bulk/bulk-panel.ts`, `docs/query/query.ts`, `browse/browse.ts`)
- Previous review and fix report: `reviews/currentop/review.md` (revision b9ffa50e), `reviews/currentop/fixes.md`

Git range:
- Branch: main
- HEAD: 0fecf7d28849e6b9f8670b06a2e52c4b81d9cc4b
- Base/start: 375764073310b27677a5248cc28decf8bd2da845
- Commits reviewed: 7 (d13c2708, e8b13f62, 4615ce8d, 92f200f5, b8ded54d, df1263e5, 0fecf7d2)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Verification of earlier findings

- CR-1 (polling restarted on a destroyed view after a confirmed kill): fixed. `currentop-view.ts` sets `destroyed` in `DestroyRef.onDestroy` (line 121); `refresh()` (line 158) and `schedule()` (line 222) return early when it is set, so a kill answering after the tab closes neither sends `admin.currentOp` nor arms a timer. The view spec destroys the fixture while `admin.killOp` is pending, answers it, advances 60 s and asserts only the initial `admin.currentOp` was sent. Same pattern as `bulk-panel.ts`.
- CR-2 (every `$currentOp` aggregation hidden): fixed. `isOwnProbe` (`currentop.ts:49`) now drops only `currentOp` commands; `$currentOp` aggregations of other clients stay listed and killable. The trade-off (other clients' short `currentOp` commands are also hidden, because the probe cannot be tagged with a `comment`) is stated in the doc comment and in `docs/ARCHITECTURE.md` "Current operations", so code and documentation agree. The unit spec expects the aggregation to be listed; the integration test only asserts the tab's own `currentOp` command is absent.
- CR-3 (duplicated Unauthorized predicate): fixed. `isUnauthorizedBrowseError` in `browse/browse.ts:113` reuses the module's `UNAUTHORIZED` constant and is used by `admin/currentop/currentop.ts:80` and `docs/query/query.ts:130`. Behavior in `query.ts` is unchanged: its `command()` helper always throws a `toBrowseError` result (an `RpcError`), so requiring `RpcError` loses no case and adds null safety. New `browse.spec.ts` cases cover code 13, code name only, other codes, other `RpcError`s, raw driver errors and null/undefined. The remaining copy in `indexes/indexes.ts:58` is outside this task's `touches` and was not introduced by it; not reported.

## Test-only commit 0fecf7d2

- Changes only `packages/backend/src/admin/currentop/handlers.spec.ts` and `packages/renderer/src/app/admin/currentop/currentop-view.spec.ts`; no production code changed, so the conclusions above still apply to the final code.
- Backend case: a reply containing another client's `currentOp` command (opid 11) and a `$currentOp` aggregation (opid 12) lists only opid 12, and `admin.killOp` with its canonical opid sends `{ killOp: 1, op: Int32(12) }` to `admin`. It would fail if `isOwnProbe` again hid `$currentOp` aggregations, so it guards the CR-2 fix end to end through the handlers.
- Renderer case: after `fixture.destroy()`, `refresh()` and `setRefresh('2')` plus 60 s of fake time send no further `admin.currentOp`. It would fail if the `destroyed` guard in `refresh()` were removed (CR-1). Destroying the fixture again in `afterEach` is harmless; existing tests in the same spec already do this.
- Ran: `npx vitest run src/admin/currentop/handlers.spec.ts --root packages/backend` -> 29 passed; `npm run test -w packages/renderer -- --include src/app/admin/currentop/currentop-view.spec.ts --watch=false` -> 26 passed.

## Verification notes (whole task)

- Write guard: `admin.killOp` is `write: 'always'`; `currentOpHandlers` sits inside `guardWrites(...)` in `server/backend.ts`, so read-only profiles get `READ_ONLY` (asserted in the integration test) and production kills need confirmation. The renderer kills through `WriteGuard.run` with `alwaysConfirm`, and the Kill button uses `appWriteControl` and is shown only for active operations with an opid. `admin.currentOp` is a read and correctly unguarded.
- Input safety: the namespace filter is regex-escaped and anchored on name boundaries; `parseOpId` accepts only integral numbers, Int32/Int64, integral Doubles or a non-empty string, otherwise `INVALID_PARAMS`.
- Async state: `refresh()` aborts the previous read and ignores aborted results and failures; `request` is cleared and the next read scheduled only by the newest request; errors show an alert and auto-refresh/Refresh can recover; kill errors other than `CANCELLED` are shown as a notice and `killing` is always reset in `finally`.
- No logging, secrets or credentials in the changed code or fixtures (integration and e2e use container URIs).
- Acceptance criteria coverage: AC1 by `test/integration/currentop.int.spec.ts` (slow `$where` find listed with filters, read-only kill refused, kill succeeds, find ends `Interrupted`, op no longer listed); AC2 by `test/e2e/currentop.e2e.ts` (tab opened from the sidebar menu, cancel sends nothing, confirm kills, row disappears). The fix report records the integration test passing after df1263e5; 0fecf7d2 changes no production code. The parent worker must record the AC runs with `tasks.py verify` (including an e2e run on the final code) before `done`. This is a process step, not a defect in the code.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

# Code Review

Date: 2026-11-17

Task: currentop - M6 (Should): currentOp and killOp

Scope: `git diff 375764073310b27677a5248cc28decf8bd2da845..b9ffa50e644964da6ad49193d26111f370eb1283` (committed changes only; working tree clean)

Requirements:
- `tasks/currentop.md` acceptance criteria (1: integration test, a slow op is listed and killed; 2: e2e, kill from the UI with confirm) and its recorded assumptions (primary only; namespace prefix on name boundaries; tab kind `currentop`, refresh never/2/5/10 s default 5, kill only for active operations)
- `SPEC.md` M6 "Should" (currentOp list filtered by namespace/duration/op type, auto-refresh; killOp with confirm), section 4 `admin.*` methods
- `docs/ARCHITECTURE.md` "Current operations", "Write safety in the renderer", "API between parts", read-preference notes
- `packages/contract/src/admin.ts` (`admin.currentOp`, `admin.killOp` with `write: 'always'`)
- `AGENTS.md`; existing conventions (`admin/users`, `guard/guard.ts`, `docs/query/query.ts`, `collection/bulk/bulk-panel.ts`)

Git range:
- Branch: main
- HEAD: b9ffa50e644964da6ad49193d26111f370eb1283
- Base/start: 375764073310b27677a5248cc28decf8bd2da845
- Commits reviewed: 4 (745a8fec, f3aefcc4, cbc4bcd6, b9ffa50e)

Summary: 0 P0, 0 P1, 0 P2, 3 P3

## Verification notes

- Write guard: `admin.killOp` is `write: 'always'` in the contract, and `currentOpHandlers` is spread into the `guardWrites(...)` map in `packages/backend/src/server/backend.ts`, so the backend refuses read-only profiles (`READ_ONLY`) and unconfirmed production kills. The integration test exercises this through `guardWrites` + contract validation (`READ_ONLY` asserted). The renderer goes through `WriteGuard.run` with `alwaysConfirm`, and the Kill button uses `appWriteControl`. `admin.currentOp` is a read and is not guarded, which is correct.
- `parseOpId` accepts only integral numbers, Int32/Int64 or a non-empty string, else `INVALID_PARAMS`; nothing user-controlled reaches the command besides the opid. The namespace filter is regex-escaped (`escapeRegExp`), so no regex injection.
- Data exposure: currentOp output (command text, client addresses, users) is shown only in the tab, as mongosh does; nothing is logged in the new backend or renderer code (no `console`/`log` calls in the diff); no secrets in fixtures (e2e/int use container URIs).
- Async state: `refresh()` aborts the previous request and ignores aborted/older results (also older failures); the next auto-refresh is scheduled only after an answer; errors leave a recoverable screen (Refresh button, auto-refresh continues). Covered by view specs.
- Acceptance criteria: AC1 is covered by `test/integration/currentop.int.spec.ts` (slow `$where` find listed with filters, killed, ends `Interrupted`, then no longer listed); AC2 by `test/e2e/currentop.e2e.ts` (opened from the sidebar menu, cancel sends nothing, confirm kills, query ends `Interrupted`, row disappears). The parent reports both run and passing; the tests assert the right behavior.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Closing the tab while a confirmed kill is in flight restarts polling on a destroyed view**
    - File: `packages/renderer/src/app/admin/currentop/currentop-view.ts:205`
    - Category: Correctness
    - Problem: `kill()` awaits `guard.run(...)` and then calls `await this.refresh()`. The `DestroyRef.onDestroy` handler (lines 118-121) only aborts the current read and clears the timer; there is no destroyed flag. If the tab is closed (e.g. Ctrl/Cmd+W) after the user confirms but before `admin.killOp` answers (a busy server is exactly when kills are used), `refresh()` then runs on the destroyed component, starts a new `admin.currentOp` request and `schedule()` arms a timer that re-arms itself every 5 s, with nothing left to clear it.
    - Why it matters: a closed tab keeps polling `currentOp` against the server until the app restarts (and the connection may later answer `NOT_CONNECTED` every 5 s). The window is narrow (the confirm dialog blocks the close shortcut, so only the killOp round trip), hence Low.
    - Suggested fix: set a `destroyed` flag in `onDestroy` (as `collection/bulk/bulk-panel.ts` does) and make `refresh()`/`schedule()` return early when it is set; optionally pass an `AbortSignal` to `guard.run`. Add a view spec that closes the tab while the kill request is pending.

- [ ] **CR-2 | Every currentOp / `$currentOp` operation is hidden, not only Thicket's own probe**
    - File: `packages/backend/src/admin/currentop/currentop.ts:52` (used at line 90)
    - Category: Correctness
    - Problem: `isOwnProbe` drops any operation whose `command` contains `currentOp` or whose pipeline has a `$currentOp` stage, regardless of which client ran it. `docs/ARCHITECTURE.md` (Current operations) says "Its own `currentOp` is left out", but with "Idle and system operations" or any filter, `$currentOp` aggregations of other clients/monitoring agents are also removed and can therefore not be seen or killed from the tab.
    - Why it matters: small behavioral mismatch with the documented contract; a long-running `$currentOp` aggregation from another tool would be invisible.
    - Suggested fix: either tag the tab's own command (e.g. a `comment` such as the `thicket:` comments used by `docs/query`) and drop only that, or update the architecture note to say all currentOp probes are hidden.

- [ ] **CR-3 | `isUnauthorized` duplicated with `docs/query/query.ts`**
    - File: `packages/backend/src/admin/currentop/currentop.ts:45`
    - Category: Quality
    - Problem: the same Unauthorized detection (`serverCode === 13 || codeName === 'Unauthorized'`, plus its own `UNAUTHORIZED` constant) already exists in `packages/backend/src/docs/query/query.ts:109` for the cancel's `$ownOps` fallback. Both modules now implement the same "currentOp, then `$ownOps` on Unauthorized" rule separately.
    - Why it matters: two copies of the rule can drift (e.g. if another code such as `Unauthorized` variants or Atlas errors needs handling).
    - Suggested fix: move the predicate (and the constant) into a shared backend helper (e.g. next to `toBrowseError`) and use it in both places.

## Review conclusion

No material issues found.

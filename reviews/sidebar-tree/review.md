# Code Review

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 4, final code)

Scope: committed task diff `git diff fc84d7a4..07f6bfcd -- . ':!reviews' ':!tasks'` (14 commits, 13 code/doc files). Focus: the round-3 CR-1 fix (55112cc) and the round-4 tests (07f6bfc), plus a re-check of the whole task against its acceptance criteria.

Requirements:
- tasks/sidebar-tree.md (acceptance criteria and recorded assumptions)
- SPEC.md M1 "Browsing" (sidebar tree, counts and sizes on demand) and "Safety"
- docs/ARCHITECTURE.md "Sidebar tree" and "Write safety in the renderer"
- AGENTS.md and docs/QUALITY.md
- Earlier reports: reviews/sidebar-tree/round1..round3/, reviews/sidebar-tree/fixes.md, reviews/sidebar-tree/tests.md
- Parent instructions (verify round-3 CR-1, review the whole task, run `npm run check`)

Git range:
- Branch: main
- HEAD: 07f6bfcd49ffda347ab0aedc7dc654adef39179f
- Base/start: fc84d7a400ffc80511c5e7337fabf160126c7369
- Commits reviewed: 14
- Uncommitted changes: none (clean working tree)

Commands run (read-only):
- `npm run check` (repo root) -> pass. Lint, prettier and type check passed. Root vitest: 46 files, 2829 tests passed. Renderer `ng test`: 46 files, 1011 tests passed.
- I did not re-run the e2e this round. The round-3 reviewer ran `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (2 passed), and the test-writer re-ran it for round 4 (tests.md: 2 passed against the mongo fixture). Since round 3, the only code change is in `SidebarTreeService.connect()`. The e2e flows use that method only on the normal path, and that path behaves the same as before.
- I did not run `tasks.py verify`, because the parent asked me not to run tasks.py. So I did not check the recorded criterion evidence myself.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Round-3 finding: verification

- CR-1 (a cancelled or older `conn.open` answer overwrote the connection state after Disconnect): resolved.
  - `connect()` (`sidebar-tree.service.ts:214-232`) now takes a generation under the key `conn:<profileId>`. It ignores both the result and the error unless that generation is still current. It only loads databases for a current attempt.
  - Three things make an attempt stale:
    - a newer `connect()`;
    - `forgetProfile()`, which `disconnect()` calls and which also runs for the `disconnected`/`error` status broadcasts. Its matcher takes the text after the first `:` and needs an exact profile-id match, so `conn:p10` survives a disconnect of `p1`. A test covers this case.
    - `backend.restarted`, which invalidates every key except `profiles`.
  - Ordering: the backend may send the `CANCELLED` rejection before the `conn.close` answer. In that case `error` shows only briefly. `disconnect()`'s `finally` then sets `disconnected` and forgets the profile. Every order therefore ends in `disconnected`. If the user reconnects first, a late rejection is dropped, and the new attempt keeps its `connected` state.
  - Callers: when a stale attempt resolves, it returns the current view and does not throw. The password prompt (`sidebar-tree.ts:369-370`) throws only on `error`, so a stale result closes the prompt, which is correct.
  - Backend context: the backend (`packages/backend`) does not send `conn.status` broadcasts yet. The broadcast cases are still tested defensively ("connected" keeps the attempt current; "disconnected"/"error" make it stale while the broadcast state is kept).
  - Tests:
    - Service tests cover Disconnect + `CANCELLED`, Disconnect + a late success, reconnect before the old rejection, a newer connect without Disconnect, `backend.restarted`, and the prefix-id case.
    - A component test checks that Disconnect while connecting shows "Not connected" with no "cancelled" text.

## Acceptance criteria

- Component tests with the fake API for lazy load, errors, context actions: met.
  - `sidebar-tree.spec.ts` and `sidebar-tree.service.spec.ts` cover:
    - lazy loading of databases and collections;
    - list errors with Retry, `NOT_CONNECTED`, and out-of-order or stale answers;
    - create, rename and drop (with the typed name), stats on demand, and the menu and keyboard.
  - They pass in `npm run check`.
- e2e against a fixture (create db and collection, rename, drop with the typed name): met. `test/e2e/sidebar.e2e.ts` covers this flow against the mongo fixture. Evidence: the round-3 reviewer ran it (2 passed), and the test-writer re-ran it for round 4.
- Read-only profile hides or disables write actions (test): met.
  - Write menu items use `[appWriteControl]`.
  - `chooseItem` (`sidebar-tree.ts:553`) refuses write items on read-only profiles.
  - `WriteGuard` refuses the write on the service side.
  - Both component tests and the e2e read-only test cover it.

SPEC "Sidebar tree: databases → collections, views, time series; counts and sizes on demand" is implemented as documented in the task assumptions. ARCHITECTURE.md documents the sidebar ("Sidebar tree" section), and the code matches that description.

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

The round-3 CR-1 fix is correct, contained, and covered by service and component regression tests. All three acceptance criteria are met, and `npm run check` passes on HEAD 07f6bfc. Nothing in this review blocks completion. The parent still has to confirm that each criterion has its evidence recorded with `tasks.py verify`.

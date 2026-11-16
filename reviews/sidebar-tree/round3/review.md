# Code Review

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 3, final code)

Scope: committed task diff `git diff add6545e..bdf5b75 -- . ':!reviews' ':!tasks'` (11 commits). Focus: the round-2 CR-1 fix (d21e62c) and the round-3 tests (bdf5b75), plus a re-check of the whole task against its acceptance criteria.

Requirements:
- tasks/sidebar-tree.md (acceptance criteria and recorded assumptions)
- SPEC.md M1 "Browsing" and "Safety"
- docs/ARCHITECTURE.md "Sidebar tree" and "Write safety in the renderer"
- AGENTS.md (check, evidence, quality gate)
- Earlier reports: reviews/sidebar-tree/round1/, reviews/sidebar-tree/round2/review.md, reviews/sidebar-tree/fixes.md, reviews/sidebar-tree/tests.md
- Parent instructions (verify round-2 CR-1, review the whole task, run `npm run check`)

Git range:
- Branch: main
- HEAD: bdf5b75a0631ccf8a0a31c36cfa44face0378ef1
- Base/start: add6545e8ae22053fd562cc7544640b14abdd408
- Commits reviewed: 11
- Uncommitted changes: none (clean working tree)

Commands run (read-only):
- `npm run check` (repo root) -> pass: lint, prettier and type check pass; root vitest 44 files / 2684 tests passed; renderer 46 files / 1000 tests passed.
- `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (mongo container fixture) -> 2 passed ("create a database and collection, rename, and drop with the typed name"; "a read-only profile disables the write actions").
- `tasks.py verify` was not run (the parent asked the reviewer not to run tasks.py). The recorded evidence was therefore not checked.

Summary: 0 P0, 0 P1, 1 P2, 0 P3

## Round-2 finding: verification

- CR-1 (permanent "Loading…" line after a cancelled create prompt): resolved.
  - `promptCreateDatabase` (`sidebar-tree.ts:477`) and `promptCreateCollection` (`sidebar-tree.ts:496`) now start `loadDatabases` / `loadCollections` after expanding the node. They use the same `undefined` guard as `toggle()`, so a list that is loaded or still loading is not requested twice. The service sets the entry to `loading` synchronously, so the guard also holds while a request is in flight.
  - The out-of-order case is safe. A submit reloads through `createCollection` / `createDatabase`, which bumps the generation, so the answer of the list started by the prompt is dropped if it arrives later. The round-3 tests "keeps the created collection/database when the list started by the prompt answers last" cover this.
  - A failed load started by the prompt shows the error with Retry (round-3 test).
  - The regression tests check the tree after Cancel and Escape and confirm that no second request is sent.

## Acceptance criteria

- Component tests with the fake API for lazy load, errors and context actions: met. `sidebar-tree.spec.ts` and `sidebar-tree.service.spec.ts` cover lazy loading, list errors with Retry, NOT_CONNECTED, out-of-order answers, create, rename, drop, stats and the menu.
- e2e against a fixture (create db and collection, rename, drop with the typed name): met. The reviewer re-ran it: 2 passed.
- Read-only profile hides or disables write actions: met. There are component tests and the e2e read-only test. Write items use `[appWriteControl]`, and `chooseItem` refuses write items on read-only profiles.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A cancelled or older `conn.open` answer overwrites the connection state after Disconnect (no request identity in `connect`)**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.service.ts:210-224` (reached through `packages/renderer/src/app/sidebar/sidebar-tree.ts:389-394`)
    - Category: Correctness
    - Problem: The context menu offers "Disconnect" while a connection is `connecting` (`sidebar-tree.ts:389`). `disconnect()` sends `conn.close`, then sets `disconnected` and forgets the lists. On the backend, `ConnectionManager.close()` deletes the entry. The pending `conn.open` then rejects with `CANCELLED` (`manager.ts` `closedWhileConnecting`, e.g. at line 180 when the close lands during the profile/secret load). That rejection arrives after the `conn.close` answer. The service's `connect()` catch then sets `{ state: 'error', message: describeError(error) }` without any check. So a connection the user just disconnected shows "Connection failed: The operation was cancelled." with a Retry link instead of "Not connected." Unlike the list loads, `connect()` has no generation, and `forgetProfile` cannot invalidate it. A second risk follows from the same cause: if the user reconnects before the old `conn.open` rejects, the late `CANCELLED` turns the new, live connection into `error`. The databases are then hidden, and the menu offers Connect instead of Disconnect. Elsewhere `CANCELLED` is deliberately ignored (`SidebarTree.run`), but not here. No test covers Disconnect while connecting.
    - Why it matters: This is the out-of-order async class the task otherwise guards against (generations for lists and stats). A normal menu action leaves a wrong error state, and the reconnect variant can mislabel a live connection. The user can recover with Retry or Connect, so this is not P1.
    - Suggested fix: Give `connect()` a request identity, e.g. `const gen = this.next(`conn:${profileId}`)`. Have `forgetProfile` / `invalidate` match it (the key format `conn:<profileId>` already fits the matcher). Apply the `conn.open` result or error only while it is current. Alternatively, ignore a `CANCELLED` failure when the state is no longer `connecting`. Add a service test: `conn.open` pending, then `disconnect()`, then `conn.open` rejects `CANCELLED` -> state stays `disconnected`. Add a second test for a reconnect that answers before the old rejection.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

The round-2 CR-1 fix is correct and covered by regression tests. All three acceptance criteria are met:
- `npm run check` passes.
- The sidebar e2e passes against the mongo fixture (re-run by the reviewer).

One P2 remains: CR-1, an unguarded `conn.open` answer after Disconnect while connecting. It is a small, contained fix with a service test. The parent may decide whether to fix it in this task or record it as a follow-up.

# Code Review

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff ad1d789558b24b9260e53e38a53070f4b6d6ab3d..b5e20ddef0d25be9ff8f21715c8e461c0c99770a` (whole task diff on top of the current main, excluding `reviews/` and `tasks/`), committed changes only. This re-review covers:
- the merges with main (server-stats, users-roles-edit), up to 5182f3c9;
- the test-only delta `git diff 5182f3c9 b5e20dde -- packages/`.

Requirements:
- tasks/change-streams.md acceptance criteria:
  - (1) integration test: insert/update/delete events received in order;
  - (2) a standalone server shows a clear 'needs replica set' message (test).
- The recorded assumptions in tasks/change-streams.md:
  - raw `$changeStream`, no auto-resume;
  - a standalone server is refused via `hello`;
  - the `docs.get` side panel;
  - the accepted P3 on re-selecting an open tab.
- SPEC.md M6 "Could" change streams
- docs/ARCHITECTURE.md: the "Watch changes" section, plus the server-stats and users sections for the parallel features
- AGENTS.md
- The previous reviews (revisions 0fe60e1b and 5182f3c9) and reviews/change-streams/quality.json

Git range:
- Branch: main
- HEAD: b5e20ddef0d25be9ff8f21715c8e461c0c99770a
- Base/start: ad1d789558b24b9260e53e38a53070f4b6d6ab3d
- Commits reviewed: 15. These are the task commits 2572e941..f21a5584, the merges d9b5e08c, b6e298b8, 9b595758, dc2e8de2 and eaafebf9, plus 5182f3c9 and b5e20dde. The working tree was clean when the review started.

Summary: 0 P0, 0 P1, 0 P2, 1 P3 (previously accepted)

## What was checked

### Merge resolutions (up to 5182f3c9)

- **Watch code unchanged since the earlier full review.** `git diff 1577c362 HEAD` shows no changes in `packages/backend/src/admin/watch`, `packages/renderer/src/app/watch` (production files) or `test/integration/change-streams.int.spec.ts` (only spec files were added later, in b5e20dde). The earlier verification of the cursor pinning and of the close-after-cancelled-round fix still applies.
- **Nothing from main was dropped.** Relative to the base, the task diff removes only one line: the `TabKind` union terminator in `workspace.service.ts`, where `'watch'` was appended after `'serverstats'`. All other changes in the merged files are additions:
  - `sidebar-tree.ts` adds a "Watch changes" entry to the connection, database and collection menus (disabled for views). It sits next to the current-ops, server-stats, users and gridfs entries, which are all still wired.
  - `sidebar-tree.service.ts` adds `openWatch`, which follows the same `workspace.open` pattern as the other `open*` methods.
  - `app.config.ts` adds `provideTabView('watch', WatchView)` and keeps users, currentop and serverstats.
  - `backend.ts` adds `...watchHandlers(connections)` and keeps the users, users-edit, currentop and stats handlers.
  - `manager.ts` only adds the optional `CursorLike.tryNext` and `setMaxTimeMS`, so the other features' test fakes still type-check.
  - `index.ts` exports `./admin/watch`.
- **Contract unchanged.** `admin.watch` was already defined on main in `packages/contract/src/admin.ts`.
- **Validation at 5182f3c9:** `npm run check` passed lint, type check, the root vitest suite (99 files, 5217 tests) and the renderer `ng test` (121 files, 4047 tests).

### Test delta b5e20dde (spec files only, no production code)

- **`packages/backend/src/server/backend.spec.ts`:**
  - One test asserts that `startBackend` registers `admin.watch` next to `admin.currentOp` and `admin.serverStatus`. This guards the merged wiring in backend.ts.
  - One test sends `admin.watch` for the read-only profile `ssh` (`readOnly: true` in the spec's fixture) and checks two things: the answer is `NOT_CONNECTED`, not `READ_ONLY`, and no connect is attempted. This behaviour is correct, because watching is a read.
- **`packages/renderer/src/app/app.spec.ts`:** asserts that the `watch` tab kind maps to exactly one view, `WatchView`. This catches a lost or duplicated `provideTabView` entry after a merge.
- **`packages/renderer/src/app/watch/watch.model.spec.ts`:** covers malformed events:
  - a relaxed ISO `wallTime`, an unreadable `wallTime` falling back to `clusterTime`, and `null`;
  - an `_id` that is not valid EJSON, labelled with its JSON text;
  - odd `updateDescription` shapes and the 200-character summary cap;
  - an event without a collection, which cannot be opened.

  The assertions check observable output (`time`, `id`, `idLabel`, `summary`, `openable`), not internals.

  The invalid-`_id` case pins `openable: true`. A real server cannot emit such an id, and `open` would only show the `docs.get` error in the side panel, so this does not need a finding.
- **Run during this review, at b5e20dde:**
  - `npx vitest run packages/backend/src/server/backend.spec.ts` -> 1 file, 58 tests passed.
  - `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/watch/**/*.spec.ts'` -> 3 files, 41 tests passed.
  - `npx eslint` on the three changed spec files -> no problems.

## Acceptance criteria

- **(1)** Covered by `test/integration/change-streams.int.spec.ts`, case "receives insert, update and delete events of a collection in order", against the `mongo8rs` fixture. That test and the watch production code are unchanged since the verification recorded in the task file. I did not re-run the integration suite in this review.
- **(2)** Covered at two levels:
  - the integration test against the `mongo8` standalone fixture (`UNSUPPORTED`, detail `needsReplicaSet`);
  - the renderer spec `watch-view.spec.ts`, which I ran green in this review.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Choosing "Watch changes" again for an open watch tab restarts the stream, even after Stop (previously accepted)**
    - File: `packages/renderer/src/app/watch/watch-view.ts:110-115`
    - Category: Correctness
    - Problem: `workspace.open` replaces the tab object of a tab that is already open. The `target` computed then returns a new object, so the constructor effect calls `start()` again. This cancels the running stream, or overrides Stop.
    - Why it matters: events in the short gap are lost, and the stream restarts unexpectedly after Stop.
    - Suggested fix: restart only when `profileId`, `db` or `coll` change, for example with an `equal` function on `target`. Add a view test that sets an equal `tab` input again.
    - Status: already accepted by the task owner and recorded as an assumption in tasks/change-streams.md, outside the acceptance criteria. It is listed here for completeness and needs no action for this revision.

## Review conclusion

No material issues found. The merge resolutions kept every server-stats, users-roles-edit, gridfs and current-ops entry and added the watch entries alongside them. The watch production code is unchanged since the earlier full review. The test-only commit b5e20dde adds meaningful regression tests for the merged wiring and for malformed events, and they pass.

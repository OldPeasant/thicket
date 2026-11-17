# Code Review

Date: 2026-11-17

Task: change-streams - M6 (Could): Watch changes

Scope: `git diff ad1d789558b24b9260e53e38a53070f4b6d6ab3d..5182f3c9` (whole task diff on top of the current main, excluding `reviews/` and `tasks/`), committed changes only. This is a re-review after the merges with main (server-stats, users-roles-edit). It focuses on the merge-resolved files.

Requirements:
- tasks/change-streams.md acceptance criteria:
  - (1) integration test: insert/update/delete events received in order;
  - (2) a standalone server shows a clear 'needs replica set' message (test).
- The recorded assumptions in tasks/change-streams.md: raw `$changeStream` without auto-resume; standalone refused via `hello`; `docs.get` side panel; accepted P3 on re-selecting an open tab.
- SPEC.md M6 "Could" change streams
- docs/ARCHITECTURE.md "Watch changes" section, plus the server-stats and users sections for the parallel features
- AGENTS.md
- The previous review in reviews/change-streams/review.md (revision 0fe60e1b) and reviews/change-streams/quality.json (reviewed_revision 1577c362)

Git range:
- Branch: main
- HEAD: 5182f3c9
- Base/start: ad1d789558b24b9260e53e38a53070f4b6d6ab3d
- Commits reviewed: 14. These are the task commits 2572e941..f21a5584, the merges d9b5e08c, b6e298b8, 9b595758, dc2e8de2 and eaafebf9, and 5182f3c9. Working tree clean.

Summary: 0 P0, 0 P1, 0 P2, 1 P3 (previously accepted)

## What was checked in this revision

- **Watch code is unchanged since the last review.** `git diff 1577c362 HEAD` on `packages/backend/src/admin/watch`, `packages/renderer/src/app/watch` and `test/integration/change-streams.int.spec.ts` is empty. The previous findings and their verification still apply: the stream is pinned to one raw driver cursor, and the cursor is closed after a cancelled round.
- **Nothing from main was dropped by the merges.** Relative to the base, the task diff has exactly one removed line. That line is the `TabKind` union terminator, `| 'serverstats';` became `| 'serverstats'` followed by `| 'watch';`. Every other change in the merged files is an addition:
  - `packages/renderer/src/app/sidebar/sidebar-tree.ts`: "Watch changes" was added to the connection menu (next to `current-ops` and `server-stats`), to the database menu (after `users` and `gridfs`), and to the collection menu (disabled for views). `openServerStats`, `openUsers` and `openGridfs` are still wired.
  - `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`: the `openWatch` method and the `watch.model` import were added. `openUsers`, `openServerStats`, `openCurrentOps` and `openGridfs` are intact. `openWatch` follows the same `workspace.open` pattern (`id`, `kind`, `title`, `detail`, `production`, `data`).
  - `packages/renderer/src/app/layout/workspace.service.ts`: `'watch'` was added to `TabKind`, and `'serverstats'` is kept.
  - `packages/renderer/src/app/app.config.ts`: `provideTabView('watch', WatchView)` was added next to `users`, `currentop` and `serverstats`.
  - `packages/backend/src/server/backend.ts`: `...watchHandlers(connections)` was added. `usersHandlers`, `usersEditHandlers`, `currentOpHandlers` and `statsHandlers` are all still registered.
  - `packages/backend/src/connections/manager.ts`: only the optional `CursorLike.tryNext` and `setMaxTimeMS` were added. Fakes from other features stay valid because both members are optional.
  - `packages/backend/src/index.ts`: the `./admin/watch` export was added.
- **The `admin.watch` contract already existed on main** in `packages/contract/src/admin.ts:170`. The handler and the renderer use it unchanged, so there is no contract drift.
- **Validation run during this review:** `npm run check` passed lint, type check and both unit suites:
  - root vitest: 99 files, 5217 tests passed;
  - renderer `ng test`: 121 files, 4047 tests passed.

  These include the sidebar watch specs and the server-stats/users specs that came from main. A separate `npx eslint` run on the merged directories reported no problems.

## Acceptance criteria

- (1) The integration test is `test/integration/change-streams.int.spec.ts`, case "receives insert, update and delete events of a collection in order" (`mongo8rs`). It is unchanged since the last review and its verification is recorded in the task file. I did not re-run the integration suite here, because no Docker or Podman run is needed when the code is unchanged.
- (2) The standalone refusal is tested at two levels, both unchanged:
  - integration against `mongo8` (`UNSUPPORTED`, detail `needsReplicaSet`);
  - renderer spec `watch-view.spec.ts` ("shows a clear needs replica set message for a standalone server"), which ran green in `npm run check` above.

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
    - Problem: `workspace.open` replaces the tab object of an already open tab. The `target` computed then returns a new object, so the constructor effect calls `start()` again. This cancels the running stream, or overrides Stop.
    - Why it matters: there is a small gap in the events, and an unexpected restart after Stop.
    - Suggested fix: restart only when `profileId`, `db` or `coll` change, for example with an `equal` function on `target`. Add a view test that sets an equal `tab` input again.
    - Status: already accepted by the task owner and recorded as an assumption in tasks/change-streams.md (outside the acceptance criteria). Listed here for completeness only. No action is required for this revision.

## Review conclusion

No material issues found. The merge resolutions kept every server-stats, users-roles-edit, gridfs and current-ops entry and added the watch entries alongside them. The watch implementation is unchanged since the previous review, and the full project check passes on HEAD 5182f3c9.

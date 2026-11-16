# Code Review

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 2, final code)

Scope: committed task diff `git diff 2d67669..ae34216 -- . ':!reviews' ':!tasks'` (7 commits, a8298b3..ae34216), with a focus on the round-1 fix commit ae34216. Uncommitted test-writer changes to `sidebar-tree.spec.ts` were present in the working tree. They were not reviewed.

Requirements:
- tasks/sidebar-tree.md (acceptance criteria and recorded assumptions)
- SPEC.md M1 "Browsing" and "Safety"
- docs/ARCHITECTURE.md "Sidebar tree" and "Write safety in the renderer"
- AGENTS.md (check, evidence, quality gate)
- Round-1 reports reviews/sidebar-tree/round1/review.md and round1/tests.md, and the fixer report reviews/sidebar-tree/fixes.md
- Parent instructions (verify the round-1 fixes; focus on focus handling, menu clamping, promptOpen/AppShell modal, and generation invalidation)

Git range:
- Branch: main
- HEAD: ae34216dbdb49320d190db94f984e5a343fef3eb
- Base/start: 2d67669a452a6e78c67a41beec6dbf4098bbf930
- Commits reviewed: 7

Commands run (read-only):
- `npm run check` -> passes: eslint, prettier and typecheck pass; root vitest 44 files / 2684 tests; renderer 46 files / 994 tests. The working tree contained the test-writer's uncommitted spec additions; the committed revision reports 989 tests.
- The e2e tests were not re-run by the reviewer. The fixer reports `npm run test:e2e -- test/e2e/sidebar.e2e.ts` -> 2 passed.

Summary: 0 P0, 0 P1, 1 P2, 0 P3

## Round-1 findings: verification

- CR-1 (prettier): resolved. `npm run check` passes, prettier included.
- CR-2 (stuck "Loading collections…" after reconnect): resolved for the reconnect path. The effect at `sidebar-tree.ts:248-259` collapses the database nodes of every profile whose database list is forgotten. Its prefix `d\0<profileId>\0` cannot match another profile. Tests cover the conn.status, menu disconnect and backend.restarted paths. A related path is still open; see CR-1 below.
- CR-3 (out-of-order tests): resolved. The service spec covers older answers that succeed or fail after newer ones (db list, coll list, stats).
- CR-4 (invalidate on forget): resolved.
  - `invalidate()` (`sidebar-tree.service.ts:461`) bumps the matching generations. `forgetProfile` matches `<type>:<profileId>` and `<type>:<profileId>\0…`, and the first `:` is always the type separator.
  - `backend.restarted` invalidates everything except `profiles`.
  - `noteDisconnect` now runs only for current requests.
- CR-5 (menu clamping): resolved. `keepMenuInView` settles after one extra pass for the normal cases: the right-edge shift is idempotent, and after the flip `y + h + margin` equals `y0 + margin`. The flip would only repeat for a pointer within 4px of the window bottom. The status bar occupies that area, so the sidebar cannot be clicked there.
- CR-6 (status rows): resolved. Status lines are `role="treeitem"` with `aria-level`. They are not focusable and are excluded from `nodes()`.
- CR-7 (prompt modal): resolved.
  - `AppShell.modal()` = confirm or prompt open, so the shortcuts are consumed but ignored.
  - The work area, splitter and status bar are inert. The sidebar is inert only for the confirm dialog.
  - The prompt has a full-window backdrop and its own Tab trap.
  - The flag is cleared on close and on destroy.
- CR-8 (no-op click): resolved. The steps were removed, and outside-mousedown closing is tested separately.
- TW-1 (prompt focus): resolved. `chooseItem` runs the item first and calls `refocus()` only when no prompt opened, and `returnFocus` returns the focus to the node when the prompt closes.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Cancelling "Create collection…" / "Create database…" on a node whose list was never loaded leaves a permanent "Loading…" line**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.ts:492` (also `:475`)
    - Category: Correctness
    - Problem: `promptCreateCollection` calls `setExpanded(dbNodeKey(profileId, db), true)` but does not load anything. When the database was never expanded, `collections(profileId, db)` is `undefined`, and `rows()` (lines 199-201) renders "Loading collections…" without a retry button. Only `toggle()`, Refresh and Retry start `loadCollections`. If the user cancels the prompt (Escape or Cancel), or cancels the production confirm and then the prompt, nothing ever loads the list, and the node shows "Loading collections…" forever. `promptCreateDatabase` (line 475) has the same problem when a connection is `connected` but its database list was never loaded. This happens when `reloadProfiles` applies a `conn.status` of `connected` for a connection the backend kept open, for example after a renderer reload. The connection then shows "Loading databases…" with no request in flight. The new collapse effect does not help: it handles only profiles whose database list is missing, and only database nodes. The spec "tells the shell while the prompt is open, through submit and Escape" (`sidebar-tree.spec.ts:1110-1121`) runs exactly this sequence on the collapsed `shop` database but does not check the tree afterwards.
    - Why it matters: This is the same stuck-loading class as round-1 CR-2, and it is reached through a normal action: opening and cancelling a create dialog. The user can recover only by collapsing and re-expanding the node.
    - Suggested fix: Expand through the loading path. For example, have `promptCreateCollection` call `toggle(row, true)` or start `loadCollections` when `collections(...)` is `undefined`. Do the same for the connection in `promptCreateDatabase` with `loadDatabases`. Add a component test: on a collapsed database, open Create collection…, cancel, and expect the collections to load and no lasting "Loading collections…".

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

All round-1 findings (CR-1..CR-8, TW-1) are resolved in the reviewed revision ae34216, and `npm run check` passes. The acceptance criteria are met in substance:
- Component tests with the fake API cover lazy loading, errors and the context actions.
- The e2e covers create, rename and drop with the typed name, according to the fixer's run; the reviewer did not re-run it.
- Read-only profiles are covered by component and e2e tests.

One P2 remains: CR-1, a stuck loading line after a cancelled create prompt. The fix is small and should come with a component test.

# Fix Report

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections

Scope: current task; findings CR-1..CR-8 from `reviews/sidebar-tree/round1/review.md` and TW-1 from
`reviews/sidebar-tree/round1/tests.md`. Code in `packages/renderer/src/app/sidebar/` and
`packages/renderer/src/app/layout/app-shell.ts` (shell change for CR-7 approved by the parent).

## Fixed findings

### TW-1 — Prompt opened from the context menu does not receive focus

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`

Problem:
`chooseItem()` called `refocus()` before `item.run()` opened the prompt. The pending node focus
ran after the prompt focus in the same `afterRenderEffect`, so focus went back to the tree node.

Fix:
`chooseItem()` now runs the item first and calls `refocus()` only when no prompt is open. The
node key stays in `returnFocus`, so closing the prompt still returns focus to the node.

Validation:
- `SidebarTree > prompt details > focuses the first field of a prompt opened from the context menu` — Pass
- `SidebarTree > prompt details > closes with Escape and returns focus to the node` — Pass

### CR-1 — Prettier failure in test/e2e/sidebar.e2e.ts

Files changed:
- none (the test-writer had already formatted the file)

Problem:
`prettier --check .` reported `test/e2e/sidebar.e2e.ts`.

Fix:
Confirmed it was already resolved. `npx prettier --check .` reports all files formatted. A
comment line in `app-shell.ts` that this fix made too long was also re-wrapped.

Validation:
- `npx prettier --check .` — Pass

### CR-2 — Expanded databases stay on "Loading collections…" after a reconnect

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
Disconnecting, a `disconnected`/`error` status or `backend.restarted` makes the service forget the
lists, but the component kept the database nodes expanded. After reconnecting, nothing requested
their collections.

Fix:
I chose to collapse the databases instead of reloading their collections. An `effect` in
`SidebarTree` removes the expanded flag from the database nodes of any profile whose database list
was forgotten (`tree.databases(id) === undefined`). After reconnecting, the databases show
collapsed, and expanding one loads its collections through the normal `toggle()` path.
Auto-reloading was rejected because a database being dropped would briefly be "expanded without a
list" and would send a `coll.list` for the dropped database.

Validation:
- New component tests: reconnect after a `conn.status` disconnected broadcast, after menu
  Disconnect + Connect, and after `backend.restarted`. Each asserts that "Loading collections" is
  not shown and that expanding the database loads the collections — Pass

### CR-3 — Out-of-order guard not tested

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
The reviewer saw no tests for generations or for the reconnect path.

Fix:
The test-writer had already covered profiles, an older db-list success, an older coll-list
failure, coll.stats, and per-database generations. I added only the missing cases:
- an older `db.listDatabases` failing with `NOT_CONNECTED` after a newer success: the list stays
  and the connection stays connected;
- an older `coll.list` success after a newer one.

The reconnect path is covered by the CR-2 tests.

Validation:
- `npx ng test --include src/app/sidebar --include src/app/layout` — Pass

### CR-4 — Forgetting a profile does not invalidate in-flight loads

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`

Problem:
Requests still running during a disconnect could write their results back afterwards. A stale
`NOT_CONNECTED` could mark a reopened connection disconnected.

Fix:
A new private `invalidate(matches)` bumps the generation of every matching list key.
- `forgetProfile` invalidates the keys of that profile (`db:<id>`, plus `coll:`/`dbstats:`/
  `collstats:` keys starting with `<id>\u0000`).
- `backend.restarted` invalidates every key except `profiles`.
- `noteDisconnect` now runs only for a request that is still current.

Validation:
- New service tests:
  - lists still loading are dropped when the connection closes;
  - a late `NOT_CONNECTED` does not mark a reopened connection disconnected;
  - another profile's requests stay current;
  - a `db.stats` answer still running at `backend.restarted` is dropped.
  All Pass.

### CR-5 — Context menu not kept inside the viewport

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
The menu opened at the raw pointer position without clamping.

Fix:
After render, `keepMenuInView()` measures `.menu` and adjusts the position against
`innerWidth`/`innerHeight` with a 4px margin:
- it shifts the menu left when it would overflow on the right;
- it flips the menu above the pointer when there is no room below (but no higher than the
  margin).

The position is written only when it changes, so the effect settles after one extra pass. The
menu state type became a named `OpenMenu` interface.

Validation:
- New tests: "keeps the menu inside the window near the bottom right corner" (stubs the menu size,
  since jsdom has no layout) and "leaves a menu that fits at the pointer" — Pass

### CR-6 — Status rows with buttons owned directly by the tree

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.html`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
Loading, error and empty lines were `role="none"` directly under `role="tree"`, so their
Retry/Connect buttons became children of the tree.

Fix:
Status lines are now `role="treeitem"` with `aria-level`. They have no tabindex: the arrow keys
skip them, and their button stays reachable with Tab. `data-testid` values are unchanged.

Validation:
- New test "status lines are non-focusable treeitems with their level" (every child of the tree
  is a `treeitem`, and the retry button sits inside the status treeitem) — Pass
- Existing `tree-status`/`tree-retry` tests and the sidebar e2e — Pass

### CR-7 — Prompt is aria-modal but shell shortcuts still act behind it

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`

Problem:
The shell's `modal()` covered only the confirm dialog.

Fix:
- `SidebarTreeService` exposes a read-only `promptOpen` signal and `setPromptOpen()`.
- `SidebarTree` sets the flag in `openPrompt`/`closePrompt` and clears it on destroy.
- `AppShell.modal()` is now `confirmOpen() || promptOpen()`. While it is true the shortcuts are
  consumed but ignored, and the splitter, `.work` and the status bar are `inert`.
- The sidebar is made `inert` only by `confirmOpen()`, so it stays interactive while its own
  prompt is open.

Validation:
- New `app-shell.spec.ts` test "while the sidebar prompt is open, the work area is inert and
  shortcuts do nothing". It covers inert flags `[false, true, true, true]`; Ctrl+W, Ctrl+Tab and
  Ctrl+(Shift+)PageUp consumed with the tabs unchanged; and everything restored after Cancel —
  Pass
- The existing confirm-dialog inert test — Pass

### CR-8 — Ineffective `click(document.body)` in the read-only spec

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
`click(document.body)` does not dispatch `mousedown`, so it did not close the menu.

Fix:
Removed both steps. Closing on an outside mousedown is covered by the test-writer's "closes on a
mousedown outside the menu but not inside it".

Validation:
- `SidebarTree > read-only profiles > disables every write action and shows the badge` — Pass

Also updated: `docs/ARCHITECTURE.md` "Sidebar tree" now describes the dropped answers after
forgetting a connection, the collapse, the modal prompt, and the status lines as treeitems.

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include src/app/sidebar --include src/app/layout` — Pass:
  9 files, 298 tests

Full test suite:
- `npm run check` (repo root) — Pass:
  - `eslint . --max-warnings 0`, `prettier --check .` and the typechecks pass;
  - root vitest: 44 files, 2684 tests;
  - renderer `ng test`: 46 files, 989 tests.
- `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (mongo fixture) — Pass: 2 passed

Lint/type-check/build:
- Included in `npm run check` — Pass. After the last comment re-wrap,
  `npx prettier --check .` and `npx eslint packages/renderer/src/app/layout
  packages/renderer/src/app/sidebar --max-warnings 0` were re-run — Pass

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passes.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

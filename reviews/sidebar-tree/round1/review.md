# Code Review

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections

Scope: committed changes `git diff 1a756a7..5c68bbe` (4 commits: 7192ed0, c65d52d, 65bdcc3, 5c68bbe); no uncommitted changes.

Requirements:
- tasks/sidebar-tree.md (acceptance criteria and recorded assumptions)
- SPEC.md M1 "Browsing" and "Safety", section 4 (writes, read-only, production confirm)
- docs/ARCHITECTURE.md (incl. the new "Sidebar tree" section and "Write safety in the renderer")
- AGENTS.md (check, evidence, token-only colors note)
- Parent instructions (Angular/signals, accessibility, WriteGuard/read-only, token colors, lazy-load races, test quality)

Git range:
- Branch: main
- HEAD: 5c68bbe84202eb77b87b63b00fbfbeb9dc1652f2
- Base/start: 1a756a7058ed6daa7b9f7404f4e82d98142a1674
- Commits reviewed: 4

Commands run (read-only):
- `npm run check` -> FAILS at `prettier --check .`: `[warn] test/e2e/sidebar.e2e.ts` (eslint passed before it)
- `npm run typecheck` -> passes
- `npm run test` -> root 44 files / 2684 tests passed; renderer 46 files / 941 tests passed
- `npx prettier test/e2e/sidebar.e2e.ts | diff test/e2e/sidebar.e2e.ts -` -> 3 hunks (lines 107, 109-111, 128)
- e2e not re-run by the reviewer (parent reports 2 passed against the Podman mongo8 fixture)

Summary: 0 P0, 1 P1, 2 P2, 5 P3

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Project check fails: test/e2e/sidebar.e2e.ts is not Prettier-formatted**
    - File: `test/e2e/sidebar.e2e.ts:107`
    - Category: Tests
    - Problem: `npm run check` (what `.taskcheck` runs) stops at `prettier --check .` with `test/e2e/sidebar.e2e.ts` reported. Prettier wants to wrap the long `expect(window.locator(...)).toBeVisible()` (line 107) and `.toHaveCount(0)` (line 128) calls and to join the `toHaveText(/^0 docs, /)` call at lines 109-111. The stated evidence "`npm run check` passes" does not hold for the reviewed revision 5c68bbe.
    - Why it matters: `tasks.py done` runs `.taskcheck` and will refuse the task; the recorded evidence for the check is inaccurate.
    - Suggested fix: run `npx prettier --write test/e2e/sidebar.e2e.ts`, re-run `npm run check`, and record the actual result.

## P2 Medium

- [ ] **CR-2 | Previously expanded databases hang on "Loading collections…" after a reconnect**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.ts:191`
    - Category: Correctness
    - Problem: On disconnect (menu `disconnect`, a `conn.status` broadcast with `disconnected`/`error`, or `backend.restarted`) the service clears the collection lists (`forgetProfile`, `sidebar-tree.service.ts:404-414`; `backendRestarted` handler at 117-124), but the component's `expanded` set keeps the database keys. After reconnecting, `connect()` reloads only the database list. For a database still marked expanded, `rows()` finds `collections(...) === undefined` and renders the "Loading collections…" status line (lines 191-193), but nothing ever calls `loadCollections`: it is only triggered by `toggle()` when a node opens (line 322), by the Refresh menu item and by the error retry. The node stays in a permanent loading state with no retry button. The user has to collapse and re-expand it.
    - Why it matters: The review checklist requires that every loading path ends and leaves a recoverable screen. This is the normal disconnect/reconnect flow, and a backend restart (which the service handles explicitly) hits it too.
    - Suggested fix: Either collapse a profile's database nodes when its data is forgotten, or have the component (or `loadDatabases`/`connect`) start `loadCollections` for expanded databases whose list is missing, for example from an effect over the expanded keys and missing lists. Add a component test: expand a database, emit `conn.status` disconnected, reconnect, and expect the collections to load again.

- [ ] **CR-3 | The out-of-order guard for lazy loads is not tested**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts:115`
    - Category: Tests
    - Problem: The service uses per-list generations (`next`/`current`, `sidebar-tree.service.ts:431-439`), and ARCHITECTURE.md says "A slower older answer never overwrites a newer one". No test covers this. No spec resolves two `db.listDatabases`/`coll.list`/`*.stats` requests in reverse order, including the case where the older request fails. The suite also does not cover the reconnect path from CR-2.
    - Why it matters: Out-of-order async results are a defect class that unit tests often miss. The behavior is documented, so a regression (for example, dropping the `current()` check) would currently go unnoticed.
    - Suggested fix: Add a spec with two deferred `coll.list` (or `db.listDatabases`) answers, for example Refresh twice, and resolve the first one last, once with data and once with an error. Expect the newer list to stay.

## P3 Low

- [ ] **CR-4 | Forgetting a profile does not invalidate its in-flight loads**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.service.ts:404`
    - Category: Correctness
    - Problem: `forgetProfile` clears the maps but does not bump the generations. A `db.listDatabases`/`coll.list`/stats request that is in flight during a disconnect or backend restart still passes `current()` and writes its result back for a profile that is no longer connected (lines 241, 259, 274, 293). Also, `noteDisconnect` (lines 239, 257) runs even for a stale request, so a late `NOT_CONNECTED` from the old connection can mark a newly reopened connection `disconnected`.
    - Why it matters: Stale lists and wrong connection states are possible after a quick disconnect/reconnect. The impact is limited, but the stated "older answer never overwrites" rule does not hold across a disconnect.
    - Suggested fix: In `forgetProfile`, bump (or delete and re-base) the generation keys of the profile, and call `noteDisconnect` only when the request is still current.

- [ ] **CR-5 | Context menu is not kept inside the viewport**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.ts:501`
    - Category: Quality
    - Problem: `openMenu` places the `position: fixed` menu at the raw click coordinates (or below the node for keyboard opening) without clamping. A right click on a node near the bottom of the window puts the 4-item menu partly off-screen. Fixed elements cannot be scrolled into view.
    - Why it matters: Actions such as Drop become unreachable by mouse for nodes near the bottom of a long tree.
    - Suggested fix: After render, measure the menu and clamp `x`/`y` so it fits in `window.innerWidth/innerHeight` (flip it above the pointer when needed).

- [ ] **CR-6 | Status rows with buttons are owned by the tree**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.html:169`
    - Category: Quality
    - Problem: The loading, error and empty lines are `<li role="none">` directly inside `role="tree"`, and the error and disconnected lines contain a Retry/Connect `<button>`. With `role="none"`, the button becomes a direct child of the tree. A tree may own only `treeitem`/`group`, so this violates ARIA required-children (axe `aria-required-children`). Screen readers may also skip or misreport these controls while they navigate the tree.
    - Why it matters: The Connect/Retry button is the main recovery action for error and disconnected nodes, and its accessibility is uncertain.
    - Suggested fix: Render the status lines as `treeitem`s, or place the status text and button in an element outside the `role="tree"` list, or expose retry through the parent node (Enter/context menu) and keep the button out of the tree.

- [ ] **CR-7 | The name/password prompt is aria-modal but shell shortcuts still act behind it**
    - File: `packages/renderer/src/app/layout/app-shell.ts:128`
    - Category: Integration
    - Problem: The sidebar prompt (`sidebar-tree.html:235`, `aria-modal="true"` with a backdrop) is not part of the shell's `modal()`, which looks only at `ConfirmService.current()`. While the prompt is open, Ctrl+W still closes the active tab and Ctrl+Tab/Ctrl+PageUp/PageDown switch tabs behind it, and the work area, tab bar and status bar are not `inert`.
    - Why it matters: The prompt claims to be modal but the app behind it is not, which is inconsistent with the confirm dialog and can close a tab while the user is typing a name.
    - Suggested fix: Expose an "open prompt" state (for example, a shared modal signal or a service) that the shell includes in `modal()`, or move the prompt to the shell-level dialog layer.

- [ ] **CR-8 | `click(document.body)` in the read-only spec is a no-op**
    - File: `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts:497`
    - Category: Tests
    - Problem: The menu closes on `(document:mousedown)` (`sidebar-tree.ts:102`), but `HTMLElement.click()` dispatches only a `click` event. The steps at lines 497 and 504 therefore do not close the menu. The test only passes because the next `contextmenu` replaces the open menu. Outside-click closing is not tested anywhere.
    - Why it matters: The test suggests coverage that does not exist, and the steps mislead anyone who edits the test later.
    - Suggested fix: Dispatch a `mousedown` on `document.body` and assert that `tree-menu` is gone, or remove the steps.

## Review conclusion

Material issues found; fix before completing the task.

The acceptance criteria are otherwise met in substance:
- The component tests with the fake API cover lazy load, errors and context actions.
- The e2e covers create db+collection, rename, and drop with the typed name against a real Mongo fixture.
- The read-only profile is covered by both component and e2e tests.
- Writes go through `WriteGuard`, with drops using `alwaysConfirm` + `typeToConfirm`.
- Read-only write items use `[appWriteControl]` and are also guarded in `chooseItem` and by `WriteGuard`.
- Colors come from tokens only, except the documented profile color.

CR-1 blocks `done` (`.taskcheck` fails). CR-2 is a recoverable but real stuck-loading state, and CR-3 should accompany its fix.

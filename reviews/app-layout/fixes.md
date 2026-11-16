# Fix Report

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: findings CR-1..CR-4 of `reviews/app-layout/review.md` (reviewed HEAD a9c1ea6), as approved by
the parent worker. Changes are limited to `packages/renderer/src/app/layout/`; uncommitted working
tree on top of a9c1ea6a85d530b75d68b471364f23a8595dc7b4.

## Fixed findings

### CR-1 — Stale `app.settings.changed` broadcasts undo newer sidebar widths

Files changed:
- `packages/renderer/src/app/layout/sidebar-width.service.ts`
- `packages/renderer/src/app/layout/sidebar-width.service.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
`commit()` did not track in-flight saves, so a broadcast (or late `app.settings.get` answer) for an
older save reset the shown width; three quick ArrowRight presses from 260 ended at 292.

Fix:
`SidebarWidthService` counts its own saves in flight (`saving`). While it is non-zero, `take()`
ignores broadcasts and `get` answers (they may predate the newest request), and a commit equal to
`stored` is still sent (`stored` may change when an earlier save lands). When the last own save
settles, the width from its answer is shown (unless a drag runs); a failure reverts to the last
stored width only when it was the last save and its value is still shown.
Tests: service-level overlapping saves with answer + broadcast between presses (260 -> 276, 292,
308, stays 308; a later foreign broadcast is followed again), a save back to the stored width while
another is in flight is still sent, a late initial `get` answer does not undo a width saved meanwhile;
app-shell-level three ArrowRight presses on the splitter end at 308 (`--sidebar-width`,
`aria-valuenow` and stored value). Confirmed these tests fail with the `saving` guard removed.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass

### CR-2 — Sidebar "New connection" link does nothing on the current URL

Files changed:
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
Only `NavigationEnd` switched to the routed page; navigating to the current URL emits
`NavigationSkipped` (`onSameUrlNavigation: 'ignore'`), so the tab stayed shown.

Fix:
`AppShell` also calls `showHome()` on `NavigationSkipped` with code
`IgnoredSameUrlNavigation`. Test: start on `/connections/new`, open a tab, click the sidebar
"New connection" link -> start pane visible with the page heading, tab still open. Confirmed it
fails without the fix.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass

### CR-3 — Tab strip does not follow the ARIA tabs pattern

Files changed:
- `packages/renderer/src/app/layout/tab-bar.ts`
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/tab-bar.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
Close buttons sat inside the tablist, tabs had no `aria-controls`/panels no `aria-labelledby`, the
Start pane had no `tabpanel`, every tab was a Tab stop without arrow keys, and closing the active
tab lost focus.

Fix:
- Tab wrappers (`data-testid="tab"`, still draggable, still handle middle click) get
  `role="presentation"`; the close button (`data-testid="tab-close"`) has `tabindex="-1"` and
  `aria-hidden="true"`, keeps its click handler and gets a `title` tooltip ("Close " followed by the tab title).
- Exported DOM id helpers `tabDomId` / `tabPanelDomId` (tab id URI-encoded, so IDREFs contain no
  whitespace) and `START_TAB_DOM_ID` / `START_PANEL_DOM_ID`. Every tab has an id and
  `aria-controls`; every panel has an id and `aria-labelledby` (replacing `aria-label`); the routed
  start pane is `role="tabpanel"` labelled by the Start tab.
- Roving tabindex: only the selected tab has `tabindex="0"`.
- Keydown on the tablist (unmodified keys, target `role="tab"` only): ArrowLeft/ArrowRight (wrap,
  Start included), Home/End select and focus (automatic activation); Delete closes the focused
  closable tab (`aria-keyshortcuts="Delete"`), not the Start tab.
- Closing via close button, middle click or Delete moves focus to the newly selected tab (or
  Start) when the closed tab was the active one or focus was inside the strip; focus outside the
  strip is left alone.
- No CSS changes; colors stay token-only. Existing `data-testid`s kept.
Tests (tab-bar.spec.ts): tablist owns only tabs, ids/`aria-controls`, IDREF encoding, roving
tabindex, arrow keys with wrap, Home/End, ignored keys/modifiers/close button, Delete with focus
move down to Start, Delete on Start, focus after button close of the active tab, of a background
tab with focus outside / on the button, after middle click. app-shell.spec.ts: panel named by its
controlling tab, Start pane is the Start tab's panel.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass
- `npm run test:e2e -- test/e2e/layout.e2e.ts` — Pass (6 passed; tablist found by role and name,
  screenshots Business light / Tron dark regenerated)

### CR-4 — Ctrl/Cmd+W matched only by `event.key`

Files changed:
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
On non-Latin layouts Ctrl+W reports e.g. `key: 'ц'`, so the shortcut was neither handled nor
consumed.

Fix:
Also accept `event.code === 'KeyW'` when `event.key` is not a Latin letter. The Latin-letter
exclusion keeps AZERTY Ctrl+Z (physical W key, `key: 'z'`, `code: 'KeyW'`) as undo instead of
closing a tab. Tests: `key 'ц' code 'KeyW'` with Ctrl and `key 'ς' code 'KeyW'` with Cmd close
and are consumed; `key 'z' code 'KeyW'` with Ctrl is left alone.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass (7 files,
  123 tests)
- Same command with the CR-1 guard and the CR-2 `NavigationSkipped` filter temporarily removed —
  4 new tests fail as expected (restored afterwards)

Full test suite:
- `npm run check` (lint, prettier, type checks, unit tests) — Pass (backend/contract/desktop
  2551 tests, renderer 37 files / 647 tests)

Lint/type-check/build:
- `npm run lint` — Pass (eslint `--max-warnings 0`, prettier check)
- `npx prettier --write packages/renderer/src/app/layout/*.ts` — applied
- `npm run test:e2e -- test/e2e/layout.e2e.ts` — Pass (6 passed, headless Ozone); the e2e spec
  needed no change

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

## Round 2 — TW-1

Date: 2026-11-16

Scope: finding TW-1 of `reviews/app-layout/tests.md` (test-writer re-run on 75c9186), approved by the
parent worker. Changes limited to `packages/renderer/src/app/layout/`; uncommitted working tree on
top of 75c9186.

### Fixed findings

#### TW-1 — Ctrl/Cmd+W with focus on the closed tab drops focus to the document body

Files changed:
- `packages/renderer/src/app/layout/tab-bar.ts`
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
`AppShell.onKeydown` called `workspace.close()` directly, bypassing the TabBar close path that moves
focus, so closing the focused active tab with Ctrl/Cmd+W removed the focused element and focus fell
back to `document.body` (unlike Delete, the close button and middle click).

Fix:
`TabBar` gets a public `closeActive()`: it closes the active tab and, only when focus was inside the
tab strip (which includes the closed tab), focuses the newly selected tab (or "Start") via the
existing `focusSelected()`. Focus elsewhere is left where it is (unlike `closeTab`, which also moves
focus whenever the closed tab was the active one, as that path is triggered from the strip itself).
The focus test is factored into a private `hasFocus()` shared with `closeTab`. `AppShell` reaches the
tab bar through `viewChild.required(TabBar)` and calls `closeActive()` for Ctrl/Cmd+W; key matching,
`preventDefault` and all other shortcuts are unchanged.
The failing test "Ctrl+W with focus on the closed tab moves focus to the newly selected tab" is kept
unchanged and now passes. Added regression test "Ctrl+W with focus outside the tab strip leaves focus
where it is" (focus on the splitter stays on the splitter after Ctrl+W closes a tab).

Validation:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass (7 files,
  140 tests)

### Not fixed

None.

### Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` — Pass (7 files,
  140 tests, including the TW-1 test)

Full test suite:
- `npm run check` (lint, prettier, type checks, unit tests) — Pass (backend/contract/desktop 2551
  tests, renderer 37 files / 664 tests)

Lint/type-check/build:
- Covered by `npm run check` — Pass. E2E not re-run (the change is focus handling covered by unit
  tests; no template, CSS or e2e-visible markup changed).

`.taskcheck`:
- Pass (it runs `npm run check`, run from the repo root)

Remaining unresolved findings:
0

### Final status

All validated findings fixed and validation passed.

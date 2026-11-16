# Code Review

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: `git diff a810541557cde9324c050969149b5b29f2e81615..e48d66a87463535a7e903206a642a67865dbb144 -- . ':!tasks' ':!reviews'`
(task commits 2f78355, 380aa15, c8c8f16, 148cea3, 3fc727c, 0793512, e48d66a). Committed changes
only; the working tree was clean. Second review: replaces the review of a9c1ea6 (findings CR-1..CR-4
of that review are referred to below as "round-1 CR-n").

Requirements:
- `tasks/app-layout.md` goal, acceptance criteria and recorded assumptions (sidebarWidth 180..560,
  default 260; routes `/connections/new`, `/connections/import/compass`; Ctrl/Cmd+W always consumed;
  physical W key only when the typed character is not a Latin letter; drag and drop plus
  Ctrl+Shift+PageUp/PageDown reorder; placeholder sidebar and `provideTabView`)
- `SPEC.md` (Business/Tron styles), `docs/ARCHITECTURE.md` incl. "Main window layout",
  `docs/QUALITY.md`, `AGENTS.md`
- `reviews/app-layout/fixes.md` (round 1: round-1 CR-1..CR-4; round 2: TW-1),
  `reviews/app-layout/tests.md`
- Parent worker instructions (confirm fixes; correctness, a11y, tokens, integration points, tests)

Git range:
- Branch: main
- HEAD: e48d66a87463535a7e903206a642a67865dbb144
- Base/start: a810541557cde9324c050969149b5b29f2e81615
- Commits reviewed: 7

Commands run:
- `git log --oneline a810541..HEAD`, `git diff --stat` and full diff of the scope -> 33 files
- full read of `packages/renderer/src/app/layout/*.ts|*.css` (non-spec), `app.routes.ts`,
  contract `app.ts`, desktop `settings/store.ts` diff, `test/e2e/layout.e2e.ts`, key spec sections
  (app-shell keyboard / sidebar width, welcome, tab-bar ARIA tests)
- token check: every `var(--...)` used in `layout/` (21 tokens plus the local `--sidebar-width`) is
  defined in `app/theme/tokens.css`; grep for `#hex`, `rgb(`, `hsl(` in non-spec layout files -> none
- `npm run check` -> exit 0 (lint, type checks; root vitest 42 files / 2551 tests; renderer
  39 files / 726 tests)
- viewed `test-results/screenshots/layout-business-light.png` and `layout-tron-dark.png` -> sidebar,
  tab strip, welcome screen and status bar in the expected style for both
- `python tasks.py verify app-layout` (read-only listing) -> criteria 1-3 not yet recorded; the
  parent worker records the evidence after the review
- e2e not re-run by the reviewer (fixer evidence: `npm run test:e2e -- test/e2e/layout.e2e.ts` ->
  6 passed after round 1; round 2 changed only focus handling)

Fix verification:
- Round-1 CR-1 (stale broadcasts): fixed. `SidebarWidthService` counts own saves in flight
  (`saving`), `take()` ignores `get` answers and broadcasts while `saving > 0`, the last own answer
  to settle is shown unless a drag runs, a failure reverts only when it was the last save and its
  value is still shown, an equal value is still sent while a save is in flight
  (`sidebar-width.service.ts:58-88`). Traced the success/failure/drag interleavings; no remaining
  overwrite of a newer local value. Covered by the app-shell test "quick arrow presses with saves in
  flight all count" and the service tests.
- Round-1 CR-2 (same-URL link): fixed. `NavigationSkipped` with `IgnoredSameUrlNavigation` also
  calls `showHome()` (`app-shell.ts:122-131`); test "the sidebar link shows its page again when its
  URL is already the current one".
- Round-1 CR-3 (ARIA tabs): fixed. Wrappers are `role="presentation"`, close buttons `tabindex="-1"`
  `aria-hidden="true"`, tabs have ids and `aria-controls`, panels (including the routed start pane)
  `role="tabpanel"` with `aria-labelledby`, roving tabindex, Arrow/Home/End/Delete, focus moved
  after closing from the strip (`tab-bar.ts`, `app-shell.ts:74-95`).
- Round-1 CR-4 (non-Latin Ctrl+W): fixed with the AZERTY guard (`app-shell.ts:145`); tests for
  `ц`/`ς` with `KeyW` and AZERTY `z`.
- TW-1 (Ctrl/Cmd+W focus): fixed. `TabBar.closeActive()` moves focus to the newly selected tab (or
  Start) only when focus was inside the strip (`tab-bar.ts:168-176`); `AppShell` calls it through
  `viewChild.required(TabBar)`. Tests cover focus on the closed tab, the last tab, Start with no
  tabs, and focus outside the strip.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

Acceptance criteria:
1. Tabs open/close/reorder; sidebar width persists in settings (component tests): met in code and
   tests (`workspace.service.spec.ts`, `tab-bar.spec.ts`, `app-shell.spec.ts` "tabs"/"sidebar width",
   `sidebar-width.service.spec.ts`, desktop `store.spec.ts` "SettingsStore sidebarWidth", e2e
   restart test).
2. Ctrl/Cmd+W closes a tab, Ctrl/Cmd+Tab cycles (test): met (`app-shell.spec.ts` "keyboard" and
   "keyboard edge cases"; e2e "Ctrl+W does not close the window" on Linux). Cmd+W against the macOS
   application menu cannot be verified here.
3. Welcome buttons navigate (test); e2e screenshots Business light / Tron dark: met
   (`welcome.spec.ts` asserts `navigateByUrl` with `NAV.*`, the resulting URL and page; e2e
   navigation and screenshot tests; screenshots inspected).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | ARCHITECTURE.md still says only `NavigationEnd` shows the routed page**
    - File: `docs/ARCHITECTURE.md:264`
    - Category: Integration
    - Problem: after the round-1 CR-2 fix, `AppShell` also calls `showHome()` on a
      `NavigationSkipped` with code `IgnoredSameUrlNavigation` (`app-shell.ts:124-131`), but the
      "Main window layout" section still states "Any `NavigationEnd` shows the routed page".
    - Why it matters: this section is the contract later tasks (sidebar-tree, connection-ui) read
      when they add links into the start page; a link to the current URL now also hides the active
      tab, which the doc does not say.
    - Suggested fix: change the sentence to "Any navigation (`NavigationEnd`, or a navigation to the
      current URL that the router skips) shows the routed page".

- [ ] **CR-2 | Ctrl+Tab / Ctrl+PageUp/PageDown leave focus on a deselected tab**
    - File: `packages/renderer/src/app/layout/app-shell.ts:150-161`
    - Category: Quality (accessibility)
    - Problem: when focus is on a tab in the strip, Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+PageUp/PageDown
      change the selected tab via `workspace.cycle()` but leave focus on the previously selected tab,
      which now has `tabindex="-1"` and `aria-selected="false"`. Arrow keys and Ctrl/Cmd+W
      (`closeActive`) move focus to the selected tab; these shortcuts do not, so the roving-tabindex
      state and focus diverge.
    - Why it matters: a screen reader keeps announcing the old tab after the switch; small
      inconsistency in the shared tab strip later views build on. Not blocking.
    - Suggested fix: give `TabBar` a method like `closeActive` (e.g. `followSelection()` that calls
      `focusSelected()` only when `hasFocus()`), call it after `cycle()`/`move()` in
      `AppShell.onKeydown`, and add a test with focus on a tab and Ctrl+Tab.

## Review conclusion

No material issues found. All three acceptance criteria are met with test evidence, the round-1
findings CR-1..CR-4 and TW-1 are correctly fixed and covered by tests, colors come only from theme
tokens, and `npm run check` passes. The two P3 findings (a stale sentence in ARCHITECTURE.md and
focus not following Ctrl+Tab inside the tab strip) are optional cleanups; the parent worker still
has to record the criterion evidence with `tasks.py verify`.

# Code Review

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: task commits in `bb928680cc4d76df66a7e2d239b2ceb368ef23ef..a9c1ea6a85d530b75d68b471364f23a8595dc7b4`
whose subject starts with `app-layout:` (96efb4e, 41420b7, a9c1ea6). Commits of other tasks in that
range (conn-manager, electron-tests-hash-url, ...) and `tasks/` files were not reviewed. Committed
changes only; the working tree was clean.

Requirements:
- `tasks/app-layout.md` goal, acceptance criteria and recorded assumptions (sidebarWidth 180..560,
  default 260; routes `/connections/new`, `/connections/import/compass`; Ctrl/Cmd+W always consumed;
  drag and drop plus Ctrl+Shift+PageUp/PageDown reorder; placeholder sidebar and `provideTabView`)
- `SPEC.md` (Business/Tron styles, sidebar tree, tabbed workspace)
- `docs/ARCHITECTURE.md` incl. the new "Main window layout" section
- `AGENTS.md`, `docs/QUALITY.md`
- Parent worker instructions (accessibility, Angular conventions, integration with sidebar-tree,
  safety-ui, connection-ui, collection-view, CSP, tests)

Git range:
- Branch: main
- HEAD: a9c1ea6a85d530b75d68b471364f23a8595dc7b4
- Base/start: bb928680cc4d76df66a7e2d239b2ceb368ef23ef
- Commits reviewed: 3

Commands run:
- `git log --oneline bb92868..HEAD -- . ':!tasks' ':!reviews'`, `git show --stat` / `git show` of the
  three task commits -> scope above
- full read of `packages/renderer/src/app/layout/*`, `app.routes.ts`, `app.config.ts`,
  `apps/desktop/src/settings/store.ts`, contract `app.ts` diff, `test/e2e/layout.e2e.ts`, spec titles
- token check: every `var(--...)` used in `layout/` is defined in `app/theme/tokens.css`; grep for
  `#hex`, `rgb(`, `hsl` in `layout/` (non-spec) -> no hard-coded colors
- `npm run check` -> pass (backend/contract/desktop 2551 tests, renderer 37 files / 626 tests)
- viewed `test-results/screenshots/layout-business-light.png` and `layout-tron-dark.png` -> both
  show sidebar, tab strip, welcome screen and status bar in the expected style
- e2e not re-run by the reviewer (parent evidence: `npm run test:e2e -- test/e2e/layout.e2e.ts` -> 6 passed)

Summary: 0 P0, 0 P1, 3 P2, 1 P3

Acceptance criteria:
1. Tabs open/close/reorder; sidebar width persists in settings (component tests): met
   (`workspace.service.spec.ts`, `tab-bar.spec.ts`, `app-shell.spec.ts` "tabs"/"sidebar width",
   `store.spec.ts` "SettingsStore sidebarWidth", e2e restart test).
2. Ctrl/Cmd+W closes, Ctrl/Cmd+Tab cycles (test): met (`app-shell.spec.ts` "keyboard"; e2e
   "Ctrl+W does not close the window" on Linux). Cmd+W against the macOS default application menu is
   not verifiable here.
3. Welcome buttons navigate (test); e2e screenshots Business light / Tron dark: met
   (`welcome.spec.ts`, e2e navigation test, screenshot tests).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Stale `app.settings.changed` broadcasts undo newer sidebar widths during keyboard resizing**
    - File: `packages/renderer/src/app/layout/sidebar-width.service.ts:322` (`commit`), `:338` (`take`); caller `packages/renderer/src/app/layout/app-shell.ts:150`
    - Category: Correctness
    - Problem: `commit()` sets the shown width and sends `app.settings.set`, but marks nothing as
      pending. Main broadcasts `settingsChanged` to every renderer after each save
      (`apps/desktop/src/main/index.ts:160`), and `take()` applies any broadcast whenever no drag runs.
      With ArrowRight pressed repeatedly (or held, auto-repeat), commit(276) and commit(292) are in
      flight; the broadcast for 276 arrives and sets the width back to 276. The next key press then
      computes `276 + 16 = 292` from that stale value; `292 === stored` once the second broadcast
      lands, so it is not even sent. Three presses end at 292 instead of 308, and the splitter
      visibly jumps back and forth. The same out-of-order write happens after a drag release
      followed quickly by a key press or double click.
    - Why it matters: an older async result overwrites a newer local value; the keyboard resize
      (the accessible path for the splitter) loses steps. Writes use `flush: true`, so the window
      between save and broadcast is not negligible.
    - Suggested fix: treat a local commit like a drag: keep a pending counter / the last requested
      value and ignore broadcasts while a commit of this renderer is in flight (or ignore a broadcast
      equal to an older pending value); add a test with two overlapping commits and the first
      broadcast arriving in between.

- [ ] **CR-2 | Sidebar "New connection" link does nothing when the URL is already `/connections/new`**
    - File: `packages/renderer/src/app/layout/app-shell.ts:95-97` (with `app-shell.ts:37`)
    - Category: Correctness / Integration
    - Problem: switching from a tab to the routed page relies only on `NavigationEnd`. The router uses
      the default `onSameUrlNavigation: 'ignore'` (`app.config.ts`), so navigating to the current URL
      emits `NavigationSkipped`, not `NavigationEnd`. Sequence: open "New connection" (URL
      `/connections/new`), open a tab, click the sidebar "New connection" link -> nothing happens, the
      tab stays shown. The same applies to any later sidebar/menu link to the current route
      (sidebar-tree and connection-ui will add more). The existing test
      "the sidebar link opens the connection editor page" starts from `/`, so it does not catch this.
    - Why it matters: a visible link that silently does nothing; later tasks building on this
      routing contract inherit the bug.
    - Suggested fix: also call `showHome()` on `NavigationSkipped` (or on `NavigationEnd` and
      `NavigationSkipped` with `SAME_URL`), or make the link handlers call `showHome()` explicitly;
      add a test that opens a tab while on `/connections/new` and clicks the sidebar link.

- [ ] **CR-3 | Tab strip does not follow the ARIA tabs pattern**
    - File: `packages/renderer/src/app/layout/tab-bar.ts:13-71`, `packages/renderer/src/app/layout/app-shell.ts:60-73`
    - Category: Quality (accessibility)
    - Problem: (a) the close `<button>`s sit inside `role="tablist"`, which may only own `tab`
      elements (axe `aria-required-children` flags this); (b) tabs have no `aria-controls` and panels
      no `aria-labelledby` (panels get a separate `aria-label`), and the "Start" tab has no
      `tabpanel` at all (the router-outlet pane has no role); (c) every tab is its own Tab stop with no
      arrow-key navigation / roving `tabindex`, which the tabs pattern expects; (d) closing the
      active tab with its close button removes the focused element and focus falls back to `body`.
    - Why it matters: screen reader users get an invalid tablist structure and cannot tell which
      panel belongs to which tab; keyboard users tab through every tab and lose focus on close. This
      strip is the base every later view (collection-view, shell, admin) uses.
    - Suggested fix: give the wrapper `role="presentation"` and move the close button out of the
      owned tree (or expose close via Delete on the focused tab and keep the button `tabindex="-1"`
      `aria-hidden` for pointer use); add ids with `aria-controls`/`aria-labelledby`, give the home
      pane `role="tabpanel"`; roving tabindex with Left/Right/Home/End; move focus to the newly
      active tab after a close. Add a component test for the structure.

## P3 Low

- [ ] **CR-4 | Ctrl/Cmd+W is matched by `event.key`, so non-Latin keyboard layouts are not consumed**
    - File: `packages/renderer/src/app/layout/app-shell.ts:109`
    - Category: Correctness
    - Problem: the handler tests `key === 'w' || key === 'W'`. With e.g. a Cyrillic or Greek layout,
      Ctrl+W on the physical W key reports `event.key === 'ц'`/`'ς'`, so the tab is not closed and the
      event is not consumed, while Electron's default menu accelerator (`role: 'close'`,
      CommandOrControl+W, matched by key code) can still close the window, which the recorded
      assumption says must never happen.
    - Why it matters: the "always consumed, never closes the window" guarantee depends on the
      keyboard layout.
    - Suggested fix: also accept `event.code === 'KeyW'`; add a test case with `key: 'ц', code: 'KeyW'`.

## Review conclusion

Material issues found; fix before completing the task. No P0/P1 findings and all three acceptance
criteria are met with test evidence; CR-1 (out-of-order width broadcasts) and CR-2 (link ignored on
the same URL) are correctness defects in behavior later tasks build on, CR-3 is an accessibility
gap in the shared tab strip, and CR-4 is a small hardening of the Ctrl+W guarantee.

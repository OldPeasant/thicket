# Code Review

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: `git diff 5f94685d0a60701a9dc0705b26f94243a3a317b1..HEAD -- packages apps .gitignore`. The theme work is in commits 644bd62 and bbe4089, plus the committed screenshots in `reviews/themes/screenshots`. The range also pulls in `packages/core/src/diff/*` from the merged `diff-ops` task. That code belongs to another task and was not reviewed here.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions (Notes)
- SPEC.md M0 "Two visual styles" (lines 60-69)
- docs/ARCHITECTURE.md (renderer conventions, CSP `font-src 'self'`)
- AGENTS.md (Evidence rules, project notes)
- packages/contract/src/app.ts (`Settings`, `STYLES`, `THEME_MODES`, `app.settings.get/set`, `app.settings.changed`)

Git range:
- Branch: main
- HEAD: bbe40893b0b1252222b095252587c10a767ef507
- Base/start: 5f94685d0a60701a9dc0705b26f94243a3a317b1
- Commits reviewed: 2 theme commits (644bd62, bbe4089). The other commits in the range are task-state commits or belong to other tasks.

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## Checks

- AC1 (four combinations, screenshots): `apps/desktop/test/theme.electron.spec.ts` switches through the UI on `#/dev/explorer` and saves four screenshots. All four PNGs are committed under `reviews/themes/screenshots/` and I viewed each one. Each shows the explorer demo in the expected style and mode. See CR-1 about when the screenshots are taken.
- AC2 (Business WCAG AA): `theme-tokens.spec.ts` computes WCAG 2.x contrast ratios (it also checks known values such as 21:1 and #777 on white = 4.48). It requires at least 4.5:1 for text, muted, faint, accent, danger, production, read-only and all 20 BSON colors on page, elevated, panel and input backgrounds, plus the hover, accent-bg, danger, production and read-only pairs. It requires at least 3:1 for the focus color.
- AC3 (Tron look, local fonts, effects only in Tron):
  - The Tron dark and light colors match the removed Canopy blocks in `styles.css` value for value.
  - The fonts are loaded with `@font-face` from `src/assets/fonts/*.woff2`. Both files exist and nothing is loaded from a CDN.
  - Business sets `--glow`, `--glow-strong`, `--grid-overlay`, `--scanline-overlay` and `--scrollbar-glow` to `none`. The scrollbar glow, which was hard-coded before, is now a token.
  - A grep of `src/app` found no literal colors and no literal glow or text-shadow outside `tokens.css`.
  - The Electron test confirms Orbitron and Share Tech Mono load (`document.fonts` status `loaded`) and that Business has no overlay.
- AC4 (switching without reload, `system` follows the OS): `ThemeService` sets `data-style` and `data-theme` on `<html>`. It listens to `matchMedia('(prefers-color-scheme: dark)')` change events and removes the listener on destroy. This is tested in two places:
  - unit tests in `theme.service.spec.ts`, using a fake MediaQueryList;
  - the Electron test, using `emulateMedia`. It checks no reload happened by setting a marker on `window` and finding it still there afterwards.
- AC5 (tokens in all four sets): the test enumerates all four sets, compares token names across them, and checks that the production, read-only and 20 `--bson-*` tokens resolve to opaque hex colors in each set.
- Integration:
  - `app.settings.get` and `app.settings.set` match the contract: `settings.partial()` is the input and the full `settings` object comes back.
  - Main emits `app.settings.changed` from `SettingsStore.onChange` (`apps/desktop/src/main/index.ts:139`).
  - Adding `settingsChanged` to `BroadcastPayloads` in `api.service.ts` lines up with `BROADCAST_STREAMS`.
  - Values outside `STYLES` and `THEME_MODES` are ignored.
  - A missing desktop bridge leaves the defaults in place.
  - `provideTheme` does not block the first paint.
- Security: no new IPC surface, no secrets, no unsafe HTML. Fonts stay inside `font-src 'self'`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Evidence screenshots are taken during the 0.15 s CSS transitions, so 3 of 4 do not show the final theme**
    - File: `apps/desktop/test/theme.electron.spec.ts:97-115`
    - Category: Tests
    - Problem: `pick()` waits only until the `data-style` and `data-theme` attributes change. The test then awaits `document.fonts.ready`, which resolves at once when the fonts are already loaded, and takes the screenshot right away. The explorer's controls fade from the previous theme's colors over 0.15 s:
        - `.filter-mode-btn` uses `transition: background 0.15s, color 0.15s` (`packages/renderer/src/app/explorer/json-explorer.component.css:81-83`);
        - `.mode-toggle` transitions background, color and border-color (lines 110-114).

      The committed screenshots show this. In `explorer-tron-light.png`, the "Strict", "Context" and "Go to edit mode" buttons have a grey background with near-unreadable text, but Tron light's `--bg-input` is `#ffffff`. They are partway between Business dark's `#16191c` and white. `explorer-business-dark.png` and `explorer-tron-dark.png` show the same grey buttons. Only `explorer-business-light.png` is correct, because it is the first combination and nothing was transitioning.
    - Why it matters: AC1's screenshots are the visual evidence a human uses to judge the four combinations. As committed, they suggest Tron light has a broken, low-contrast toolbar that does not exist once the transition ends.
    - Suggested fix: Wait for transitions to finish before each screenshot. Either await `Promise.all(document.getAnimations().map((a) => a.finished))` in the page, or pass `animations: 'disabled'` to `page.screenshot` (Playwright then jumps finite transitions to their end state). Then re-run the Electron test and replace the four PNGs.

## P3 Low

- [ ] **CR-2 | A failed save rolls back both style and mode to a snapshot that may itself never have been saved**
    - File: `packages/renderer/src/app/theme/theme.service.ts:84-95`
    - Category: Correctness
    - Problem: `change()` snapshots `{ style, mode }` before applying its own change and restores the whole snapshot on failure. If two changes overlap and both fail, the UI ends in the wrong state:
        1. Change A (style → tron) starts; its snapshot is S0.
        2. Change B (mode → dark) starts; its snapshot already contains A's unsaved style.
        3. A fails and restores S0.
        4. B fails and restores its snapshot, which brings back A's unsaved `tron`.

      The UI then shows a style that was never stored, which contradicts the comment "so the UI does not pretend it was saved". A single failure also resets the field the user did not change.
    - Why it matters: This is rare in practice (two quick switches while saving keeps failing). When it happens, the visible theme stops matching `settings.json` until the next restart or broadcast.
    - Suggested fix: Restore only the keys in `patch`, and only if they still hold the value this call set. Or, on failure, re-read `app.settings.get` and apply that result. Add a unit test with two overlapping failing changes.

## Review conclusion

Material issues found; fix before completing the task. CR-1 affects the evidence for AC1. The implementation itself meets all five criteria.

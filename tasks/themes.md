---
title: M0: Business and Tron styles, each light and dark
status: in_progress
owner: dell26/agent-1
deps: [explorer-copy,app-settings]
touches: [packages/renderer/src/app/theme,packages/renderer/src/styles.css,packages/renderer/src/assets/fonts]
prio: 1
lease_until: 2026-11-16T20:02:53Z
---
## Goal
Token sets for Business (default) and Tron, each light and dark, selected by `data-style` and `data-theme` on the root; mode follows the OS when set to system; persisted via app settings. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [x] Four combinations render the explorer demo; Playwright screenshots of each attached in reviews/
  - verified (2026-11-16 20:47+0100 by dell26/agent-1): npm run test:electron -w apps/desktop -- test/theme.electron.spec.ts at d370b59 -> 4 passed; 'renders the explorer demo in all four combinations, switched without reload' wrote 4 screenshots, byte-identical (sha1) to reviews/themes/screenshots/explorer-{business,tron}-{light,dark}.png, viewed in review rounds
- [x] Business light and dark pass WCAG AA contrast for text/background token pairs (unit test computing ratios)
  - verified (2026-11-16 20:47+0100 by dell26/agent-1): cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts' at d370b59 -> 64 passed, incl. theme-tokens.spec.ts 'business/{light,dark}: every pair >= 4.5' and focus ring >= 3:1 (WCAG ratios computed from tokens.css)
- [x] Tron keeps Canopy's look (fonts bundled locally, glow/scanlines only in Tron)
  - verified (2026-11-16 20:47+0100 by dell26/agent-1): theme-tokens.spec.ts 'Tron: glow, grid and scanlines, Orbitron and Share Tech Mono', 'Tron keeps Canopy original colors', 'Business: no glow, grid or scanlines' -> pass; theme.electron.spec.ts checks the bundled woff2 fonts load under font-src 'self' -> pass (at d370b59)
- [x] Switching style/mode applies without reload; `system` follows `prefers-color-scheme` changes (test)
  - verified (2026-11-16 20:47+0100 by dell26/agent-1): theme.service.spec.ts (switching sets data-style/data-theme without reload, system follows matchMedia change; 64 theme tests pass) + theme.electron.spec.ts 'system mode follows prefers-color-scheme changes live' and 'switched without reload' -> pass (at d370b59)
- [ ] Tokens exist for production accent, read-only marker and each BSON type in all four sets (test enumerates)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 20:19+0100 by dell26/agent-1): Tokens live in packages/renderer/src/app/theme/tokens.css (imported by styles.css); each of the four data-style x data-theme blocks repeats every token (explicit, testable). :root alone = Business light fallback before ThemeService runs.
- ASSUMPTION (2026-11-16 20:19+0100 by dell26/agent-1): BSON type tokens are --bson-<kebab $type alias> for all 20 $type aliases (double ... maxKey); explorer --val-* kept as aliases to them. Production accent = --production/-bg/-text, read-only marker = --readonly/-bg/-text.
- ASSUMPTION (2026-11-16 20:19+0100 by dell26/agent-1): Renderer resolves 'system' itself via matchMedia(prefers-color-scheme) instead of the app.theme method/stream (not implemented in main yet); main's nativeTheme.themeSource is not set by this task.
- ASSUMPTION (2026-11-16 20:19+0100 by dell26/agent-1): Business palette: cool neutral greys + muted ink-blue accent (#2c5a85 light / #8cb4dd dark), system-ui 13px; AA tested for text/muted/faint/accent/danger/production/readonly/all BSON colors on page/elevated/panel/input backgrounds. Style/mode switcher (ThemeSwitcher) shown on the dev explorer page until a settings page exists.
- ASSUMPTION (2026-11-16 20:19+0100 by dell26/agent-1): 4 Electron tests (app.electron thicket://app URL and dev.electron URL checks expect no '#/') fail on main 64cb776 without this task's changes as well; left for their owners, not in this task's scope.

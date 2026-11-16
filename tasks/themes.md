---
title: M0: Business and Tron styles, each light and dark
status: todo
owner:
deps: [explorer-copy,app-settings]
touches: [packages/renderer/src/app/theme,packages/renderer/src/styles.css,packages/renderer/src/assets/fonts]
prio: 1
---
## Goal
Token sets for Business (default) and Tron, each light and dark, selected by `data-style` and `data-theme` on the root; mode follows the OS when set to system; persisted via app settings. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Four combinations render the explorer demo; Playwright screenshots of each attached in reviews/
- [ ] Business light and dark pass WCAG AA contrast for text/background token pairs (unit test computing ratios)
- [ ] Tron keeps Canopy's look (fonts bundled locally, glow/scanlines only in Tron)
- [ ] Switching style/mode applies without reload; `system` follows `prefers-color-scheme` changes (test)
- [ ] Tokens exist for production accent, read-only marker and each BSON type in all four sets (test enumerates)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

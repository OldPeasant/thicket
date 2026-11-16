# Code Review

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: fourth review round. Task diff `git diff 1dfcf47d005346393de36220875ea064bbccab2b..60a9323 -- packages apps .gitignore`. The focus is commit 60a9323, which rewrote the `ThemeService` bookkeeping per CR-4 (per key `confirmed`/`confirmedBy` plus `latest = {request, value, state}`, with the display recomputed by `refresh()`), and the two regression tests added in 9563ba9. The rest of the task diff was re-checked briefly. Only committed code was reviewed; the working tree was clean when the tests ran.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions (Notes)
- SPEC.md M0 "Two visual styles"
- docs/ARCHITECTURE.md (renderer conventions, CSP `font-src 'self'`)
- AGENTS.md (Evidence rules, project notes)
- Earlier rounds: previous reviews/themes/review.md (CR-1..CR-4), reviews/themes/tests.md, reviews/themes/fixes.md
- apps/desktop/src/settings/store.ts, apps/desktop/src/main/handlers.ts and apps/desktop/src/main/index.ts (how main answers `app.settings.get/set` and broadcasts `app.settings.changed`)

Git range:
- Branch: main
- HEAD: 60a9323b57755fc08048f83ec65af89db87b599f
- Base/start: 1dfcf47d005346393de36220875ea064bbccab2b
- Commits reviewed: 8 (df350c6, 975d7fa, 582f4cf, e65dc18, 7bcbecb, 857a292, 9563ba9, 60a9323)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (screenshots taken mid-transition): resolved.** Unchanged since round 2. The four PNGs are in `reviews/themes/screenshots/`. 60a9323 changes only service bookkeeping, not CSS or markup, so the screenshots still match the code.
- **CR-2 and CR-3 (revert paths): still resolved under the new code.** A failed choice gets `state = 'failed'`, and `refresh()` (`theme.service.ts:153-161`) then shows `confirmed[key]`. `record()` (`:137-144`) always stores a newer valid answer, whatever is currently shown. I traced the CR-3 sequence again with the new code. Tron is stored, the `get` is pending (request 1), the user picks Business (request 2) and that save fails, so the window shows `confirmed` (still Business). The `get` answer then records Tron with `confirmedBy = 1`. The choice has failed, so the window shows Tron. This is correct.
- **CR-4 (bookkeeping complexity): resolved.** The service now keeps three per-key structures and applies a single display rule, written in the class comment at `:56-60`: show the latest choice if its save has not failed and its request is newer than the last recorded answer; otherwise show `confirmed`. The revert branch in `change()` is gone, and every path ends in `refresh()`: init (`:96`), the `finally` of every save (`:129`), and broadcasts (`:149`).

## Broadcast while a local save is pending (the behavior change)

`take()` updates `confirmed` but not `confirmedBy`, so while a choice is `pending` it stays on screen until an answer to that request or a later one arrives. I checked this against how main orders its messages:

- `SettingsStore.set()` is serialized through `queue`. `apply()` writes, sets `current`, notifies the listeners (the broadcast to every window) and only then resolves. The `app.settings.set` handler returns that result, so on this window's port, a write's broadcast always arrives before its answer. `get()` is synchronous and returns `current`.
- **Another window's write W queued before our save S.** W's broadcast arrives while S is pending. It updates `confirmed` but the display keeps our choice. S's answer then carries the stored value, which is ours because S was applied after W, and `record()` stores it. The final display matches main. The old code briefly showed W's value and then switched back; the new code avoids that flicker. Covered by `a broadcast from another window while a save is pending: the later save wins`.
- **W queued after S.** S's answer is posted when S resolves. W's broadcast comes only after W's file write (asynchronous I/O) and goes over the same port, so it arrives after S's answer. By then `confirmedBy[key]` equals S's request, which is not lower than the choice's request, so `refresh()` shows the broadcast value (W). This is correct.
- **S fails.** Main's `current` stays unchanged and it sends no broadcast for S. Broadcasts received while S was pending are already in `confirmed`, so the failed choice falls back to the value main actually stores. Covered by the two `a pending save that fails after a broadcast ...` tests.
- **Our own echo.** The broadcast for S carries S's value and arrives while S is pending, so ignoring it for display changes nothing.
- **Startup.** `init()` takes request 1 synchronously inside the app initializer, before any UI exists, so no save can be numbered before the `get`. A broadcast that arrives before the `get` answer is for a write main already applied, so the synchronous `get` result includes it, and recording that result (request 1 > 0) is correct.
- **Other keys.** The rule is per key. A broadcast changing only the other key shows immediately, as in `a broadcast from another window while a save is pending` (the mode becomes dark).
- **A set answer that lacks a key.** Every set answer carries all settings (`store.get()` returns `Settings` with every key, and the contract requires them), so a successful choice always moves `confirmedBy` up to its own request. After that, later broadcasts from other windows apply. The choice cannot stay "ok and newer" indefinitely.

Conclusion: holding the pending choice is correct for the orderings main can produce, and it removes a visible flicker. The only window where the display differs from main's state is while this window's own write is in flight, and the answer always settles it.

## Checks

- AC1: the Electron test drives the switcher on `#/dev/explorer` and writes four screenshots after transitions settle. Unchanged.
- AC2: `theme-tokens.spec.ts` computes WCAG ratios for the Business light and dark token pairs. Unchanged.
- AC3: Tron keeps Canopy's tokens and bundled `woff2` fonts (`font-src 'self'`). In Business, every glow and scanline token is `none`. Unchanged.
- AC4: `data-style` and `data-theme` are set on `<html>` without a reload. The `matchMedia` listener follows changes and is removed on destroy. Unit and Electron tests cover both. The public API (`init`, `setStyle`, `setMode`, `style`, `mode`, `effective`) is unchanged.
- AC5: a test enumerates the production, read-only and 20 BSON tokens in all four sets. Unchanged.
- Integration and security: no new IPC surface, and no secrets or personal data in the diff. `ThemeSwitcher` still catches rejected saves.
- Validation I ran: `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`. Result: 2 files, 53 of 53 tests passed, with a clean working tree.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-5 | No test pins the new "pending choice wins over a broadcast" display**
    - File: `packages/renderer/src/app/theme/theme.service.spec.ts:318-335`
    - Category: Tests
    - Problem: 60a9323 intentionally changed what a window shows between a broadcast from another window and the answer to its own pending save. The window now keeps showing its pending choice. The old code showed the broadcast value until the answer arrived. Every test checks only the state after the answers (for example `a broadcast from another window while a save is pending` checks only after `await pending`, and `main echoes each save as a broadcast before answering` checks only at the end). Reverting to the old flicker would therefore pass the whole suite.
    - Why it matters: this is a deliberate, user-visible rule, and it is written in the class comment. Without a test, a later refactor (for example, when `app.theme` from main replaces the renderer-side `system` resolution) can change it unnoticed.
    - Suggested fix: in the test at `:318`, after `changed({ ...stored })` and before `save.resolve(...)`, assert `theme.style()` is `'tron'` (the pending choice) and `theme.mode()` is `'dark'` (the broadcast value for the key with no choice).

## Review conclusion

No material issues found. The CR-4 rewrite keeps CR-1 to CR-3 resolved and implements the display rule correctly. Holding a pending choice while a broadcast arrives is correct for the way main orders writes, broadcasts and answers, including writes from other windows. All five acceptance criteria are met. The only remaining finding, CR-5 (P3), is an optional test addition.

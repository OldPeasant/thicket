# Code Review

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: second review of the final revision. `git diff e9d447f1c2d444ee4e3b82420101e7b5501f39d7..b7d29c1 -- packages apps .gitignore`, plus the four PNGs in `reviews/themes/screenshots/`. The focus is the reworked `ThemeService` and the screenshot wait in the Electron test, and the full task diff was re-checked against the final code. Only committed code was reviewed. The working tree holds uncommitted additions to `theme.service.spec.ts` from a parallel test-writer run. Those additions were not reviewed. One of them is cited only because it reproduces CR-3 against the committed production code, which is unchanged in the working tree.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions (Notes)
- SPEC.md M0 "Two visual styles"
- docs/ARCHITECTURE.md (renderer conventions, CSP `font-src 'self'`)
- AGENTS.md (Evidence rules, project notes)
- Previous round: reviews/themes/review.md (CR-1, CR-2), reviews/themes/tests.md (TW-1..3), reviews/themes/fixes.md
- apps/desktop/src/main/index.ts, apps/desktop/src/settings/store.ts, apps/desktop/src/main/broadcast.ts (how main answers and broadcasts settings)

Git range:
- Branch: main
- HEAD: b7d29c1
- Base/start: e9d447f1c2d444ee4e3b82420101e7b5501f39d7
- Commits reviewed: 4 (1162e28, 3cb2fae, 957882d, b7d29c1)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (screenshots taken mid-transition): resolved.**
    - `apps/desktop/test/theme.electron.spec.ts:115-122` now waits for `document.getAnimations()` to finish before each screenshot and passes `animations: 'disabled'`.
    - The renderer has no infinite CSS animations (the only one is the finite `jump-flash` in `styles.css:92`), so the wait cannot hang.
    - I viewed all four committed PNGs. In Tron light, the Strict, Context and "Go to edit mode" controls now use the white input background with readable text. Business dark and Tron dark show their final dark controls. Business light is unchanged.
- **CR-2 (failed save rolls back to an unsaved snapshot): resolved.**
    - `theme.service.ts:113-119` now reverts only the keys the failed call changed. It reverts a key only while that call is still the latest choice for it and the key still shows the value the call set. The value it reverts to is `confirmed`.
    - The regression test `two overlapping failed saves end on the stored values, not an unsaved one` covers the exact sequence.
- **TW-1, TW-2, TW-3: resolved for the sequences they describe.**
    - The generation and in-flight gate in `takeAnswer` (`theme.service.ts:131-139`) drops stale `get` and `set` answers.
    - The committed tests for these sequences pass.
    - CR-3 below is a remaining edge case of the TW-1 fix.

## Checks

- AC1: the Electron test switches through the UI on `#/dev/explorer` and writes four screenshots after transitions finish. The committed PNGs show the explorer demo in each combination (see CR-1).
- AC2: `theme-tokens.spec.ts` computes WCAG ratios for Business light and dark: at least 4.5:1 for the text pairs and at least 3:1 for focus. Unchanged since the first review.
- AC3: Tron values match the former Canopy blocks. The fonts are bundled `woff2` files loaded through `@font-face`. In Business, every effect token is `none`. The Electron test checks that Orbitron and Share Tech Mono are loaded. Unchanged.
- AC4: `data-style` and `data-theme` are set on `<html>`, and the `matchMedia` change listener is removed on destroy. Unit and Electron tests cover switching without reload and `system` following the OS. Unchanged.
- AC5: the test enumerates all four sets and checks the production, read-only and 20 BSON tokens in each. Unchanged.
- Reworked `ThemeService`:
    - The public API is unchanged.
    - Broadcasts (`app.settings.changed`) are still applied unconditionally and update `confirmed`. In the real app, main's `SettingsStore` serializes writes and broadcasts after each saved change to every window, including the sender. So the last broadcast always carries what was written last, and the window ends on the stored values after quick successive saves.
    - The `inFlight` counters are decremented in `finally`, so they cannot leak on failure.
- Integration and security: no change since the first review. There is no new IPC surface and no secrets. The fonts stay within `font-src 'self'`.
- Validation I ran: `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`. Result: 48 of 49 tests passed. The run included the uncommitted test additions. The one failure is the uncommitted test cited in CR-3. All committed tests passed.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | A skipped `app.settings.get` or `app.settings.set` answer is discarded entirely, so `confirmed` can stay stale and a later failed save reverts to a value main does not store**
    - File: `packages/renderer/src/app/theme/theme.service.ts:131-139` (`takeAnswer`), with the revert at `:113-119` and the startup `get` at `:79-83`
    - Category: Correctness
    - Problem: When `takeAnswer` skips a key, because there is a newer local choice or another save is in flight, it skips more than displaying the key. It also does not record the answered value in `confirmed`. The failure path then reverts to `confirmed`, which can be stale. A reachable sequence in the real app:
        1. The stored style is Tron.
        2. At startup, `app.settings.get` is still pending, and the window shows the default, Business.
        3. The user picks Business. The save fails. The revert keeps Business, because `confirmed.style` is still the default `business`.
        4. The `get` answer (Tron) arrives. Style's generation changed after `asked` was taken, so the answer is dropped.

      The window shows Business while `settings.json` holds Tron, until the next broadcast or a restart. No broadcast arrives, because nothing was saved and a `get` does not broadcast. The uncommitted test `a save that fails before the late app.settings.get answer ends on the stored value` reproduces this against the committed service: it expects `tron` and gets `business`.

      The same gap exists for a skipped `set` answer: an earlier save of the same key succeeds, and a later save of that key fails. In the real app, main's broadcast of the successful save updates `confirmed` and masks this case. The unit-test fake does not broadcast on `set`, so the committed overlap tests do not model this.
    - Why it matters: The service's stated goal is that the UI never shows something other than what is stored ("so the UI does not pretend it was saved"). Here it does, until the next broadcast or restart. The trigger is rare: a save has to fail while the startup `get` is still pending.
    - Suggested fix: In `takeAnswer`, always record the valid answered values in `confirmed` (`Object.assign(this.confirmed, this.valid(settings))`), and gate only what is shown. Then, when a failed save reverts a key, it reverts to the last value main reported. Also consider re-showing `confirmed` for a key whose newer choice has since failed. Keep the uncommitted regression test above, or an equivalent one.

## Review conclusion

No material issues found. CR-1 and CR-2 from the first round are resolved, and all five acceptance criteria are met. The one remaining finding (CR-3, P3) is a rare edge case in the error path. It can be fixed in this task or recorded as a follow-up at the parent's discretion.

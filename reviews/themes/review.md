# Code Review

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: third review of the final revision. `git diff bec07cbd7a9529b987170bccd01d84fd1f1060e5..5331615 -- packages apps .gitignore`. The focus is the round-2 change to `packages/renderer/src/app/theme/theme.service.ts` (commit 5331615, fix for CR-3/TW-4), and the rest of the task diff was re-checked against the final code. Only committed code was reviewed. The working tree was clean when this review ran.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions (Notes)
- SPEC.md M0 "Two visual styles"
- docs/ARCHITECTURE.md (renderer conventions, CSP `font-src 'self'`)
- AGENTS.md (Evidence rules, project notes)
- Earlier rounds: previous reviews/themes/review.md (CR-1..CR-3), reviews/themes/tests.md (TW-1..TW-4), reviews/themes/fixes.md (rounds 1 and 2)
- apps/desktop/src/settings/store.ts and apps/desktop/src/main/index.ts (how main answers `app.settings.get/set` and broadcasts `app.settings.changed`)

Git range:
- Branch: main
- HEAD: 5331615
- Base/start: bec07cbd7a9529b987170bccd01d84fd1f1060e5
- Commits reviewed: 6 (2d8bcc4, c199edd, d591c5d, 45e8fc7, 7045226, 5331615)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (screenshots taken mid-transition): resolved.** This round did not change it. `apps/desktop/test/theme.electron.spec.ts` waits for `document.getAnimations()` to finish and takes the screenshots with `animations: 'disabled'`.
- **CR-2 (failed save rolls back to an unsaved snapshot): resolved.** The failure path at `theme.service.ts:121-134` reverts only the keys that call changed. It reverts a key only while that call is still the latest choice for it and the key still shows that call's value. It reverts to `confirmed`.
- **CR-3 / TW-4 (a skipped answer left `confirmed` stale): resolved.**
    - `takeAnswer` (`theme.service.ts:148-169`) now always records a valid answer in `confirmed` and only gates what is shown. An answer is recorded only if its request number is newer than the one already recorded (`confirmedBy`).
    - When the latest local choice for a key has failed (`failed[key] === generation[key]`) and no other save of the key is pending, a late answer shows `confirmed` again.
    - I traced the CR-3 sequence by hand. Tron is stored, `get` is pending, the user picks Business, and the save fails. At that point `failed.style = 1` and the window shows `confirmed`, which is still the default Business. Then the `get` answer arrives: request 1 is newer than `confirmedBy` 0, so `confirmed` becomes Tron. The generation differs from `asked` and `failed` equals the generation, so Tron is shown. The committed test `a save that fails before the late app.settings.get answer ends on the stored value` covers this sequence and passes.
    - I also traced the `set` variant: save A (Tron) is pending, save B (Business) fails, then A's answer arrives. Tron is recorded and shown, as in the committed test `an earlier save that succeeds after a later one failed ends on its stored value`. I traced the reverse order as well: A succeeds, then B fails and reverts to `confirmed`, which is Tron. That is correct.

## Checks

- Request ordering, checked against main:
    - `SettingsStore.get()` is synchronous. `set()` is serialized through `queue`, and the change listener broadcasts before `set` resolves.
    - Requests, answers and broadcasts share the window's port, so they reach the renderer in order.
    - Successful `set` answers therefore arrive in request order. The single `get` is sent first, from `init`, and is answered without waiting. So the comment that main answers requests in sending order holds for every request this service sends.
    - Broadcasts (`take`) update `confirmed` but not `confirmedBy`. For an older answer to overwrite a newer broadcast value, main would have to send that answer after a later write's broadcast. The ordering above rules that out, so this is not a finding.
- Bookkeeping hygiene:
    - `inFlight` is decremented in `finally`.
    - `failed` is compared with the current generation, so a stale marker is harmless.
    - The public API (`init`, `setStyle`, `setMode`, `style`, `mode`, `effective`) is unchanged.
- AC1: the Electron test switches through the UI on `#/dev/explorer` and writes four screenshots after transitions settle. The PNGs are in `reviews/themes/screenshots/`. Unchanged since round 2.
- AC2: `theme-tokens.spec.ts` computes WCAG ratios for Business light and dark: at least 4.5:1 for text pairs and at least 3:1 for focus. Unchanged.
- AC3: Tron keeps Canopy's values. Its fonts are bundled `woff2` files under `font-src 'self'`. In Business, every effect token is `none`. Unchanged.
- AC4: `data-style` and `data-theme` are set on `<html>`, and the `matchMedia` listener is removed on destroy. Unit and Electron tests cover switching and `system` following the OS. Unchanged.
- AC5: the test enumerates the production, read-only and 20 BSON tokens in all four sets. Unchanged.
- Integration and security: no change. There is no new IPC surface, and no secrets or personal data appear in the diff.
- Validation I ran: `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`. Result: 2 files, 51 of 51 tests passed, run against a clean working tree (the committed code).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-4 | ThemeService needs five bookkeeping structures to reach a simple display rule**
    - File: `packages/renderer/src/app/theme/theme.service.ts:51-67`, `:109-169`
    - Category: Quality
    - Problem: The service tracks a request counter plus `confirmed`, `confirmedBy`, `generation`, `inFlight` and `failed` for two string preferences. From my traces, the observable behavior reduces to one rule per key:
        - show the latest local choice while its save is pending or after it succeeded;
        - otherwise show the latest value main reported (`confirmed`).

      The current code reaches this through two branches in `takeAnswer` and a separate revert path in `change`. Each of the three review rounds found a defect in this logic (CR-2, TW-1..3, CR-3).
    - Why it matters: The final code is correct and well covered: 51 tests, including every sequence found so far. But the next change to this file (for example, when `app.theme` from main replaces the renderer-side `system` resolution, per the recorded assumption) has to keep five structures consistent, so it can easily reintroduce an ordering bug.
    - Suggested fix: Optional, and not needed to complete the task. Per key, keep `confirmed` (updated by answers newer than the last recorded one and by broadcasts) and `latest = { id, value, state: 'pending' | 'ok' | 'failed' }`. After every answer, failure or broadcast, recompute the shown value as `latest.state !== 'failed' && latest is newer than confirmed ? latest.value : confirmed`. Keep the existing ordering tests as the safety net. Alternatively, keep the current code and record the rule above in the class doc.

## Review conclusion

No material issues found. CR-1, CR-2 and CR-3 (with TW-1..TW-4) are resolved in the final revision, and all five acceptance criteria are met. The request-ordering and revert logic in `ThemeService` is correct, as checked against how main orders answers and broadcasts. The only remaining finding, CR-4 (P3), is an optional simplification.

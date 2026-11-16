# Code Review

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: fourth review round, final revision d370b59. Task diff `git diff 1dfcf47d005346393de36220875ea064bbccab2b..d370b59 -- packages apps .gitignore`. The focus is 60a9323, which rewrote the `ThemeService` bookkeeping per CR-4 (per key `confirmed`/`confirmedBy` plus `latest = {request, value, state}`, with the display recomputed by `refresh()`), and the tests added in 9563ba9 and d370b59. d370b59 changes only `theme.service.spec.ts`, `reviews/themes/tests.md` and this report; no production code changed since 60a9323. The rest of the task diff was re-checked briefly. Only committed code was reviewed; the working tree was clean when the tests ran.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions (Notes)
- SPEC.md M0 "Two visual styles"
- docs/ARCHITECTURE.md (renderer conventions, CSP `font-src 'self'`)
- AGENTS.md (Evidence rules, project notes)
- Earlier rounds: previous reviews/themes/review.md (CR-1..CR-5), reviews/themes/tests.md, reviews/themes/fixes.md
- apps/desktop/src/settings/store.ts, apps/desktop/src/main/handlers.ts and apps/desktop/src/main/index.ts (how main answers `app.settings.get/set` and broadcasts `app.settings.changed`)

Git range:
- Branch: main
- HEAD: d370b59b2af8f6617d6832096d05d4cf5356e64f
- Base/start: 1dfcf47d005346393de36220875ea064bbccab2b
- Commits reviewed: 9 (df350c6, 975d7fa, 582f4cf, e65dc18, 7bcbecb, 857a292, 9563ba9, 60a9323, d370b59)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Status of earlier findings

- **CR-1 (screenshots taken mid-transition): resolved.** Unchanged since round 2. The four PNGs are in `reviews/themes/screenshots/`. 60a9323 changes only service bookkeeping, not CSS or markup, so the screenshots still match the code.
- **CR-2 and CR-3 (revert paths): still resolved under the new code.** A failed choice gets `state = 'failed'`, and `refresh()` (`theme.service.ts:153-161`) then shows `confirmed[key]`. `record()` (`:137-144`) always stores a newer valid answer, whatever is currently shown. I traced the CR-3 sequence again with the new code. Tron is stored, the `get` is pending (request 1), the user picks Business (request 2) and that save fails, so the window shows `confirmed` (still Business). The `get` answer then records Tron with `confirmedBy = 1`. The choice has failed, so the window shows Tron. This is correct.
- **CR-4 (bookkeeping complexity): resolved.** The service now keeps three per-key structures and applies a single display rule, written in the class comment at `:56-60`: show the latest choice if its save has not failed and its request is newer than the last recorded answer; otherwise show `confirmed`. The revert branch in `change()` is gone, and every path ends in `refresh()`: init (`:96`), the `finally` of every save (`:129`), and broadcasts (`:149`).
- **CR-5 (no test pins the "pending choice wins over a broadcast" display): resolved in d370b59.** The new block `one rule per key: latest choice unless failed or superseded by main` (`theme.service.spec.ts:523-745`) adds these tests:
    - **`a broadcast while a save is pending changes only the key without a pending choice`:** it asserts the intermediate state after a broadcast and before the answer. The style keeps the pending `tron` and the mode follows the broadcast to `dark`. It then checks the state after the answer.
    - **`echo of an older save does not flash its stale value over a newer pending choice`:** it reproduces main's order of broadcasting before answering and records the display after every broadcast and every answer. All six samples must be `business/dark`. Showing the broadcast while a save is pending (the old flicker) would fail both of these tests.
    - **`a broadcast from another window after this window saved replaces the saved choice`:** it pins the other half of the rule.

## Soundness of the d370b59 tests

- **Coverage:** the tests exercise every branch of `refresh()` for both keys:
    - pending, ok and failed choices;
    - no choice for the key;
    - superseded by a newer answer;
    - a late `get` while a save is pending, with the save then succeeding or failing;
    - invalid values held back by `valid()`;
    - an unreachable main at startup.
- **Assertions:** they check `style()`, `mode()` and the `data-style`/`data-theme` attributes, which is observable behavior, not internal fields.
- **Order compared with real main:** two tests order answers in ways main never produces, because main runs writes one at a time, so answers come back in request order:
    - `both keys interleaved: a saved style and a failed mode ...` lets the newer mode save fail before the older style save answers;
    - the earlier `an earlier save that succeeds after a later one failed ...` does the same.

  They check defensive behavior against a fake, and the outcome they assert is still correct, so they are harmless. They are not evidence of how main orders answers. The tests that model main's real order (`main echoes each save ...`, `echo of an older save ...`, the broadcast-while-pending tests) are the ones that matter for that.
- **Invalid values:** `a value outside the contract is never shown ...` holds because `show()` drops invalid values. While such a choice is pending, the display keeps its previous value instead of switching to `confirmed`. In this test both are the same, so the assertion is valid. Callers are typed (`Style`/`ThemeMode`), and the switcher offers only contract values, so this is not a finding.

## Broadcast while a local save is pending (the behavior change)

`take()` updates `confirmed` but not `confirmedBy`, so while a choice is `pending` it stays on screen until an answer to that request or a later one arrives. I checked this against how main orders its messages:

- `SettingsStore.set()` is serialized through `queue`. `apply()` writes, sets `current`, notifies the listeners (the broadcast to every window) and only then resolves. The `app.settings.set` handler returns that result, so on this window's port, a write's broadcast always arrives before its answer. `get()` is synchronous and returns `current`.
- **Another window's write W queued before our save S.** W's broadcast arrives while S is pending. It updates `confirmed` but the display keeps our choice. S's answer then carries the stored value, which is ours because S was applied after W, and `record()` stores it. The final display matches main, without the brief flicker the old code showed.
- **W queued after S.** S's answer is posted when S resolves. W's broadcast comes only after W's file write (asynchronous I/O) and goes over the same port, so it arrives after S's answer. By then `confirmedBy[key]` equals S's request, so `refresh()` shows the broadcast value (W). This is correct.
- **S fails.** Main's `current` stays unchanged and it sends no broadcast for S. Broadcasts received while S was pending are already in `confirmed`, so the failed choice falls back to the value main actually stores.
- **Our own echo.** The broadcast for S carries S's value and arrives while S is pending, so ignoring it for display changes nothing.
- **Startup.** `init()` takes request 1 synchronously inside the app initializer, before any UI exists, so no save can be numbered before the `get`. A broadcast that arrives before the `get` answer is for a write main already applied, so the synchronous `get` result includes it.
- **A set answer that lacks a key.** Every set answer carries all settings (`store.get()` returns every key, and the contract requires them), so a successful choice always moves `confirmedBy` up to its own request. After that, later broadcasts from other windows apply.

Conclusion: holding the pending choice is correct for the orderings main can produce. The display differs from main's state only while this window's own write is in flight, and the answer always settles it.

## Checks

- AC1: the Electron test drives the switcher on `#/dev/explorer` and writes four screenshots after transitions settle. Unchanged.
- AC2: `theme-tokens.spec.ts` computes WCAG ratios for the Business light and dark token pairs. Unchanged.
- AC3: Tron keeps Canopy's tokens and bundled `woff2` fonts (`font-src 'self'`). In Business, every glow and scanline token is `none`. Unchanged.
- AC4: `data-style` and `data-theme` are set on `<html>` without a reload. The `matchMedia` listener follows changes and is removed on destroy. Unit and Electron tests cover both. The public API is unchanged.
- AC5: a test enumerates the production, read-only and 20 BSON tokens in all four sets. Unchanged.
- Integration and security: no new IPC surface, and no secrets or personal data in the diff.
- Validation I ran at HEAD d370b59 with a clean working tree: `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`. Result: 2 files, 64 of 64 tests passed.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None. CR-5 is resolved (see above).

## Review conclusion

No material issues found. At d370b59, CR-1 to CR-5 are resolved. The `ThemeService` display rule is correct for the way main orders writes, broadcasts and answers, including writes from other windows, and tests now pin it, including the intermediate states. All five acceptance criteria are met.

# Code Review

Date: 2026-11-17

Task: connection-ui - M1: Connection editor and manager

Scope: third (final) review pass of the whole task diff, `git diff fda71f94e3a52a1b5d760a23a58fcacd7a959f64..0414a53 -- packages test docs`. The task commits in that range are c0c0d72, 3ce5528, 14881ea, 2ffe107, 5aa43a1, 55339c5 and 0414a53. Commits 26608b8, 1562057 and 27f6b76 touch only `tasks/` and `reviews/`. This pass focuses on three things:
- whether the open P2 finding of the second pass (CR-1, a Save that finishes after the user left a new profile navigates back to it) is resolved;
- whether the round-2 fix commit 55339c5 causes regressions;
- whether the two specs in the test-writer commit 0414a53 (only `connection-editor.spec.ts`) assert what their names claim, and whether they are flaky.

Uncommitted changes in `reviews/` and `tasks/` are not part of this review.

Requirements:
- tasks/connection-ui.md (goal, 3 acceptance criteria, recorded assumptions)
- SPEC.md M1 "Connections", docs/ARCHITECTURE.md "Connection editor"
- reviews/connection-ui/review.md (second pass), reviews/connection-ui/fixes.md (rounds 1 and 2)
- route config `packages/renderer/src/app/app.routes.ts`

Git range:
- Branch: main
- HEAD: 0414a53
- Base/start: fda71f94e3a52a1b5d760a23a58fcacd7a959f64 (`git merge-base HEAD origin/main`)
- Commits reviewed: 7 code/test commits (c0c0d72, 3ce5528, 14881ea, 2ffe107, 5aa43a1, 55339c5, 0414a53). Commits 55339c5 and 0414a53 were reviewed in detail.

Commands run:
- `git show 55339c5`, `git show 0414a53`, `git diff 55339c5 27f6b76 --stat` (only `reviews/connection-ui/fixes.md`), `git log --oneline fda71f9..HEAD`
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/**/*.spec.ts'` at 55339c5 -> 3 files, 125 tests passed; at 0414a53 -> 3 files, 127 tests passed
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/connection-editor.spec.ts'` at 0414a53, run again for stability -> 1 file, 39 tests passed
- `python tasks.py verify connection-ui` could not be run in this review session because the command was not permitted. The parent worker must confirm that evidence is recorded for each criterion.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Status of the earlier finding

- CR-1 of the second pass (leaving a new profile while its Save runs navigates back to it): resolved.
  - The `DestroyRef` callback (`connection-editor.ts:152-156`) now increments `loadGeneration`, so `current()` in `save()` (`:503-504`) returns false for a destroyed instance. The state, notice, error, `storedSecrets` and navigation updates (`:514`, `:531`, `:545`, `:552`, `:557`, `:560`) are then skipped.
  - The safety registration and sidebar reload (`:519-525`) still run, which is intended.
  - The field initializer `loadGeneration = 0` (`:165`) is declared after the constructor. Class field initializers run before the constructor body, so the increment works on a defined number.
  - `connections/new` and `connections/:id` are separate route configs (`app.routes.ts:38`, `:52`), so leaving the page does destroy the instance.
  - The 55339c5 spec covers a hold during `profiles.save`. The 0414a53 spec covers a hold during `profiles.setSecret`. Both pass.

## Regression check of 55339c5

- `savedNotice.set(unchanged)` (`:562-565`): "Saved." is shown only when the state is still the one that Save set. `update()` already clears the notice on any edit, so the result is consistent.
- The extra generation bump on destroy also turns pending `loadProfile` answers of a destroyed instance into no-ops (`:182`, `:190`, `:198`). This is harmless. A running test is still aborted first.
- The navigation-state "Saved" notice for a newly created profile is unaffected. The bump happens only when the old instance is destroyed, and the new instance starts its own generation (`gen > 1` check, `:179`).
- No new colors, secrets or logging were added.

## Review of the test commit 0414a53

- `leaving a new profile while its password is stored keeps the store but stays on the new page`: the name is accurate.
  - `expect(release).toBeDefined()` proves that `profiles.save` has answered and that `setSecret` is pending at the moment the test leaves.
  - The URL assertion would fail if the destroyed editor still navigated to `/connections/new-id`. The test router has a `connections/:id` route (spec line 47), so the navigation would succeed.
  - The `setSecret` params assertion checks that the password was sent once for the saved profile id.
  - The secret value is fictitious.
  - Flakiness: the test waits a fixed 5 macrotasks after the release. This is the same pattern as the 55339c5 spec. The fixer showed that this pattern fails with the fix disabled, and the passing direction does not depend on timing. Two runs passed.
- `a new profile saved without edits during the store navigates to its page with the Saved notice state`: the assertions (URL `/connections/new-id`, navigation state `{ thicketProfileSaved: true }`) are correct and deterministic. Note that `router.lastSuccessfulNavigation` is a signal in the installed `@angular/router` 22.2.6. However, the name claims more than the test exercises. See CR3-2.
- The reader side, which shows "Saved." on the new instance, is not unit-tested. The e2e (`test/e2e/connections.e2e.ts:88`) asserts `saved-notice` after a real create-and-navigate, so this is not reported as a gap.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR3-1 | Edits made while `profiles.save` runs are silently replaced by the saved state**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:500`, `:531-534`
    - Category: Correctness
    - Problem: `save()` captures `state` before `profiles.save` (`:500`). The form fields are not disabled while saving: only the Save button is (`connection-editor.html:62`). After the save returns, `this.state.set(pending)` (`:532`) unconditionally replaces whatever the user typed during the request with the state built from the saved profile. Only edits made during the later `setSecret` step are kept (`:562`). For a new profile, edits made during `setSecret` are also lost, because the editor navigates to the new instance (`:566-571`). The fixer acknowledged this second case in fixes.md round 2.
    - Why it matters: input typed during a Save disappears without notice, and for a new profile "Saved." is then shown. The window is normally short (a local IPC store write), so the impact is low. However, the editor's stated rule ("edits made while saving stay") holds for only one of the two awaits.
    - Suggested fix: apply the same identity check before the first update, for example `if (current() && this.state() === state) this.state.set(pending)`. Otherwise, keep the user's state and adopt only `id` and `base`. Alternatively, disable the form inputs (a `fieldset [disabled]="saving()"`) for the whole save. Add a spec that edits a field while `profiles.save` is held.

- [ ] **CR3-2 | The spec name says "without edits during the store", but no password store runs in it**
    - File: `packages/renderer/src/app/connections/connection-editor.spec.ts:820-831`
    - Category: Tests
    - Problem: the spec sets only the name. A new editor state uses mechanism `NONE` (`connection-form.model.ts:71`), so `profiles.setSecret` is never called. The test therefore does not exercise the `unchanged` path after a password store, which is what its name ("saved without edits during the store") suggests. It checks only the plain new-profile navigation and its `thicketProfileSaved` state. That behavior is correct, but it was already largely covered by the URL check at spec line 241.
    - Why it matters: a reader may assume that "new profile, password stored, no edits -> navigates with the Saved state" is covered when it is not. This case depends on the 55339c5 change.
    - Suggested fix: either rename the spec (for example "a new profile without a password navigates to its page with the Saved notice state"), or select SCRAM-SHA-256 with a username, password and `secret-saved` before Save, and also assert the `setSecret` call.

## Checked without findings

- The earlier fixes from the second pass are unchanged by 55339c5 and 0414a53, and their specs still pass:
  - secret URI option stripping and masking;
  - adopting the saved profile before `setSecret`;
  - the same-instance generation guard;
  - the e2e `secrets.bin` control;
  - the h1 heading.
- `saving` is reset in `finally` on every path, including the early return for a destroyed instance. After destroy, only the unguarded `safety.set` and `tree.reloadProfiles` still update anything. These are app-level services and are expected to learn about the saved profile.
- 0414a53 changes only the spec file. It does not weaken, skip or delete existing tests.

## Review conclusion

No material issues found.

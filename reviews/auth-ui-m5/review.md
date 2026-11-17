# Code Review

Date: 2026-11-17

Task: auth-ui-m5 - M5: Connection editor for LDAP, OIDC and AWS

Scope: second pass, final revision. `git diff 8b692e3ce07275fb58c834d4aefdf019131495fa..4ab26fd -- packages test`: task commits 26237a8, 7c1b2b3, 3a9057b, 9012d45, 4799427 and 4ab26fd. I looked closely at the fixer commit 4799427 (CR-1..CR-3) and the test-writer commit 4ab26fd. `reviews/auth-ui-m5/fixes.md` and `tests.md` were read for context only.

Requirements:
- `tasks/auth-ui-m5.md` acceptance criteria and its three recorded ASSUMPTION notes
- `SPEC.md` (M5, security requirements), `docs/ARCHITECTURE.md`, `AGENTS.md`
- Findings CR-1..CR-3 of the first review pass
- The backend behavior the fix relies on: a stored `awsSessionToken` is sent with any access key ID (`packages/backend/src/auth/aws/aws.ts`)

Git range:
- Branch: main
- HEAD: 4ab26fd98360785d0caa32e116c769a7dd74f90f
- Base/start: 8b692e3ce07275fb58c834d4aefdf019131495fa
- Commits reviewed: 6 (working tree clean)

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Earlier findings: status

- CR-1 (a stored AWS session token could not be removed): **fixed**.
    - `toggleRemoveSecret` and `setSecret` mark the token for removal and cancel the mark (`connection-editor.ts:540-573`).
    - `secretsToRemove` runs before `profiles.save` and covers both an explicit mark and a changed key ID (`connection-editor.ts:913-934`).
    - `storeSecrets` calls `profiles.clearSecret` first. A failure is reported and the mark is kept for a retry (`pending.removedSecrets`, `connection-editor.ts:849-854, 951-960`).
    - A profile switch during the removal is guarded (`current()`).
    - The retry path works after a failed password `setSecret` or `clearSecret`: `state.base` is then the saved profile, so the explicit `removedSecrets` from `pending` carries the removal.
    - Comparing the key IDs is consistent with the draft: both sides are trimmed (`connection-form.model.ts:589-591`).
- CR-2 ("1 seconds"): **fixed** at `oidc-sign-in.ts:142`, and the spec asserts the singular.
- CR-3 (ask hint said "password" for AWS): **fixed** at `connection-editor.html:684-691` (`passwordNoun()`, plus the AWS session-token sentence).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-4 | A token removed because the key ID changed gets no notice before save**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:920-932` (auto-removal), `packages/renderer/src/app/connections/connection-editor.html:25-31, 645-649` (placeholder / `aws-token-removed` hint)
    - Category: Quality
    - Problem: `secretsToRemove` adds `awsSessionToken` whenever the access key ID differs from the saved one. In the UI, though, `secretRemoved()` only reads `state.removedSecrets`. So after editing the key ID, the token field still shows "Saved; type to replace it" and no "removed on save" hint appears. Then save deletes the stored token without warning. One example: a user corrects a typo in the key ID of a profile whose token is correct. The token is deleted, and the next Test fails for lack of a token. The only sign is that the placeholder changes to "none" after save. The spec test "a changed access key ID removes the stored token on save" (`connection-editor.spec.ts:1749`) asserts the clearSecret call but no UI signal.
    - Why it matters: A stored credential is deleted for good without the user seeing it coming. The cost is small, because the user can paste the token again.
    - Suggested fix: Derive one computed "token removed on save" signal from the same rule as `secretsToRemove` (explicit mark, or a changed key ID with no typed token). Use it for the placeholder and the `aws-token-removed` hint, possibly with wording such as "The saved session token belongs to the old access key and is removed on save". Add an assertion to the existing key-change test.

- [ ] **CR-5 | The "removed on save" hint and placeholder stay after the removal when the user edited during the save**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:556-558, 891-893`
    - Category: Quality
    - Problem: `pending` carries `removedSecrets`. If the user edits the form while the save is running, `this.state() === pending` is false, so the state keeps `removedSecrets: ['awsSessionToken']`, even though `storeSecrets` already removed the token from `storedSecrets`. `secretRemoved()` then stays true while `secretSaved()` is false. The remove button disappears, but the hint "The saved session token is removed on save." and the placeholder "Removed on save; type to replace it" still show for a token that no longer exists. The next save makes no extra call, because `secretsToRemove` filters by `stored`, so the problem is only the misleading text.
    - Why it matters: The UI briefly says something false about a credential. This needs a rare edit during the save.
    - Suggested fix: Make `secretRemoved(kind)` also require `secretSaved(kind)`, or drop removed kinds from `state.removedSecrets` once `clearSecret` succeeds.

## Notes (not findings)

- I ran `cd packages/renderer && npx ng test --include src/app/connections --include src/app/layout`: 13 files, 466 tests passed on HEAD 4ab26fd.
- AC1 (component tests for each mechanism's fields and URI sync) is covered by the editor spec's M5 block, the model spec, `oidc-sign-in.spec.ts` and the app-shell test. AC2 (LDAP e2e) is `test/e2e/ldap.e2e.ts`. `tests.md` says it passed against the Podman LDAP fixture. I did not re-run it in this pass.
- The commit hashes in `tests.md` and `fixes.md` do not match the current history (`git log` shows 4799427 / 4ab26fd). This fits commits rewritten by `tasks.py`; the parent should set `reviewed_revision` to the final hash.
- I did not inspect evidence recorded with `tasks.py verify`, because the parent asked me not to run `tasks.py`.
- No secrets in fixtures: the AWS keys and tokens in the specs are fictitious placeholders.

## Review conclusion

No material issues found. CR-1..CR-3 are fixed. The two remaining findings are low-priority UI wording issues and are optional before completing the task.

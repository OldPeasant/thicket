# Code Review

Date: 2026-11-17

Task: users-roles-edit - M6 (Could): Edit users and roles

Scope: final committed task code, `git diff 27adc3ab..2b0b7e60` (commits 77bdb590, 7d9d52ce, 8b97c739, 2ba37069, 678055ee, 2b0b7e60), with focus on the fix commit 2b0b7e60 for the findings of the previous review. Committed changes only; uncommitted working-tree changes (another helper's tests, and an in-progress rebase by the parent worker) were not reviewed. All code was read from the commit objects, not from the working tree.

Requirements:
- tasks/users-roles-edit.md (goal, 2 acceptance criteria, 4 recorded assumptions)
- SPEC.md M6 ("Could: Users and roles: create, edit, drop, grant/revoke") and M1 safety (write guard, confirm dialog)
- docs/ARCHITECTURE.md "Users and roles"
- docs/QUALITY.md (report format), AGENTS.md (project notes)
- reviews/users-roles-edit/fixes.md (dispositions of the previous CR-1 to CR-4)

Git range:
- Branch: main
- HEAD: 2b0b7e60d10d665a817a2b0505f28438ef2f326c
- Base/start: 27adc3abd4885ca9a8f0496a7abc21d3a21853d1
- Commits reviewed: 6

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Previous findings

- CR-1 (tests for the confirm text and the editor diff): resolved. `packages/renderer/src/app/safety/operation.spec.ts` covers the 8 `describeWrite` branches and asserts `pwd: "<hidden>"` and the absence of the password for `admin.createUser`/`admin.updateUser`; `users-edit.model.spec.ts` and `principal-editor.spec.ts` (commit 678055ee) cover the helpers and the change diff.
- CR-2 (admin role suggestions for custom roles outside `admin`): resolved. `roleSuggestions(known, db, forRole)` drops the `@admin` suggestions when `forRole` is set outside `admin` (`users-edit.model.ts:63`); the editor passes `!isUser()` and the detail grant field passes `mode() === 'roles'`. Same-database built-in roles (read, readWrite, ...) are still suggested, which MongoDB allows. Covered by model, editor and view tests.
- CR-3 (typed role cleared before the grant succeeds): resolved. `RoleInput` has `clearOnPick` (default true, editor unchanged) and `clear()`; the grant field sets `clearOnPick=false`, and a refused grant keeps the text (view test "a refused grant keeps the typed role"). The field is disabled while `busy()`, so no double grant.
- CR-4 (stale notice after the tab switched database): resolved. `change()` captures the target and sets neither the success nor the error notice, nor reloads, when the target changed (`users-roles-view.ts:287-310`); `busy` is always reset in `finally`. Two view tests cover success and failure answered after the switch. `saved()` is correctly left as is: it is synchronous up to the notice and the target switch closes the editor.

## What was checked in the fix commit

- `change()`/`grantOrRevoke()` now return `Promise<boolean>`; every early return yields `false`, and `drop()`/`revoke()` ignore the result as before. A cancelled confirm dialog returns `false` without a notice (unchanged behavior).
- Target comparison uses the same profileId/db equality as the `target` computed, so switching A -> B -> A before the answer still shows the notice for A, which matches the lists on screen.
- No new state owners, no layer changes, no new dependencies; template bindings (`#grantField`, `[forRole]`, `[clearOnPick]`) match the component inputs.
- Backend, contract and guard code are unchanged since the previous review; re-read `edit.ts`, `handlers.ts`, `admin.ts` contract additions and `operation.ts`/`write-guard.service.ts` additions: password only goes into the command and is rendered as the hidden marker; all 8 methods are `write: 'always'` and registered behind the guard.
- Criterion evidence: `python tasks.py verify users-roles-edit` shows both criteria still unticked. Nothing is claimed yet, so this is not a finding; the parent must run the integration and e2e suites and record them before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The "grant that worked empties the field" test does not exercise `RoleInput.clear()`**
    - File: `packages/renderer/src/app/admin/users/users-roles-view.ts:254` (test in `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`, "a refused grant keeps the typed role; a grant that worked empties the field")
    - Category: Tests
    - Problem: after a successful grant, `change()` awaits `reload()`, which sets `users` to `loading`; the template (`users-roles-view.html:86-158`) then replaces the user detail with "Loading users…", destroying the grant field. `field?.clear()` runs afterwards on the destroyed instance, and the recreated field starts empty anyway. The test's final assertion (`role-input` value is `''`) would therefore pass even if `grant()` never called `clear()`.
    - Why it matters: the success half of the CR-3 fix is not actually verified; if the reload later stops re-rendering the detail (e.g. keeping the old list while loading), a regression that leaves the text in the field would go unnoticed. Behavior today is correct.
    - Suggested fix: add a direct test that `grant(ref, field)` calls `field.clear()` only on success (e.g. a spy on a `RoleInput`-like object), or assert on a `RoleInput` instance that survives the reload; alternatively document that the reload recreates the field and drop the `clear()` call.

## Review conclusion

No material issues found. The previous findings CR-1 to CR-4 are resolved in the reviewed code; the remaining P3 is an optional test-strength improvement. The parent must still record evidence for both acceptance criteria (integration suite and the e2e flow against the `--auth` MongoDB container) before running `done`.

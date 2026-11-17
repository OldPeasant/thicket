# Code Review

Date: 2026-11-17

Task: users-roles-edit - M6 (Could): Edit users and roles

Scope: final committed task code, `git diff a02c41b2..c77c019e` excluding `tasks/` and `reviews/` (commits f4697191, e83464b1, 09cdcd26, 1fcd2050, 90186564, 2a3fb1c2, c77c019e). Focus on (a) confirming the production code equals the revision reviewed before (2b0b7e60 on base 27adc3ab), (b) the rebase conflict resolutions in `write-guard.service.ts` and `operation.spec.ts`, (c) the new test-only commit c77c019e. Committed changes only; the working tree was clean.

Requirements:
- tasks/users-roles-edit.md (goal, 2 acceptance criteria, recorded assumptions and evidence)
- SPEC.md M6 ("Could: Users and roles: create, edit, drop, grant/revoke") and M1 safety (write guard, confirm dialog)
- docs/ARCHITECTURE.md "Users and roles"
- docs/QUALITY.md (report format), AGENTS.md (project notes)
- reviews/users-roles-edit/tests.md, reviews/users-roles-edit/fixes.md

Git range:
- Branch: main
- HEAD: c77c019ea904e476c434a24a27ec27093c57cf3c
- Base/start: a02c41b2b71143a9e921e8d76696b81144605651
- Commits reviewed: 7

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Production code unchanged since the previous review

- `git diff 2b0b7e60 c77c019e` restricted to the task's files differs in only six files (`backend.ts`, `operation.ts`, `write-guard.service.ts`, `operation.spec.ts`, `contract/index.spec.ts`, `contract/methods.spec.ts`, 118 added lines) plus the two test files of c77c019e. `git diff 27adc3ab a02c41b2` on those six files has exactly the same per-file stats: the differences are main's changes (the gridfs task), not task changes.
- The task diff `a02c41b2..c77c019e` on `backend.ts`, `operation.ts` and `write-guard.service.ts` contains only the task's lines (users edit handler registration; 8 `describeWrite` cases with `HIDDEN_PASSWORD`; 3 DESTRUCTIVE entries and 8 TITLES).
- The criterion evidence was recorded at f9a32cf8 (the pre-rebase fix commit); `git diff f9a32cf8 2a3fb1c2 -- packages test` is empty, so the recorded integration and e2e runs apply to the reviewed code.

## Conflict resolutions

- `write-guard.service.ts`: DESTRUCTIVE keeps main's `'gridfs.delete'` and adds `'admin.dropUser'`, `'admin.dropRole'`, `'admin.revokeRoles'`; TITLES keeps both the gridfs and the admin entries. No entry lost or duplicated.
- `operation.spec.ts`: the task's "user and role changes" block is added alongside main's gridfs tests; no existing test was changed or removed.

## New tests (c77c019e)

- `role-input.spec.ts` (10 tests): covers default clear on pick, Enter and `name@db`, `clearOnPick=false` with an explicit `clear()`, malformed input alert/aria-invalid, `clear()` ending an error, disabled state, CR-2 suggestion rules (outside and inside `admin`), and distinct datalist ids. Assertions are on rendered DOM and emitted values, not internals.
- `users-roles-view.spec.ts` (5 tests): cancelled grant keeps the typed role and sends nothing; a change answered after a tab switch does not reload or notify; `saved()` after the editor closed does nothing; re-selecting the current mode keeps the form; with nothing selected, grant/revoke/drop/edit send nothing. The tests use the existing fake bridge and confirm service and assert on sent requests and visible state. No existing tests were weakened.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The view's success path of `grant()` calling `RoleInput.clear()` is still not exercised**
    - File: `packages/renderer/src/app/admin/users/users-roles-view.ts:254` (tests in `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`, "a refused grant keeps the typed role; a grant that worked empties the field" and the new "a grant cancelled in the confirm dialog keeps the typed role; confirming empties it")
    - Category: Tests
    - Problem: after a successful grant, `change()` awaits `reload()`, which sets `users` to `loading`; `userItems()` then returns `null` (`itemsOf`, line 51) and the template (`users-roles-view.html:88`) removes the user detail, destroying the grant field. The recreated field starts empty, so both view tests' final assertion (`role-input` value `''`) passes even if `grant()` never called `field?.clear()`. The new `role-input.spec.ts` test verifies `clear()` itself, but not that the view calls it only on success.
    - Why it matters: the success half of the CR-3 fix is verified only indirectly; if the reload later keeps the old list on screen while loading, a regression that leaves the text in the field would go unnoticed. Behavior today is correct.
    - Suggested fix: call `view.grant(ref, fakeField)` with a stub `{ clear: vi.fn() }` and assert it is called on success and not on refusal or cancel; or drop the `clear()` call and document that the reload recreates the field.

## Review conclusion

No material issues found. The production code is identical to the previously reviewed revision apart from main's changes brought in by the rebase, the conflict resolutions keep both sides correctly, and the new tests are meaningful. The remaining P3 is an optional test-strength improvement.

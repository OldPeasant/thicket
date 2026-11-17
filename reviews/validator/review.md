# Code Review

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: `git diff dedda46..fe8806d -- ':!tasks' ':!reviews'` (task commits rebased onto newer main; original base 1fef92f). Third review, final revision fe8806d. The code that ships (contract `coll.validator.check`, `packages/backend/src/browse/validator/*`, `packages/renderer/src/app/validator/*`, collection-view changes, workspace/sidebar tab kind, docs, unit, integration and e2e tests) was fully reviewed at 6a0b73e. This pass confirms it is unchanged and reviews the tests added in fe8806d.

Reviewed revision: fe8806d17f18079b4ed14fc8be5306b5bd5d8c82

Requirements:
- tasks/validator.md acceptance criteria and recorded assumptions (check method via a `$nor` query, markers in the list view plus a summary line, marks reflect stored documents)
- SPEC.md M3 "Collection validator" and the API table (`coll.*`)
- docs/ARCHITECTURE.md (write guard, EJSON contract, the renderer never evals, "Validator tab" section)
- AGENTS.md
- Previous reviews of this task (CR-1..CR-7), reviews/validator/fixes.md, reviews/validator/tests.md

Git range:
- Branch: main
- HEAD: fe8806d17f18079b4ed14fc8be5306b5bd5d8c82
- Base/start: dedda46bd91a53436def437df17145b5482d4509 (original base 1fef92fde38609ff3d0ebadae6fbbff5145caef1)
- Commits reviewed: 6 (4952668, 831799e, 3892b1f, cea9f7e, 49dee3a, fe8806d); working tree clean at review time

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Changes since the previous review

- `git range-diff 6a0b73e~5..6a0b73e 49dee3a~5..49dee3a` shows all 5 earlier commits as identical (`=`) after the rebase.
- `git diff 49dee3a fe8806d -- ':!reviews' ':!tasks'` touches only `packages/renderer/src/app/validator/validator-view.spec.ts` (+62 lines, 4 tests). There are no production code changes since the reviewed revision.
- I reviewed the added tests:
  - "Ctrl+Enter right after a successful save sends no second collMod": this test is valid because the fake `coll.validator.set` updates `stored`, so the reload makes the editor clean again. It exercises the `!dirty()` guard in `save()` (`validator-view.ts:172`) through the keyboard path.
  - "Ctrl+Enter saves a change of the level alone, with the stored validator": this checks that the keyboard path sends the unchanged stored validator together with the new level.
  - "unlocks the editor after a refused save, and a retry sends again": this covers the `finally` that resets `saving` on a SERVER_ERROR. It also checks the alert role, that the edit is kept (`dirty`) and that a retry succeeds. Removing the `finally` reset would make the test fail.
  - "locks the editor while the confirmation is open and unlocks it after Cancel" (production profile): this covers the CR-4 claim that the lock includes the time the confirmation dialog is open, and that the text is kept after Cancel.
  - The tests assert behavior (requests sent, DOM state, messages) rather than implementation details. They do not weaken or replace existing tests. One test partly overlaps "locks the editor while saving" (that test covers the success path; the new one covers the failure path), which is acceptable.
- Test run by this reviewer: `cd packages/renderer && npx ng test --include='src/app/validator/**/*.spec.ts'` -> 3 files, 67 tests passed.

## Status of earlier findings

- CR-1 (a failing check was silent): Fixed. `collection-view.html` renders `validator.error()` as `validator-check-error` (role `status`), and a successful check clears it. Covered by collection-view.spec "says why when the check fails, and drops the notice after a successful check" and by the error-path tests in the validator-marks spec.
- CR-2 (no unit tests): Resolved. Backend `validator.spec.ts` and `handlers.spec.ts`, plus renderer `validator.model.spec.ts`, `validator-marks.service.spec.ts` and `validator-view.spec.ts`. fe8806d extends the last of these.
- CR-3 (Ctrl+Enter saved while Save was disabled): Fixed. `save()` returns early on `saving()`, `!dirty()` or a read-only profile (`validator-view.ts:172`). Tests cover the unchanged, just-saved, production and read-only cases.
- CR-4 (edits typed while saving were overwritten): Fixed. The textarea is read-only and the selects and template button are disabled while `saving()`, including while the confirmation dialog is open. Tests cover the success, refusal and Cancel paths.
- CR-5 (any validator change re-checked every tab): Fixed. `ValidatorChanges` keeps one signal per namespace, and tests assert that no extra `coll.validator.check` is sent.
- CR-6 (the check error notice stays after the page becomes empty): Still open (P3, optional), unchanged below.
- CR-7 (`hasValidator` is not read in production code): Still open (P3, optional), unchanged below.

The production code was verified as correct at the previous review, and that still holds because it is unchanged:
- `coll.validator.check` is evaluated by the server (`{ _id: { $in: ids }, $nor: [validator] }`). There is no client-side schema evaluation, and the editor text is parsed with core's shell-syntax parser, without eval.
- `coll.validator.set` is `write: 'always'` with `writeFields` and is sent via `WriteGuard.run`. `check` and `get` are cancellable reads.
- EJSON contract: canonical EJSON strings in both directions. The backend uses `relaxed: false`, and rejects non-document validators and over-long id lists with `INVALID_PARAMS`.
- Out-of-order safety: `ValidatorMarks.check` aborts the previous request and ignores aborted answers, including failures. `ValidatorView.reload` uses a generation counter.
- Validator tabs close with their collection on drop or rename.
- Acceptance criteria: the integration test (8.x RS and 7.0 standalone) and the e2e test have recorded evidence that names the command, the configuration and the result.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | A check error notice stays after the page becomes empty**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:79`
    - Category: Correctness
    - Problem: The empty-page / no-profile branch of `check()` aborts the running request and clears `invalid`, but does not reset `error` (nor `hasValidator`). After a failed check, a query that returns no documents keeps showing "Could not check the documents against the validator: ..." even though nothing is being checked.
    - Why it matters: The user sees an outdated error message for a page with no documents. The confusion is minor because the next non-empty page clears it.
    - Suggested fix: Also call `this.error.set(null)` in that branch, and add a one-line spec next to "sends no request for an empty page".

- [ ] **CR-7 | `ValidatorMarks.hasValidator` is never read in production code**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:67`
    - Category: Quality
    - Problem: `hasValidator` is set from every check result, but only specs read it. Its doc comment ("only then are documents marked") describes behavior that no code relies on, because marking is driven only by `invalid`.
    - Why it matters: Dead state with a misleading comment. Future readers may assume it controls the markers.
    - Suggested fix: Either remove the signal (keep the contract field) or use it, for example to show an explicit "no validator" state, and adjust the comment.

## Review conclusion

No material issues found. The production code at fe8806d is identical to the reviewed revision. The 4 tests added in fe8806d are correct and add useful coverage. CR-1..CR-5 are resolved; CR-6 and CR-7 remain optional low-priority cleanups.

# Code Review

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: `git diff 1fef92f..HEAD -- ':!tasks' ':!reviews'` (second review, final revision after the fixer commit 6a0b73e): contract `coll.validator.check`, `packages/backend/src/browse/validator/*`, `packages/renderer/src/app/validator/*`, collection-view changes, workspace/sidebar tab kind, docs, unit, integration and e2e tests.

Reviewed revision: 6a0b73ef449ce7dbb3581eeee2e62e03664de3a0

Requirements:
- tasks/validator.md acceptance criteria and recorded assumptions (check method via `$nor` query, markers in list view plus summary line, marks reflect stored documents)
- SPEC.md M3 "Collection validator" and API table (`coll.*`)
- docs/ARCHITECTURE.md (write guard, EJSON contract, renderer never evals, "Validator tab" section)
- AGENTS.md
- Previous review of this task (CR-1..CR-5) and reviews/validator/fixes.md

Git range:
- Branch: main
- HEAD: 6a0b73ef449ce7dbb3581eeee2e62e03664de3a0
- Base/start: 1fef92fde38609ff3d0ebadae6fbbff5145caef1
- Commits reviewed: 5 (5e290eb, 7f1e0ec, 0fd662a, 096e68a, 6a0b73e); working tree clean at review time

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Status of earlier findings

- CR-1 (failing check silent) - Fixed. `collection-view.html` renders `validator.error()` as `validator-check-error` (role `status`); a successful check clears it. Covered by collection-view.spec "says why when the check fails, and drops the notice after a successful check" and validator-marks spec error-path tests.
- CR-2 (no unit tests) - Resolved. The diff now contains `validator.spec.ts` and `handlers.spec.ts` (backend: `parseIds` limit, `parseValidator` rejecting non-documents, get/set/check), `validator.model.spec.ts`, `validator-marks.service.spec.ts` (stale answer dropped also on failure, CANCELLED, error path, empty page, id cap) and `validator-view.spec.ts` (dirty, revert, save, CANCELLED, read-only, locks).
- CR-3 (Ctrl+Enter saves when Save is disabled) - Fixed. `save()` returns early on `saving()`, `!dirty()` or `ProfileSafetyService.readOnly(profileId)()` (`validator-view.ts:84`), matching the Save button's `[disabledWhen]` plus `appWriteControl`. `WriteGuard` still enforces read-only as a second layer. Tests cover the unchanged, production and read-only cases.
- CR-4 (edits typed while saving overwritten) - Fixed. Textarea is `readOnly`, selects and template button `disabled` while `saving()`, which includes the time a write-confirmation dialog is open because `saving` is set before `guard.run`. Tests cover lock and unlock after a refused save.
- CR-5 (any validator change re-checks every tab) - Fixed. `ValidatorChanges` keeps one lazily created signal per namespace key; test "notifies readers of the changed collection only" and the strengthened collection-view test assert no extra `coll.validator.check`.

Verified as correct in the final code:
- `coll.validator.check` is evaluated by the server (`{ _id: { $in: ids }, $nor: [validator] }`); no Ajv or client-side schema evaluation. Editor text is parsed with core's shell-syntax parser (no eval).
- `coll.validator.set` is `write: 'always'` with `writeFields` (backend `guardWrites`) and sent via `WriteGuard.run`; `check` and `get` are reads, cancellable through `abortable`.
- EJSON contract: params/results are canonical EJSON strings (`ejsonArray`, `ejsonDocument`); backend parses with `relaxed: false`, rejects non-document validators and non-array or over-long id lists with `INVALID_PARAMS`; `_id` keys round-trip through the same core `stringifyEJson` that `documentKey` uses.
- Out-of-order safety: `ValidatorMarks.check` aborts the previous request and ignores aborted answers, also failing ones; `ValidatorView.reload` uses a generation counter; the check is stopped on tab destroy.
- Validator tabs close with their collection on drop/rename (sidebar `closeTabs` includes the `validator` kind).
- Acceptance criteria: the integration test sets a validator and asserts the check returns exactly the failing `_id`s (8.x RS and 7.0 standalone); the e2e test edits and saves the validator in the tab and asserts `doc-invalid` markers on exactly the failing documents. Both criteria have recorded evidence naming the command, configuration and result. (Tests were not re-run by this reviewer; the sandbox denied running the test commands. The fixer reports `npm run check` and the validator e2e passing on this revision.)

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | A check error notice stays after the page becomes empty**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:77`
    - Category: Correctness
    - Problem: The empty-page / no-profile branch of `check()` aborts the running request and clears `invalid`, but does not reset `error` (nor `hasValidator`). After a failed check, running a query that returns no documents keeps showing "Could not check the documents against the validator: ..." although nothing is being checked.
    - Why it matters: A stale error message about a page with no documents; minor confusion only, since the next non-empty page clears it.
    - Suggested fix: Also `this.error.set(null)` in that branch, with a one-line spec next to "sends no request for an empty page".

- [ ] **CR-7 | `ValidatorMarks.hasValidator` is never read in production code**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:66`
    - Category: Quality
    - Problem: `hasValidator` is set from every check result but only specs read it; its doc comment "only then are documents marked" describes behaviour that no code relies on (marking is driven solely by `invalid`).
    - Why it matters: Dead state with a misleading comment; future readers may assume it gates the markers.
    - Suggested fix: Either drop the signal (keep the contract field) or use it, e.g. to show nothing/"no validator" state explicitly; adjust the comment accordingly.

## Review conclusion

No material issues found. All earlier findings CR-1..CR-5 are resolved in the final code; CR-6 and CR-7 are optional low-priority cleanups.

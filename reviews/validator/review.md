# Code Review

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: `git diff 3c0e3cb..HEAD -- ':!tasks' ':!reviews'` (production code, contract, docs, integration and e2e tests of task `validator`)

Requirements:
- tasks/validator.md acceptance criteria and recorded assumptions (#1 check method via `$nor` query, #2 markers in list view + summary line, #3 marks reflect stored documents)
- SPEC.md M3 "Collection validator" and API table (`coll.*`)
- docs/ARCHITECTURE.md (write guard, EJSON contract, renderer never evals, "Validator tab" section)
- AGENTS.md

Git range:
- Branch: main
- HEAD: 0c4d1efd1e8d832f221579212fe13b28c5197d7b
- Base/start: 3c0e3cbe86b245e9e551fc2aed38cb292f270599
- Commits reviewed: 3 (c1274e5, b39cd00, 0c4d1ef); working tree clean

Summary: 0 P0, 0 P1, 2 P2, 3 P3

Verified as correct:
- `coll.validator.check` evaluates the validator on the server (`{ _id: { $in }, $nor: [validator] }`), no Ajv or client-side schema evaluation; the renderer parses the editor text with core's shell-syntax parser (no eval).
- `coll.validator.set` is `write: 'always'` in the contract, goes through `guardWrites` in the backend and `WriteGuard.run` in the renderer; `check` is a read and cancellable.
- `_id` round trip is lossless: batches are decoded with `promoteValues: false`, the result is canonical EJSON, and the renderer compares keys produced by the same core `stringifyEJson` that `documentKey` uses (int test covers Int32 and string `_id`s).
- `ValidatorMarks.check` aborts the previous request, so an older (or failing) answer cannot overwrite a newer one; the empty-page path also aborts.
- `MAX_VALIDATOR_CHECK_IDS` (1000) is above the largest page size (500); the renderer also slices to it.
- Validator tabs are closed with their collection on drop/rename (`closeTabs`).
- Integration test (8.x RS and 7.0 standalone) sets a validator and asserts the invalid documents are flagged by the check method; e2e test edits the validator in the tab and asserts `doc-invalid` markers on exactly the failing documents. Both criteria are covered by the tests in the repository; `tasks.py verify validator` shows neither criterion recorded yet (the parent must run and record them).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A failing validator check is silent and looks like "all documents pass"**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:84`
    - Category: Correctness
    - Problem: When `coll.validator.check` fails (e.g. no `listCollections`/`find` privilege, `NOT_CONNECTED`, a server error), `check()` clears `invalid` and stores the message in `error`, but neither `error` nor `hasValidator` is read anywhere (`collection-view.html` only renders `invalidText()`, which is `null` for an empty set). The collection tab then shows no markers and no summary, which is indistinguishable from "every document on this page satisfies the validator".
    - Why it matters: The feature's purpose is to tell the user which documents fail; a failed check gives a false negative with no error and no way to retry other than re-running the query.
    - Suggested fix: Render `validator.error()` in the collection tab (e.g. next to `validator-summary`, `role="alert"`) or drop the unused signals; add a unit test for the error path.

- [ ] **CR-2 | New renderer and backend logic has no unit tests**
    - File: `packages/renderer/src/app/validator/validator.model.ts:45`, `packages/renderer/src/app/validator/validator-marks.service.ts:64`, `packages/renderer/src/app/validator/validator-view.ts:165`, `packages/backend/src/browse/validator/validator.ts:53`
    - Category: Tests
    - Problem: The diff adds no `*.spec.ts` for `parseValidatorText`/`validatorText` (empty text and `{}` -> `null`, parse errors), `invalidKeys`, `ValidatorMarks` (stale-answer drop, CANCELLED handling, error path, empty page), `ValidatorView` (dirty, revert, save -> `ValidatorChanges.changed`, CANCELLED not shown), or the backend `parseIds` limit (> `MAX_VALIDATOR_CHECK_IDS` -> `INVALID_PARAMS`) and `parseValidator` rejecting non-documents. Only contract samples, the handler list, the int test and the e2e test exercise the code; none covers these edge/error paths.
    - Why it matters: `npm run check` (the `.taskcheck`) runs unit tests only, so regressions in these paths would pass the gate.
    - Suggested fix: Add focused unit specs for the functions and services above (the test-writer run for this task is the natural place).

## P3 Low

- [ ] **CR-3 | Ctrl+Enter saves even when Save is disabled**
    - File: `packages/renderer/src/app/validator/validator-view.html:241`
    - Category: Correctness
    - Problem: `(keydown.control.enter)="save()"` calls `save()`, which only checks `saving()`; it ignores the `!dirty()` and read-only conditions that disable the Save button. Unchanged text sends a no-op `collMod` (with a confirmation on production profiles), and on read-only profiles it produces a `READ_ONLY` error message instead of doing nothing.
    - Why it matters: Keyboard and button behaviour diverge; an unnecessary write prompt on production profiles.
    - Suggested fix: Return early in `save()` when `!dirty()` (and when the profile is read-only), or guard the key binding the same way as the button.

- [ ] **CR-4 | Edits typed while a save runs are overwritten**
    - File: `packages/renderer/src/app/validator/validator-view.ts:188`
    - Category: Correctness
    - Problem: The textarea and selects stay enabled while `saving()`; after `coll.validator.set` resolves, `reload()` unconditionally sets `text`, `level` and `action` to the server's values, discarding anything changed in the meantime.
    - Why it matters: Silent loss of user input (small window, but includes the time the write-confirmation dialog is open on production profiles if the editor stays focusable).
    - Suggested fix: Disable the inputs while saving, or only replace fields that still equal what was sent.

- [ ] **CR-5 | Any validator change re-checks every open collection tab**
    - File: `packages/renderer/src/app/validator/validator-marks.service.ts:28`
    - Category: Quality
    - Problem: `ValidatorChanges.version(target)` reads the whole `versions` map signal, so the effect in `collection-view.ts:369` re-runs (and sends `coll.validator.check`) in every open collection tab when any collection's validator is saved.
    - Why it matters: Unnecessary server round trips proportional to open tabs; the intent (per-collection bump) is not what the signal dependency expresses.
    - Suggested fix: Wrap the lookup in a `computed` per target in the collection view (so equal versions don't propagate), or keep one signal per namespace key.

## Review conclusion

Material issues found; fix before completing the task. (No P0/P1; CR-1 and CR-2 should be resolved or explicitly dispositioned, P3 items are optional.)

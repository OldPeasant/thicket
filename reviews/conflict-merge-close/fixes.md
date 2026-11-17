# Fix Report

Date: 2026-11-17

Task: conflict-merge-close - Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)

Scope: current task. Task commit 0c620cd on base 6d75b31879dbf63a071886890313241c4f33c4d2, plus the uncommitted test-writer changes in `packages/renderer/src/app/document/document-editing.spec.ts` (kept unchanged). Findings from `reviews/conflict-merge-close/review.md`.

## Fixed findings

### CR-1 - Deleted/unknown tests do not show that the effect resets `mergeKey`, only that the template hides the editor

Files changed:
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
The existing "Save merged finds the document deleted" and "cannot read" tests pass even without the closing `effect(...)` in `ConflictView`, because `merging()` hides the editor whenever the conflict is not in the "changed" state. No test covered the case where the same conflict entry later becomes "changed" again without being removed. `DocumentActions.failed()` replaces the map entry in place, so without the effect the stale `mergeKey`/`mergeText` would bring back the old merge editor and its text.

Fix:
Added the test "stays closed when the deleted conflict changes in place to a readable version" to the CR-7 describe. The test opens Merge, types `{ _id: 1, total: 15, qty: 77 }`, and then runs Save merged, which gets a CONFLICT with `current: null` (deleted title shown). Next, an edit-bar save (total 19) fails with a CONFLICT that carries a readable server version (total 99), so the conflict entry is replaced in place. The test then asserts that the title is "Changed on the server", that Keep server / Overwrite / Merge are offered, and that no merge editor, Save merged or Cancel is shown. Finally it opens Merge and checks that the text contains `total: 19` and does not contain `qty: 77`. Production code is unchanged.

Validation:
- `npx ng test --include='src/app/document/**/*.spec.ts'` (from packages/renderer): Pass, 6 files, 254 tests.
- Mutation check: I temporarily replaced `untracked(() => this.closeMerge())` in the `ConflictView` constructor effect with `untracked(() => undefined)`, which disables the effect's closing behavior. The new test then failed with "expected <textarea> to be null", along with the 4 existing revert/edit-bar-save/syntax-error CR-7 tests: 5 failed, 249 passed. I then restored the line. `git status` shows `conflict-view.ts` unmodified, and the rerun passed 254/254.

## Not fixed

None.

## Validation summary

Focused tests:
- `npx ng test --include='src/app/document/**/*.spec.ts'` - Pass (254/254), after the effect was restored.

Full test suite:
- `npm run check` (root, as named by `.taskcheck`) - Pass: root vitest 64 files / 3530 tests, renderer `ng test` 80 files / 2429 tests.

Lint/type-check/build:
- `npm run check` includes eslint (max-warnings 0), prettier --check, tsc for all workspaces, and ngc for the renderer - Pass.

`.taskcheck`:
- Pass. Its command (`npm run check`) was run directly from the repo root.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

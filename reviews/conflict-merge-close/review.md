# Code Review

Date: 2026-11-17

Task: conflict-merge-close - Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)

Scope: round 2, final code. Commits 0c620cd (fix and tests) and c575ff4 (more CR-7 tests from the test-writer and the fixer's CR-1 test, plus reports) on top of base 6d75b31879dbf63a071886890313241c4f33c4d2. Production change: `packages/renderer/src/app/document/conflict/conflict-view.ts`. Tests: `packages/renderer/src/app/document/document-editing.spec.ts`.

Requirements:
- `tasks/conflict-merge-close.md` acceptance criteria
- `reviews/conflict-ui/review.md` CR-7 (background, as named by the task)
- `AGENTS.md` project notes
- Existing conventions in `packages/renderer/src/app/document/document-actions.service.ts`

Git range:
- Branch: main
- HEAD: c575ff46fb36f8dda41c34d9b598ff60739ebdfe
- Base/start: 6d75b31879dbf63a071886890313241c4f33c4d2
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Round 2 review notes (no finding)

- Production code is unchanged since round 1: `git diff 0c620cd..c575ff4 -- packages` touches only `document-editing.spec.ts` (+122 lines).
- Round 1 CR-1 is resolved. The new test "stays closed when the deleted conflict changes in place to a readable version" covers the transition that only the effect handles. Its comment says the entry is replaced, not removed, and that is accurate: `DocumentActions.failed()` replaces the map entry in place (`document-actions.service.ts:451`), and `dropConflict` runs only after a successful write (`document-actions.service.ts:344`). Without the effect, `mergeKey` would still point at order 1, and `merging()` would bring the stale editor back once the state is "changed" again. The fixer's mutation check in `fixes.md` (5 tests fail with the effect disabled) is consistent with this.
- The test-writer's added tests cover more cases:
  - a server version that cannot be read (state unknown) closes the editor;
  - an earlier merge syntax error does not show on a later conflict;
  - with conflicts on two documents, the open editor on order 1 keeps its typed text and still saves the correct update/expected when order 2 is reverted, kept from the server, overwritten, or found deleted. This shows the effect only reacts to its own key.
- AC1: covered by component tests through the real `CollectionView` for header revert, Revert all, a successful edit-bar save, and Save merged finding the document deleted (plus unknown).
- AC2: the revert, Revert all, edit-bar-save, in-place and syntax-error tests all start a later conflict on the same document. They check that Keep server / Overwrite / Merge are offered and that the merge text is fresh (new `total`, the typed `qty: 77` gone, no error, no `aria-invalid`).
- `closeMerge()` now also clears `mergeText`, and `openMerge()` always re-seeds it. Running `closeMerge` in `untracked` avoids a write-in-effect loop: the rerun returns early because `mergeKey` is null.
- `isChanged()` repeats the "changed" rule from `item()`. The duplication is small and local, so it is not reported.
- Focused run (from `packages/renderer`): `npx ng test --include='src/app/document/**/*.spec.ts'` -> 6 files, 254 tests passed.
- At review time, `python tasks.py verify conflict-merge-close` shows both criteria still unverified. The parent worker records that evidence before `done`.
- No security-relevant changes. No new dependencies. Conflict state still has a single owner (`DocumentActions`).

## Review conclusion

No material issues found.

---

# Round 1 (history)

Date: 2026-11-17

Scope: task commit 0c620cd on top of base 6d75b31879dbf63a071886890313241c4f33c4d2 (one commit).

Git range:
- Branch: main
- HEAD: 0c620cd
- Base/start: 6d75b31879dbf63a071886890313241c4f33c4d2
- Commits reviewed: 1

Review limitation: shell access was denied in that session, so the review was done from the current file contents and the scope supplied by the parent worker.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P3 Low

- [x] **CR-1 | Deleted/unknown tests do not show that the effect resets `mergeKey`, only that the template hides the editor**
    - File: `packages/renderer/src/app/document/document-editing.spec.ts:580`
    - Category: Tests
    - Problem: The deleted and unknown tests only check that the editor is hidden while the state is not "changed". `merging()` already does that, so these tests would pass without the effect. No test covered the same conflict entry becoming "changed" again without being removed. `failed()` replaces the entry in place.
    - Why it matters: If the effect were removed or narrowed, the tests would still pass and the stale merge text could come back.
    - Suggested fix: Extend the deleted test with a later edit-bar save conflict that carries a readable version, and assert fresh resolutions and merge text.
    - Resolution (round 2): fixed in c575ff4 by the test "stays closed when the deleted conflict changes in place to a readable version". Verified in round 2.

Round 1 conclusion: No material issues found.

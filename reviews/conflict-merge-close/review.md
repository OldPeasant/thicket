# Code Review

Date: 2026-11-17

Task: conflict-merge-close - Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)

Scope: task commit 0c620cd on top of base 6d75b31879dbf63a071886890313241c4f33c4d2 (one commit), changed files `packages/renderer/src/app/document/conflict/conflict-view.ts` and `packages/renderer/src/app/document/document-editing.spec.ts`, as named by the parent worker.

Requirements:
- `tasks/conflict-merge-close.md` acceptance criteria
- `reviews/conflict-ui/review.md` CR-7 (background, as named by the task)
- `AGENTS.md` project notes
- Existing conventions in `packages/renderer/src/app/document/document-actions.service.ts`

Git range:
- Branch: main
- HEAD: 0c620cd
- Base/start: 6d75b31879dbf63a071886890313241c4f33c4d2
- Commits reviewed: 1

Review limitation: shell access was denied in this review session, so `git diff`, `git log`, `python tasks.py verify` and the test suite could not be run. I reviewed the current contents of both changed files in full, plus `document-actions.service.ts` (which owns the conflict state the view reacts to). The commit range and changed-file list come from the parent worker. I could not inspect the recorded verification evidence.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Deleted/unknown tests do not show that the effect resets `mergeKey`, only that the template hides the editor**
    - File: `packages/renderer/src/app/document/document-editing.spec.ts:580`
    - Category: Tests
    - Problem: The "Save merged finds the document deleted" and "cannot read" tests only check that the merge editor is gone while the conflict is still in the deleted or unknown state. `merging()` (`conflict-view.ts:376-378`) already hides the editor whenever `item.state !== 'changed'`, so these tests would pass even without the new effect (`conflict-view.ts:367-372`). The effect's purpose in this case is to clear `mergeKey` and the stale `mergeText`, so the editor does not come back if the same conflict entry later becomes "changed" again without being removed. One example is a later edit-bar save whose CONFLICT carries a readable server version: `failed()` replaces the map entry in place (`document-actions.service.ts:451`). No test covers that transition. The revert and edit-bar-save tests do exercise the effect, because there the conflict is removed and re-created.
    - Why it matters: If someone later removes the effect or narrows it to the "removed" case only, the deleted/unknown tests would still pass, and the stale merge text would come back in that transition.
    - Suggested fix: Extend the deleted test. After Save merged returns a deleted conflict, make a further edit-bar save fail with a CONFLICT that carries a changed server version (e.g. `orderText(1, 50, 1)`). Then assert that Keep server / Overwrite / Merge are offered and that opening Merge shows the current local text, not the earlier typed merge text.

## Review notes (no finding)

- AC1: The effect closes the editor when the conflict under `mergeKey` is removed, or when its `current` is `null` (deleted) or `undefined` (unknown). `closeMerge()` runs through `untracked`, and the rerun it triggers returns early because `mergeKey` is `null`. Revert from the header, Revert all, a successful edit-bar save (`send` drops the conflict before the async read-back) and the deleted/unknown merged-save cases are all covered by component tests through the real `CollectionView`.
- AC2: The revert, Revert all and edit-bar-save tests create a later conflict on the same document. They check that Keep server / Overwrite / Merge are offered and that the merge text is fresh (new `total`, earlier typed `qty: 77` gone).
- When an edit-bar save or a merged save conflicts again with a newer readable version, the editor stays open with the user's merge text. This matches the existing "merged save conflicts again" behavior and the diff rows update to the new server version. The acceptance criteria do not ask for a change here.
- No security-relevant changes. No new dependencies. Conflict state still has a single owner (`DocumentActions`), and the view only reacts to it.

## Review conclusion

No material issues found.

# Code Review

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 4, the final code after the round-3 fixes)

Scope: `git diff 679b60f7..HEAD -- packages test` (all 8 task commits, 77a5263b..30768702), with focus on the round-3 fix commit 30768702 (`git diff 5746bd3f..30768702`). Committed changes only. Uncommitted test-writer files, made in parallel, are not reviewed.

Requirements:
- tasks/undo-last-save.md (2 acceptance criteria, 6 recorded assumptions, including the round-3 ones: multi-edit not tracked, repeated top-level keys refused)
- SPEC.md "Undo last save" (Should: keep the pre-save version and write it back with the same conflict check)
- docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions: review the whole task diff, focusing on `keepingOrder`/`send` refusing an undo replace when the whole-document check can't be built (TW-1) and the `SavedVersion.after` comment (round-3 CR-2)
- Earlier reports: reviews/undo-last-save/review.md (round 3), tests.md, fixes.md (round 3)

Git range:
- Branch: main
- HEAD: 3076870218b4302f870ab3849256cb3489d995a2
- Base/start: 679b60f71b5a30b1dfdfd62e3e2223603b0c97ba
- Commits reviewed: 8 (code changes since round 3: 30768702 only; 5746bd3f and d9dcf09a add tests and reports)
- Uncommitted changes: none at review time

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## What was checked

- **TW-1 fix: correct and safe.** `keepingOrder` (`document-actions.service.ts:720-740`) now returns `null` when the diff is a `replace` and `wholeDocumentCheck` can't be built. `send` (`:448-451`) refuses on `null` with `UNDO_REPEATED_KEYS_REFUSED` before the partial check, before `WriteGuard` and before the busy flag is set. Nothing is written, no confirm dialog opens and nothing is left busy. `null` can only come from the `keepOrder && !partial` branch, so Save, Overwrite and Merge are unchanged (they use `SAVE_OPTIONS` without `keepOrder`). The undo entry is kept, the same as for the partial refusal. This fits the recorded assumption. The undo's replace can no longer write every field under a check of only the changed fields, so AC2 holds for repeated top-level keys.
- **Return type:** `send`'s `diff` narrows correctly after the `null` guard. `overwritesHiddenData` / `unsetsUnloaded` still receive a non-null diff, and type checking passes.
- **Tests:** the three tests in `describe('a document with repeated top-level keys')` (`undo-last-save.spec.ts:911-965`) now assert the exact refusal text, an unchanged server document (including the `status: "shipped"` server change), that only the save's replace was sent, and that the undo is still offered. The earlier expectation of success was not weakened to hide a bug. The required behavior changed, per the parent's decision recorded as an assumption, and the server-unchanged assertion (the AC2 requirement) is kept.
- **CR-2 (round 3): fixed.** `save-history.ts:9` now says `after` is the document as the server stored it, with a pointer to `recordSave`.
- **Nested repeated keys (checked as a side path):** in an embedded document they make core `$set` the whole parent (an update), and they never reach the `null` branch. If the order-restoring replace is used, the whole-document `$expr` compares the embedded literal. The worst case is a false conflict, and nothing is overwritten.
- The rest of the task diff was reviewed in rounds 1-3 and is unchanged since round 3, apart from the lines above. I re-read `undoSave`, `recordSave`, `send`, `keepingOrder`, `wholeDocumentCheck` and `savedVersion` in full and found no new issues.
- Unit tests run by this review: `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` -> 11 files, 365 passed.
- Not run: e2e. The parent runs it, per instructions. It has no repeated-key case, because the MongoDB driver does not round-trip repeated keys easily. The unit tests cover this path.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The "update stays the minimal one" branch for repeated keys can't be reached, and the recorded assumption describes it as real behavior**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:727` (and the `keepingOrder` doc comment at `:716-718`); `tasks/undo-last-save.md:28`
    - Category: Quality
    - Problem: `wholeDocumentCheck(original)` returns `null` only when `original` (`last.after`) has repeated top-level keys. In that case core `diffFields` (`packages/core/src/diff/diff.ts:143`) always returns `'replace'` at the top level, so `pending.diff` is never an `update` there. The `diff.kind === 'update' ? diff : null` fallback is therefore dead code. Any undo of a document whose saved version has repeated top-level keys is refused. The assumption line, "a minimal update undo is still sent", and the comment, "an update stays the minimal one", suggest a case that never happens.
    - Why it matters: Humans review assumptions. They may think some repeated-key undos still go through, but none do. The behavior itself is safe.
    - Suggested fix: Optional. Return `null` whenever the check can't be built, or keep the code and reword the comment. In either case, correct the assumption text (via the parent's normal assumption workflow) to "an undo of a document whose saved version has repeated top-level field names is always refused".

## Review conclusion

No material issues found.

The round-3 fix (TW-1 refusal) and the CR-2 comment fix are correct, minimal and covered by unit tests. The single P3 finding is an optional wording and dead-code cleanup. The parent worker decides its disposition.

# Code Review

Date: 2026-11-17

Task: conflict-reinsert-rule - Conflict view: one re-insert rule shared with DocumentActions

Scope: final task code at revision 0076d8f3. This covers the production commit fe0d5bc4 (rebased c3c1326b; `git range-diff` shows the patch unchanged) and the test-writer commit 0076d8f3. Files: `packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`, `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`, `packages/renderer/src/app/document/document-actions.service.spec.ts`

Requirements:
- tasks/conflict-reinsert-rule.md acceptance criteria
- reviews/conflict-partial-docs/review.md CR-4 (background)
- SPEC.md "Conflict detection"
- docs/ARCHITECTURE.md, AGENTS.md, existing conventions in the document/conflict code

Git range:
- Branch: main
- HEAD: 0076d8f3 (reviewed revision)
- Base/start: a36efaf4 (parent of fe0d5bc4; originally 2e1f1933 before the rebase)
- Commits reviewed: 2 (fe0d5bc4 production, 0076d8f3 tests and test report)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Verification notes

- AC1 (one rule, in the service only): `DocumentActions.reinsertBlocker(key)` is the only place that decides re-insert. `resolveWith` uses it for the refusal and its message, and `ConflictView.item()` uses it for `blocked` when `conflict.current === null`. The view no longer has its own `conflict.cut !== undefined` check. I checked that the new rule matches the old refusal. The old code refused on `isPartial(key) || cut`. The new code returns `'projection'` when `cut === undefined` and a projection is active, otherwise `'partial'` when `cut || isPartial(key)`. Because `isPartial` already includes "projection active", both cover the same cases. The message choice (`PROJECTION_REINSERT_REFUSED` for an active projection without a cut, `PARTIAL_REINSERT_REFUSED` otherwise) is the same as before.
- AC2 (component test): `conflict-view.spec.ts` covers three cases:
  - A document deleted under an active projection: no "Insert your version again", one note explaining why, and "Keep it deleted" is offered.
  - The same case after the projection was cleared: `reinsertBlocker` returns `'partial'`, the same note appears and `overwrite` is refused.
  - A whole document with no projection: the button is still offered.

  In all three, `overwrite` sends no `docs.insert`.
- Template: the note for a deleted document now comes before the `'projection'` and `'partial'` notes for Overwrite and Merge, so a deleted document never shows the Overwrite/Merge wording. The overwrite button still depends on `item.blocked === null`.
- Reactivity: `reinsertBlocker` reads the same signals (`conflictMap`, host `projection()`, edits) as `resolveBlocker`, which the `items` computed already used. This adds no new staleness.
- Tests added in 0076d8f3 (`document-actions.service.spec.ts`, 11 cases): the unit tests exercise every branch of `reinsertBlocker`:
  - It returns null when there is no conflict, when the server version changed or could not be read, and after the conflict is resolved.
  - It returns null for a whole deleted document, and `overwrite` then inserts it.
  - It returns `'projection'` under inclusion, exclusion and dotted projections, including the cases where `resolveBlocker` would allow them.
  - It returns `'partial'` after the projection was cleared.
  - A cut deleted document stays `'partial'` even under a projection, and the cut wording is used.
  - A cut document whose server version changed returns null.

  The tests check visible behavior: the result, the refusal message, and that no request is sent. Mocks only stand in for IPC, so they do not hide the rule under test. No existing tests were weakened or removed.
- Ran `npx ng test --include src/app/document/document-actions.service.spec.ts --include src/app/document/conflict/conflict-view.spec.ts` (from packages/renderer) at 0076d8f3: 2 files, 162 tests passed.

## Review conclusion

No material issues found.

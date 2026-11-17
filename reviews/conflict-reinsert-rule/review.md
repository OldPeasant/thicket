# Code Review

Date: 2026-11-17

Task: conflict-reinsert-rule - Conflict view: one re-insert rule shared with DocumentActions

Scope: production code of task commit c3c1326b (`git diff 2e1f1933 c3c1326b`): `packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`, `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`

Requirements:
- tasks/conflict-reinsert-rule.md acceptance criteria
- reviews/conflict-partial-docs/review.md CR-4 (background)
- SPEC.md "Conflict detection"
- docs/ARCHITECTURE.md, AGENTS.md, existing conventions in the document/conflict code

Git range:
- Branch: main
- HEAD: c3c1326b
- Base/start: 2e1f1933
- Commits reviewed: 1

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

- AC1 (one rule, in the service only): `DocumentActions.reinsertBlocker(key)` is the only place that decides re-insert. `resolveWith` uses it for the refusal and its message, and `ConflictView.item()` uses it for `blocked` when `conflict.current === null`. The view no longer has its own `conflict.cut !== undefined` check. I checked that the new rule matches the old refusal: the old code refused on `isPartial(key) || cut`, and the new code returns `'projection'` when `cut === undefined && projection active`, otherwise `'partial'` when `cut || isPartial(key)`. Because `isPartial` already includes "projection active", both cover the same cases. The message choice (`PROJECTION_REINSERT_REFUSED` for an active projection without a cut, `PARTIAL_REINSERT_REFUSED` otherwise) is the same as before.
- AC2 (component test): `conflict-view.spec.ts` covers three cases. (1) A document deleted under an active projection: no "Insert your version again", one note explaining why, and "Keep it deleted" is offered. (2) The same case after the projection was cleared: `reinsertBlocker` returns `'partial'`, the same note appears and `overwrite` is refused. (3) A whole document with no projection still offers the button. In all three, `overwrite` sends no `docs.insert`.
- Template: the note for a deleted document now comes before the `'projection'` and `'partial'` notes for Overwrite and Merge, so a deleted document never shows the Overwrite/Merge wording. The overwrite button still depends on `item.blocked === null`.
- Reactivity: `reinsertBlocker` reads the same signals (`conflictMap`, host `projection()`, edits) as `resolveBlocker`, which the `items` computed already used. This adds no new staleness.
- Ran `npx ng test --include src/app/document/conflict/conflict-view.spec.ts` (from packages/renderer) at c3c1326b: 17 passed.

## Review conclusion

No material issues found.

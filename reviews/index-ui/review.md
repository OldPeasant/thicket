# Code Review

Date: 2026-11-17

Task: index-ui - M3: Indexes tab

Scope: second pass on the final revision; all task commits (`git diff 3a2f9aa..3bd499e`: 7e856b7, b17a5c5, 6b2c038, 3bd499e). Committed changes only; the uncommitted `indexes-view.spec.ts` change from the parallel test-writer was ignored.

Requirements:
- tasks/index-ui.md acceptance criteria (e2e: TTL and partial index created and listed with options; component tests for the create form validation)
- SPEC.md M3 "Index management"
- docs/ARCHITECTURE.md (WriteGuard for writes, `idx.*` contract, theme tokens, "Indexes tab" section)
- AGENTS.md project notes; parent instructions (re-check CR-1..CR-5 and TW-1 against reviews/index-ui/fixes.md)

Git range:
- Branch: main
- HEAD: 3bd499e91de605e396d821e63adeef9c05f98772
- Base/start: 3a2f9aa21b5a65caefd94fa4fa3a1eb508f9985b
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Earlier findings re-checked

- CR-1 (wildcard text index refused): resolved. `index-form.model.ts:143-151` accepts `{ "$**": "text" }`, still refuses text on `path.$**` and 2dsphere/2d/hashed on any wildcard; `wildcards` (line 160) excludes the text `$**`, so weights/language apply and unique/TTL/projection checks treat it as a text index. Projection on it is refused (line 260). Covered by model tests (spec lines 156-175, 497, 535, 565) and component tests (lines 327, 343).
- CR-2 (no IndexesView tests): resolved. Committed `indexes-view.spec.ts` covers `keyParts`, `toRows`, stats failure, list failure, out-of-order answers, drop cancel/confirm/error, busy lock, hide/unhide, read-only and production profiles.
- CR-3 (2d position, collation with text/2d): resolved. Lines 172-173 and 231-232, with tests (spec lines 196, 202, 497, 503).
- CR-4 (Cancel while creating): resolved. `index-create-form.html:283` `[disabled]="saving()"`; component test at line 309.
- CR-5 (`_fts`/`_ftsx` in the list, no text/wildcard tags): resolved. `rowKeys` (`indexes-view.ts:110-117`) rebuilds text fields from `weights`, falls back to raw parts when unreadable; `tagsOf` adds non-English `default_language` and `wildcardProjection`. Tests at spec lines 626-684.
- TW-1 (`.$**` accepted): resolved. `fieldProblem` (lines 104-109) refuses an empty base.

Also re-checked on the final code: all writes still go through `WriteGuard` with `appWriteControl` buttons; `reload()` generation guard unchanged; collection-view, sidebar-tree.service, workspace.service and app.config changes are unchanged since the first review and consistent with the tab registration; docs/ARCHITECTURE.md "Indexes tab" matches the new behavior. The task file still shows criterion 2 (component tests for create form validation) without recorded `verify` evidence; the parent must record it before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | Changing a key type leaves a stale collation or wildcard projection error on screen**
    - File: `packages/renderer/src/app/indexes/index-create-form.ts:122`
    - Category: Quality
    - Problem: The fix made the collation error ("A text index does not support a collation." / "A 2d index ...") and the wildcard projection error ("A wildcard text index has no wildcard projection.") depend on the key types, but `setType` only clears `field.<i>`, `ttl`, `unique`, `weights` and `defaultLanguage`. After a failed Create, switching the offending field from `text`/`2d` to ascending keeps the now-wrong message (with `aria-invalid`) beside the collation or projection input until the next Create.
    - Why it matters: The form shows an error whose cause the user already removed; it does not block the next Create (errors are recomputed), so impact is small, but it is inconsistent with how the other type-dependent errors are cleared.
    - Suggested fix: Add `'collation'` and `'wildcardProjection'` to the `clearError` call in `setType`, with a component test that the collation error disappears after changing a text field to ascending.

## Review conclusion

No material issues found. All earlier findings (CR-1 to CR-5, TW-1) are resolved in the final code; the only new finding (CR-6) is a low-priority cleanup that the parent may fix or record as deferred.

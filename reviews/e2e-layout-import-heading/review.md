# Code Review

Date: 2026-11-17

Task: e2e-layout-import-heading - layout.e2e: welcome Import button test expects a page-heading the import page no longer has

Scope: `git diff 8efeae08..4ed165c7` (task commits 5edd161f and 4ed165c7 on top of the claim base 8efeae08), committed changes only. The task-unrelated commits in the range (a039b717, ec5444f3) touch only other tasks' `tasks/*.md` files and are out of scope.

Requirements:
- tasks/e2e-layout-import-heading.md acceptance criteria and the recorded assumption
- AGENTS.md (task protocol, evidence rules)
- Existing convention: `data-testid="page-heading"` on the page h1 (connection-editor.html), plus unit tests for it in other page specs (connection-editor.spec.ts, welcome.spec.ts)

Git range:
- Branch: main
- HEAD: 4ed165c79046d7f60b190c53c87b24a8ab9fef01
- Base/start: 8efeae088488bc4b4589cbdeb64b997f901dac7d
- Commits reviewed: 2 task commits (5edd161f, 4ed165c7). The range holds 5 commits; 3 of them only change `tasks/` files.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Notes

- Criterion 1: `packages/renderer/src/app/connections/import/import-export-page.html:3` adds
  `data-testid="page-heading"` to the h1. It keeps `id="transfer-title"`, which the section's
  `aria-labelledby` needs.
- Criterion 2: `test/e2e/layout.e2e.ts:47` now expects 'Import and export connections'. The route
  `connections/import/compass` loads `ImportExportPage`, so this is the heading the user actually sees.
  The welcome page has no `page-heading`, so the locator matches exactly one element under strict mode.
  The fix changes the test and leaves the page heading as it is. That matches the recorded assumption.
- The new unit test (`import-export-page.spec.ts:91-97`) uses the spec's existing `start`/`one`/`all`
  helpers. It checks behavior, not implementation details: exactly one `page-heading`, the element is an
  `H1`, and its text is right. The exact `textContent` comparison is safe because the h1 contains only
  the literal text with no surrounding whitespace. Without the template change, `one()` throws, so the
  test fails on the base revision and catches a regression without the slow e2e suite.
- No other test still expects 'Import from Compass' from `page-heading`. The text remains as the welcome
  button label, and that use is still correct.
- Evidence: `python tasks.py verify e2e-layout-import-heading` still lists all 3 criteria as
  unverified. The parent worker must record the actual `npm run test:e2e -- layout.e2e.ts` and
  `npm run check` runs. tests.md says the test-writer did not run the e2e test itself. A unit run is not
  evidence for criterion 2.

## Review conclusion

No material issues found.

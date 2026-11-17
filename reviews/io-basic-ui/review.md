# Code Review

Date: 2026-11-17

Task: io-basic-ui - M1: Import/export dialogs

Scope: second review, of the final revision of the task: `git diff 01305873..HEAD`. The range holds 287efb6 (export and import panels), 6337384 (e2e and read-only tests), b5c2913 (reuse of the collection view's `readOnly` signal), 3f5d06d (unit tests, test report, first review), 4722356 (fixes for TW-1 and CR-1..CR-4) and 6533158 (a `tasks/`-only verify commit). 4722356 is the rebased copy of 78316e4. `git diff 78316e4 4722356` differs only in `tasks/io-basic-ui.md`. Uncommitted spec files that a test-writer adds in parallel are out of scope. The backend (`packages/backend/src/io`) and the contract (`packages/contract/src/io.ts`) came from an earlier task, and I read them only as context.

Requirements:
- tasks/io-basic-ui.md: both acceptance criteria and the 3 recorded assumptions (panels in the collection tab, import defaults and target, read-only behavior)
- SPEC.md M1 "Import / export (basic)"
- docs/ARCHITECTURE.md (API, collection tab, write safety through `WriteGuard`)
- AGENTS.md
- The previous review (CR-1..CR-4), reviews/io-basic-ui/tests.md (TW-1) and reviews/io-basic-ui/fixes.md

Git range:
- Branch: main
- HEAD: 4722356ab827a4e12f08c83e7419c862c57e1013
- Base/start: 01305873def284d41f41a923f25d0fd12c685d72
- Commits reviewed: 6 (5 code/test/report commits, 1 tasks-only verify commit)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Fix verification (current code at HEAD):
- TW-1 (an import was sent after the profile turned read-only while the confirm dialog was open): fixed. `import-panel.ts:200-229` passes an `AbortController` signal to `WriteGuard.approve`. `WriteGuard.approve` (`write-guard.service.ts:122-124`) rejects with `CANCELLED` when that signal is aborted. Cancel, close, the read-only effect and destroy abort the signal (`import-panel.ts:118-123`, `251-255`). After approval, `start()` sends nothing if the signal was aborted, the panel was destroyed or the profile is read-only (`:229`). A second `start()` does nothing while a confirmation is pending (`:194`). Tests cover the read-only switch, close and destroy while the confirm dialog is open.
- CR-1 (Import stayed enabled after a finished import and re-imported the same file): fixed. On `complete`, `preview` is cleared (`:244`). The Import button and the file info go away, and the button reads "Choose file…" again. The result count and failures stay visible, because the status text and the failures list use `progress`, not `preview`. A test checks this and also checks that a direct `start()` call sends nothing. After a cancelled or failed import, the file stays chosen on purpose so the user can retry. That retry is a deliberate action.
- CR-2 (the tab was not refreshed after a cancelled or failed import): fixed. `ended()` (`:276-280`) emits `imported` with the inserted count and reloads the sidebar, on complete, on stream error and on cancel. `CollectionView.imported` (`collection-view.ts:426-428`) re-runs the applied query when the target is the tab's collection. The coll name read in `cancel()` (`:261`) is reliable, because the name input is disabled while `busy()` (`import-panel.html:66`). Covered in `collection-view.spec.ts` ("a cancelled import into the tab collection also runs the query again"), and the panel spec's assertions for error and cancel were updated.
- CR-3 (shell text was wrong for collection names that are not identifiers): fixed. `collRef` (`io.util.ts:64-72`) prints `db.<name>` only for JavaScript identifiers and `db.getCollection("<JSON-quoted name>")` otherwise. `describeExport` and the import header (`collText`, `import-panel.ts:94-97`) use it. Unit tests cover dashes, spaces, dots, quotes, backslashes and non-ASCII names. One leftover limit: a name that is also a `db` method (e.g. `stats`) still prints the short form. The fixer already noted this. It affects only displayed text and is very rare, so it is not a finding.
- CR-4 (the export header followed the live query while an export ran): fixed. `start()` saves `sentCommand` (`export-panel.ts:95`). `command` shows that saved command in `running`, `done` and `cancelled`, and shows the live query in `idle` and `error`, where it describes what the next export would send (`:64-73`). A test changes the query during a running export, checks the header, and then checks that the next export sends the new query.

Other checks on the final revision:
- No regressions to the behavior confirmed in the first review: export params, a cancelled save dialog, late stream-id cancel, read-only hiding of Import, protection against stale preview responses, and double-submit protection.
- Focused renderer tests run in this review: `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` -> 4 files, 103 tests passed.
- Criterion evidence in `tasks/io-basic-ui.md`: criterion 1 has an e2e run recorded (`npm run test:e2e -- test/e2e/io.e2e.ts`, mongo8 fixture). That run was recorded before the fix commit. The parent reports that it ran again after the fixes and passed, and fixes.md records the same. The fixes do not change the panels' e2e-visible flow for an identifier collection name (`orders`, `orders_copy`, `group1`). Criterion 2 has a recorded unit-test run that names the read-only test.
- I did not run ESLint or Prettier in this review, because the command was not permitted in this session. fixes.md reports that `npm run check` passed, including lint and `prettier --check`. The parent's `.taskcheck` run before `done` covers this.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. TW-1 and CR-1..CR-4 are fixed in the current code and covered by tests. The final revision raises no new findings.

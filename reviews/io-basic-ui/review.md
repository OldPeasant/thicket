# Code Review

Date: 2026-11-17

Task: io-basic-ui - M1: Import/export dialogs

Scope: committed changes of the task after its rebase onto main, `git diff fc553f5..afb68d8` (3d9869a export and import panels, 364d2bb e2e and read-only tests, afb68d8 reuse of the collection view's `readOnly` signal after the raw-editor merge). Unit specs under `packages/renderer/src/app/io` that the test-writer is adding (uncommitted `io.util.spec.ts`) are out of scope. The backend (`packages/backend/src/io`) and contract (`packages/contract/src/io.ts`) came from an earlier task and were read only as context.

Requirements:
- tasks/io-basic-ui.md acceptance criteria and the 3 recorded assumptions (panels in the collection tab, import defaults and target, read-only behavior)
- SPEC.md M1 "Import / export (basic)"
- docs/ARCHITECTURE.md (API, collection tab, write safety through `WriteGuard`)
- AGENTS.md
- Existing conventions in `packages/renderer/src/app/safety/operation.ts`, `sidebar-tree.service.ts`, `api.service.ts`

Git range:
- Branch: main (2 task commits plus 1 fix commit ahead of origin/main)
- HEAD: afb68d85e56f82da4b91a3dc64a0d84a72041f22
- Base/start: fc553f5 (originally 5340f46; the parent rebased the same patch onto main, and the earlier commits 60e88fd/d90f400 match 3d9869a/364d2bb)
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 0 P2, 4 P3

Checked and found correct:
- Export sends the query applied in the tab (`results.query()`, not the text in the query bar): filter, projection, sort, collation and limit (`limit > 0` only). It sends the chosen format and EJSON mode. The params match the strict `io.export` schema.
- When the save dialog is cancelled (`streamId: null`), the panel goes back to idle. If the user cancels before the stream id is known, the stream is still cancelled, because `ApiService.stream` cancels a late `streamId`. Destroying the panel unsubscribes.
- Import goes through `WriteGuard.approve` (read-only is refused and production asks for confirmation) and then `ApiService.stream`. `CANCELLED` is handled quietly and other errors are shown. The panel checks the collection name with the sidebar's `collNameProblem`. After an import it reloads the sidebar's collections so a new collection appears.
- Read-only: the Import button is not rendered (`collection-view.html` `@if (!readOnly())`), an open import panel is removed, and the panel also refuses and closes itself. Export stays available. Covered by `collection-view.spec.ts` "does not offer import on a read-only profile, and closes an open import panel".
- Old preview responses cannot overwrite newer state: `choose()` checks its own `AbortController` and is blocked while busy. A double click on Import cannot start two imports, because the button turns into Cancel as soon as the phase is `importing`.
- After the raw-editor merge, `collection-view.ts` has a single `readOnly` computed, and the template uses it for both the raw editor and the import controls.
- `eslint --max-warnings 0` passes on the changed files and `prettier --check` passes on all committed changed files.
- The e2e test (`test/e2e/io.e2e.ts`) seeds 1 234 documents with long, decimal, date and ObjectId values. It exports them as canonical JSON, imports them into a new collection, and checks the count and that the documents are deep-equal. It then does a filtered JSONL relaxed round trip. This matches criterion 1. It still has to be run against the real stack and recorded with `tasks.py verify`: no criterion has evidence yet, and `verify io-basic-ui` shows both unchecked.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Import stays enabled after a finished import and re-imports the same file**
    - File: `packages/renderer/src/app/io/import-panel.ts:98`
    - Category: Correctness
    - Problem: `canImport` only requires `preview() !== null && !busy() && !readOnly()`. After `complete`, the phase is `done` but the preview and its `fileToken` are kept. The Import button (`import-panel.html:101-102`) is enabled again. The backend still accepts the token (it keeps up to `MAX_FILE_TOKENS` = 100), so one more click inserts the same file a second time.
    - Why it matters: Files whose documents have no `_id` (JSON Lines from other tools are common) are silently duplicated. Files with `_id` fail with duplicate-key errors. Both can easily happen after a successful import, for example when the user clicks Import again to check whether it worked.
    - Suggested fix: After `done`, require a new file choice (clear `preview`, or keep it only for display and disable Import), or change the button to "Import again" so a repeat is a clear, deliberate action.

- [ ] **CR-2 | The tab's results are not refreshed after a cancelled or failed import into the tab's collection**
    - File: `packages/renderer/src/app/io/import-panel.ts:210-234`
    - Category: Correctness
    - Problem: `imported` is only emitted in `complete`. The `error` handler and `cancel()` only reload the sidebar. The status text says "Documents already inserted stay", but `CollectionView.imported` (`collection-view.ts:426`) never re-runs the query in these cases.
    - Why it matters: After a partial import into the open collection, its page and count are stale until the user runs the query again manually.
    - Suggested fix: Also emit `imported` (with the inserted count so far) on error and cancel, or emit a separate "changed" output that the collection view handles the same way.

- [ ] **CR-3 | The export/import command preview prints `db.<name>` for any collection name**
    - File: `packages/renderer/src/app/io/io.util.ts:66` (also `packages/renderer/src/app/io/import-panel.html:5-7`)
    - Category: Quality
    - Problem: `describeExport` builds `db.${coll}.find(...)`, and the import header builds `db.<coll>.insertMany(...)`. Names such as `my-orders`, `2024 sales` or `a.b` then produce shell text that is wrong or misleading. Neither preview names the database. The project's existing helper for shown operations (`safety/operation.ts:21-23`) uses `db.getSiblingDB("<db>").getCollection("<name>")` with quoted names.
    - Why it matters: The preview is shown as "the mongosh call it runs". It is wrong for valid collection names and does not match the confirm dialog's description of the same import.
    - Suggested fix: Reuse the same quoting as `operation.ts`, or use the `db.<name>` short form only for names that are valid identifiers and fall back to `getCollection("...")` otherwise.

- [ ] **CR-4 | The export header follows the live query while an export of the previous query is running**
    - File: `packages/renderer/src/app/io/export-panel.ts:64`
    - Category: Correctness
    - Problem: `command` is computed from the `query` input. The collection view binds this input to `results.query()` (`collection-view.html`, `app-export-panel`). If the user runs another query while an export runs, the header shows the new query, while the stream and the final "Exported N documents" message still belong to the query that was sent in `start()`.
    - Why it matters: Small, but the panel then describes the file wrongly (wrong filter or limit) after the export finishes.
    - Suggested fix: Take a snapshot of the described command (or the params) in `start()`, and show the snapshot while the phase is `running`, `done` or `cancelled`.

## Review conclusion

No material issues found. The four P3 findings are optional improvements. Before `done`, the parent worker still needs to run the e2e criterion against the real stack (`npm run test:e2e` with the MongoDB fixture) and record evidence for both criteria with `tasks.py verify`.

# Code Review

Date: 2026-11-17

Task: gridfs - M6 (Could): GridFS (review round 2)

Scope: `git diff 27adc3ab..HEAD` (`27adc3ab` = `git merge-base HEAD origin/main`). Committed changes only. The working tree was clean before and after the review. The parent named HEAD 6709a258. That commit was later rebased to 2043ec33, and the two differ only in `tasks/gridfs.md` (`git diff 6709a258 HEAD --stat`). The round-1 fix commit 64ac4558 is now c732fb1f, again differing only in `tasks/gridfs.md`.

Requirements:
- tasks/gridfs.md (goal, 2 acceptance criteria, 3 recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md ("GridFS" section; renderer never sends file paths; writes guarded in the backend; canonical EJSON; theme tokens only)
- AGENTS.md, parent instructions for round 2
- Round 1: reviews/gridfs/review.md (CR-1..CR-5, now replaced by this report), reviews/gridfs/fixes.md, reviews/gridfs/tests.md (round 2 notes O-1..O-3)
- Driver source `node_modules/mongodb/lib/gridfs/upload.js` (mongodb 7.9.0), used to check the CR-2 fix

Git range:
- Branch: main
- HEAD: 2043ec33b56e421da3674db1310e811e3519db7b (reviewed revision)
- Base/start: 27adc3abd4885ca9a8f0496a7abc21d3a21853d1
- Commits reviewed: 9 (4b14b72b, 5f1855ec, 389f7066, d8e6d24d, 5e6a8e19, 0bfa8383, c732fb1f, b0e1ad46, 2043ec33)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Verification of round 1 findings

- CR-1 (project check red; TW-1/TW-2): resolved. `write-guard.service.ts` now lists `gridfs.delete` in `DESTRUCTIVE` and has `TITLES` entries `Upload file` and `Delete file`. `npx ng test --include src/app/gridfs/gridfs-view.spec.ts` gave 47 passed.
- CR-2 (cleanup raced in-flight driver inserts): resolved. `uploadFile` (`packages/backend/src/gridfs/gridfs.ts:298-338`) no longer passes the GridFS stream through an abortable `pipeline`. It awaits each `write` callback and the `end` callback, and checks the signal only between these steps. I checked the driver source. `doWrite` calls back only after its chunk inserts resolve: the `outstandingRequests` counter covers this, and a 64 KiB read is smaller than a 255 KiB chunk, so a write starts at most one insert. `_final` → `writeRemnant` → `checkDone` calls back only after the files-document `insertOne` resolves. So when `removeFile` runs, no insert of this upload is still in flight. A read-side abort (`createReadStream(..., { signal })`) also lands only between awaited writes. `cancelOnClose` awaits `uploadFile`, so `conn.close` waits for the cleanup too. Cleanup deletes only the id generated for this upload.
- CR-3 (cancel tests never cancelled mid-transfer): resolved. `test/integration/gridfs.int.spec.ts:441-489` cancels after the first progress event, and also at every progress step including the end. It asserts an empty bucket right away and again after a settle. Validator-based tests (lines 491-536) and `gridfs-faults.int.spec.ts` cover server and local-file failures in the middle of a transfer.
- CR-4 (late open recreates the cancelled download file): resolved. `downloadFile` awaits `closeStream(output)` before `rm` (`gridfs.ts:252-256, 263-272`), which follows the `io/export.ts` convention. `gridfs-faults.int.spec.ts:212` holds back the open past the cancel and asserts that no file is left.
- CR-5 (cancel message promised nothing was kept): resolved. `cancelTransfer` (`packages/renderer/src/app/gridfs/gridfs-view.ts:262-267`) says "Cancelled the upload/download of X." and reloads the list after an upload cancel. The spec covers the reload, the no-reload case for downloads, and keeping the chosen bucket.

## Acceptance criteria

- AC1 (integration test: 20 MB upload, download identical by hash): `gridfs.int.spec.ts:180` uploads 20 MB of random bytes through the RPC server with the write guard, checks stepwise progress and the `fileId`, downloads the file, and compares SHA-256. I ran `npm run test:int -- gridfs` (MongoDB 8 Testcontainers fixture): 2 files, 18 passed.
- AC2 (e2e: upload and delete from the UI): `test/e2e/gridfs.e2e.ts` opens the tab from the sidebar database menu, uploads through the stubbed native dialog, checks the row and the stored `length`, downloads and compares the hash, then deletes through the confirm dialog and asserts 0 files and 0 chunks. I ran `npm run test:e2e -- gridfs` (built Electron app, Playwright `_electron`): 1 passed.
- `python tasks.py verify gridfs` still shows both criteria unticked. No criterion is claimed without evidence. The parent still has to record the evidence.

Other runs: `npx vitest run packages/backend/src/gridfs` gave 41 passed. I did not run the full `.taskcheck`; the parent runs it.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Notes (not findings)

- Test-writer O-3 confirmed, not counted. The reload after an upload cancel is sent without waiting for the backend's terminal event. If the cancel arrives while the files document is being written, the reloaded list can briefly show the file that the cleanup is about to remove. The window is a few milliseconds, the next refresh corrects it, and deleting that row answers "was already gone". This needs no fix for this task.
- Test-writer O-2 confirmed, not counted. `stat(source)` (`gridfs.ts:308`) is outside the `try`. If the file vanishes between the handler's `stat` and the stream start, the user sees a generic error message instead of "Could not read …". Nothing is written to the database in this case.
- Test-writer O-1 is accurate. The branch in `closeStream` for a stream that is not yet closed is defensive, because `pipeline` already waits for the close.
- Other checks found no issues. The renderer sends no paths, and the upload/download paths come only from the backend's dialogs. Both writes are guarded in the backend (`write: 'always'`, `guardWrites`) before any dialog opens. Delete always asks (`alwaysConfirm`), and Cancel has the focus. Queries use `$eq` and an escaped regex, and the bucket name refuses `$`/NUL. Ids travel as canonical EJSON and are read without BSON promotion. Stale list responses are dropped through `AbortController`s. Repeated clicks on Upload are blocked by `running`/`transfer`. The template has no `innerHTML`, and the CSS has no hard-coded colours.

## Review conclusion

No material issues found.

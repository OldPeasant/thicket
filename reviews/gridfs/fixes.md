# Fix Report

Date: 2026-11-17

Task: gridfs - M6 (Could): GridFS

Scope: current task; findings CR-1..CR-5 from `reviews/gridfs/review.md` and TW-1/TW-2 from `reviews/gridfs/tests.md`. Task commits 233e4ad1..11c689e6, base 80d5f98f.

All code changes were made in commit 11c689e6 ("gridfs: fix review round 1"). This fixer pass checked each change against the findings and against the driver source (`node_modules/mongodb/lib/gridfs/upload.js`, mongodb 7.9.0). It found nothing incomplete, so it made no further code changes. This report is the only new file.

## Fixed findings

### TW-1 — GridFS delete confirm dialog is not marked destructive

Files changed (in 11c689e6):
- `packages/renderer/src/app/safety/write-guard.service.ts`

Problem:
`gridfs.delete` was not in `DESTRUCTIVE`. The confirm dialog focused OK, so pressing Enter deleted the file.

Fix:
Added `'gridfs.delete'` to `DESTRUCTIVE`, so Cancel now gets the focus.

Validation:
- `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` — Pass (46 passed)

### TW-2 — GridFS confirm dialogs are titled with the raw method name

Files changed (in 11c689e6):
- `packages/renderer/src/app/safety/write-guard.service.ts`

Problem:
`TITLES` had no entries for `gridfs.upload` and `gridfs.delete`.

Fix:
Added `'gridfs.upload': 'Upload file'` and `'gridfs.delete': 'Delete file'`.

Validation:
- `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` — Pass (46 passed)

### CR-1 — The project check fails at HEAD (3 renderer tests red)

Files changed (in 11c689e6):
- `packages/renderer/src/app/safety/write-guard.service.ts`

Problem:
The three tests for TW-1 and TW-2 failed, so `.taskcheck` failed too.

Fix:
Fixed by the TW-1 and TW-2 changes. The tests were not changed.

Validation:
- `sh .taskcheck` (`npm run check`) — Pass: lint and typecheck clean, root Vitest 94 files / 4953 tests passed, renderer 113 files / 3804 tests passed

### CR-2 — A cancelled upload cleans up before the driver's in-flight inserts finish

Files changed (in 11c689e6):
- `packages/backend/src/gridfs/gridfs.ts`

Problem:
`pipeline(..., { signal })` destroyed the GridFS upload stream while chunk inserts or the files-document insert were still running. `removeFile` could then run before those inserts landed, which left stray chunks or a files document without chunks.

Fix:
`uploadFile` no longer gives the GridFS stream to an abortable pipeline. It reads the source with `for await`, awaits each `write` callback (`writeChunk`), awaits the `end` callback (`endStream`), and checks the signal only between these steps. Cleanup (`upload.destroy()` + `removeFile`) runs only after these steps, and only when the upload stream was opened. I checked the driver source. `doWrite` calls back only after its chunk `insertOne` resolves (each read is 64 KiB and a chunk is 255 KiB, so a write starts at most one insert). `_final`/`checkDone` call back only after the files-document `insertOne` resolves. So when cleanup runs, no insert from the upload can still be in flight. If a cancel arrives during the files-document write, the completed file is removed. `ByteCounter` gained `count()` so progress is still reported without the Transform. Since `uploadFile` returns only after cleanup, `cancelOnClose`/`conn.close` also wait for it to settle.

Validation:
- `npm run test:int -- gridfs` — Pass (12 passed, run 3 times, stable)
- `npx vitest run packages/backend/src/gridfs` — Pass (41 passed)

### CR-3 — The upload-cancel integration test never cancels mid-transfer

Files changed (in 11c689e6):
- `test/integration/gridfs.int.spec.ts`

Problem:
The cancel tests cancelled right away, probably before any chunk was written. The cleanup path was never exercised.

Fix:
The upload-cancel and download-cancel tests now wait for the first progress event (`firstEvent`) before cancelling. They assert that some progress was reported and that it is below the full size. They check the cleanup result (no `files`/`chunks`, no target file) both immediately and after a 300 ms settle (`expectNoFile`, `settleWrites`). A new test calls `uploadFile` directly with a 64 KiB progress step and cancels at every progress step of a 600 KiB file, including the step just before the last chunk and the end. After each cancel it asserts `CANCELLED` and an empty bucket.

Validation:
- `npm run test:int -- gridfs` — Pass (12 passed)

### CR-4 — A cancelled download can leave the (empty) target file

Files changed (in 11c689e6):
- `packages/backend/src/gridfs/gridfs.ts`

Problem:
`rm(target)` could run before the asynchronous `createWriteStream` open finished. The late open then recreated the file.

Fix:
`downloadFile` keeps a reference to the write stream. On failure or cancel it awaits `closeStream(output)` (destroy, then wait for `close`, or return at once if already closed) before `rm`. This follows the `closeStream` convention in `io/export.ts`.

Validation:
- `npm run test:int -- gridfs` — Pass (the download-cancel test asserts ENOENT immediately and after a settle)

### CR-5 — Cancel always says "nothing was kept", even if the upload already committed

Files changed (in 11c689e6):
- `packages/renderer/src/app/gridfs/gridfs-view.ts`
- `packages/renderer/src/app/gridfs/gridfs-view.spec.ts`

Problem:
The cancel message promised that nothing was kept, and the list was not reloaded after an upload cancel.

Fix:
The message is now "Cancelled the upload/download of X." without that promise. Cancelling an upload reloads the list. The spec expectations were updated to the new wording, and they now also assert the reload on upload cancel and no reload on download cancel. The behavior changed as the finding requested, so this is not a weakened test.

Validation:
- `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` — Pass (46 passed)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/gridfs` — Pass (2 files, 41 tests)
- `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` — Pass (46 tests)
- `npm run test:int -- gridfs` — Pass (12 tests; run 3 times, all passed)

Full test suite:
- `sh .taskcheck` (`npm run check`) — Pass: root Vitest 94 files / 4953 tests, renderer 113 files / 3804 tests

Lint/type-check/build:
- Included in `npm run check` (lint, then backend/contract/renderer typecheck) — Pass

`.taskcheck`:
- Pass

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

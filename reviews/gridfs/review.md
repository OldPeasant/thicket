# Code Review

Date: 2026-11-17

Task: gridfs - M6 (Could): GridFS

Scope: `git diff c10fccd4..HEAD` (committed changes only; working tree clean)

Requirements:
- tasks/gridfs.md (goal, 2 acceptance criteria, 3 recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md (renderer never sends file paths, every write checked in the backend, canonical EJSON, theme tokens only; "GridFS" section added by this task)
- AGENTS.md, parent instructions (focus on transfer cancel/cleanup, streamOnConnection, progress, write guard ordering, error mapping, renderer transfer state)
- Existing conventions, especially `packages/backend/src/io/export.ts` (cleanup of a cancelled file write)

Git range:
- Branch: main
- HEAD: 3b5094ce0202682f2a19b3d728f88cad4dcf3a62
- Base/start: c10fccd45875c380422f1ada78c7e16442ff14c4
- Commits reviewed: 5 (8876ccb6, 3dfa194e, 95911f20, 08632b7d, 3b5094ce)

Summary: 0 P0, 1 P1, 2 P2, 2 P3

Already reported by the test-writer (reviews/gridfs/tests.md) and confirmed here, not counted
again: TW-1 (`gridfs.delete` is missing from `DESTRUCTIVE` in
`packages/renderer/src/app/safety/write-guard.service.ts:35`) and TW-2 (no `TITLES` entries for
`gridfs.upload`/`gridfs.delete`, write-guard.service.ts:44). I ran
`npx ng test --include src/app/gridfs/gridfs-view.spec.ts` and got 3 failed / 43 passed: the three
tests that fail on purpose because of TW-1/TW-2. Backend and contract units
(`npx vitest run packages/backend/src/gridfs packages/contract`) gave 932 passed.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | The project check fails at HEAD (3 renderer tests red)**
    - File: `packages/renderer/src/app/safety/write-guard.service.ts:35`
    - Category: Tests
    - Problem: At HEAD, three tests in `gridfs-view.spec.ts` fail (destructive delete and dialog titles; TW-1/TW-2). `.taskcheck` runs `npm run check`, which includes the renderer suite, so it fails.
    - Why it matters: `done` cannot pass. The underlying behavior is also a real safety gap: Enter confirms a file delete because the OK button gets focus, and the confirm dialogs are titled `gridfs.delete`/`gridfs.upload`.
    - Suggested fix: Add `gridfs.delete` to `DESTRUCTIVE`, and add `TITLES` entries such as `'gridfs.upload': 'Upload file'` and `'gridfs.delete': 'Delete file'`. Then re-run the renderer suite.

## P2 Medium

- [ ] **CR-2 | A cancelled upload cleans up before the driver's in-flight inserts finish, so chunks or a chunkless files document can be left behind**
    - File: `packages/backend/src/gridfs/gridfs.ts:276-281`
    - Category: Correctness
    - Problem: `pipeline(..., { signal })` rejects as soon as the signal aborts. It destroys the `GridFSBucketWriteStream` and does not wait for that stream's pending writes. In driver 7.9 (`node_modules/mongodb/lib/gridfs/upload.js`, `doWrite`/`writeRemnant`/`checkDone`), a chunk `insertOne` and, during `_final`, the files-document `insertOne` are already started and keep running after the destroy. `removeFile` (line 280) then sends `deleteOne`/`deleteMany` right away, possibly on another pooled connection. If one of those inserts is applied after the delete, a stray chunk remains. If the cancel arrives during `_final`, a files document remains whose chunks were deleted: a corrupt file that the list shows as a normal file, while the user was told the upload was cancelled. `conn.close` has the same race, because `cancelOnClose` only waits for `uploadFile` to return.
    - Why it matters: This contradicts the task assumption and the ARCHITECTURE.md statement that "a partial upload's chunks and files document are deleted". The failure is silent data corruption, and it is most likely when a small file is cancelled near its end.
    - Suggested fix: Before `removeFile`, wait until the upload stream has settled. Options: wait for its `close`/`finish`, or do not give the GridFS stream to the abortable pipeline (stop the read side and call `uploadStream.abort()` once it is idle). Alternatively, run the cleanup again after a settle. Compare `closeStream` in `io/export.ts`.

- [ ] **CR-3 | The upload-cancel integration test never cancels mid-transfer**
    - File: `test/integration/gridfs.int.spec.ts:408-423`
    - Category: Tests
    - Problem: The test calls `backend.cancel(streamId)` immediately after `gridfs.upload` returns. `uploadFile` awaits `stat` and then calls `signal.throwIfAborted()`, so the cancel most likely lands before any chunk is written, and the test passes trivially. There is no test that cancels after progress has been reported, or during the final files-document write, which is where CR-2 occurs. The download-cancel test (line 319) has the same weakness.
    - Why it matters: The cleanup guarantee the feature advertises is unverified on the path where it matters.
    - Suggested fix: Wait for the first progress event (or use a small `progressBytes`) before cancelling. After `finished`, wait briefly and then assert that `files` and `chunks` are both 0.

## P3 Low

- [ ] **CR-4 | A cancelled download can leave the (empty) target file when the cancel arrives before the file is open**
    - File: `packages/backend/src/gridfs/gridfs.ts:243-247`
    - Category: Correctness
    - Problem: `createWriteStream(target)` opens the file asynchronously. If the signal aborts before that open completes, `pipeline` rejects at once and `rm(target)` runs. The open can then still finish and create `target`. The project already handles exactly this case in `io/export.ts` `closeStream` ("An open still running finishes (and creates the file) first, so a removal after this cannot be undone by a late open"), but `downloadFile` does not.
    - Why it matters: A file the user cancelled is left behind, which contradicts the documented "a partial download file is removed". The project has a convention for this case, and this code does not follow it.
    - Suggested fix: Keep a reference to the write stream and wait for its `close` (destroy it if needed) before calling `rm`, as `closeStream` does.

- [ ] **CR-5 | Cancel always says "nothing was kept", even if the upload already committed**
    - File: `packages/renderer/src/app/gridfs/gridfs-view.ts:259-265`
    - Category: Correctness
    - Problem: `cancelTransfer` unsubscribes and shows "Cancelled the upload of X; nothing was kept." without reloading. If the backend had already finished the upload (the files document was written and `end` was in flight), the backend ignores the cancel and the file exists. The message is then wrong, and the list stays stale until the user clicks Refresh. CR-2 can also keep data that the message says was removed.
    - Why it matters: A cancelled write may already have been committed. The UI states as fact something it cannot know.
    - Suggested fix: After cancelling an upload, reload the list, and word the message without the guarantee (for example "Cancelled the upload of X."). Or wait for the stream's terminal event before choosing the message.

## Review conclusion

Material issues found; fix before completing the task.

Notes: The acceptance-criterion tests exist. `gridfs.int.spec.ts:153` does a 20 MB round trip checked by SHA-256, and `test/e2e/gridfs.e2e.ts` uploads, downloads and deletes through the UI and its confirm dialog. As instructed, I did not run them or inspect the `tasks.py verify` evidence. Other checks found no issues. The write guard covers `gridfs.upload`/`gridfs.delete` (`write: 'always'`) before any dialog opens. The renderer sends no paths. Ids travel as canonical EJSON and are read without BSON promotion. Every database query uses `$eq` and escapes the regex. Out-of-order list results are ignored through per-list `AbortController`s. Destroying the tab cancels a running transfer. The CSS contains no hard-coded colours.

# Fix Report

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: findings CR-1 (P2) and CR-2 (P3) from `reviews/io-basic-backend/review.md`, plus FX-1 (P3, assigned by the parent worker after the fixer found it as a test flake), base e0bf99087908fbf893e7b66445f51ef0f362c622 .. HEAD e0bee05 (changes not committed). CR-3 was accepted by the parent worker and is not part of this pass.

## Fixed findings

### CR-1 — Import scanners hold an unterminated value in memory without limit

Files changed:
- `packages/backend/src/io/scanner.ts`
- `packages/backend/src/io/scanner.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `docs/ARCHITECTURE.md` ("Import/export" bullet)

Problem:
`JsonScanner` (`parts`) and `LineScanner` (`carry`) kept adding to one pending value until it ended. So a JSON file with an unclosed `{`, a minified file read as JSON Lines or a binary file was buffered whole and joined into one string. This affected both `io.import` and `io.previewImport`. Also, `LineScanner` rebuilt `carry + chunk` and searched it again for every chunk, which is quadratic for a long line.

Fix:
- The new exported constant `MAX_VALUE_CHARS = 64 * 1024 * 1024` characters is the 16 MiB BSON limit plus room for EJSON text (type wrappers, base64), as the review suggested.
- Both scanners take an optional `maxValueChars` constructor argument (default `MAX_VALUE_CHARS`). Tests use a small value.
- `JsonScanner` counts the characters of the pending value. When the value grows past the cap, at the end of a chunk or when it closes, it throws `ScanError("a value is longer than N characters (is the file in the chosen format?)", valueLine)`. The line is where the value starts.
- `LineScanner` keeps the open line as a list of parts with a running length. It searches only the new chunk for `\n` and throws the same `ScanError` for line `this.line + 1`.
- Like `JsonScanner` already did, `LineScanner` returns the values completed earlier in the same chunk and throws the error on the next call.
- `importFile` and `previewFile` needed no change. The error is a `ScanError`, so the existing broken-structure path handles it: the pending batch is flushed, a last progress event is sent, and the call rejects with `INVALID_PARAMS` "Line N: ...". The preview also answers `INVALID_PARAMS`.
- Memory per value is now bounded by the cap plus one 256 KiB read chunk.

Tests added:
- Scanner tests with a small cap:
  - unterminated array element, unclosed `{` in a sequence, and a growing bare scalar: each throws after at most 10 more chunks and names the start line;
  - a too-long value completed inside one chunk;
  - a value of exactly the cap is accepted, however the text is cut;
  - a JSONL line that grows past the cap;
  - lines before a too-long line are returned, then the error is thrown;
  - a line of exactly the cap is accepted.
- `importFile` and `previewFile` with the real constant: a JSON file with an unclosed value and a JSONL file with one huge line, each `MAX_VALUE_CHARS + 1024` characters long. The import inserts the first document, sends one final progress event and rejects `INVALID_PARAMS` "Line 2: a value is longer than ...". The preview rejects `INVALID_PARAMS` with the same message. Each test takes about 0.2-0.8 s.

Validation:
- `cd packages/backend && npx vitest run src/io/scanner.spec.ts` — Pass (43 tests)
- `cd packages/backend && npx vitest run src/io` — Pass (145 tests)

### CR-2 — Stop mode can report a later line than the first failure

Files changed:
- `packages/backend/src/io/import.ts`
- `packages/backend/src/io/import.spec.ts`
- `docs/ARCHITECTURE.md` ("Import/export" bullet)

Problem:
In stop mode, a parse failure at line N set `stop` first (`stop ??=`). A server refusal of an earlier line M < N, found when the pending batch was flushed, did not replace it. The import therefore ended with "Import stopped: Line N" and listed `errors` as `[N, M]`.

Fix:
- `fail()` remembers the line of the current stop and replaces the stop error whenever a failure at an earlier line arrives. The import ends with the error of the earliest failed line.
- `errors` is kept in line order with a sorted insert. It holds the first `MAX_REPORTED_ERRORS` lines: when the list is full, a later-arriving earlier line drops the last entry. This also fixes the same ordering issue in continue mode, where a parse failure was recorded before the refusal of an earlier line in the same batch.
- The comment "A stop comes from an earlier line than the broken structure" still holds: every stop comes from a value read before the broken point.

Tests added (`import.spec.ts`):
- Stop mode: a duplicate at line 2 in the pending batch, then a bad line 3. The import rejects `SERVER_ERROR` "Import stopped: Line 2: E11000 duplicate key error", with one insert of 2 documents, one progress event and errors `[2 SERVER_ERROR, 3 INVALID_PARAMS]`. The old code would end at line 3 with errors `[3, 2]`.
- Continue mode: the same file gives errors `[2, 3]`.
- Continue mode: a refusal of line 1 that arrives after 105 parse failures. The kept errors are exactly lines 1..100, and the first is the `SERVER_ERROR`.

Validation:
- `cd packages/backend && npx vitest run src/io` — Pass (145 tests)

### FX-1 — A cancelled or failed export can leave its file behind

Files changed:
- `packages/backend/src/io/export.ts`
- `packages/backend/src/io/export.spec.ts`

Problem:
During this pass, the first `npm run check` run failed once in `export.spec.ts` "a cancel stops the export, kills the server operation and removes the file", because `cancel.json` was still in the folder. The cause is in the error path of `exportToFile`: `stream.destroy()` was followed at once by `rm(file)`. When the `WriteStream`'s asynchronous `open` had not finished yet, `rm` found no file, and the open created it afterwards. A cancelled or failed export could therefore leave an empty file behind. The new 64 MiB import tests add I/O load, which made the race more likely to show up.

Fix:
- New helper `closeStream()`: it destroys the stream and resolves on its `close` event, or at once when the stream is already `closed`. A destroyed `WriteStream` lets a pending open finish (or fail) and then closes the file before emitting `close`.
- The error path now runs `await closeStream(stream)` before `rm(file)`, so the removal always comes after the file exists.

Test added (`export.spec.ts`):
- "a failure before the file is open removes the file once the open completed".
- `node:fs` is mocked so that `createWriteStream` passes everything through, unless a test sets `slowOpen.gate`. Then the stream uses a custom `fs.open` that waits for the gate and exposes an `opened` promise.
- The fake server rejects the `find` and releases the gate 20 ms later. The test waits for `opened` and then checks that the file does not exist and the folder is empty.
- Against the old code (`stream.destroy()` without waiting, restored temporarily) the test fails: `expected true to be false`. With the fix it passes.

Validation:
- `cd packages/backend && npx vitest run src/io/export.spec.ts` — Pass (26 tests); Fail against the old code, as expected
- `cd packages/backend && npx vitest run src/io --repeats 5` — Pass (146 tests)

## Not fixed

### CR-3 — `FileDialogs` signal unused; `io.export` ignores `csvFields`

Status:
Out of scope (accepted by the parent worker)

Reason:
The parent worker accepted this finding and asked for it not to be fixed in this pass.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/io --repeats 5` — Pass, 4 files, 146 tests (final code)
- `cd packages/backend && npx vitest run src/io/export.spec.ts` with the old `stream.destroy()` line restored temporarily — Fail as expected (FX-1 regression test); the fix was then restored

Full test suite:
- `npm run check` (eslint, prettier, typecheck, root vitest, renderer tests) — Pass on the final code: root 53 files / 3152 tests, renderer 60 files.
- Earlier runs during this pass:
  - prettier flagged the CR spec files, fixed with `npx prettier --write`;
  - one run hit the export flake that became FX-1;
  - one run failed eslint `no-empty-function` in the first FX-1 test draft, fixed.
- Integration tests (`test:int`) were not run: the changes are covered by unit tests, and no container behavior changed.
- Integration tests (`test:int`) were not run: the changes are covered by unit tests, and no container behavior changed.

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (`sh .taskcheck` from the repo root, runs `npm run check`)

Remaining unresolved findings:
0 (CR-3 was accepted by the parent worker)

## Final status

All validated findings fixed and validation passed.

## Earlier fixes (previous fix pass, kept as history)

Scope of that pass: findings TW-1, TW-2 (from `reviews/io-basic-backend/tests.md`) and TW-3 (parent decision on broken file structure in import), base c65dcfc66e53b4f8dc3bfc072521982fc0eef08c .. HEAD d7c364d. All three were fixed and validated then (`npx vitest run src/io` 117 tests, `npm run check`, `.taskcheck`, `io.int` 10/10).

#### TW-1 — Export reports success when the file cannot be created

Files changed:
- `packages/backend/src/io/export.ts`

Problem:
`finish()` ignored the error argument of the `stream.end` callback, so an open failure (missing folder, no permission) that arrived after the first buffered write let `exportToFile` resolve with the document count although no file existed.

Fix:
`finish()` now rejects at once when the stream already failed or was destroyed, and rejects with the `end` callback's error (or `stream.errored`) otherwise. The existing `catch` turns it into `INTERNAL` "Could not write (path): ..." and removes any partial file.

Validation:
- `cd packages/backend && npx vitest run src/io/export.spec.ts` — Pass (test "rejects INTERNAL naming the file when it cannot be created (server answers at once)" now passes)

#### TW-2 — Export hangs when the file stream failed before a write

Files changed:
- `packages/backend/src/io/export.ts`
- `packages/backend/src/io/export.spec.ts` (one regression test added)

Problem:
`write()` waited for `drain` on a stream that had already errored or been destroyed; such a stream emits neither `drain` nor `error` again, so the export never ended and the cursor stayed open.

Fix:
New helper `brokenStream()` (`stream.errored`, or `stream.destroyed`). `write()` rejects at once when the stream is broken, and while waiting for back pressure it also listens for `close`, rejecting when the stream closes without draining. The `finally` still runs `op.close()`, which kills the cursor. Added a regression test that exports to a symlink to `/dev/full` (writes fail with ENOSPC) with a slow `getMore`: the export rejects `INTERNAL` naming the file within the timeout, `killCursors` is sent and the symlink is removed (skipped where `/dev/full` does not exist).

Validation:
- `cd packages/backend && npx vitest run src/io/export.spec.ts` — Pass (21 tests, including "rejects INTERNAL when the file cannot be created and the server answers after the open failed" and the new "rejects INTERNAL and kills the cursor when a write fails between batches (disk full)")

#### TW-3 — Broken file structure loses the pending batch and the final progress

Files changed:
- `packages/backend/src/io/import.ts`
- `packages/backend/src/io/scanner.ts`
- `packages/backend/src/io/import.spec.ts`
- `packages/backend/src/io/scanner.spec.ts`
- `docs/ARCHITECTURE.md` ("Import/export" bullet)

Problem:
A `ScanError` skipped the final flush, so documents of the current batch read before the broken point were never inserted and no final progress event was sent. In addition, `JsonScanner.feed` threw before returning, so values completed earlier in the same read chunk (in practice the whole file for files under 256 KiB) were lost even before reaching the importer.

Fix:
- `importFile`: the reading loop moved into a local `readAll`. A `ScanError` is recorded as `INVALID_PARAMS` (the scanner's "Line N: ..." message), the pending batch is flushed (which sends the last progress event), then the call rejects. This applies regardless of `stopOnError`. Other read errors (file vanished, `CANCELLED`) are rethrown without a flush, as before. If a stop-mode failure (an earlier line) is set, it is the rejection, because the import already ended there.
- `JsonScanner.feed`: when a `ScanError` occurs after values of the same chunk were completed, it returns those values and throws the stored error on the next `feed`/`end` call. The error message and line are unchanged. An element that is never terminated by `,` or `]` (file ends inside the array) is still not emitted, since the scanner cannot know it is complete.
- Tests: the old broken-structure test now runs in continue and stop mode and checks the inserted documents and the single final progress. New tests: a broken structure after a full batch keeps both batches; a stop on an earlier line takes precedence over the broken structure; a cancel during reading writes no further documents and sends no final progress; the scanner returns values completed before a broken point, then throws.

Validation:
- `cd packages/backend && npx vitest run src/io` — Pass (117 tests; also with `--repeats 4`)

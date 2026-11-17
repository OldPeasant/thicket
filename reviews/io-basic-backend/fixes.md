# Fix Report

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: findings TW-1, TW-2 (from `reviews/io-basic-backend/tests.md`) and TW-3 (parent decision on broken file structure in import), base c65dcfc66e53b4f8dc3bfc072521982fc0eef08c .. HEAD d7c364d.

## Fixed findings

### TW-1 — Export reports success when the file cannot be created

Files changed:
- `packages/backend/src/io/export.ts`

Problem:
`finish()` ignored the error argument of the `stream.end` callback, so an open failure (missing folder, no permission) that arrived after the first buffered write let `exportToFile` resolve with the document count although no file existed.

Fix:
`finish()` now rejects at once when the stream already failed or was destroyed, and rejects with the `end` callback's error (or `stream.errored`) otherwise. The existing `catch` turns it into `INTERNAL` "Could not write <file>: ..." and removes any partial file.

Validation:
- `cd packages/backend && npx vitest run src/io/export.spec.ts` — Pass (test "rejects INTERNAL naming the file when it cannot be created (server answers at once)" now passes)

### TW-2 — Export hangs when the file stream failed before a write

Files changed:
- `packages/backend/src/io/export.ts`
- `packages/backend/src/io/export.spec.ts` (one regression test added)

Problem:
`write()` waited for `drain` on a stream that had already errored or been destroyed; such a stream emits neither `drain` nor `error` again, so the export never ended and the cursor stayed open.

Fix:
New helper `brokenStream()` (`stream.errored`, or `stream.destroyed`). `write()` rejects at once when the stream is broken, and while waiting for back pressure it also listens for `close`, rejecting when the stream closes without draining. The `finally` still runs `op.close()`, which kills the cursor. Added a regression test that exports to a symlink to `/dev/full` (writes fail with ENOSPC) with a slow `getMore`: the export rejects `INTERNAL` naming the file within the timeout, `killCursors` is sent and the symlink is removed (skipped where `/dev/full` does not exist).

Validation:
- `cd packages/backend && npx vitest run src/io/export.spec.ts` — Pass (21 tests, including "rejects INTERNAL when the file cannot be created and the server answers after the open failed" and the new "rejects INTERNAL and kills the cursor when a write fails between batches (disk full)")

### TW-3 — Broken file structure loses the pending batch and the final progress

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

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/io` — Pass, 4 files, 117 tests
- `cd packages/backend && npx vitest run src/io --repeats 4` — Pass

Full test suite:
- `npx vitest run --config test/integration/vitest.config.ts io.int` (Podman containers) — Pass, 10/10
- `npm run check` (eslint, prettier, typecheck, root vitest, renderer tests) — Pass (root 3123 tests, renderer 60 files). Prettier had flagged `import.spec.ts` at first and was fixed with `npx prettier --write` on that file.

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (`sh .taskcheck`, runs `npm run check`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

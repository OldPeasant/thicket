# Code Review

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: the whole task range 7906c6ca3aba897605b541415380aa044f49ec6f..85deb3bba895ca8a07f1cc2caddcf6cd64d725d2 on main. This is the third pass. The second pass reviewed the code up to e577190 (the fixes for CR-1, CR-2 and FX-1). This pass adds commit 85deb3b, which changes only tests (`packages/backend/src/io/{scanner,import,export}.spec.ts`) and the reports under `reviews/io-basic-backend/`. For this pass the delta was read with `git diff e577190 85deb3b -- packages`, together with the code it exercises (`scanner.ts`, `import.ts` `importFile`, `export.ts`) and the spec helpers it relies on (`splits`, `expectAnySplit`, `duplicateAt`, `fakeServer`, the `node:fs` mock with `slowOpen`). Production code is unchanged since e577190, so the earlier findings below still apply as written. The second pass had no Bash and read the files at HEAD e577190 in full; its results are kept.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and its four ASSUMPTION notes
- `SPEC.md` M1 "Import / export (basic)" and section 4 (`io.*`), as checked in the first pass
- `docs/ARCHITECTURE.md` (Import/export, Streams, Privileged port, File paths, Write guard)
- `AGENTS.md`; parent instructions (correctness, memory bounds, cancellation, the renderer never sends paths, tests, maintainability; for this pass: test correctness, flakiness and maintainability of the 85deb3b delta)
- `reviews/io-basic-backend/review.md` (earlier passes) and `reviews/io-basic-backend/fixes.md`

Git range:
- Branch: main
- HEAD: 85deb3bba895ca8a07f1cc2caddcf6cd64d725d2
- Base/start: 7906c6ca3aba897605b541415380aa044f49ec6f
- Commits reviewed: 9 (7ef0d1a, 3171c1e, 1c9214b, e4c771f, 29ddec4, 68b9042, e676611, e577190, 85deb3b)
- Uncommitted changes: none at the start of this pass

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (P2) Import scanners hold an unterminated value in memory without limit: Fixed.**
    - `scanner.ts:38` adds `MAX_VALUE_CHARS` = 64 Mi characters, the 16 MiB BSON limit plus room for EJSON wrappers.
    - `JsonScanner` counts the pending value in `size`. It is reset in `open()` (`:110-115`) and checked when a value closes (`:100-102`) and at the end of every chunk (`:172-176`). So a value of any kind is cut off at most one read chunk (256 KiB) past the cap: an unclosed `{`, an unterminated string (inside a string the loop `continue`s, but the check at the end of the chunk still runs), or a growing bare scalar.
    - `LineScanner` now keeps the open line as parts with a running length (`:207-253`) and searches only the new chunk for `\n`. This also removes the earlier quadratic `carry + chunk` search. The error names line `this.line + 1`, which is correct because `line` counts the lines already pushed.
    - Both scanners still return the values completed earlier in the same chunk and throw on the next call (`feed` try/catch). So `importFile` handles the error like any broken structure: it flushes the pending batch, sends a final progress event and rejects with `INVALID_PARAMS` "Line N: …". `previewFile` uses the same `scanFile`, so it is bounded too.
    - Tests: `scanner.spec.ts:343-408` checks the limit, the boundary values (exactly the cap, under every split) and the early stop (`fed <= 10`). `import.spec.ts` checks the real constant end to end for import and preview, in JSON and JSONL. 85deb3b adds the one-over-the-limit cases under every split (see below).
    - ARCHITECTURE documents the limit.
- **CR-2 (P3) Stop mode can report a later line than the first failure: Fixed.**
    - `import.ts:182, :190-202`: `fail()` keeps `stopLine` and replaces `stop` whenever a failure at an earlier line arrives.
    - `errors` is kept in line order by a sorted insert, and the overflow drops the last entry. This keeps the first `MAX_REPORTED_ERRORS` lines also when failures arrive out of order.
    - An ordered flush still stops resubmitting once `stop` is set (`:232`). So the documents between the refused line M and the bad line N are not inserted, and the import now reports M.
    - Tests: stop mode reports line 2, not 3 (errors `[2, 3]`); continue mode keeps line order; a late refusal of line 1 after 105 parse failures keeps exactly lines 1..100. 85deb3b adds the unordered variant and the "refusal in an earlier full batch" case (see below).
    - The ARCHITECTURE wording ("error of the earliest failed line") matches the code.
- **FX-1 (P3, raised by the fixer) A failed or cancelled export can leave its file behind: Fixed.**
    - `export.ts:107-116` `closeStream()` destroys the stream and waits for `close`, or resolves at once when the stream is already `closed`. The error path awaits it before `rm` (`:181-184`), so a pending `open` can no longer recreate the file after the removal.
    - `close` is always emitted for `fs` write streams (`emitClose` defaults to true), also after an open error, so the wait cannot hang in normal use.
    - Regression tests: `export.spec.ts:322-345` (gated `fs.open` through the stream's `fs` option), and from 85deb3b `:347-372` for the JSON format, where `[` is buffered while the open waits.
- **CR-3 (P3) `FileDialogs` signal unused; `io.export` ignores `csvFields`: Still open, accepted by the parent worker.** The code at `handlers.ts:17-37` and `:88-113` is unchanged. Details are under P3 below.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | `FileDialogs` takes an abort signal that is never used; `io.export` silently ignores `csvFields`** (still open, accepted by the parent worker)
    - File: `packages/backend/src/io/handlers.ts:17-37`, `packages/backend/src/io/handlers.ts:88-113`
    - Category: Quality
    - Problem:
        1. `saveFile`/`openFile` take a `signal`, and the handlers pass `c.signal`, but `dialogsOverLink` drops it. A cancelled `io.export` / `io.previewImport` leaves the native dialog open.
        2. `io.import` refuses `csvMapping` for JSON files (`:139-141`), while `io.export` accepts `csvFields` for `json`/`jsonl` and ignores it.
    - Why it matters: The interface promises a cancel behavior that does not exist, and format-specific fields are validated inconsistently. Nothing breaks today: after a cancel, `serve()` never starts the stream, and `previewFile` stops on the aborted signal.
    - Suggested fix: Drop the `signal` parameter from `FileDialogs`, or document that it is not honored. Refuse `csvFields` for non-CSV exports, or document why it is accepted. This can be done in io-advanced, which adds CSV.

## Test delta 85deb3b (third pass)

No findings. Each new test was checked against the code it exercises:

- `scanner.spec.ts:409-481` (value size limit, one character over):
    - `scanUntilError` fails the test when no error is thrown, so a missing refusal cannot pass silently.
    - `expectTooLongAnySplit` runs every two-way cut plus one character per chunk. For each cut it asserts the values returned before the error (`{"a":1}` at line 1), the `ScanError` type and the exact message with line 2.
    - The expectations match `scanner.ts`. A value that closes in a later chunk is checked at `close` (`size + to - from`, `:100`). A value still open at the end of a chunk is checked at `:172-176`. A scalar that ends the file is caught by that end-of-chunk check before `end()` runs, and `end()` itself does not check the size. Because of the deferred `failure`, `{"b":2}` after the bad value is never returned.
    - The "consecutive values at the limit" test checks that `size` is reset per value (`open()`): in an array, in a sequence with no separator, and for bare scalars split by spaces.
- `import.spec.ts:385-414` (unordered: a refused earlier line found when flushing wins over a later bad line):
    - Matches `import.ts`. The parse failure at line 5 sets `stop` and breaks the loop (`:245-246`), and the final `flush()` sends one unordered insert of 4 documents. The refusal of line 2 then replaces `stop` (`:198-201`), and `rest` becomes `[]` because the insert is unordered. One progress event is sent, `{processed: 5, failed: 2}`, with the errors in line order.
- `import.spec.ts:416-428` (a refusal in an earlier full batch keeps the earlier stop):
    - Matches `:254-255`. The full batch is flushed, the refusal sets `stop`, and the loop breaks before the bad line is counted. The final empty flush sends the last progress (`processed: IMPORT_BATCH_DOCS, failed: 1`).
    - This test would also pass before the CR-2 fix, because the bad line is never read. It locks the "break at once" behavior rather than the earliest-line rule. That matches its stated intent, so it is not a finding.
- `export.spec.ts:347-372` (a failed JSON export settles only after the late open):
    - `[` is written while the open is gated, the server rejects, and the gate is released 20 ms later by a timer. `exportToFile` can only settle after `closeStream` has seen `close`, and `close` follows the open callback. The open callback runs `opened()` first, so the `openDone` microtask runs before `close` is emitted (that needs another `fs.close` callback).
    - So `openDone === true` and the empty directory are deterministic and do not depend on the 20 ms timer. Against the pre-FX-1 code, the export would reject before the timer fires, and `openDone` would be false.
    - The `finally` block resets the shared `slowOpen` state, so later tests are not affected.
- `npx vitest run src/io/scanner.spec.ts src/io/import.spec.ts src/io/export.spec.ts` (packages/backend, at HEAD 85deb3b): 3 files, 130 tests passed in 1.6 s. Repeated runs to probe flakiness were not permitted in this session. The flakiness conclusion above therefore comes from reading the ordering logic, not from repeated runs.

## Verified without findings

- AC1 (10 000-document canonical round trip), AC2 (continue mode reports the bad line numbers and imports the rest) and AC3 (export memory stays bounded with 200 000 documents): the implementation paths checked in the first pass are unchanged by e577190, apart from the error path of `exportToFile`, which only runs on failure. 85deb3b does not touch production code. The integration tests in `test/integration/io.int.spec.ts` were not re-read or re-run in this pass. The recorded criterion evidence was not inspected. The parent worker must record the evidence (the actual `npm run test:int` run) with `tasks.py verify` before `done`.
- Memory bounds after the fixes: import holds at most one batch (≤ 1 000 documents / 8 MB, or one document up to 16 MB), one pending value (≤ `MAX_VALUE_CHARS` plus one chunk) and one 256 KiB read chunk. Export holds one cursor batch plus the write stream buffer, with back pressure.
- Cancellation: the import checks the signal per read chunk, and `Operation` kills server commands. The export cancels through `Operation`, then waits for the file to close and removes it. A cancel during reading flushes nothing (tested).
- Security: the renderer only sends `fileToken`, and paths stay in the backend's token map (the last 100). `dialog.*` exists only on the privileged port. `io.import` stays behind the write guard. No secrets, `eval`, or paths built from renderer input. The new tests use temp directories and inline fixtures, with no secrets.
- Maintainability: the fixes stay small and local and follow the existing patterns (the deferred `failure` in both scanners, `brokenStream` / `closeStream` in export). The new test helpers are scoped to their `describe` block, reuse the existing `splits` / `expectAnySplit`, and have comments that match the behavior.

## Review conclusion

No material issues found. CR-1 and CR-2 are fixed correctly and covered by regression tests, and FX-1 is fixed with regression tests. The test-only delta 85deb3b is correct, deterministic by construction, and passes. The only open finding is CR-3 (P3), which the parent worker accepted. Before `done`, the parent worker must still record the evidence for acceptance criteria #1-#3 with `tasks.py verify`, based on an actual integration test run.

# Code Review

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: second review pass on the final code, task range 7906c6ca3aba897605b541415380aa044f49ec6f..e577190c905c650a1caa49729601060e5fed0ef3 on main (as given by the parent worker). Its focus is the fix commit e577190 (CR-1, CR-2, FX-1), and the whole task scope is checked again. Bash was not available to this reviewer, so `git diff` / `git log` could not be run. The review read the current files of the task scope in full instead: `packages/backend/src/io/{scanner,import,export,handlers}.ts`, their specs, `apps/desktop/src/dialogs/handlers.ts`, and the "Import/export" bullet of `docs/ARCHITECTURE.md`. The working tree was clean at the start of the session, so these files are the content of HEAD e577190.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and its four ASSUMPTION notes
- `SPEC.md` M1 "Import / export (basic)" and section 4 (`io.*`), as checked in the first pass
- `docs/ARCHITECTURE.md` (Import/export, Streams, Privileged port, File paths, Write guard)
- `AGENTS.md`; parent instructions (correctness, memory bounds, cancellation, the renderer never sends paths, tests, maintainability)
- `reviews/io-basic-backend/review.md` (first pass) and `reviews/io-basic-backend/fixes.md`

Git range:
- Branch: main
- HEAD: e577190c905c650a1caa49729601060e5fed0ef3
- Base/start: 7906c6ca3aba897605b541415380aa044f49ec6f
- Commits reviewed: the task commits up to and including e577190 (the commit list could not be printed without Bash; the latest five on main are e4c771f, 29ddec4, 68b9042, e676611 and e577190)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of earlier findings

- **CR-1 (P2) Import scanners hold an unterminated value in memory without limit: Fixed.**
    - `scanner.ts:38` adds `MAX_VALUE_CHARS` = 64 Mi characters, the 16 MiB BSON limit plus room for EJSON wrappers.
    - `JsonScanner` counts the pending value in `size`. It is reset in `open()` (`:110-115`) and checked when a value closes (`:100-102`) and at the end of every chunk (`:172-176`). So a value of any kind is cut off at most one read chunk (256 KiB) past the cap: an unclosed `{`, an unterminated string (inside a string the loop `continue`s, but the check at the end of the chunk still runs), or a growing bare scalar.
    - `LineScanner` now keeps the open line as parts with a running length (`:207-253`) and searches only the new chunk for `\n`. This also removes the earlier quadratic `carry + chunk` search. The error names line `this.line + 1`, which is correct because `line` counts the lines already pushed.
    - Both scanners still return the values completed earlier in the same chunk and throw on the next call (`feed` try/catch). So `importFile` handles the error like any broken structure: it flushes the pending batch, sends a final progress event and rejects with `INVALID_PARAMS` "Line N: …". `previewFile` uses the same `scanFile`, so it is bounded too.
    - Tests: `scanner.spec.ts:343-408` checks the limit, the boundary values (exactly the cap, under every split) and the early stop (`fed <= 10`). `import.spec.ts:675-700` checks the real constant end to end for import and preview, in JSON and JSONL.
    - ARCHITECTURE documents the limit.
- **CR-2 (P3) Stop mode can report a later line than the first failure: Fixed.**
    - `import.ts:182, :190-202`: `fail()` keeps `stopLine` and replaces `stop` whenever a failure at an earlier line arrives.
    - `errors` is kept in line order by a sorted insert, and the overflow drops the last entry. This keeps the first `MAX_REPORTED_ERRORS` lines also when failures arrive out of order.
    - An ordered flush still stops resubmitting once `stop` is set (`:232`). So the documents between the refused line M and the bad line N are not inserted, and the import now reports M.
    - Tests: `import.spec.ts:367-383` (stop mode reports line 2, not 3; errors `[2, 3]`), `:455-463` (continue mode keeps line order), and `:465-478` (a late refusal of line 1 after 105 parse failures: the kept errors are exactly lines 1..100).
    - The ARCHITECTURE wording ("error of the earliest failed line") now matches the code.
- **FX-1 (P3, raised by the fixer) A failed or cancelled export can leave its file behind: Fixed.**
    - `export.ts:107-116` `closeStream()` destroys the stream and waits for `close`, or resolves at once when the stream is already `closed`. The error path awaits it before `rm` (`:181-184`), so a pending `open` can no longer recreate the file after the removal.
    - `close` is always emitted for `fs` write streams (`emitClose` defaults to true), also after an open error, so the wait cannot hang in normal use.
    - Regression test: `export.spec.ts:322-345`, with a gated `fs.open` through the stream's `fs` option. The fixer reports that it fails against the old code.
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

## Verified without findings

- AC1 (10 000-document canonical round trip), AC2 (continue mode reports the bad line numbers and imports the rest) and AC3 (export memory stays bounded with 200 000 documents): the implementation paths checked in the first pass are unchanged by e577190, apart from the error path of `exportToFile`, which only runs on failure. The integration tests in `test/integration/io.int.spec.ts` were not re-read or re-run in this pass. Recorded criterion evidence could not be inspected (`python tasks.py verify io-basic-backend` needs Bash). The task file still shows the criteria unticked, so the parent worker must record the evidence (the actual `npm run test:int` run) before `done`.
- Memory bounds after the fixes: import holds at most one batch (≤ 1 000 documents / 8 MB, or one document up to 16 MB), one pending value (≤ `MAX_VALUE_CHARS` plus one chunk) and one 256 KiB read chunk. Export holds one cursor batch plus the write stream buffer, with back pressure.
- Cancellation: the import checks the signal per read chunk, and `Operation` kills server commands. The export cancels through `Operation`, then waits for the file to close and removes it. A cancel during reading flushes nothing (tested).
- Security: the renderer only sends `fileToken`, and paths stay in the backend's token map (the last 100). `dialog.*` exists only on the privileged port. `io.import` stays behind the write guard. No secrets, `eval`, or paths built from renderer input. The default file name in the save dialog comes from the collection name, but the user confirms the path in the native dialog.
- Maintainability: the fixes stay small and local and follow the existing patterns (the deferred `failure` in both scanners, `brokenStream` / `closeStream` in export). Comments match the behavior.

## Review conclusion

No material issues found. CR-1 and CR-2 are fixed correctly and covered by regression tests, and FX-1 is fixed with a regression test. The only open finding is CR-3 (P3), which the parent worker accepted. Before `done`, the parent worker must still record the evidence for acceptance criteria #1-#3 with `tasks.py verify`, based on an actual integration test run.

# Code Review

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: committed changes e0bf990..c7c85da on main (the task's 6 commits: 3cec5d5, 5f33da4, 59fa1a7, 9c0feb5, 28efdba, c7c85da). Uncommitted edits to `packages/backend/src/io/export.spec.ts` and `packages/backend/src/io/scanner.spec.ts` existed in the working tree during the review and were not reviewed.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and its four ASSUMPTION notes
- `SPEC.md` M1 "Import / export (basic)" and section 4 (API contract, `io.*` row)
- `docs/ARCHITECTURE.md` (Processes, Privileged port, Streams, Import/export, Write guard, API between parts, File paths)
- `AGENTS.md` and parent instructions (focus: streaming/memory bounds, cancellation, error handling, the renderer never sends file paths)

Git range:
- Branch: main
- HEAD: c7c85daf81e6bd1072ebe0b8e5e452558507d92b
- Base/start: e0bf99087908fbf893e7b66445f51ef0f362c622
- Commits reviewed: 6

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Import scanners hold an unterminated value in memory without limit**
    - File: `packages/backend/src/io/scanner.ts:143` (JsonScanner `parts`), `packages/backend/src/io/scanner.ts:179-185` (LineScanner `carry`)
    - Category: Correctness
    - Problem: Nothing limits the size of one scanned value. `JsonScanner` adds every chunk to `this.parts` until the brackets balance. `LineScanner` keeps adding to `this.carry` until it sees a newline. So the whole file is buffered in these cases:
        - a JSON file with an unclosed `{` near the start;
        - a single-line (minified) file imported as JSON Lines;
        - a binary file or other wrong file picked in the open dialog.

      The whole file is then joined into one string (`parts.join('')` at line 77 or 164, `this.carry + chunk` at line 179). This applies to both `io.import` and `io.previewImport`, because `previewFile` also goes through `scanFile`. A valid document can never be larger than 16 MB of BSON, so text beyond a few tens of MB cannot become a valid document.
    - Why it matters: The backend utilityProcess serves every window. A large file of the wrong shape uses as much memory as the file is big (UTF-16 strings, about twice the file size). Above V8's string limit (~512 M characters) the join throws a `RangeError`, which reaches the user as a vague `INTERNAL` error. Before that point the heap can fill up and the backend crashes: every connection is dropped and the backend has to restart. This defeats the module's claim that "the file is read as a stream" with bounded memory.
    - Suggested fix: Track the pending value's length in both scanners. Once it goes past a cap (for example 16 MB of BSON plus a generous margin for EJSON text, such as 64 MB of characters), throw `ScanError('a value is larger than … (wrong format?)', valueLine)`. Add a unit test for each scanner that feeds a long unterminated value and expects the `ScanError` without buffering it all.

## P3 Low

- [ ] **CR-2 | Stop mode can report a later line than the first failure**
    - File: `packages/backend/src/io/import.ts:186`, `:230-231`, `:257`, `:262`
    - Category: Correctness
    - Problem: With `stopOnError` (the default), a value that does not parse at line N sets `stop` and ends reading. Then `flush()` inserts the pending batch of earlier lines. If one of those inserts is refused at line M < N (for example a duplicate `_id`), `fail()` does not replace the stop error (`stop ??=`). In an ordered insert the documents after line M are also not inserted. The stream then ends with "Import stopped: Line N: …", and `errors` lists `[N, M]`, not in line order. The comment at line 261 ("A stop comes from an earlier line…") and the documented rule ("ends the stream with the first failure's error", ARCHITECTURE Import/export and the task's ASSUMPTION) do not hold here. Example: re-importing a partially imported file that also has a bad line.
    - Why it matters: The user is told the import stopped at line N, while lines M+1..N-1 were silently not inserted because of line M. To resume, they would fix the wrong place first.
    - Suggested fix: Do not set `stop` on a parse failure until the pending batch has been flushed. Alternatively, when `flush()` records a write error from an earlier line, replace `stop` with that error (keep the earliest line), and keep `errors` in line order. Add a unit test: a duplicate in the pending batch followed by a bad line in stop mode.

- [ ] **CR-3 | `FileDialogs` takes an abort signal that is never used; `io.export` silently ignores `csvFields`**
    - File: `packages/backend/src/io/handlers.ts:17-37`, `packages/backend/src/io/handlers.ts:88-96`
    - Category: Quality
    - Problem:
        1. `FileDialogs.saveFile/openFile` take a `signal`, and the handlers pass `c.signal`. But `dialogsOverLink` throws it away, and `RpcClient.call` has no cancel support. So a cancelled `io.export` or `io.previewImport` leaves the native dialog open. The interface suggests a cancel behavior that does not exist. Nothing breaks after the cancel: `serve()` never starts the stream, and `previewFile` stops on the aborted signal.
        2. `io.import` refuses `csvMapping` for JSON files (`INVALID_PARAMS`, line 139). `io.export` accepts `csvFields` with `json`/`jsonl` and ignores it, which is inconsistent.
    - Why it matters: A misleading contract makes it likely that a later caller relies on the cancel working. Inconsistent validation of format-specific fields makes renderer bugs harder to see.
    - Suggested fix: Either drop the `signal` parameter from `FileDialogs`, or document that it is not honored (Electron cannot close a native dialog). Refuse `csvFields` for non-CSV exports, the same way `io.import` refuses `csvMapping`, or document why it is accepted.

## Verified without findings

- AC1 (round trip of 10 000 documents in canonical EJSON): `test/integration/io.int.spec.ts:237-263` exports `rich` (most BSON types, including integral Doubles, Decimal128, Int64, Timestamp, MinKey/MaxKey) as JSON and JSONL, imports into a new collection, and compares the canonical EJSON of every document. The export reads raw values (types survive), and the import parses with `relaxed: false`.
- AC2 (continue mode with a bad line): `io.int.spec.ts:318-356` checks the line numbers `[2, 5, 6]`, the error codes and the inserted documents for JSONL, and the JSON-array line numbers.
- AC3 (export memory stays bounded): `exportToFile` writes each 1 000-document batch, with back pressure (`write()` waits for `drain`), before the next `getMore`. The int test (`io.int.spec.ts:377-418`) checks that the retained heap stays below 16 MB and that the file grows while the cursor is read.
- The earlier test-writer findings TW-1/TW-2 (export resolving or hanging on file errors) are fixed in `export.ts:58-101`: `brokenStream` is checked before writes, the error argument of `end()` is used, and `close` is watched while waiting for `drain`.
- Security: the renderer only ever sends `fileToken` (the contract has no path field). The paths come from `main`'s native dialogs over the privileged port. `dialog.*` is not in `methods`, so the renderer cannot call it (tested in `apps/desktop/src/main/handlers.spec.ts`). `io.import` has `write: 'always'` and goes through `guardWrites` in `startBackend` (int test with a read-only profile). No secrets, and no `eval`.
- Routing change (`io.*` moved from `main` to `backend`): this matches SPEC section 4 (the file is still chosen in main with a native dialog). It is recorded as a task assumption and documented in ARCHITECTURE, and the contract tests were updated to match.
- Acceptance-criterion evidence: `python tasks.py verify io-basic-backend` shows no evidence recorded yet for #1-#3. The parent worker records it before `done`, so this is not a finding at review time.

## Review conclusion

Material issues found; fix before completing the task. CR-1 (P2) should be fixed or explicitly accepted by the parent worker. CR-2 and CR-3 are low-priority cleanups.

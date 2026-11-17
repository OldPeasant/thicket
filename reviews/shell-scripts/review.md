# Code Review

Date: 2026-11-17

Task: shell-scripts - M4 (Should): Run a script file in the shell

Scope: code diff of the task commit `1a2caedd` against base `c1d702aa` (`packages/renderer/src/app/console/scripts/script-file.ts`, `packages/renderer/src/app/console/shell-console.{ts,html,css}`, `test/e2e/shell.e2e.ts`, `test/e2e/fixtures/insert-three.mongodb`). The task commit was rebased since then as `69cc678a` (current HEAD); `git range-diff` shows it as identical (`=`), and `git diff 1a2caedd HEAD -- packages test` is empty. The `tasks/*.md` differences in the two-dot diff come from the branch topology (other agents' assumption and lease commits), not from this task's code, and were not reviewed.

Requirements:
- tasks/shell-scripts.md (acceptance criterion #1, goal, recorded assumptions #1 and #2)
- SPEC.md section 3 M4 ("Should: Run a script file in the shell") and section 6 (security requirements)
- docs/ARCHITECTURE.md (renderer/bridge conventions, file paths, file dialogs)
- AGENTS.md (evidence rules), docs/QUALITY.md (report contract)

Git range:
- Branch: main
- HEAD: 69cc678a (rebased copy of 1a2caedd, identical code)
- Base/start: c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A chosen script is silently not run when a run starts or the session ends while the file is being read**
    - File: `packages/renderer/src/app/console/shell-console.ts:292`
    - Category: Correctness
    - Problem: `runScript` awaits `readScriptFile(file)` (which awaits `file.text()`), then checks the state again and returns with no message if `session.state !== 'open'` or `this.running()`. During the read the input stays usable, so a run typed and sent with Enter, or a lost session, makes the chosen script disappear: no transcript entry, no `scriptProblem`, no announcement.
    - Why it matters: The user chose a file and gets no feedback about why nothing ran. The window is short for small files but grows with file size (up to the 5 MB limit) and slow disks.
    - Suggested fix: Set `scriptProblem` in that branch (for example "<name> was not run: another input is running" or "the session is not open"), skipping only the `this.closed` case. A unit test with a deferred `text()` promise can cover it.

- [ ] **CR-2 | Script runs keep the full script text in the transcript, which never displays it**
    - File: `packages/renderer/src/app/console/shell-console.ts:303`
    - Category: Quality
    - Problem: `evaluate` stores `code` in every `Run`, including script runs. For script runs the template shows only `run.script` (name and line count), and nothing else reads `run.code`. The transcript keeps up to `TRANSCRIPT_LIMIT` (200) runs, so repeated runs of a large script keep up to 5 MB of unused text each in renderer memory.
    - Why it matters: This memory is never used, and repeated runs of a large script let it grow to hundreds of MB.
    - Suggested fix: Don't keep the script text on the run once it has been sent to `shell.eval`. For example, store `code: ''` (or make `code` optional) for script runs and pass the text to `shell.eval` separately, which `evaluate` already does through its `code` parameter.

## Notes (not findings)

- Security (SPEC section 6): the script is read in the sandboxed renderer through `<input type=file>` and `File.text()`. No file path crosses the bridge, and the JavaScript runs only in the backend mongosh session through the existing `shell.eval`. So the rules "only the mongosh console runs user JavaScript, in the backend" and "the renderer never sends paths" are kept. This is the project's first renderer-side file input. Other file choices go through native dialogs in `main`. The difference is recorded as assumption #1 and does not break an ARCHITECTURE rule.
- The read-only and production behavior matches typed shell input: `shell.eval` is not a contract write, and the server's permissions are the guard, as the SPEC's M4 "Must" text says.
- Acceptance criterion #1: the e2e test drives the real file chooser of the built Electron app against the Testcontainers MongoDB. It asserts the printed output, the absence of errors, the announcement and the 3 documents through a separate `MongoClient`. The recorded evidence (`npm run test:e2e -- test/e2e/shell.e2e.ts -> 3 passed`) matches the 3 tests in the file. The reviewer did not run the e2e suite again.
- Unit coverage of `script-file.ts` (extension, size, empty and BOM handling), the "N outputs so far" progress text and the `scriptProblem` alert is being added by the test-writer in parallel, so it is not reported here.

## Review conclusion

No material issues found. CR-1 and CR-2 are low-priority improvements and do not block completing the task.

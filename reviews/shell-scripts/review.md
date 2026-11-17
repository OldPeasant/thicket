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

---

# Round 2

Date: 2026-11-17

Task: shell-scripts - M4 (Should): Run a script file in the shell

Scope: the whole task diff on the final code, `git diff c1d702aa..HEAD -- packages test`, made up of the task commits `e6f99bee` (implementation and e2e), `45897b54` (unit tests and round-1 reports) and `dc96c1f1` (fixes for CR-1, CR-2 and TW-2). Reviewed files: `packages/renderer/src/app/console/scripts/script-file.ts` and `script-file.spec.ts`, `packages/renderer/src/app/console/shell-console.{ts,html,css,spec.ts}`, `test/e2e/shell.e2e.ts`, `test/e2e/fixtures/insert-three.mongodb`. The two-dot diff also shows `packages/renderer/src/app/connections/import/import-export-page.{html,spec.ts}` and `test/e2e/layout.e2e.ts`. Those changes come from task `e2e-layout-import-heading` (commits `ac6bc2a8` and `ade94464`), which was merged into main after the base, so they were not reviewed here. The working tree has an uncommitted change to `shell-console.spec.ts`, probably from a parallel test-writer run. It is not committed, so it was not reviewed.

Requirements:
- tasks/shell-scripts.md (acceptance criterion #1, goal, assumptions #1 and #2)
- SPEC.md section 3 M4 and section 6; docs/ARCHITECTURE.md; AGENTS.md; docs/QUALITY.md
- reviews/shell-scripts/review.md (round 1), reviews/shell-scripts/fixes.md

Git range:
- Branch: main
- HEAD: dc96c1f1
- Base/start: c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92
- Commits reviewed: 3 (e6f99bee, 45897b54, dc96c1f1)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Round 1 findings, checked against the final code

- **CR-1: resolved.** `runScript` (`shell-console.ts:294-304`) still returns silently only when the component was destroyed (`this.closed`). Otherwise it sets `scriptProblem` to "<name> was not run: the session is not open" or "<name> was not run: the shell is busy". That alert (`shell-console.html`, `data-testid="shell-script-problem"`, `role="alert"`) is cleared on the next file choice or typed run. Two new unit tests use a deferred `text()`. One starts a typed run during the read, and the other ends the session with `NOT_FOUND` during the read. Both check that nothing extra is sent and that the message is shown. The existing "tab goes away while the file is read" test still checks that nothing is sent after destroy.
- **CR-2: resolved.** `evaluate` (`shell-console.ts:310-322`) stores `code: ''` for script runs and sends the full text to `shell.eval` through its `code` parameter. The only reader of `run.code` is the `@else` branch of the template, which script runs never reach. The `Run.script` doc comment describes this. The unit test now expects `runs()[0].code` to be `''` and still checks that the full text was sent.
- **TW-2 (test report): resolved.** The size message is now "<name> is too large to run: it is larger than 5 MB". The value comes from `MAX_SCRIPT_BYTES`, so it is exact, and the unused `formatSize` was removed. The spec checks exactly the limit, one byte over it and 12 MB.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | The byte order mark check uses an invisible literal character**
    - File: `packages/renderer/src/app/console/scripts/script-file.ts:58`
    - Category: Quality
    - Problem: `code.startsWith('﻿')` contains a raw U+FEFF character (bytes `EF BB BF`) between the quotes. In an editor or a diff it looks like `startsWith('')`.
    - Why it matters: A reader, or a later edit or tool that normalizes the invisible character away, can turn it into `startsWith('')`. That is always true, so `slice(1)` would silently drop the first character of every script. The BOM unit test would catch the regression, but the code itself does not show what it checks.
    - Suggested fix: Write it as `code.startsWith('﻿')`.

## Notes (not findings)

- The new behavior in the fix commit is correct for the overlapping cases checked. If a second file is chosen while the first is still being read (the button stays enabled during the read), whichever read finishes first runs. The other one gets the "shell is busy" message, so nothing is lost without feedback. A typed run during the read clears `scriptProblem` before the busy message is set, so the message stays visible.
- The session-ended path uses the current `session()` after the read. A reopened session (a new `sessionId`) is used correctly, and a session that is still `opening` gets the "not open" message.
- Security and architecture observations from round 1 still apply unchanged. The fixes add no new bridge methods, paths or dependencies.
- Acceptance criterion #1 evidence was recorded before the fixes. The fixes change only renderer state and messages, not the e2e path (no e2e asserts the changed texts or `run.code`). The fixer reports `npm run check` and `.taskcheck` passing. The reviewer did not run the test suites again.

## Review conclusion

No material issues found. CR-1, CR-2 and TW-2 are fixed. CR-3 is a low-priority readability improvement and does not block completing the task.

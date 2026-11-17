# Fix Report

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend

Scope: current task; findings TW-1 (reviews/shell-backend/tests.md), CR-2, CR-3, CR-4
(reviews/shell-backend/review.md) and the test-writer observations O-1, O-2, O-3, O-4, as
listed and approved by the parent worker. Reviewed against HEAD 8c8f97a; changes are uncommitted
in the working tree.

## Fixed findings

### TW-1 - A shell command line with a trailing comment swallows the rest of the input

Files changed:
- `packages/backend/src/shell/split.ts`
- `packages/backend/src/shell/split.spec.ts`

Problem:
`COMMAND` took the words of a trailing `//` comment as arguments of `use`/`show`/`it`, so
`commandAt` rejected the command and the whole input went to mongosh's evaluator as one piece,
which ran `use("test", "//", ...)` and silently dropped the following lines.

Fix:
`COMMAND` no longer accepts an argument starting with `//` or `/*`, then allows any number of
trailing comments (`// ...` to the end of the line, `/* ... */` closed on the same line) before
`;`, a line break or the end of input. The command text (group 1) excludes the comments, so they
are dropped. A command word followed directly by a comment (`it//x`) is recognised too. A block
comment followed by code on the line, or not closed on the line, is still not a command form
(unchanged behaviour, tested). The existing failing test now passes unchanged; 10 cases were added
(show/it/exit/quit/use with line and block comments, negative cases).

Validation:
- `cd packages/backend && npx vitest run src/shell` - Pass (140 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` - Pass, including
  `runs the lines after a shell command that has a trailing comment`

### CR-2 - `exit` / `quit` close the session's client and answer with an internal error

Files changed:
- `packages/backend/src/shell/split.ts` (`EXIT_TEXT`, `isExitCommand`)
- `packages/backend/src/shell/runtime.ts`
- `packages/backend/src/shell/split.spec.ts`
- `test/integration/shell.int.spec.ts`

Problem:
mongosh's `exit()` closes every client of the instance state before calling `onExit`, then
throws `MongoshInternalError`; the session stayed open with a closed, untracked client.

Fix:
`exit`/`quit` are never passed to mongosh. `ShellRuntime.evaluateAll` answers an `exit`/`quit`
command piece with a print output `EXIT_TEXT` ("exit and quit are not available in the Thicket
console: close the shell tab instead.") and goes on with the rest of the input. The `exit` and
`quit` globals of the session's vm context are replaced by a function that throws an `Error` with
the same text, so `exit()` / `quit(1)` fail with a clear error and close nothing. An `onExit`
listener was not used because mongosh calls it only after the client was already closed (verified
in `@mongosh/shell-api/lib/shell-api.js`, `exit`). The parent worker may want to record this
behaviour as an assumption.

Validation:
- `cd packages/backend && npx vitest run src/shell/split.spec.ts` - Pass (`isExitCommand` tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` - Pass: new case
  `exit / quit / exit() are refused and leave the session working` (`exit` -> print notice;
  `quit // bye\n1 + 1` -> notice then result `2`; `exit()` -> error output with the notice;
  afterwards `db.c.countDocuments({})` still reaches the server)

### CR-3 - Completion fails after a worker restart until the next eval

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/host.spec.ts`
- `test/integration/shell.int.spec.ts`

Problem:
`complete` answered `CANCELLED` ("The shell is restarting") while the session's worker was dead;
only an evaluation restarted it.

Fix:
`complete` now runs `ensureWorker` when the worker is dead or restarting. Restarts are shared
through `session.restarting` (one replacement for an eval and completions running at the same
time). The restart notice no longer goes to the caller's `emit` during the restart: it is stored
in `session.notice` and emitted by the next evaluation, so a completion-triggered restart does not
lose it. A completion does not tie the restart to its own signal (cancelling the completion only
stops waiting). The existing test that expected `CANCELLED` after a death was updated to the new
behaviour (restart, completions answered, notice shown once by the next eval) and a test for the
shared restart was added.

Validation:
- `cd packages/backend && npx vitest run src/shell/host.spec.ts` - Pass
- `npx vitest run --config test/integration/vitest.config.ts shell` - Pass: new case
  `completion works right after the worker was restarted; the notice comes with the next eval`
  (cancel `while (true) {}`, then `complete('db.c.fi')` contains `db.c.find`, then the next eval
  starts with `RESTARTED_TEXT`)

### CR-4 / O-2 - Evals queued behind a closed session start and connect a new worker

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/host.spec.ts`

Problem:
A queued evaluation of a session closed meanwhile went through `ensureWorker`, which started and
connected a worker before noticing `session.closed`.

Fix:
`runEval` rejects `NOT_FOUND` before anything else when the session is closed, and `restart`
checks `session.closed` again before `startWorker` (the check after the start is kept for a close
during the start).

Validation:
- `cd packages/backend && npx vitest run src/shell/host.spec.ts` - Pass:
  `a queued evaluation of a closed session fails and leaves no worker running` now also asserts
  that no second worker was created

### O-1 - A worker that dies during an evaluation ends the stream silently

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/host.spec.ts`

Problem:
The worker's `exit` resolved the evaluation like `evalDone`; the user learnt about the crash only
from the notice on the next input.

Fix:
When the worker dies under an evaluation that was not interrupted by the user, the evaluation emits
an output `{ kind: 'error', text: <reason> }` (`CRASHED_TEXT`, exported, or "The shell session was
closed" when the session was closed) and resolves; the death is marked `told`, so the next
evaluation does not repeat the notice. An interrupted evaluation still answers `CANCELLED` and the
next evaluation shows the notice (unchanged). A death while idle shows the notice on the next
evaluation (unchanged). The worker `exit` handler now uses the close reason when the session is
closing. Tests: the existing dying-worker test was updated (error output, no second notice); new
tests for the idle death and for an evaluation running when its session is closed.

Validation:
- `cd packages/backend && npx vitest run src/shell/host.spec.ts` - Pass

### O-3 - The restart in ensureWorker ignores the evaluation's abort signal

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/host.spec.ts`

Problem:
`ensureWorker` called `startWorker` without the evaluation's signal, so a cancel during a slow
reconnect waited for the open to finish.

Fix:
The evaluation that starts a restart passes its signal to `startWorker` (which already terminates
the new worker and rejects `CANCELLED` on abort); the session stays dead and the next use starts
another worker, still with the notice. The existing test expected the aborted replacement to be
kept; it was updated: the replacement is terminated, the next eval starts a fresh worker and shows
the notice.

Validation:
- `cd packages/backend && npx vitest run src/shell/host.spec.ts` - Pass
  (`an evaluation cancelled while its worker restarts is not run and stops the restart (CANCELLED)`)

### O-4 - ShellHost.eval throws synchronously for an unknown session

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/host.spec.ts`

Problem:
`ShellHost.eval` threw `NOT_FOUND` synchronously instead of returning a rejected promise.

Fix:
The session lookup is wrapped; `eval` returns `Promise.reject(error)`.

Validation:
- `cd packages/backend && npx vitest run src/shell/host.spec.ts` - Pass
  (`answers an unknown session with a rejected promise, not a synchronous throw`)

## Not fixed

None. (CR-1, the host test gap, was not in the list given to the fixer; the test-writer's
`host.spec.ts` already covers it.)

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/shell` - Pass, 4 files, 140 tests
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 fixture) -
  Pass, 14 tests (2 new: exit/quit, completion after restart)

Full test suite:
- `npm run check` - Pass: eslint (0 warnings), prettier, type checks, vitest 59 files / 3413 tests,
  renderer 71 files / 2014 tests

Lint/type-check/build:
- Included in `npm run check` - Pass. The bundled `apps/desktop/dist/shell-worker.cjs` was not
  rebuilt (build output, not part of the check).

`.taskcheck`:
- Pass (it runs `npm run check`, result above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

Note for the parent worker: production code changed after the review, so test-writer and
code-reviewer evidence is stale and has to be refreshed; the coverage numbers in tests.md predate
these fixes.

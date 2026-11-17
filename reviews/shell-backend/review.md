# Code Review

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend

Scope: `git diff 160d1d5..HEAD` excluding `package-lock.json` (committed changes only; the untracked `packages/backend/src/shell/output.spec.ts` in the working tree is not part of the reviewed scope)

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions
- SPEC.md (M4 Shell, IPC section)
- docs/ARCHITECTURE.md
- docs/mongosh.md (the design implemented here)
- packages/contract/src/shell.ts
- AGENTS.md

Git range:
- Branch: main
- HEAD: 71c0e305bffbfb51cb0593c6c17552fca90e8c3b (the rebased implementation commit; code identical to 0124b5f, which differs from HEAD only in `tasks/shell-backend.md`)
- Base/start: 160d1d584f71ecb632361988b7c8d6ecafde703a
- Commits reviewed: 6 (1 implementation commit, 5 `assume:` commits)

Summary: 0 P0, 0 P1, 1 P2, 3 P3

Verification performed by the reviewer:
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman fixture, mongo 8 standalone) -> 1 file, 10 tests passed. Covers AC1 (`use <db>; db.c.insertOne({a:1}); db.c.find()` -> Cursor result with canonical EJSON), AC2 (cancel of `while (true) {}` ends with `CANCELLED` and the next eval succeeds, elapsed < 2000 ms), AC3 (`complete('db.c.fi')` contains `db.c.find` and `db.c.findOne`).
- `npm run check` -> lint, type check and all unit tests passed.
- `npm ls mongodb bson` -> the mongosh packages dedupe to the root `mongodb@7.9.0` / `bson@7.3.4`, as docs/mongosh.md requires.
- `python tasks.py verify shell-backend` -> no criterion has recorded evidence yet (expected before `done`; the parent worker records it).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | ShellHost session lifecycle beyond the three criteria is untested**
    - File: `packages/backend/src/shell/host.ts:119`, `packages/backend/src/server/backend.ts:62`
    - Category: Tests
    - Problem: `ShellHost` has an injectable `createWorker` for fakes, but no unit test uses it, and the integration test only drives the happy paths plus the two interrupt cases. Untested: the evaluation queue (second eval waits for the first; cancel of a queued eval), a worker that dies unexpectedly (`attach` exit handler -> "stopped unexpectedly" restart on next eval), `closeSession` while an eval is running (close grace timeout then terminate), `startWorker` failure mapping through `toConnectError` with secrets masked, and the `conn.close` wrapper in `startBackend` that calls `closeProfile` (a recorded assumption).
    - Why it matters: these are the concurrency and recovery paths most likely to regress (stale worker messages, hung streams, sessions left open after the connection closes), and none of them is exercised.
    - Suggested fix: add `host.spec.ts` with a fake `WorkerLike` covering queueing, cancel-while-queued, unexpected exit and restart, close during eval and open failure; add a test (unit or integration) that `conn.close` removes the profile's shell sessions.

## P3 Low

- [ ] **CR-2 | `exit` / `quit` close the session's client and answer with an internal error**
    - File: `packages/backend/src/shell/runtime.ts:50`
    - Category: Correctness
    - Problem: the evaluation listener sets no `onExit`. In shell-api 5.9.9, `exit()` checks `platform === 'CLI'` (true for `NodeDriverServiceProvider`), runs `instanceState.close()` (closes every `Mongo` and removes it from `state.mongos`), then calls `onExit?.()` and throws `MongoshInternalError('.onExit listener returned')` (`node_modules/@mongosh/shell-api/lib/shell-api.js:232-238`). `splitShellInput` deliberately routes `exit`/`quit` to the evaluator as commands, so typing `exit` shows "MongoshInternalError: .onExit listener returned" and leaves the session with an untracked, closed client: later cooperative interrupts find no `Mongo` to suspend, so a running server operation is no longer aborted by Cancel (only the 1 s worker restart remains).
    - Why it matters: a normal mongosh command produces a confusing internal error and silently degrades the session.
    - Suggested fix: provide `onExit` (for example throw a clear "use the tab's close button" error before anything is closed, or intercept `exit`/`quit` in the splitter/runtime) and record the chosen behavior as an assumption.

- [ ] **CR-3 | Completion fails after a worker restart until the next eval**
    - File: `packages/backend/src/shell/host.ts:184`
    - Category: Correctness
    - Problem: `complete` throws `CANCELLED` ("The shell is restarting") whenever `session.dead` is set, but nothing restarts the worker except `ensureWorker` in `runEval`. After a `while (true) {}` cancel or a worker crash, every Tab press fails until the user evaluates something. The `Session.dead` doc comment ("a replacement is started on next use") does not match this.
    - Why it matters: autocompletion (SPEC M4 Must) is silently unavailable after an interrupt, with an error that suggests a transient state.
    - Suggested fix: have `complete` run `ensureWorker` as well (through the queue or a shared restart promise so it does not race with a queued eval), or start the replacement right after `kill`.

- [ ] **CR-4 | Evals queued behind a closed session start and connect a new worker**
    - File: `packages/backend/src/shell/host.ts:137`
    - Category: Quality
    - Problem: `runEval` checks `signal.aborted` but not `session.closed`. `closeSession` marks the session dead, so each eval still waiting in the queue goes through `ensureWorker`, which starts a worker, connects a `MongoClient` to the server, and only then notices `session.closed` and terminates it.
    - Why it matters: closing a tab (or `conn.close`) with queued input causes needless worker starts and server connections after the user asked to close.
    - Suggested fix: return `NOT_FOUND` at the start of `runEval` (and before `startWorker` in `ensureWorker`) when `session.closed` is set.

## Review conclusion

Material issues found; fix before completing the task.

All three acceptance criteria are met and were reproduced by the reviewer; the findings are a test gap for the host's recovery and concurrency paths (CR-1) and low-priority behavior issues (CR-2 to CR-4). The parent worker decides which are in scope.

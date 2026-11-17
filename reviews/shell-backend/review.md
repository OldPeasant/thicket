# Code Review

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 2)

Scope: `git diff 00b7787..20ff545` (committed changes only, `package-lock.json` checked for the mongosh packages only), with special attention to the fix commit 20ff545 (`split.ts` comment handling, `host.ts` restart/exit logic, `runtime.ts` exit/quit). Reviewed revision: 20ff545112c87b030baae9c943ad088db4973637. Uncommitted spec-file edits in the working tree (another helper) are out of scope.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions (including the 03:07 exit/quit assumption)
- SPEC.md (M4 Shell, IPC section)
- docs/mongosh.md
- docs/ARCHITECTURE.md
- packages/contract (shell.* methods, ShellOutput)
- AGENTS.md
- round-1 reports: reviews/shell-backend/review.md (previous version), tests.md, fixes.md

Git range:
- Branch: main
- HEAD: 2708094b5afff8f523c451cf96f3c0829f978343 (rebased copy of the task commits; `git diff 20ff545 HEAD` over `packages/backend/src/shell`, `packages/backend/src/server`, `connections/manager.ts` and `apps/desktop/scripts/build.mjs` is empty, so the reviewed code is identical)
- Base/start: 00b77872e6a71c850815fba8de4d22045dff09e7
- Commits reviewed: 3 (1b7bc07 implementation, 723b4b0 tests + round-1 review, 20ff545 fixes)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Round-1 findings

- CR-1 (host lifecycle untested): resolved. `host.spec.ts` at 20ff545 uses a fake `WorkerLike` for queueing, cancel while queued, cooperative interrupt, grace-timeout restart, crash during and between evaluations, cancelled and failed restarts, close during eval/queue/restart, closeProfile/closeAll; `shell.int.spec.ts` covers `closeProfile` through `conn.close`.
- CR-2 (exit/quit close the client): resolved. `ShellRuntime.evaluateAll` answers an `exit`/`quit` command piece with `EXIT_TEXT`; the context's `exit`/`quit` are replaced after `state.setCtx` (which is only called in the constructor, `shell-instance-state.js:134`), so `exit()` throws before anything is closed. Verified the remaining path through mongosh's evaluator (`shell-evaluator.js:39-49` dispatches any piece whose first token is `exit`/`quit` to `shellApi.exit(...argv)`): every such piece the splitter does not catch has at least one string argument, and `ShellApi.exit` rejects it in `assertArgsDefinedType` before `instanceState.close()` (`shell-api.js:233-235`), so the client is not closed.
- CR-3 (completion after a restart): resolved. `complete` runs `ensureWorker`; restarts are shared via `session.restarting`, the notice is kept in `session.notice` for the next evaluation, and an aborted completion only stops waiting (`abortable` attaches handlers, no unhandled rejection; `restarting.then(clear, clear)` also handles it).
- CR-4 (queued evals of a closed session start workers): resolved. `runEval` throws `NOT_FOUND` first when `session.closed`; `restart` checks `closed` before and after `startWorker`.

Additional checks of the fix commit:
- Restart state machine (`host.ts:328-356`): traced eval-started restart aborted by its signal (session stays dead with the original `dead` object, notice preserved), completion and eval sharing one restart, close during restart (replacement terminated, `NOT_FOUND`), crash during eval (`told` suppresses the duplicate notice), crash while idle (notice on next eval), interrupt timeout (`RESTARTED_TEXT` on next eval). No stale-worker message leaks: `attach` ignores messages and exits of replaced workers.
- AC1 to AC3 remain covered by `test/integration/shell.int.spec.ts` (`use test; db.c.insertOne({a:1}); db.c.find()` EJSON, `while(true){}` interrupt under 2 s, `complete('db.c.fi')`). Note: this reviewer could not execute tests in this session (command execution beyond read-only inspection was denied); the run results come from fixes.md and must be confirmed by the parent worker's own `verify` evidence.
- No secrets, no new dependencies in the fix commit; build externals and mongosh package versions unchanged from round 1.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-5 | A comment glued to a command argument still swallows the following lines**
    - File: `packages/backend/src/shell/split.ts:89`
    - Category: Correctness
    - Problem: the TW-1 fix recognises a comment directly after the command word (`it//x`) or after whitespace (`use test // c`), but the argument pattern `[^\s;]+` greedily includes a `//` or `/*` that follows an argument without a space. `use test// c\ndb.c.find()` yields the arguments `test//` and `c`, so `commandAt` rejects it and the whole input becomes one JS piece; mongosh's evaluator then runs `use("test//", "c", "db.c.find()")` and the find is silently dropped (same symptom as TW-1). `show dbs//x` is accepted as `show("dbs//x")` and fails as an unknown show command. Not covered by `split.spec.ts` (only space-separated comments and `it//more` are tested).
    - Why it matters: an uncommon but valid way of commenting a command line silently loses the following input, the exact behavior the fix was meant to remove.
    - Suggested fix: exclude `//` and `/*` from inside an argument (for example `(?:(?!\/[/*])[^\s;])+`) so the comment branch takes them, and add `use test// c\ndb.c.find()` and `show dbs/* x */` cases to `split.spec.ts`.

## Review conclusion

No material issues found.

All four round-1 findings are resolved in 20ff545, the restart/exit changes hold up under the traced concurrency paths, and the acceptance criteria remain covered by integration tests. CR-5 is a low-priority edge case the parent worker may fix or accept.

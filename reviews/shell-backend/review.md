# Code Review

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 4, final review for the whole task)

Scope: all task commits `git diff 735b36d..8712197` (committed changes only, `package-lock.json` checked for the mongosh packages only), with special attention to the round-4 fix commit 8712197 (TW-2, `COMMAND` regex in `split.ts`). Reviewed revision: 871219790eb459a5a9ea6fcb7212cb6df3fbc3bb. At review time the working tree held uncommitted test-writer edits (`split.spec.ts`, untracked `zz-probe-tmp.spec.ts`); they were not reviewed as part of the task code.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions (including the exit/quit assumption)
- SPEC.md (M4 Shell, IPC section)
- docs/mongosh.md
- docs/ARCHITECTURE.md
- packages/contract (shell.* methods, ShellOutput)
- AGENTS.md
- earlier rounds: reviews/shell-backend/review.md (round 3), tests.md (TW-2), fixes.md (round 4)

Git range:
- Branch: main
- HEAD: 871219790eb459a5a9ea6fcb7212cb6df3fbc3bb
- Base/start: 735b36d36aa2edab5c72fc2c7dda7f749f430509 (`git merge-base HEAD origin/main`)
- Commits reviewed: 7 (2f0b3d7 implementation, 6339ca9 tests + round-1 review, 2708094 round-1 fixes, 92c9fb1 round-2 tests + review, 02d12f9 CR-5 fix, c95f534 round-3 tests + review, 8712197 TW-2 fix)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Changes since round 3

`git diff --stat 02d12f9 8712197 -- . ':!reviews' ':!tasks'` touches only `packages/backend/src/shell/split.spec.ts` (+63, tests), `test/integration/shell.int.spec.ts` (+13, a CR-5 integration test) and `packages/backend/src/shell/split.ts` (5 lines: the `COMMAND` regex and its doc comment). All other production code (`host.ts`, `runtime.ts`, `worker.ts`, `output.ts`, `handlers.ts`, server/connections wiring, `build.mjs`) is unchanged since round 2, so the earlier conclusions for it still hold.

## Earlier findings

- CR-1 (host lifecycle untested): resolved in round 2; unchanged.
- CR-2 (exit/quit close the client): resolved in round 2; unchanged.
- CR-3 (completion after a restart): resolved in round 2; unchanged.
- CR-4 (queued evals of a closed session start workers): resolved in round 2; unchanged.
- CR-5 (comment glued to a command argument): resolved in 02d12f9; the argument part of the regex is unchanged by 8712197, and the CR-5 unit cases plus the new integration case still apply.
- TW-2 (exponential backtracking in the trailing-comment part): resolved in 8712197, see below.

## Review of the TW-2 fix (8712197)

Old trailing part: `(?:(?:\/\*.*?\*\/|\/\/.*)[^\S\n]*)*`. New: `(?:(?:\/\*(?:[^*\n]|\*(?!\/))*\*\/|\/\/.*(?!.))[^\S\n]*)*`.

- Block comment: the body alternatives `[^*\n]` and `\*(?!\/)` are disjoint, and the body cannot contain `*/`, so a block comment ends exactly at its first `*/` (as JavaScript and `skipBlockComment` do). `/* **/`, `/***/`, `/* * / */` still match as one comment. A given text has a single way to be split into comments, so the outer `*` no longer explores 2^n groupings.
- Line comment: `.*(?!.)` forces the comment to run to the end of the `.` run (end of input, or a `\r`/U+2028/U+2029). A failing attempt costs O(L) cheap lookahead checks per `//` start, no regrouping. After it, `[^\S\n]*` can take the terminator character, and a further `//` or `/*` can begin only after it, so the iteration is still unambiguous; the CRLF case (`use test // first\r\ndb.c.find()`) behaves as before.
- Every loop iteration consumes at least two characters, so there is no empty-iteration ambiguity.
- Remaining parts checked for super-linear backtracking: the command word and its lookahead are fixed; arguments are whitespace-free runs separated by mandatory whitespace (`[^\S\n]+`) and cannot start a comment at any position, so the argument loop has a single parse, and its overlap with the following `[^\S\n]*` is linear (a whitespace run can only be given back character by character, each failing immediately). `commandAt` still slices the input at the next `\n`, so the `(?=\n)` alternative and every quantifier work within one line. No remaining nested ambiguous quantifier was found.
- Accepted inputs: the documented change (`use a /* x */ b */` is no longer a command and goes to mongosh whole) is correct JavaScript semantics. One further, undocumented difference exists, see CR-1 below; it is an improvement, not a regression.
- `commandAt`'s argument-count and identifier checks, statement-start detection and the string/template/regex/comment skipping in `splitShellInput` are untouched.
- The committed TW-2 timing tests (`28 block comments then code`, `28 glued block comments then code`, 1 s bound) pass, and so do all pre-existing split cases.

## Verification run by this reviewer

- `npx vitest run packages/backend/src/shell/split.spec.ts packages/backend/src/shell/handlers.spec.ts packages/backend/src/shell/output.spec.ts packages/backend/src/shell/host.spec.ts` at 8712197 production code -> 4 files, 215 tests passed in 2.7 s. `split.spec.ts` in the working tree is the committed file plus the test-writer's uncommitted, bounded additions (more TW-2 timing and semantics cases, all passing); `handlers`, `output` and `host` specs are the committed versions.
- `npx vitest run packages/backend/src/shell` (whole directory) was stopped by a 300 s timeout: it also picks up the untracked `packages/backend/src/shell/zz-probe-tmp.spec.ts`, which is not part of the committed code. The parent worker must make sure that file is removed and never committed.
- Ad-hoc regex probing outside the test runner was not available in this session; the old/new comparison above is by reading the patterns.
- Integration tests (`test/integration/shell.int.spec.ts`, Podman) were not run by this reviewer; fixes.md reports `npx vitest run --config test/integration/vitest.config.ts shell` -> 17 passed. AC1 to AC3 remain covered there; the parent worker's `tasks.py verify` evidence must come from its own run.
- No secrets, no dependency changes in the round-4 commit.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A CR or U+2028/U+2029 inside a trailing block comment is now accepted; the fix notes say otherwise**
    - File: `packages/backend/src/shell/split.ts:93`
    - Category: Quality
    - Problem: the old block-comment body `.*?` could not match `\r`, U+2028 or U+2029; the new body `[^*\n]` matches them. So `use a /* x\ry */\nq` was not a command before (sent to mongosh whole) and now splits into `use a` and `\nq`. fixes.md states the only behavior change is the `*/` one and that the body excludes a line break "as before, since `.` excluded `\n`", and no test pins the new behavior.
    - Why it matters: the new behavior is the more correct one (JavaScript allows these characters in a block comment, and `splitShellInput` treats `\r` as whitespace), so this is not a functional regression, but the recorded scope of the change is inaccurate and an unintended future revert would go unnoticed.
    - Suggested fix: mention the difference in the fix notes or the regex doc comment and add one `split.spec.ts` case such as `'use a /* x\ry */\nq' -> ['use a', '\nq']`. Optional; does not block the task.

## Review conclusion

No material issues found.

The TW-2 fix removes the exponential (block comments) and quadratic (line comments) backtracking without introducing new ambiguity anywhere in `COMMAND`, the only production change since round 3 is that regex, all earlier findings (CR-1 to CR-5 of earlier rounds, TW-2) remain resolved, and the shell unit specs pass at 8712197. The one P3 note above is documentation/test hygiene only.

---

# Code Review (round 5: merge resolutions)

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 5, after the main merges 369c532 and 515cdb8)

Scope: `git diff origin/main...HEAD` (merge-base 1ec66b38860e9925cd05c63d8ca088ca93ace3d6, which equals origin/main) with focus on the conflict resolutions in `apps/desktop/scripts/build.mjs`, `packages/backend/package.json`, `packages/backend/src/index.ts`, `packages/backend/src/server/backend.ts`, `packages/backend/src/connections/manager.ts`, plus how the shell host integrates with the features that arrived from main through those merges (SSH tunnel, MONGODB-AWS, LDAP). Committed changes only. Reviewed revision: 515cdb8ab181c7697c121441ae903f883f68f2c5.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions
- SPEC.md (M4 Shell, M5 MONGODB-AWS)
- docs/mongosh.md, docs/ARCHITECTURE.md
- AGENTS.md
- round 4 of this report and fixes.md

Git range:
- Branch: main
- HEAD: 515cdb8ab181c7697c121441ae903f883f68f2c5
- Base/start: 1ec66b38860e9925cd05c63d8ca088ca93ace3d6 (origin/main)
- Commits reviewed: 9 non-merge task commits (2f0b3d7 .. a6e4257) and 8 merge commits (369c532 .. 515cdb8); working tree clean

Summary: 0 P0, 1 P1, 0 P2, 1 P3

## Merge resolution check

- Nothing from main was dropped: the only `-` lines of `git diff origin/main...HEAD` outside `package-lock.json` and `reviews/` are replaced by supersets (`external` list in build.mjs, the `options` import and the `createClient` assignment in manager.ts, the `rpc` import in backend.spec.ts, `...connHandlers(connections)` replaced by the wrapped `...conn`).
- `package-lock.json`: comparing the `packages` maps of origin/main and HEAD gives 0 entries removed, 0 versions changed, 271 added (the mongosh packages and their dependencies); `packages/backend` in the lock lists the four `@mongosh/*` pins of package.json. One `mongodb` (7.9.0) is used by both the backend and `@mongosh/service-provider-node-driver`.
- `backend.ts`: SSH (`KnownHosts`, `HostKeyPrompts`, `sshHandlers`, the `ssh` option), `indexHandlers`, `ioHandlers` and the shell wiring (`ShellHost`, `shellHandlers`, the `conn.close` wrapper that closes the profile's shells after the connection) are all present and inside `guardWrites`.
- `manager.ts`: `configOf` records the `{uri, options}` of every client made through `createClient`, which covers both `test` and `connect`; with an SSH tunnel the recorded options carry the tunnel's local proxy, so shells go through the tunnel.
- `index.ts` exports `./shell` next to `./ssh`; `entry.ts` passes `shellWorker` next to `userData`.
- `build.mjs`: `common.external` keeps `cpu-features` from main and adds `kerberos` and `mongodb-client-encryption`; the worker entry spreads `common.external` and adds its two lazy requires.

## Verification run by this reviewer

- `npx vitest run packages/backend/src/shell packages/backend/src/server/backend.spec.ts packages/backend/src/connections/manager.spec.ts` at 515cdb8 -> 6 files, 371 tests passed (the stray `zz-probe-tmp.spec.ts` of round 4 is gone).
- In-memory esbuild bundles (`write: false`) of `packages/backend/src/server/entry.ts`, `packages/backend/src/shell/worker.ts` and `apps/desktop/src/main/index.ts` with the externals of build.mjs -> all three built with 0 warnings.
- `node -e` with a `worker_threads` Worker: `postMessage({ options: { authMechanismProperties: { AWS_CREDENTIAL_PROVIDER: () => ... } } })` -> throws `DataCloneError ... could not be cloned` (basis of CR-2).
- Integration tests were not re-run by this reviewer; the task file records 17/17 at 369c532.

## P0 Critical

None.

## P1 High

- [ ] **CR-2 | shell.open fails for MONGODB-AWS profiles with explicit keys and leaks a worker thread**
    - File: `packages/backend/src/shell/host.ts:381` (with `packages/backend/src/auth/aws/aws.ts:63`)
    - Category: Integration
    - Problem: the AWS auth merged from main puts a function into the driver options (`authMechanismProperties.AWS_CREDENTIAL_PROVIDER: () => Promise.resolve(credentials)`). `configOf` hands those options to the shell host, which sends them to the worker with `worker.postMessage({ type: 'open', uri, options, db })`. Structured clone cannot copy a function, so `postMessage` throws `DataCloneError` synchronously. The call is before the `try` at line 382, so the `catch` that terminates the worker never runs: the worker created at line 366 stays alive (waiting for an `open` it never gets) and `shell.open` fails with a non-`RpcError` (INTERNAL with a DataCloneError text) instead of opening a shell.
    - Why it matters: SPEC M4 requires a mongosh console per connection and SPEC M5 makes MONGODB-AWS with access key / secret / session token a Must; after the merge every such connection can connect but cannot open a shell, and each attempt leaks one worker thread for the life of the backend. No unit test covers function-valued options or a throwing `postMessage` on open.
    - Suggested fix: send only cloneable data to the worker (e.g. strip `AWS_CREDENTIAL_PROVIDER` and pass the static credentials as plain fields that the worker turns back into a provider, or build the options in the worker from the same profile data), mask the AWS secret access key and session token in `secretsOf`, and move the `postMessage` inside the `try` so any failure terminates the worker. Add a host test where `postMessage` throws on `open` and one for an AWS-key configuration.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | Shell sessions of an SSH profile keep a dead tunnel after the tunnel is lost**
    - File: `packages/backend/src/server/backend.ts:96` (with `packages/backend/src/connections/manager.ts:318`)
    - Category: Correctness
    - Problem: shell sessions are closed only through the `conn.close` RPC wrapper. When the SSH tunnel drops, `tunnelLost` sets the connection to `error` and closes the main client, but the profile's shell sessions keep their recorded config pointing at the closed tunnel's local proxy. If the user opens the connection again (a new tunnel with a new proxy port and credentials) without a `conn.close` first, the old shell tabs stay broken, and their restart after an interrupt (`restart` reuses `session.config`) fails too.
    - Why it matters: a recoverable network event leaves shell tabs that only fail until the user closes them; the recorded assumption "conn.close also closes that profile's shell sessions" does not cover connection loss.
    - Suggested fix: close (or mark dead with a clear message) the profile's shells on the `conn.status` transition to `error`/`disconnected` as well, e.g. from the manager's `onStatus` callback in `startBackend`, and add a test.

## Review conclusion

Material issues found; fix before completing the task.

The merge resolutions themselves are correct: nothing from main or from the task was dropped, the lockfile only adds packages, the shell wiring and the build externals are intact and the bundles build. CR-2 is an integration defect between the shell host and the MONGODB-AWS auth that arrived with the merges and should be fixed before `done`; CR-3 is a low-priority resilience note.

---

# Code Review (round 6: CR-2/CR-3 fixes and latest main merge)

Date: 2026-11-17

Task: shell-backend - M4: mongosh host in the backend (round 6)

Scope: `git diff origin/main...HEAD` (whole task diff), with focus on fix commit 5914df0 (`packages/backend/src/shell/{host,protocol,worker}.ts`, `packages/backend/src/server/backend.ts` and their specs) and merge commit 6628377 (origin/main b739b48, which brought `ConnectionManager.cancelOnClose`/close-time stream cancellation). Committed changes only. Reviewed revision: 662837788fd88af6de9c0c267891dbd3f88857dd.

Requirements:
- tasks/shell-backend.md acceptance criteria and recorded assumptions
- SPEC.md (M4 Shell, M5 MONGODB-AWS), docs/mongosh.md, docs/ARCHITECTURE.md, AGENTS.md
- round 5 of this report, fixes.md (round 5)

Git range:
- Branch: main
- HEAD: 662837788fd88af6de9c0c267891dbd3f88857dd
- Base/start: b739b48d188a45b25e68023ffc6cc61f3479e17e (`git merge-base HEAD origin/main`, equals origin/main)
- Commits reviewed: fix commit 5914df0 and merge 6628377 in detail; the whole task diff (22 files outside `package-lock.json`, `reviews/`, `tasks/`) sanity-checked; working tree clean

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Round 5 findings

- CR-2 (round 5, AWS provider DataCloneError and leaked worker): resolved.
  - `cloneableOptions` (`host.ts:410`) removes `AWS_CREDENTIAL_PROVIDER`, calls it in the host and sends plain `{accessKeyId, secretAccessKey, sessionToken?, expiration?}` (all structured-clone safe, `expiration` is a `Date`); other `authMechanismProperties` are kept, an empty properties object is dropped. `withAwsCredentials` (`protocol.ts`) rebuilds a static provider in the worker before `ShellRuntime.open`; profiles without a user name (default AWS chain) have no provider and pass through unchanged, so the driver in the worker builds its own chain as `conn.open` does.
  - `createWorker` is the only step before the `try`; option preparation, `postMessage` and the wait are inside it, so a throwing provider, a `DataCloneError`, a cancel or an open failure all terminate the worker (`host.ts:385-401`). `opened.catch(() => undefined)` prevents an unhandled rejection if the worker exits while the options are still being prepared. No leak path found; `restart` uses the same `startWorker`, so a restarted AWS session works too.
  - Secrets: `secretsOf` now masks the resolved AWS secret access key and session token; `secrets` is updated before `postMessage`, so both the worker's `openFailed` message and the host log line (`failure.message` after `toConnectError`) are masked. The access key id is not a secret and stays visible, consistent with `conn.open`. No credential is logged by the new code; the `awsCredentials` field is only posted to the worker, never logged.
  - Tests in `host.spec.ts` ("driver options cross postMessage (MONGODB-AWS)") cover the clone-safe message, the worker-side rebuild, kept properties, a non-static provider per start, a throwing `postMessage`, a failing provider and masking.
- CR-3 (round 5, shells kept after tunnel loss): resolved. The `onStatus` callback in `startBackend` (`backend.ts:79-90`) calls `shells.closeProfile` for `error`/`disconnected` and logs (not throws) a failure. `onStatus` is only called by `tunnelLost` (`manager.ts:343`).
  - Race with a reconnect: `closeProfile` selects the profile's sessions and `closeSession` marks each `closed` and removes it from the map synchronously, before its first `await`, all inside the synchronous `onStatus` call. A `conn.open` after the tunnel loss cannot have produced shells yet, and shells opened on the new connection are never in the closed set. A restart running at that moment checks `session.closed` after `startWorker` and terminates its new worker (`host.ts:348`). No race with `conn.open`/reconnect found; the remaining window is an in-flight `shell.open`, see CR-1 below.
  - The backend.spec test drives the real `deps.onStatus` of the manager built by `startBackend` and asserts `closeProfile` only for `error`/`disconnected`.

## Merge 6628377 check

- `git diff b739b48 6628377 --stat -- packages/` lists only task files; `manager.ts` differs from main only by the task's `ClientConfig` import, the `configs` WeakMap/`createClient` wrapper and `configOf`. Main's `cancelOnClose`, `RunningWork`, `CLOSE_CANCEL_GRACE_MS` and the stream cancellation in `close` are intact.
- The `conn.close` wrapper still calls the manager's `close` first (which now cancels streams with up to 5 s grace) and then `shells.closeProfile`; shells are not manager work, so the two do not interfere.
- `manager.spec.ts` merged result passes together with the task's `configOf` tests.

## Verification run by this reviewer

- `npx vitest run packages/backend/src/shell packages/backend/src/server/backend.spec.ts packages/backend/src/connections/manager.spec.ts` at 6628377 -> 6 files, 391 tests passed.
- Reading `packages/backend/src/connections/options.ts` and `packages/backend/src/auth/`: the AWS provider is the only function-valued driver option produced on this revision.
- Integration tests and a real MONGODB-AWS server were not run by this reviewer (fixes.md records the Podman shell integration suite 17/17 and states that no AWS fixture was used).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A shell.open in flight while the connection is closed or its tunnel is lost registers a session afterwards**
    - File: `packages/backend/src/shell/handlers.ts:22` (with `packages/backend/src/shell/host.ts:107-118`)
    - Category: Correctness
    - Problem: `shell.open` takes `manager.configOf(profileId)` and then waits for the worker to connect (`startWorker`). The session is put into `sessions` only after that. A `conn.close` (wrapper in `backend.ts:104-108`) or a tunnel loss (`onStatus`, `backend.ts:85-89`) during that wait runs `closeProfile` before the session exists, so it is not closed. For a direct (non-SSH) connection the worker's own client connects successfully and the shell session stays open after its connection was closed; nothing checks that the connection is still the same afterwards.
    - Why it matters: the recorded behavior "conn.close also closes that profile's shell sessions" (and the CR-3 fix for connection loss) does not hold for a session that was opening at that moment; the window is a few hundred milliseconds to the driver's connect timeout, so it is narrow but reachable (e.g. user disconnects right after opening a console).
    - Suggested fix: after `host.open` resolves, check that the profile's open client is still the one `configOf` was read from (e.g. `isOpenClient(manager, profileId, client)` captured before the open) and otherwise close the new session and answer `CANCELLED`/`NOT_CONNECTED`; add a handler test with a close during a pending open.

## Review conclusion

No material issues found.

The CR-2 fix correctly removes the function from the cross-thread message, rebuilds the provider in the worker, terminates the worker on every failure path and masks the AWS secret and session token; the CR-3 fix closes a profile's shells on connection loss without racing a reconnect. The latest main merge kept main's `cancelOnClose` changes intact, and the focused unit suites pass at 6628377. The single P3 is a narrow pre-existing race that the parent worker may fix or record.

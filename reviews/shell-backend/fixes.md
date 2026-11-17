# Fix Report

Date: 2026-11-17

Task: shell-backend — mongosh host in worker threads (shell.open/eval/complete/close)

Scope: current task. This report covers three fix rounds: CR-5 from
`reviews/shell-backend/review.md` (round 3, commit 02d12f9), TW-2 from
`reviews/shell-backend/tests.md` (round 4) and CR-2 and CR-3 from the "round 5: merge
resolutions" section of `reviews/shell-backend/review.md` (round 5, on top of e4661bc, this
change, uncommitted). The round-5 finding IDs are those of the round-5 review section, not the
resolved CR-2/CR-3 of round 1.

## Fixed findings

### CR-5 — A comment glued to a command argument still swallows the following lines

Round: 3 (commit 02d12f9)

Files changed:
- `packages/backend/src/shell/split.ts`
- `packages/backend/src/shell/split.spec.ts`

Problem:
The argument pattern in `COMMAND` was `(?!\/[/*])[^\s;]+`: only the first character of an
argument was checked, so a `//` or `/*` directly after an argument (`use test// c`, `show dbs//x`,
`show dbs/* x */`) became part of the argument. `use test// c\ndb.c.find()` was then rejected as a
command (two arguments) and passed whole to mongosh, which dropped the `db.c.find()`; `show dbs//x`
became `show("dbs//x")`.

Fix:
The argument pattern is now `(?:(?!\/[/*])[^\s;])+`: no character of an argument may start `//` or
`/*`, so the trailing-comment branch takes the comment. A single `/` inside an argument (`use a/b`)
is still part of it. Doc comment of `COMMAND` updated accordingly.

Tests added to the "trailing comment edge cases" table in `split.spec.ts`:
- `use test// c\ndb.c.find()` -> `['use test', '\ndb.c.find()']`
- `show dbs//x` -> `['show dbs']`
- `show dbs/* x */` -> `['show dbs']`
- `use test/* c */\nx` -> `['use test', '\nx']`
- `show profile 5//last\nx` -> `['show profile 5', '\nx']`
- `use a/b\nx` -> `['use a/b', '\nx']` (single slash stays in the argument)

All previously existing split cases still pass unchanged.

Validation (round 3):
- `npx vitest run packages/backend/src/shell` — Pass (4 files, 165 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman) — Pass (1 file, 16 tests)
- `npm run check` — Pass

### TW-2 — Catastrophic backtracking in the trailing-comment part of `COMMAND`

Round: 4 (this change, uncommitted)

Files changed:
- `packages/backend/src/shell/split.ts` (the `COMMAND` regex and its doc comment only)

Problem:
The trailing-comment part `(?:(?:\/\*.*?\*\/|\/\/.*)[^\S\n]*)*` was ambiguous. The lazy `.*?` of
the block-comment branch could also span several comments (`/**/ /**/` as one comment), so when
the match failed at the end (`use a /**/ /**/ ... /**/ x`) the engine tried every grouping of the
comments: 2^n steps. 28 comments took 3.3 to 6.1 s (split.spec.ts tests "28 block comments then
code" and "28 glued block comments then code" failed their 1 s bound).

While checking the rest of the regex as asked, a second, quadratic ambiguity was found in the same
part: the line-comment branch `\/\/.*` could stop early and leave its trailing spaces to the
following `[^\S\n]*` (and a later `//` inside it could start a new loop iteration). With
`use a //` + 20000 spaces + a U+2028 + `x`, the match took about 730 ms.

Fix:
- Block comment: `\/\*(?:[^*\n]|\*(?!\/))*\*\/`. The body cannot contain `*/` (nor a line break,
  as before, since `.` excluded `\n`), so a block comment ends at its first `*/`. This matches how
  `skipBlockComment` in the same file and JavaScript itself end a block comment.
- Line comment: `\/\/.*(?!.)`. The comment must run as far as `.` matches (to the end of the line
  or a `\r`/U+2028/U+2029), so it has a single possible extent. Accepted inputs are the same as
  before (e.g. the CRLF case `use test // first\r\ndb.c.find()` still splits).
- The argument part (`(?:[^\S\n]+(?:(?!\/[/*])[^\s;])+)*` followed by `[^\S\n]*`) was checked:
  an argument cannot contain whitespace and arguments need a separator, so it has one way to
  match; only the trailing whitespace overlaps with the separator, which is linear per position
  and was measured (below).

Only behavior change: a block comment can no longer extend past its first `*/`
(`use a /* x */ b */` was a command `use a` before; now it is not a command and goes to mongosh
whole, as JavaScript would read it). No test depended on the old behavior.

The failing tests were kept unchanged; no test was weakened or removed.

Validation (round 4):
- `npx vitest run packages/backend/src/shell` — Pass (4 files, 190 tests, including both TW-2
  timing tests)
- Ad-hoc timing check, not committed (`npx tsx -e` importing `split.ts`): 5000 spaced or glued
  `/**/` then code 0.5 to 1.0 ms; 3000 `/***/ /* * */` 1.1 ms; 5000 ` //` 0.1 ms; `//` + 20000
  spaces + U+2028 + `x` 0.1 ms (was about 730 ms); 30000 trailing spaces then `(` 0.8 ms; 10000
  `a/ /` arguments 3.6 ms; 10000 unterminated `/* /*` 0.6 ms. Semantics spot checks:
  `use a /* x */ /** y **/ // z\r\nq` -> `['use a', '\nq']`, `use a // c\r// d\nq` ->
  `['use a', '\nq']`, `use a // c\rx` -> not a command, `show dbs /***/;x` -> `['show dbs', 'x']`.
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman, MongoDB 8 container
  fixture) — Pass (1 file, 17 tests)
- `npm run check` — Pass

### CR-2 (round 5) — shell.open fails for MONGODB-AWS profiles with explicit keys and leaks a worker thread

Round: 5 (on top of e4661bc)

Files changed:
- `packages/backend/src/shell/host.ts`
- `packages/backend/src/shell/protocol.ts`
- `packages/backend/src/shell/worker.ts`
- `packages/backend/src/shell/host.spec.ts`

Problem:
Confirmed at e4661bc: `auth/aws/aws.ts` puts a function (`AWS_CREDENTIAL_PROVIDER`) into
`authMechanismProperties`; `ShellHost.startWorker` posted `config.options` as is, so
`postMessage` threw `DataCloneError` synchronously. The call was before the `try`, so the new
worker was never terminated, and `shell.open` failed with a non-`RpcError`. The AWS secret access
key and session token were not in the masked secrets.

Fix:
- `host.ts`: `cloneableOptions` removes `AWS_CREDENTIAL_PROVIDER` from the options sent to the
  worker and calls it in the host (works for static and non-static providers, on every start
  including restarts); the plain credentials (access key id, secret, optional session token and
  expiration) go to the worker as `awsCredentials` in the `open` message. Other
  `authMechanismProperties` are kept. The session keeps its original `ClientConfig`.
- The options are prepared and `postMessage` is called inside the `try`, so a provider failure,
  a cancel or a throwing `postMessage` terminates the worker; the error is mapped with
  `toConnectError` (secrets masked) before it is logged and thrown.
- `secretsOf` also masks the resolved AWS secret access key and session token (open errors from
  the worker and the log line).
- `protocol.ts`: the `open` message gets a typed optional `awsCredentials: AWSCredentials`;
  `withAwsCredentials(options, credentials)` rebuilds a static
  `AWS_CREDENTIAL_PROVIDER: () => Promise.resolve(credentials)`. `worker.ts` applies it before
  `ShellRuntime.open`.
- Tests (`host.spec.ts`, new describe "driver options cross postMessage (MONGODB-AWS)"):
  options built by `awsAuthOptions` are posted as clone-safe data (`structuredClone` of the posted
  message succeeds, no provider in the posted options, credentials present); the worker side
  rebuilds a provider that resolves to the credentials after a structured clone; other mechanism
  properties are kept and a non-static provider is called on each start; a `postMessage` that
  throws `DataCloneError` on open rejects (INTERNAL) and terminates the worker; a failing
  provider rejects, posts nothing and terminates the worker; the AWS secret and session token are
  masked in the open error and the logs.

Validation:
- `npx vitest run src/shell/host.spec.ts` (packages/backend) — Pass (53 tests)
- `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts`
  (repo root, Podman, real worker from source) — Pass (17 tests)
- `npm run build` in `apps/desktop` — Pass (`dist/shell-worker.cjs` bundles
  `withAwsCredentials`; build output is not tracked)

Not verified here: a shell against a real MONGODB-AWS server (no AWS fixture in this round); the
driver gets the same static provider shape that `conn.open` uses.

### CR-3 (round 5) — Shell sessions of an SSH profile keep a dead tunnel after the tunnel is lost

Round: 5 (on top of e4661bc)

Files changed:
- `packages/backend/src/server/backend.ts`
- `packages/backend/src/server/backend.spec.ts`

Problem:
Confirmed: shell sessions were closed only by the `conn.close` wrapper; the manager's
`onStatus` broadcast (called by `tunnelLost`, state `error`) did not touch them, so they kept a
config pointing at the closed tunnel.

Fix:
In `startBackend`, the `ShellHost` is now created before the `ConnectionManager`, and its
`onStatus` callback, after broadcasting `conn.status`, calls `shells.closeProfile(profileId)` when
the state is `error` or `disconnected` (`CONN_STATES` in `packages/contract/src/conn.ts`); a
failure is logged, never unhandled. New test in `backend.spec.ts`: the manager's `onStatus`
closes the shells for `error` and `disconnected`, not for `connected`/`connecting`.

Validation:
- `npx vitest run src/server/backend.spec.ts` (packages/backend) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/shell` — Pass, 4 files, 190 tests

Full test suite:
- `npm run check` unit suites — Pass (backend/root 59 files / 3463 tests; renderer 72 files /
  2154 tests)
- `npx vitest run --config test/integration/vitest.config.ts shell` (Podman) — Pass, 17 tests

Lint/type-check/build:
- `npm run check` (eslint, prettier --check, type checks, unit tests) — Pass

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed.

Remaining unresolved findings:
0

No coverage was run in these rounds.

Round 5 (CR-2, CR-3):
- `npx vitest run` in `packages/backend` — Pass, 33 files, 1421 tests
- `npx vitest run --config test/integration/vitest.config.ts test/integration/shell.int.spec.ts`
  (repo root, Podman) — Pass, 17 tests
- `npm run check` (eslint, prettier --check, type checks, unit suites: root 68 files / 3764
  tests, renderer 80 files / 2418 tests) — Pass; `.taskcheck` runs exactly this command
- `npm run build` in `apps/desktop` — Pass
- Remaining unresolved findings after round 5: 0

## Final status

All validated findings fixed and validation passed.

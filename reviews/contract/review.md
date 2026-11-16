# Code Review

Date: 2026-11-16

Task: contract - M0: Typed IPC contract (envelope, errors, all method groups)

Scope: second pass on the code up to a414a09, plus a third, narrow pass on the delta to the final revision. Second pass: `git diff 721a273..a414a09`, limited to this task's commits: bfebc59 (contract), 7bf1c08 (contract tests and reports) and a414a09 (fixes for CR-1..CR-5, TW-1 and the `ejsonValue` blank-text observation). The other commits in that range belong to `int-harness`, `uri-model` and `explorer-copy` (task bookkeeping and integration fixtures). They were not reviewed here. Third pass: `git diff a414a09 77349c5 -- packages/`. The only code change is in commit 77349c5, which adds tests to `packages/contract/src/methods.spec.ts`. Committed changes only; the working tree was clean.

Final reviewed revision: 77349c5d864a0bbab16dc8cd282e172e5a63ec5d

Requirements:
- `tasks/contract.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 4 (API contract), section 3 M1 "Safety", sections 5 and 6
- `docs/ARCHITECTURE.md` (API contract section)
- `AGENTS.md`
- First review `reviews/contract/review.md` (CR-1..CR-5) and fixer report `reviews/contract/fixes.md`

Git range:
- Branch: main
- HEAD: 77349c5d864a0bbab16dc8cd282e172e5a63ec5d
- Base/start: 721a27361eadde378e1225eb2d7fd03043ae1c7e (second pass); a414a09494d73ba47f92c19d9ccb4d3d97e32414 (third pass)
- Commits reviewed: 4 (bfebc59, 7bf1c08, a414a09, 77349c5)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Commands run

- `cd packages/contract && npx vitest run` (second pass, at a414a09): 2 files, 596 tests passed.
- `npx eslint packages/contract --max-warnings 0`: no problems.
- `npm run check` (repo root): lint and prettier passed. `typecheck` failed, but only in `test/integration/**` (`Cannot find module 'mongodb' / 'testcontainers' / 'node-forge'`). These dependencies belong to the `int-harness` task. They are declared in `package.json` and `package-lock.json`, but they are not installed in this clone's `node_modules`. This is a local environment problem, not a problem in the contract task. Running `npx tsc -p tsconfig.json` and filtering out `test/integration` leaves no errors. `npm run typecheck --workspaces` passed. The parent worker should run `npm ci` and then `.taskcheck` again before `done`.
- I reproduced the `hasPassword` logic with `node -e` on edge-case URIs. Results are under CR-6.
- Third pass, at 77349c5: `cd packages/contract && npx vitest run`: 2 files, 596 tests passed. (The second-pass run already counted the two new `it` blocks, because they were in the working tree when the second pass ran. `methods.spec.ts` has 31 `it(` calls at a414a09 and 33 at 77349c5.)

## Third pass: delta a414a09..77349c5

`git diff --stat a414a09 77349c5 -- packages/` shows a single changed file, `packages/contract/src/methods.spec.ts` (+37 lines). It contains no production changes. I checked each new assertion by hand against `hasPassword` (`profiles.ts:49-54`) and `FILE_PURPOSES` (`profiles.ts:69`):

- "ignores `@` and `:` outside the authority ... and in IPv6 hosts": in every URI, the authority (cut at the first `/`, `?` or `#`) either has no `@`, or has a userinfo before its last `@` with no `:` (`alice`, `alice%40corp.example.test`, `alice%3Apw`). So `false` is correct. The `save(...).ok === true` subset agrees with this.
- "detects a password with an empty username, an unescaped `@`, IPv6 hosts or an srv URI": every userinfo before the last `@` contains a `:` (`:pw`, `alice:p@ss`, `alice:pw`). So `true`/`save` rejection is correct. The srv case with `appName=x@y` in the query also checks that a query `@` does not move the split point.
- `profiles.chooseFile`: `exportFile` is not in `FILE_PURPOSES`, so the params rejection is correct. `{ path: '/home/alice/ca.pem' }` matches the result schema `{ path: string.min(1).nullable() }`.
- The `expect([uri, value]).toEqual([uri, expected])` pattern puts the failing URI in the failure message. That is a reasonable way to label table cases inside a loop.

The tests assert behavior, use only `example.test` hosts and dummy passwords (no real secrets), and weaken no existing test. As intended, they do not cover the CR-6 inputs (`u:pa?ss@h` and similar). CR-6 is still open because the production code did not change. No new findings.

## Status of earlier findings

- **CR-1 (password in `connectionString`)**: resolved. `profiles.ts:49-54,105-113` adds `hasPassword` and a `.refine` with a readable message that does not echo the password. Because the check is on the `profile` field, it applies to `profiles.save` params, `conn.test` drafts (through `profileDraft = profile.extend`), and the `profiles.list/get/save/duplicate` and import results. The tests cover these cases: multi-host, srv, IPv6, query/path/fragment text that contains `@` or `:`, an empty username, an unescaped `@`, a percent-encoded password, and leaks in results and drafts (`methods.spec.ts:555-630`; the edge cases were committed in 77349c5). One remaining edge case is listed as CR-6.
- **CR-2 (no file picker)**: resolved. `profiles.chooseFile` (`profiles.ts:197-203`) is main-routed, takes `purpose` as an enum with strict params, and returns `{ path: string | null }`. The exception to "the renderer never sends file paths" is documented on the fields and in ARCHITECTURE.md. A sample was added to `SAMPLES`, so the every-method test covers it, and dedicated tests were added (77349c5 adds an unknown-purpose rejection and a non-null result case).
- **CR-3 (cancel routing)**: resolved as documentation (`envelope.ts:53-64`, ARCHITECTURE.md "Cancel routing"). The owner rule and the streamId to owner map are now stated, and the wrong field name in the comment (`target` instead of `cancel`) was corrected.
- **CR-4 (`docs.find` paging)**: resolved. `docs.ts:56-77` has two refines with readable messages. They reject `after` together with `before`, and `skip` together with either range-paging field. The tests cover each rejected combination. The schema walker and the every-method sample test still pass with the refined object.
- **CR-5 (rule for `confirmed`)**: resolved. `define.ts`, `common.ts` (`writeFields`) and ARCHITECTURE.md now state the bulk-write rule. It matches `errors.ts` and the recorded assumption.
- **TW-1 / blank `ejsonValue`**: checked. `ejsonDocumentOrArray` (`common.ts:53-65`) is a single string schema registered as `documentOrArray`, and the message names both accepted shapes. `ejsonValue` rejects whitespace-only text. Both have tests.

## Acceptance criteria

1. Every method has a schema, valid samples parse, and invalid samples fail with a readable message: met. `profiles.chooseFile` is included.
2. Documents are EJSON strings everywhere: met. The new `documentOrArray` kind is registered in `ejsonSchemas`, so the walker accepts `docs.updateMany.update`.
3. Writes carry `profileId` and optional `confirmed`: met. Unchanged by the fixes.
4. `npm run check` passes and the package has no `any`: met for the contract package (lint, prettier, contract tests and contract typecheck pass). The root `typecheck` fails only because the `int-harness` dependencies are missing locally (see "Commands run").

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | `hasPassword` misses a password that contains an unescaped `/`, `?` or `#`**
    - File: `packages/contract/src/profiles.ts:49-54`
    - Category: Security
    - Problem: The authority is cut at the first `/`, `?` or `#` before the code looks for `@`. So in `mongodb://u:pa?ss@h`, `mongodb://u:pa/ss@h/db` and `mongodb://u:pa#ss@h` the `@` is never found, and `hasPassword` returns `false` (checked by running the same logic with `node -e`). Those URIs pass `profile.connectionString`. The Node driver's parser (`mongodb-connection-string-url`) matches the userinfo as `[^:@]*:[^@]*@` before it looks at the host list. It treats these strings as a password and rejects them only later ("Password contains unescaped characters"), when it connects. The doc comment at `profiles.ts:100-104` promises that a password "can neither be stored in `connections.json` nor reach the renderer". That promise does not hold for these inputs. Passwords with `?`, `/` or `#` are common, and users often paste them without percent-encoding.
    - Why it matters: This is the contract's safety net for SPEC sections 5 and 6 (no secrets in `connections.json`, secrets never leave main/backend). If the `profiles.save` / `importUris` handler does not parse and strip the URI first, such a password is stored and returned in plain text. The main-process handler is the primary guard, so this is low priority.
    - Suggested fix: Find the password the way the driver's parser does. For example, report a password when the URI matches `^mongodb(\+srv)?:\/\/[^:@/?#]*:[^@]*@[^/?@]*$|^mongodb(\+srv)?:\/\/[^:@/?#]*:[^@]*@[^/?@]*[/?]`. Here the username cannot contain `/?#`, and the password runs up to the `@` before the host list. Add `u:pa?ss@h`, `u:pa/ss@h/db` and `u:pa#ss@h` to the "detects a password" test, and keep the existing false-positive cases passing. A plain-regex approach also flags `host:port/?x=y@z`; the driver misreads that URI as well. If that false positive is not acceptable, keep the current check, weaken the doc comment at `profiles.ts:100-104`, and record an `assume` entry that the main-process handler must parse the URI and strip the password. Still open at 77349c5.

## Review conclusion

No material issues found. CR-1..CR-5 and the test-writer observations are resolved correctly, and the contract code meets the acceptance criteria. The third-pass delta (a414a09..77349c5) only adds tests. They are correct, they pass (596/596), and they raise no new findings. CR-6 is still open as a low-priority edge case in the password check. The parent worker can fix it or record it as an assumption. Before `done`, run `npm ci` so the root `typecheck` (int-harness dependencies) can pass in `.taskcheck`. Final reviewed revision: 77349c5d864a0bbab16dc8cd282e172e5a63ec5d.

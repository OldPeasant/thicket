# Fix Report

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string

Scope: current task (packages/core/src/uri). Findings CR-1..CR-4 from `reviews/uri-model/review.md` and TW-1..TW-3 from `reviews/uri-model/tests.md`, on top of HEAD cbc69e7.

## Fixed findings

### CR-1 / TW-3 — `maskText()` leaks passwords containing a quote, `<`, `>` or backtick

Files changed:
- `packages/core/src/uri/mask.ts`
- `packages/core/src/uri/convert.ts`
- `packages/core/src/uri/mask.spec.ts`
- `packages/core/src/uri/convert.spec.ts`

Problem:
`URI_IN_TEXT` stopped at `"'<>` and backtick, which can appear unencoded in a valid password. For `mongodb://u:ab'cdSecret@h` only `mongodb://u:ab` was matched, which has no `@`, so the whole password stayed in the text. `toConnectionString` wrote `'` unencoded (`encodeURIComponent` leaves it), so this happened for URIs Thicket writes itself.

Fix:
- `URI_IN_TEXT` now matches up to the next whitespace or the next `mongodb://` / `mongodb+srv://` scheme (so several URIs joined without whitespace, such as a JSON list, are still masked one by one). `mask()` then finds the credentials by the last `@` of the authority. A quote that follows the hosts stays in the token and is kept unchanged by `mask()`, so the existing double-quoted `maskText` test still gives the same output.
- `toConnectionString` encodes `'` as `%27` in the user name and password (new `encodeUserinfo`). `!*()` stay as before, so the round-trip fixtures (incl. `ipv6Secret!`) are unchanged.
- Trade-off: when non-URI text directly follows a URI without whitespace and contains `@` and `:` (e.g. `"mongodb://h","x":"a@b"`), `maskText` may now mask some of that text too. This errs on the side of masking more, as the `mask()` docstring promises for invalid strings.

Validation:
- `cd packages/core && npx vitest run` — Pass (the TW-3 row `hides a password containing "'"` now passes; new tests `masks passwords with unencoded quotes, "<", ">" and backticks`, `masks several connection strings not separated by whitespace`, `encodes an apostrophe in the user info`)

### CR-2 — `toConnectionString` writes an invalid URI for a password without a user name, or an empty user name

Files changed:
- `packages/core/src/uri/convert.ts`
- `packages/core/src/uri/convert.spec.ts`

Problem:
A password without a user name gave `mongodb://:pw@...`, and `username: ''` gave `mongodb://@...`. The library rejects both ("URI contained empty userinfo section"), and a test asserted the broken output.

Fix:
`username: ''` is treated as absent. A password without a (non-empty) user name throws `ConnectionStringError('A password needs a user name')`, matching the docstring's promise to throw for models the driver would reject. The test "writes a password without a user name" was replaced by "rejects a password without a user name" (undefined and `''`) and "treats an empty user name as none" (output `mongodb://localhost:27017`, which re-parses). The old test locked in the defect the reviewer found, so changing it is a correction, not a weakening.

Validation:
- `cd packages/core && npx vitest run` — Pass

### CR-3 — Unix socket path containing `:` written in IPv6 brackets

Files changed:
- `packages/core/src/uri/convert.ts`
- `packages/core/src/uri/convert.spec.ts`

Problem:
`formatHost` put any host containing `:` in brackets, so `/tmp/a:b.sock` became `[/tmp/a:b.sock]`.

Fix:
Brackets are used only when the host contains `:` and no `/`; socket paths (they contain `/`) are always percent-encoded. New round-trip test with `mongodb://%2Ftmp%2Fa%3Ab.sock`.

Validation:
- `cd packages/core && npx vitest run` — Pass

### CR-4 / TW-1 / TW-2 — Option keys named like `Object.prototype` members corrupted or dropped

Files changed:
- `packages/core/src/uri/convert.ts`

Problem:
`addExtra` read `m.extra[key]`, which returns inherited members for `toString`, `constructor`, `valueOf`, `hasOwnProperty`, and assigning `__proto__` replaced the prototype. `parsePairs` dropped `__proto__` entries of `authMechanismProperties` / `readPreferenceTags` the same way.

Fix:
New helper `setOwn` stores entries with `Object.defineProperty` (enumerable, writable, configurable own property). `addExtra` reads the previous value only via `Object.hasOwn`. `parsePairs` stores through `setOwn`. The objects stay plain objects with the normal prototype, so `toEqual` against `{}` literals, spreading and JSON behave as before. The 7 failing tests from the test-writer are unchanged and pass.

Validation:
- `cd packages/core && npx vitest run` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run` — Pass: 3 files, 201 tests passed (was 8 failed | 188 passed)

Full test suite:
- `npm run check` (repo root: lint, typecheck of all workspaces, root `vitest run` 6 files / 204 tests passed, renderer `ng test` 2 files / 46 tests passed) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run as above; `tasks.py done` not run by the fixer)

Remaining unresolved findings:
0

## Round 2

Date: 2026-11-16

Scope: findings TW-4 (`reviews/uri-model/tests.md`), CR-5 and CR-6 (`reviews/uri-model/review.md`) on revision `9efb954`; only `maskText()` / `mask()` in `packages/core/src/uri/mask.ts`.

### Fixed findings

#### TW-4 — `maskText()` leaks the tail of a secret option value that contains `mongodb://`

Files changed:
- `packages/core/src/uri/mask.ts`
- `packages/core/src/uri/mask.spec.ts`

Problem:
The `URI_IN_TEXT` regex ended a match at every embedded scheme, so `mongodb://h/?proxyPassword=px-mongodb://proxyTail2Secret` was split and the tail was outside `mask()`. Confirmed: the test-writer's test failed on `9efb954`.

Fix:
Replaced the regex with a small scanner (`maskText` -> `uriEnd`). An embedded scheme inside a non-whitespace run starts a new connection string only when the text before it does not end inside a secret (`endsInSecret`): not in the value of `proxyPassword`, `tlsCertificateKeyFilePassword`, an undecodable option key or a secret `authMechanismProperties` entry, and not in an authority without `@` that has a `:` other than a port. So `"mongodb://a@h1","mongodb://b:pw@h2/db"`, `mongodb://h:27017,mongodb://...` and `...?tls=true","mongodb://...` still split, while `px-mongodb://...` and `mongodb://u:amongodb://bSecret@h` (invalid, now masked as `mongodb://u:****@h`) do not. When such a merge swallows a following connection string, `mask()`'s invalid-URI branch (credentials up to a later `@`) could show a secret option value as the "user name" (`mongodb://h/?proxyPassword=pp","mongodb://b:pw@h2` -> `...pp","mongodb:****@h2`); that branch now keeps only the text before the authority end visible (`mongodb://h:****@h2`). The test-writer's test is unchanged.

Validation:
- `cd packages/core && npx vitest run` — Pass (TW-4 test passes)

#### CR-5 — `maskText()` leaks a password containing raw whitespace

Files changed:
- `packages/core/src/uri/mask.ts`
- `packages/core/src/uri/mask.spec.ts`

Problem:
`maskText('log: mongodb://u:my secret@h/db failed')` matched only `mongodb://u:my` and left the password in the text. Confirmed against `9efb954`; the driver accepts the URI (the URL parser keeps spaces as `%20` and drops tabs).

Fix:
In `uriEnd`, when the first of `/`, `?`, `#`, `@`, a line break or another scheme after the scheme is an `@`, the connection string runs to that `@` even across spaces/tabs (never across a line break), then continues to the next whitespace as before. Documented over-masking in a code comment: `mongodb://host:27017 failed for user@x` becomes `mongodb://host:****@x` (masks, never leaks).

New tests (`mask.spec.ts`, `maskText` block): space, tab and mixed whitespace passwords in plain, quoted and multi-URI log text (exact output `log: mongodb://u:****@h/db failed`); no extension across a line break; the over-masking case; the `amongodb` / `a,mongodb` invalid-password cases; joined connection strings after a port, a non-secret option and a secret option. Plus a `mask()` edge-case test for the invalid-branch change.

Validation:
- `cd packages/core && npx vitest run` — Pass

### Not fixed

#### CR-6 — `maskText()` rewrites the host in compact JSON log lines that contain a later `@`

Status:
Invalid as a required change (accepted by the parent worker as over-masking).

Reason:
No secret leaks; SPEC §6 allows masking more. Behavior unchanged (`{"uri":"mongodb://u:p@h","email":"x:y@z"}` -> `{"uri":"mongodb://u:****@z"}`); the existing JSON/quoted tests still pass.

### Validation summary (Round 2)

Focused tests:
- `cd packages/core && npx vitest run` — Pass: 3 files, 249 tests passed (was 1 failed | 243 passed)

Full test suite:
- `npm run check` (repo root: eslint, prettier, typecheck of all workspaces, root `vitest run` 7 files / 847 tests, renderer 2 files / 46 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass (`prettier --write` applied to `mask.ts` once)

`.taskcheck`:
- `sh .taskcheck` (runs `npm run check`) — Pass; `tasks.py done` not run by the fixer

Remaining unresolved findings:
0

## Round 3

Date: 2026-11-16

Scope: findings TW-5, TW-6 (`reviews/uri-model/tests.md`) and CR-7 (`reviews/uri-model/review.md`, same issue as TW-6) on revision `3e06e96`; only the `maskText()` scanner in `packages/core/src/uri/mask.ts`. No test changed.

### Fixed findings

#### TW-6 / CR-7 — `maskText()` leaks the tail of a secret option value containing a raw space or tab

Files changed:
- `packages/core/src/uri/mask.ts`

Problem:
The driver accepts a raw space in an option value, but `uriEnd` ended the connection string at the first whitespace, so `log: mongodb://h/?proxyHost=p&proxyPassword=my spaceOptSecret failed` became `...proxyPassword=**** spaceOptSecret failed`; likewise for `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN` in `authMechanismProperties`. Confirmed: the 3 test-writer rows failed on `3e06e96`.

Fix:
`uriEnd` now loops: when the whitespace that ends a run falls inside a secret option value (new `endsInSecretOption`, split out of `endsInSecret`), the value runs on to the next `&`, `#` or line break (never across a line break, never past the end of the text); after `&`/`#` the connection string continues to the next whitespace with the same checks (embedded-scheme splitting included). `mask()` then hides the whole value, e.g. `...proxyPassword=**** ` without the tail. Over-masking (prose up to the next `&`/`#`/line break is swallowed into the masked value) is documented in a code comment. Option keys or `authMechanismProperties` values that can't be decoded are invalid for the driver and keep their previous behavior (value ends at whitespace, `mask()` hides it): two existing tests pin that exact output (`x mongodb://h/?%ZZ=**** y`).

Validation:
- `npx vitest run --root packages/core` — Pass (3 TW-6 rows pass)

#### TW-5 — `maskText()` splits an invalid URI whose password is digits followed by a scheme

Files changed:
- `packages/core/src/uri/mask.ts`

Problem:
In `endsInSecret`'s authority branch, `:` + digits + any non-alphanumeric character counted as a port, so in `x mongodb://u:123-mongodb://digitTailSecret@h y` the scanner split before the second scheme and `digitTailSecret` stayed visible as a user name. Confirmed: the test failed on `3e06e96`.

Fix:
A `:` followed by digits is a port only when the digits are followed by a host delimiter (`,`, `/`, `?`, `#`, whitespace, a quote, backtick, bracket/brace/paren, `<`, `>`) or the end of the prefix; otherwise it is treated as credentials. Joined connection strings after a real port (`mongodb://h:27017,mongodb://...`, quoted/JSON forms) still split; the existing tests for them pass.

Validation:
- `npx vitest run --root packages/core` — Pass

### Not fixed

None.

### Validation summary (Round 3)

Focused tests:
- `npx vitest run --root packages/core` (repo root) — Pass: 3 files, 261 tests passed (was 4 failed | 257 passed)

Full test suite:
- `npm run check` (repo root: eslint `--max-warnings 0`, prettier, typecheck, root `vitest run` 7 files / 859 tests, renderer 2 files / 46 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Runs `npm run check` (result above) — Pass; `tasks.py done` not run by the fixer

Remaining unresolved findings:
0

## Round 4

Date: 2026-11-16

Scope: finding TW-7 (`reviews/uri-model/tests.md`) = CR-8 (`reviews/uri-model/review.md`) on revision `41a3d02`; only the `maskText()` scanner in `packages/core/src/uri/mask.ts` and its tests.

### Fixed findings

#### TW-7 / CR-8 — `maskText()` leaks a secret option that follows a raw space in a non-secret option value

Files changed:
- `packages/core/src/uri/mask.ts`
- `packages/core/src/uri/mask.spec.ts`

Problem:
`uriEnd` carried the token across whitespace only when the whitespace fell inside a secret option value. A raw space in a non-secret value (`appName=my app&proxyPassword=x`, `authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:tok`) ended the token, so the later secret option was never passed to `mask()` and stayed visible. The driver parses these URIs as valid. Confirmed: the 3 TW-7 rows failed on `41a3d02`.

Fix:
Used the reviewer's simpler option. When whitespace ends a run and the text before it is in the query part (after `?`, with no `#` after it; new helper `endsInQuery`), the token continues one word at a time up to the end of the line (never across a line break). After a `#` it stops at the next whitespace as before. Each later word is still checked for an embedded scheme, and that scheme starts a new connection string unless it lies in a secret value. This keeps the TW-4 and joined-string behavior. This replaces the secret-only jump to the next `&`/`#`/line break, so the unused `valueEnd` regex was removed. The extra masking (prose after a query becomes part of the token) is acceptable under SPEC §6. Because `mask()` leaves non-secret option text unchanged, the visible output usually does not change (e.g. the test `does not run a non-secret option value on past whitespace` passes unchanged).

Test expectation changes (over-masking, not weakening):
- `keeps a scheme inside the value of an option key that cannot be decoded` and `keeps a scheme inside an authMechanismProperties value that cannot be decoded` used to expect the trailing prose ` y` after the masked value. Round 3 deliberately stopped undecodable values at whitespace. Under the new query rule, ` y` becomes part of the value that `mask()` hides completely, so the expected output is now `x mongodb://h/?%ZZ=****` and `x mongodb://h/?authMechanismProperties=****`. These tests check that the scheme inside the value is not split off and that the secret does not leak, and both still hold (`expectNoLeak` is unchanged). Letting undecodable values run on too is the safer choice: such text may still carry a later secret in a log line.
- Added the regression test `still splits off a later connection string after prose that follows a query`, which checks that a second connection string on the same line is still split off and its password masked.

Validation:
- `npx vitest run --root packages/core` — Pass (3 TW-7 rows pass)

### Not fixed

None.

### Validation summary (Round 4)

Focused tests:
- `npx vitest run --root packages/core` (repo root) — Pass: 3 files, 293 tests passed (was 3 failed | 289 passed)

Full test suite:
- `npm run check` (repo root: eslint `--max-warnings 0`, prettier, typecheck, root `vitest run` 7 files / 891 tests, renderer 5 files / 181 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Runs `npm run check` (result above) — Pass; `.taskcheck` itself was not run directly by the fixer, and `tasks.py done` was not run

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

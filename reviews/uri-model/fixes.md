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

## Final status

All validated findings fixed and validation passed.

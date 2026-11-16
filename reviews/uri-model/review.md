# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string

Scope: `git diff 6813e14a9613908d1013b47dfe336c487dee57e6 e726035` (packages/core/src/uri/*, packages/core/src/index.ts, packages/core/package.json, package-lock.json). Committed changes only; the working tree was clean.

Requirements:
- tasks/uri-model.md acceptance criteria and goal
- Recorded assumptions #1-#4 for uri-model (`python tasks.py assumptions`)
- SPEC.md §3 (connection profiles, form ⇄ URI, SOCKS5 proxy, copyable masked URI) and §6 ("logs and error messages mask passwords in URIs")
- docs/ARCHITECTURE.md (stack table lists `mongodb-connection-string-url`; `packages/core` free of Node/Electron APIs; strict TS, no `any` in core)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: e726035ef73fb07cf50c0a4d00bb33b95152cd01
- Base/start: 6813e14a9613908d1013b47dfe336c487dee57e6
- Commits reviewed: 1 (e726035 "Core: connection profile model to/from connection string, password masking")

Commands run:
- `cd packages/core && npx vitest run src/uri` -> 2 files, 128 tests passed
- Read `node_modules/mongodb-connection-string-url/lib/index.js` (parser validation rules) and `whatwg-url/lib/URL-impl.js` (error text) to validate the findings below
- An ad-hoc probe script (bundled outside the repo) was not permitted in this session; findings CR-1 and CR-2 are validated by reading the library's validation code and the regex/encoding logic, line by line

Summary: 0 P0, 1 P1, 1 P2, 2 P3

Acceptance criteria:
- AC1 (20+ round-trip URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties): met; `fixtures.ts` has 33 cases covering all named kinds, `convert.spec.ts` checks parse -> write -> parse equality and idempotence.
- AC2 (unknown options preserved in `extra`, test): met; `convert.spec.ts` "unknown options" block (except the edge case in CR-4).
- AC3 (`mask()` never leaks the password in any test URI, test): met for `mask()` on all fixtures in decoded/encoded/form-encoded forms. `maskText()`, the log/error-message path, has a leak outside the fixtures (CR-1).

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | `maskText()` leaks passwords that contain a quote, `<`, `>` or backtick (incl. URIs written by `toConnectionString`)**
    - File: `packages/core/src/uri/mask.ts:12` (`URI_IN_TEXT`), `packages/core/src/uri/convert.ts:552-553`
    - Category: Security
    - Problem: `URI_IN_TEXT` stops a URI at the first `'`, `"`, `<`, `>` or backtick. These characters are legal unencoded in a password: the library's illegal-character check is only `[:/?#[\]@]` (`mongodb-connection-string-url/lib/index.js`, `illegalCharacters`), so e.g. `mongodb://u:ab'cdSecret@h` is a valid connection string. `maskText` then matches only `mongodb://u:ab`, which contains no `@`, so `mask()` returns it unchanged and the rest of the line (`'cdSecret@h`) is untouched: the whole password stays in the log line. `toConnectionString` makes this likely rather than exotic: it encodes the password with `encodeURIComponent`, which leaves `'` (and `! * ( )`) unencoded, so any profile password with an apostrophe produces such a URI. The same path is used for `parseConnectionString` error messages (`convert.ts:503`, `maskText(reason)`), and whatwg-url's error text is `Invalid URL: ${url}` including the user info.
    - Why it matters: SPEC §6 requires logs and error messages to mask passwords in URIs; `maskText` is the function for exactly that. The fixtures contain no password with these characters, so the tests do not catch it.
    - Suggested fix: in `maskText`, do not end the match at quote/angle/backtick characters before the credentials are resolved (e.g. match up to whitespace, let `mask()` locate the last `@` in that token, and only then trim trailing delimiters), or extend the match to the last `@` before the next whitespace. Additionally percent-encode `'`, `!`, `*`, `(`, `)` in the user info written by `toConnectionString`. Add fixtures with passwords containing `'` and `"` (raw and encoded) to the `maskText` leak test.

## P2 Medium

- [ ] **CR-2 | `toConnectionString` writes an invalid URI for an empty or missing user name with credentials, and a test locks it in**
    - File: `packages/core/src/uri/convert.ts:551-555`; test `packages/core/src/uri/convert.spec.ts:200-203`
    - Category: Correctness
    - Problem: with `username` undefined and a `password`, or with `username: ''`, the output starts with `mongodb://:pw@` or `mongodb://@`. The library (used by `parseConnectionString` and by the driver) rejects both: `if (!username || !password)` and the remainder starts with `:` or `@` -> `MongoParseError('URI contained empty userinfo section')`. So `parseConnectionString(toConnectionString(m))` throws for such a model, and the test "writes a password without a user name" asserts this unusable output as correct. A form that clears the user field to `''` hits this.
    - Why it matters: the docstring promises a `ConnectionStringError` for models the driver would reject; instead a broken string is produced silently and only fails later on connect or re-parse, breaking the form ⇄ URI sync (SPEC §3).
    - Suggested fix: treat `username === ''` like undefined, and either omit the user info or throw `ConnectionStringError` when only a password is set; change the test to assert that behavior and that the output re-parses.

## P3 Low

- [ ] **CR-3 | Unix socket path containing `:` is written in IPv6 brackets**
    - File: `packages/core/src/uri/convert.ts:529`
    - Category: Correctness
    - Problem: `formatHost` brackets any host containing `:`. A decoded socket path such as `/tmp/a:b.sock` (parsed from `%2Ftmp%2Fa%3Ab.sock`) is written as `[/tmp/a:b.sock]`, which is not a socket path and does not round-trip.
    - Why it matters: rare, but a silent round-trip change of the host.
    - Suggested fix: bracket only when the host does not start with `/` (or ends with `.sock`) and contains `:`; otherwise `encodeURIComponent` it.

- [ ] **CR-4 | Option key `__proto__` is silently dropped and mutates the `extra` prototype**
    - File: `packages/core/src/uri/convert.ts:453-457` (`addExtra`), also `parsePairs` at `convert.ts:194-195`
    - Category: Correctness
    - Problem: `m.extra['__proto__']` reads `Object.prototype` (not undefined), so `addExtra` assigns `[Object.prototype, value]` to `__proto__`, replacing the object's prototype instead of storing an entry; `Object.entries(extra)` then omits it and `toConnectionString` drops the option. `parsePairs` likewise ignores a `__proto__:` key. This contradicts the model's promise that a round trip never drops anything (AC2), though only for a nonsensical key.
    - Why it matters: low impact (the prototype change is local to one model object), but it is an unvalidated-key write into a plain object.
    - Suggested fix: check `Object.hasOwn(m.extra, key)` before reading and store with `Object.defineProperty` (or build `extra`/pairs from `Object.create(null)` and copy), and add a test.

## Review conclusion

Material issues found; fix before completing the task. CR-1 (P1, password leak through `maskText` in logs and error messages) must be fixed; CR-2 should be fixed with the test corrected. Architecture fit is fine: the code is pure TS without Node/Electron APIs, the new dependency is the one named in docs/ARCHITECTURE.md, and the lockfile changes (punycode/webidl-conversions moving from dev to runtime) follow from it.

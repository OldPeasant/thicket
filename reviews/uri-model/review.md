# Code Review

Date: 2026-11-16

Task: uri-model - Core: connection profile ⇄ connection string (fifth pass, final revision cfd245d)

Scope: `git diff 2693efcf889a05c8ab14886508568ec74bbecf6d cfd245d -- packages` (packages/core/src/uri/*). Committed changes only. Delta since the fourth pass: `git show cfd245d` changes `packages/core/src/uri/mask.ts` (`uriEnd` loop, new `endsInQuery`, removed `valueEnd`) and `packages/core/src/uri/mask.spec.ts` (two changed expectations, one new test), plus `reviews/uri-model/fixes.md` "Round 4". An untracked file `packages/core/src/uri/tw5-probe.spec.ts` appeared in the working tree during this review; it isn't committed and was not reviewed.

Requirements:
- tasks/uri-model.md acceptance criteria and recorded assumptions
- SPEC.md §6 ("logs and error messages mask passwords in URIs"; over-masking acceptable, leaking not)
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- previous review rounds (CR-1..CR-8), reviews/uri-model/fixes.md "Round 4", reviews/uri-model/tests.md (TW-7)

Git range:
- Branch: main
- HEAD: cfd245d
- Base/start: 2693efcf889a05c8ab14886508568ec74bbecf6d
- Commits reviewed: 9 (ed883de, 4a7164c, 9c085b7, bbff6da, a29b39f, c537952, c6761ff, 900386e, cfd245d); this pass focuses on cfd245d

Commands run:
- `cd packages/core && npx vitest run` -> 3 files, 293 tests passed
- Read `packages/core/src/uri/mask.ts` in full, the `git show cfd245d` diff and the changed spec sections.
- Read-only probes with `node --experimental-strip-types --input-type=module -e` importing `./src/uri/mask.ts`:
  - `log: mongodb://u:p@h/?appName=My App&proxyHost=x&proxyPassword=leakSecret1 done` -> `...proxyPassword=****` (CR-8 fixed)
  - `log: mongodb://h/?authMechanism=MONGODB-AWS&authMechanismProperties=SERVICE_NAME:a b,AWS_SESSION_TOKEN:leakTok2 done` -> `...AWS_SESSION_TOKEN%3A****` (CR-8 fixed)
  - `x mongodb://u:pw@h/?tls=true<TAB>foo&proxyPassword=tabSecret bar` -> secret masked
  - `x mongodb://h/?tls=true failed<LF>next mongodb://u:pw@h2 y` -> stops at the line break, second password masked
  - `x mongodb://h/#f?a=1 b mongodb://u:pw@h2 c` -> second password masked
  - `connecting mongodb://h:27017/?tls=true as user:x@example.com now` -> `connecting mongodb://h:****@example.com now` (new over-masking: the swallowed prose makes the token invalid and `mask()` masks up to the later '@'; hides the host, no leak, acceptable under SPEC §6)
  - `x mongodb://h/?authMechanismProperties=AWS_SESSION_TOKEN:tok failed, retrying now` -> `...AWS_SESSION_TOKEN%3A****%2C%20retrying%20now` (prose re-encoded, cosmetic, no leak)
  - Timing, one line `mongodb://h/?tls=true ` + `word ` x N: N=1000 -> 5 ms, 10000 -> 56 ms, 40000 (200 KB) -> 463 ms, 100000 (500 KB) -> 6204 ms; same text without `?` (40000 words) -> 0 ms; 40000 embedded `mongodb://` words -> 17 ms (see CR-9)

Summary: 0 P0, 0 P1, 1 P2, 0 P3

Status of earlier findings:
- CR-1 (P1), CR-2 (P2), CR-3 (P3), CR-4 (P3), CR-5 (P2): still resolved; convert.ts unchanged, all tests pass.
- CR-6 (P3, compact JSON host rewrite): accepted over-masking, unchanged.
- CR-7 / TW-6 (P3): still resolved; the secret-only rule is subsumed by the new query rule (secret values with raw spaces still masked, tests pass).
- CR-8 / TW-7 (P3, secret option after a raw space in a non-secret value): fixed by cfd245d. `uriEnd` (mask.ts:188-190) continues the token word by word while the prefix ends in the query part (`endsInQuery`, mask.ts:195-199), up to a line break, or the first whitespace after a `#`. Embedded schemes in later words are still split off unless inside a secret value (mask.ts:177-180), so later connection strings on the same line are still masked separately (new test at mask.spec.ts:466). The task note "CR-8 accepted (P3)" no longer describes the code; the parent worker may want to record that it was fixed.
- TW-5: still resolved.

Changed test expectations (mask.spec.ts:322-337): justified. Both tests target an undecodable option key/value containing an embedded scheme; their purpose (scheme not split off, secret not leaked) is unchanged and `expectNoLeak` still runs. The trailing ` y` now belongs to the query token and is hidden together with the undecodable value: more masking, not less. No assertion was weakened in a way that could hide a leak.

Regression check: no new leak found; the extra masking is within SPEC §6. The one regression is performance (CR-9).

Acceptance criteria:
- AC1 (20+ round-trip URIs incl. SRV, IPv6, encoded credentials, authMechanismProperties): met; round-trip suites pass, convert.ts unchanged this round.
- AC2 (unknown options preserved in `extra`): met; tests pass.
- AC3 (`mask()` never leaks the password in any of the test URIs): met; all fixture, special-character and TW-7 tests pass.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-9 | `maskText()` is quadratic on long single lines after a query part**
    - File: `packages/core/src/uri/mask.ts:173-190` (`uriEnd` loop) with `endsInQuery` at 195-199
    - Category: Correctness (resilience/performance)
    - Problem: Since cfd245d, every whitespace after a `?` continues the loop, and each iteration calls `endsInQuery(text.slice(start, runEnd))`, which copies and scans the whole prefix from the start of the connection string (`replace`, `indexOf('?')`, `indexOf('#')`). The work is O(words x line length). Measured: one 200 KB line after `mongodb://h/?tls=true ` takes 463 ms, a 500 KB line 6.2 s; the same text without `?` takes 0 ms, so the cost comes from this change. Before cfd245d a non-secret query ended at the first whitespace.
    - Why it matters: `maskText()` is the API for log lines and error messages (SPEC §6). A single long line (a one-line JSON log entry or a server error that echoes a large document after a URI) would block the event loop for seconds wherever logs are masked, e.g. in the Electron main process.
    - Suggested fix: Keep the result linear. Whether the token is "in the query" only changes when a `?` or `#` is passed, so compute it once and then update it only from the newly scanned run (`text.slice(end, runEnd)`), or, once in the query, jump directly to the first of line break / `#`, scanning only for embedded schemes (as the old `valueEnd` regex did). Add a test that masks a line of about 1 MB after a query within a time bound (e.g. under 200 ms) or that counts work.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task. CR-8/TW-7 is fixed by cfd245d without a new leak, and the two changed test expectations are justified over-masking. CR-1..CR-7 and TW-5 stay resolved, and CR-6 stays accepted. The fix adds a quadratic slowdown in `maskText()` on long single lines after a query (CR-9, P2, 6.2 s for a 500 KB line). It should be made linear, or recorded as an accepted assumption with a follow-up, before `done`.

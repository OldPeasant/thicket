# Test Report

Date: 2026-11-16

Task: secrets-store — M1: Secrets in the OS keychain via safeStorage

Scope: base 516f40781da5bbfce69b7a1f897c8e25b8824aec .. HEAD e5b36ac5b7a0ab7f8652a5ce8c09f75b046255bd on `main`. Task code commits: b7fbbdb ("Add the secrets store"), 1a34c24 (first-pass tests and reports), e5b36ac (fix for CR-1/CR-2, see `reviews/secrets-store/fixes.md`); the other commits in the range are `assume:`/`heartbeat:` task-file commits. Plus the uncommitted second-pass test changes listed below. Production files were not modified by the test-writer. This is the second pass, on the final (post-fix) revision.

Requirements:
- `tasks/secrets-store.md` acceptance criteria and recorded assumptions
- `SPEC.md` (secrets only via safeStorage; `basic_text` warns and defaults to not saving; renderer never sees secrets)
- `docs/ARCHITECTURE.md` "Secrets" bullet under Electron shell (updated by the fix)
- `reviews/secrets-store/review.md` CR-1, CR-2 and `reviews/secrets-store/fixes.md` (fixed behaviour to check)
- `docs/QUALITY.md` (report contract)

## Test files changed

First pass (committed in 1a34c24):
- `apps/desktop/src/secrets/store.spec.ts`
- `apps/desktop/src/secrets/handlers.spec.ts`
- `apps/desktop/test/secrets.electron.spec.ts` (new, real Electron with `--password-store=basic`)
- `apps/desktop/test/helpers.ts` (optional `switches` argument for `launchApp`)

Second pass (uncommitted, this run):
- `apps/desktop/src/secrets/store.spec.ts` (2 tests)
- `apps/desktop/src/secrets/handlers.spec.ts` (2 tests)

## Tests added or updated

Count: 4 in this pass (20 in the first pass).

Review of the fixer's tests: CR-1 (delete refused while `unavailable` and the file exists; no-op without a file; `clearSecret` -> `UNSUPPORTED`, file and secret kept) and CR-2 (weak backend + undecryptable file: kept byte-for-byte, reads empty, `set`/`delete` refused with the keyring message, logged once, no "moved aside"; weak backend + decryptable-but-invalid file still moved aside; secure backend + undecryptable file still moved aside; `clearSecret` -> `UNSUPPORTED`) are well covered. Coverage showed two new branches without a test, and two behaviours the fix exists for were only implied. Added:

- `store.spec.ts` `while encryption is unavailable, an unreadable secrets.bin fails delete with the read error` — the new `fileExists()` passes on errors other than ENOENT (a folder in place of the file -> EISDIR) instead of reporting `SecretStorageUnavailableError` or success; the queue keeps working afterwards.
- `store.spec.ts` `weak backend lock keeps keyring secrets: they are readable again once the keyring is back` — the purpose of CR-2 end to end: secrets written with the keyring, a `basic_text` session that cannot decrypt them stays locked on repeated calls (`get`/`kinds` empty, `set`/`delete` refused), and a later keyring session reads the original secret; no `.corrupt-*` file.
- `handlers.spec.ts` `profiles.setSecret on a weak backend with an undecryptable file fails with UNSUPPORTED` — locked path through `setSecret`; the error message does not contain the value and the file is unchanged.
- `handlers.spec.ts` `profiles.clearSecret passes other failures on unchanged (not as UNSUPPORTED)` — the new rethrow branch in `clearSecret` (EISDIR stays an fs error, not an `RpcError`).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: unit tests with a fake safeStorage: set/get/delete | store.spec.ts `SecretsStore set/get/delete`; edge cases (overlapping set/delete in call order, failed write isolation, missing folder, cleanup failure, value round-trip, unavailable delete refuses with a file / no-op without one / passes on EISDIR); handlers.spec.ts setSecret/clearSecret incl. UNSUPPORTED mapping and pass-through of other errors | `npx vitest run --project desktop --project contract` (repo root) | Pass (12 files, 855 tests) |
| AC1: file corruption handled | store.spec.ts `SecretsStore with a corrupt file` (corrupt variants moved aside; secure backend + undecryptable -> moved aside; weak backend + undecryptable -> kept and locked; weak + decryptable-but-invalid -> moved aside; lock survives repeated calls and the secret is readable again with the keyring) + failed re-encryption | same | Pass |
| AC2: on `basic_text` status reports `weak`, default not saving passwords | store.spec.ts status tests and strict-fake restart test; handlers.spec.ts `profiles.secretStorage...`, `setSecret on basic_text ... secureStorage: false`; secrets.electron.spec.ts (status `weak`/`basic_text`/`ask`, `setSecret` -> `secureStorage: false`, encrypted file, decrypts after restart) | unit command above; `npm run test:electron` (repo root, Linux, real Electron) | Pass (3 files, 17 tests) |
| AC3: renderer cannot request a secret (contract test) | contract `no-secrets.spec.ts`; desktop `no-secrets-to-renderer.spec.ts`; main/handlers.spec.ts; handlers.spec.ts (error messages without the value, incl. the new locked `setSecret` test); app.electron.spec.ts privileged-method test; secrets.electron.spec.ts `secrets.get` -> UNKNOWN_METHOD | unit command above; `npm run test:electron` | Pass |
| CR-1 fix: no false "cleared" while encryption is unavailable | store.spec.ts `...delete refuses and leaves an existing file untouched`, `...delete without a file is a no-op`, `...unreadable secrets.bin fails delete with the read error`; handlers.spec.ts `clearSecret without encryption fails with UNSUPPORTED when a file exists`, `clearSecret passes other failures on unchanged` | unit command above | Pass |
| CR-2 fix: weak backend keeps a keyring-encrypted file | store.spec.ts `weak backend, undecryptable file: left in place...`, `weak backend lock keeps keyring secrets...`, `weak backend, decrypts but invalid: moved aside...`, `...on a secure backend is moved aside`; handlers.spec.ts `clearSecret on a weak backend...`, `setSecret on a weak backend...` | unit command above | Pass |

## Focused test execution

Command:

`npx vitest run src/secrets` (apps/desktop), then `npx vitest run --project desktop --project contract` (repo root)

Result:

Pass (`src/secrets`: 3 files, 69 tests; desktop + contract: 12 files, 855 tests)

## Full test execution

Command:

`npm run check` (repo root: eslint --max-warnings 0 + prettier --check, tsc for all workspaces, vitest, renderer `ng test`) and `npm run test:electron` (repo root)

Result:

Pass. check: vitest 28 files / 1520 tests, renderer 5 files / 181 tests (first attempt failed lint on an unused parameter in a new test; fixed in the test and rerun green). test:electron: renderer build + desktop build, 3 files / 17 tests, about 7 s.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run directly as above, exit 0)

## Bugs found

None. The fixed behaviour matches CR-1 and CR-2 as described in `fixes.md`; no test exposed a production defect.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a diff intersection tool. Every executable line of `store.ts` and `secrets/handlers.ts` is covered (100% lines), so the lines changed by the fix are covered as a consequence; the two remaining uncovered branches (`store.ts:149`, `store.ts:170`) are not in lines changed by the fix.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `secrets-store`; base 516f40781da5bbfce69b7a1f897c8e25b8824aec (from parent); HEAD e5b36ac5b7a0ab7f8652a5ce8c09f75b046255bd; task code commits b7fbbdb, 1a34c24, e5b36ac (`git diff --stat 1a34c24..HEAD` for the fix; file list matches the parent's and the first pass).
- Source/test snapshot identifier (including uncommitted inputs): HEAD e5b36ac + uncommitted test files; sha256 before and after the coverage run: store.ts 645e03a6…8ea4, secrets/handlers.ts e453c030…1812, main/handlers.ts 0ee093c1…1dad, store.spec.ts 3915bdb0…ce76, handlers.spec.ts 03dbdb20…943e. `reviews/secrets-store/review.md` was also modified in the working tree (not by the test-writer; not a test or source input).
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/secrets/store.ts`, `apps/desktop/src/secrets/handlers.ts`, `apps/desktop/src/main/handlers.ts`, `packages/contract/src/profiles.ts`. Excluded: `apps/desktop/src/secrets/testing.ts` (test fake); `apps/desktop/src/secrets/index.ts` (re-exports only); `apps/desktop/src/main/index.ts` (Electron entry point, exercised by `npm run test:electron`, not instrumented); all `*.spec.ts`; `docs/ARCHITECTURE.md` (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: V8 via vitest 5.1.0. In `apps/desktop`: `npx vitest run --coverage --coverage.include='src/secrets/store.ts' --coverage.include='src/secrets/handlers.ts' --coverage.include='src/main/handlers.ts' --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all desktop unit specs, 8 files / 148 tests). In `packages/contract`: `npx vitest run --coverage --coverage.include=src/profiles.ts --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all contract specs, 4 files / 707 tests).
- Run start/completion time and exit status: desktop 2026-11-16 19:53:49 (+0100), 596 ms, exit 0; contract 19:53:58, 481 ms, exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/secrets-store/coverage-summary.json` sha256 94a7c4aa…993e, `apps/desktop/coverage/secrets-store/coverage-final.json` sha256 e2de6e45…2bc3; `packages/contract/coverage/secrets-store/coverage-summary.json` (git-ignored by `coverage/`).
- Evidence outputs are fresh and inputs stayed unchanged: vitest cleans the reports directory per run; source and test hashes were identical before and after the desktop run.
- Final run after latest test additions and production fixes: yes (after fix commit e5b36ac and after the last test edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/secrets/store.ts` | 143/144 (99.31%) | 81/83 (97.59%) | 30/31 (96.77%) | 122/122 (100%) |
| `apps/desktop/src/secrets/handlers.ts` | 19/19 (100%) | 4/4 (100%) | 6/6 (100%) | 17/17 (100%) |
| `apps/desktop/src/main/handlers.ts` | 5/5 (100%) | N/A (0/0) | 4/4 (100%) | 4/4 (100%) |
| `packages/contract/src/profiles.ts` | 19/19 (100%) | 3/4 (75%) | 2/2 (100%) | 19/19 (100%) |
| Aggregate (summed counters, 4 files) | 186/187 (99.47%) | 88/91 (96.70%) | 42/43 (97.67%) | 162/162 (100%) |

Aggregate excludes `src/main/index.ts` (not unit-instrumentable, exercised only by the Electron tests), `src/secrets/testing.ts` and `src/secrets/index.ts` (see above).

At the fix revision before this pass's tests the desktop scope measured statements 165/168, branches 83/87, functions 40/41, lines 141/143 (uncovered `secrets/handlers.ts:34`, `store.ts:243`).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `secrets/handlers.ts:34` (clearSecret rethrow of non-`SecretStorageUnavailableError`) | other failures must not be reported as UNSUPPORTED | Covered now: `profiles.clearSecret passes other failures on unchanged (not as UNSUPPORTED)` |
| `store.ts:243` (`fileExists` rethrow of non-ENOENT) | an unreadable file must not be treated as absent (silent "cleared") | Covered now: `while encryption is unavailable, an unreadable secrets.bin fails delete with the read error` |
| `store.ts:149` (default `log` when not injected; the uncovered function) | none: trivial default; `main/index.ts` always passes `log` | Left uncovered, non-material |
| `store.ts:170` (`PLATFORM_BACKENDS[platform] ?? 'unknown'` for a platform other than linux/darwin/win32) | Electron ships only for those three | Left uncovered, not reachable in supported builds |
| `profiles.ts:51` (`?? ''` in `hasPassword`) | pre-existing code, not changed by this task | Out of task scope |

## Unable to test

- macOS Keychain and Windows DPAPI with the real `safeStorage`: only the platform mapping is unit-tested with the fake; this machine is Linux. Follow-up only if CI gains those runners.
- A real "secure" Linux keyring (`gnome_libsecret`/`kwallet`) in Electron, and therefore the real CR-2 scenario (file written with a keyring, app restarted with `--password-store=basic`): not available here. Covered with the fake (`weak backend lock keeps keyring secrets...`). Follow-up only if CI gets a keyring.
- The real "unavailable" path (no encryption at all) cannot be forced in Electron on Linux; covered by unit tests only (CR-1 included).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

# Test Report

Date: 2026-11-16

Task: secrets-store — M1: Secrets in the OS keychain via safeStorage

Scope: base 516f40781da5bbfce69b7a1f897c8e25b8824aec .. HEAD 4ca6a194051c7731c2a1fc22ddd5a4ff2853b00b on `main`. Task code commits: 32980b6 ("Add the secrets store"), 495019c (first-pass tests and reports), 293ff55 (fix for CR-1/CR-2), 01d5d3e (second-pass tests and review), 4ca6a19 (weak backend locks only for `v11` keyring ciphertext; other undecryptable files moved aside — resolves the second-pass review finding). The other commits in the range are `assume:`/`heartbeat:`/`claim:`/`done:` commits of this and other tasks. Plus the uncommitted third-pass test change listed below. Production files were not modified by the test-writer. This is the third pass, on the final revision 4ca6a19.

Requirements:
- `tasks/secrets-store.md` acceptance criteria and recorded assumptions (including the 19:56 assumption: `v10` = basic_text, `v11` = keyring; only undecryptable `v11` files lock the store)
- `SPEC.md` (secrets only via safeStorage; `basic_text` warns and defaults to not saving; renderer never sees secrets)
- `docs/ARCHITECTURE.md` "Secrets" bullet under Electron shell
- `reviews/secrets-store/review.md` (second-pass finding) and `reviews/secrets-store/fixes.md`
- `docs/QUALITY.md` (report contract)

## Test files changed

First pass (committed in 495019c):
- `apps/desktop/src/secrets/store.spec.ts`
- `apps/desktop/src/secrets/handlers.spec.ts`
- `apps/desktop/test/secrets.electron.spec.ts` (new, real Electron with `--password-store=basic`)
- `apps/desktop/test/helpers.ts` (optional `switches` argument for `launchApp`)

Second pass (committed in 01d5d3e):
- `apps/desktop/src/secrets/store.spec.ts` (2 tests)
- `apps/desktop/src/secrets/handlers.spec.ts` (2 tests)

Third pass (uncommitted, this run):
- `apps/desktop/src/secrets/store.spec.ts` (2 parameterized tests, 7 cases)

## Tests added or updated

Count: 7 test cases in this pass (2 `it.each` blocks); 4 in the second pass, 20 in the first pass.

Review of the implementer's tests in 4ca6a19: the new `it.each` (`weak backend, %s: corrupt, moved aside, not locked`: garbage bytes, a damaged `v10` file, plain JSON) covers the main corrupt-vs-keyring split; the existing lock tests now use `v11` input (literal `v11-keyring-ciphertext`, and the fake's keyring-backend output in `weak backend lock keeps keyring secrets...`); `weak backend, decrypts but invalid` now uses a `v11` file that decrypts, so it covers "prefix `v11` but decrypt succeeds -> invalid content is moved aside, not locked". `secrets.electron.spec.ts` checks that real Electron basic_text writes `v10`. The gaps were the edges of the prefix check itself, which decides between keeping and moving a user's file:

- `store.spec.ts` `weak backend, %s: moved aside, not locked` — an empty file, a file shorter than the prefix (`v1`), an upper-case `V11`, `v11` not at offset 0 (`xv11...`), and another version `v12`: all moved aside to `secrets.bin.corrupt-<timestamp>`, no "OS keyring" log, and the store accepts and reads back a new secret.
- `store.spec.ts` `weak backend, undecryptable keyring file, %s: locked and kept` — a file that is exactly `v11` (prefix length boundary) on `basic_text`, and a `v11` file on the `unknown` backend (Linux before ready, also `weak`): status `weak`, reads empty, `set` refused with `SecretStorageUnavailableError`, file kept byte for byte, no `.corrupt-*` file.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: unit tests with a fake safeStorage: set/get/delete | store.spec.ts `SecretsStore set/get/delete`; edge cases (overlapping set/delete in call order, failed write isolation, missing folder, cleanup failure, value round-trip, unavailable delete refuses with a file / no-op without one / passes on EISDIR); handlers.spec.ts setSecret/clearSecret incl. UNSUPPORTED mapping and pass-through of other errors | `npx vitest run --project desktop --project contract` (repo root) | Pass (12 files, 865 tests) |
| AC1: file corruption handled | store.spec.ts `SecretsStore with a corrupt file` (corrupt variants moved aside on a secure backend; weak backend: garbage, `v10`, plain JSON, empty, `v1`, `V11`, `xv11`, `v12` moved aside; `v11` (incl. exactly `v11`, and on `unknown`) kept and locked; `v11` that decrypts but is invalid moved aside; secure backend + undecryptable `v11` moved aside; lock survives repeated calls and the secret is readable again with the keyring) + failed re-encryption | same | Pass |
| AC2: on `basic_text` status reports `weak`, default not saving passwords | store.spec.ts status tests and strict-fake restart test; handlers.spec.ts `profiles.secretStorage...`, `setSecret on basic_text ... secureStorage: false`; secrets.electron.spec.ts (status `weak`/`basic_text`/`ask`, `setSecret` -> `secureStorage: false`, file starts with `v10` and holds no plain text, decrypts after restart) | unit command above; `npm run test:electron` (repo root, Linux, real Electron 45 with `--password-store=basic`) | Pass (3 files, 17 tests) |
| AC3: renderer cannot request a secret (contract test) | contract `no-secrets.spec.ts`; desktop `no-secrets-to-renderer.spec.ts`; main/handlers.spec.ts; handlers.spec.ts (error messages without the value); app.electron.spec.ts privileged-method test; secrets.electron.spec.ts `secrets.get` -> UNKNOWN_METHOD | unit command above; `npm run test:electron` | Pass |
| Review fix (4ca6a19): only keyring (`v11`) ciphertext locks a weak-backend store | the two new `it.each` blocks above plus `weak backend, %s: corrupt, moved aside, not locked` and the existing lock tests | unit command above | Pass |
| Assumption: real basic_text ciphertext is `v10` | secrets.electron.spec.ts `v10` prefix assertion | `npm run test:electron` | Pass |
| Assumption: real keyring ciphertext is `v11` | none | — | Not run: no libsecret/KWallet keyring available here (see Unable to test) |

## Focused test execution

Command:

`npx vitest run src/secrets` (apps/desktop), then `npx vitest run --project desktop --project contract` (repo root)

Result:

Pass (`src/secrets`: 3 files, 79 tests; desktop + contract: 12 files, 865 tests)

## Full test execution

Command:

`npm run check` (repo root: eslint --max-warnings 0 + prettier --check, tsc for all workspaces, vitest, renderer `ng test`) and `npm run test:electron` (repo root)

Result:

Pass. check: vitest 28 files / 1530 tests, renderer 5 files / 181 tests (first attempt failed `prettier --check` on the new test; formatted with prettier and rerun green). test:electron: renderer build + desktop build, 3 files / 17 tests, about 7 s.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run directly as above, exit 0)

## Bugs found

None. The prefix check behaves as the assumption and the store's doc comment describe; no test exposed a production defect.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a diff intersection tool. Every executable line of `store.ts`, `secrets/handlers.ts` and `main/handlers.ts` is covered (100% lines), so the lines changed in 4ca6a19 (`isKeyringCiphertext`, the extended `load()` condition) are covered as a consequence; both remaining uncovered branches (`store.ts:161`, `store.ts:182`) are outside the lines changed by 4ca6a19, and every branch of the new `&&` condition is taken (provider lists no uncovered branch there).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `secrets-store`; base 516f40781da5bbfce69b7a1f897c8e25b8824aec (from parent); HEAD 4ca6a194051c7731c2a1fc22ddd5a4ff2853b00b; task code commits 32980b6, 495019c, 293ff55, 01d5d3e, 4ca6a19 (`git log 516f407..HEAD`; `git show --stat 4ca6a19` touches store.ts, testing.ts, store.spec.ts, secrets.electron.spec.ts, docs/ARCHITECTURE.md). File list matches the parent's and earlier passes.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 4ca6a19 + uncommitted `store.spec.ts`; sha256 identical before and after the coverage run: store.ts ce6136f4…f814, secrets/handlers.ts e453c030…1812, main/handlers.ts 0ee093c1…1dad, testing.ts 1d9bda8d…c202, store.spec.ts 76177b09…5a5a, handlers.spec.ts 03dbdb20…943e.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/secrets/store.ts`, `apps/desktop/src/secrets/handlers.ts`, `apps/desktop/src/main/handlers.ts`, `packages/contract/src/profiles.ts`. Excluded: `apps/desktop/src/secrets/testing.ts` (test fake); `apps/desktop/src/secrets/index.ts` (re-exports only); `apps/desktop/src/main/index.ts` (Electron entry point, exercised by `npm run test:electron`, not instrumented); all `*.spec.ts`; `docs/ARCHITECTURE.md` (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: V8 via vitest 5.1.0. In `apps/desktop`: `npx vitest run --coverage --coverage.include='src/secrets/store.ts' --coverage.include='src/secrets/handlers.ts' --coverage.include='src/main/handlers.ts' --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all desktop unit specs, 8 files / 158 tests). In `packages/contract`: `npx vitest run --coverage --coverage.include=src/profiles.ts --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all contract specs, 4 files / 707 tests).
- Run start/completion time and exit status: desktop started 2026-11-16 19:57:56 (+0100), 572 ms, exit 0; contract 19:58:05, 460 ms, exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/secrets-store/coverage-summary.json` sha256 cd7af455…fdf6, `apps/desktop/coverage/secrets-store/coverage-final.json` sha256 2d606146…9be0; `packages/contract/coverage/secrets-store/coverage-summary.json` (git-ignored by `coverage/`).
- Evidence outputs are fresh and inputs stayed unchanged: vitest cleans the reports directory per run; the summary's store.ts totals (124 lines, 146 statements) differ from the second-pass report (122/144), consistent with the new code; source and test hashes were identical before and after the run.
- Final run after latest test additions and production fixes: yes (on 4ca6a19, after the last test edit and its prettier formatting).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/secrets/store.ts` | 145/146 (99.32%) | 82/84 (97.62%) | 31/32 (96.88%) | 124/124 (100%) |
| `apps/desktop/src/secrets/handlers.ts` | 19/19 (100%) | 4/4 (100%) | 6/6 (100%) | 17/17 (100%) |
| `apps/desktop/src/main/handlers.ts` | 5/5 (100%) | N/A (0/0) | 4/4 (100%) | 4/4 (100%) |
| `packages/contract/src/profiles.ts` | 19/19 (100%) | 3/4 (75%) | 2/2 (100%) | 19/19 (100%) |
| Aggregate (summed counters, 4 files) | 188/189 (99.47%) | 89/92 (96.74%) | 43/44 (97.73%) | 164/164 (100%) |

Aggregate excludes `src/main/index.ts` (not unit-instrumentable, exercised only by the Electron tests), `src/secrets/testing.ts` and `src/secrets/index.ts` (see above).

Coverage was not measured separately at 4ca6a19 without this pass's tests; the new tests pin behaviour at the prefix edges rather than targeting uncovered code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `store.ts:161` (`options.now ?? (() => new Date())` default and its function) | none: trivial default; unit tests always inject `now`; `main/index.ts` uses the default and runs in `npm run test:electron` | Left uncovered, non-material |
| `store.ts:182` (`PLATFORM_BACKENDS[platform] ?? 'unknown'` for a platform other than linux/darwin/win32) | Electron ships only for those three | Left uncovered, not reachable in supported builds |
| `profiles.ts:51` (`?? ''` in `hasPassword`) | pre-existing code, not changed by this task | Out of task scope |

## Unable to test

- That a real Linux keyring (`gnome_libsecret`/`kwallet`) writes `v11` ciphertext, and the real "file written with a keyring, app restarted with `--password-store=basic`" scenario: no keyring here. The `v11` value comes from Chromium source (recorded as an assumption); behaviour is covered with the fake. Follow-up only if CI gets a keyring.
- macOS Keychain and Windows DPAPI with the real `safeStorage` (their ciphertext prefixes are irrelevant: those backends are never `weak`): only the platform mapping is unit-tested; this machine is Linux.
- The real "unavailable" path (no encryption at all) cannot be forced in Electron on Linux; covered by unit tests only.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

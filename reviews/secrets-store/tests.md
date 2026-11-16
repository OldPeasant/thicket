# Test Report

Date: 2026-11-16

Task: secrets-store — M1: Secrets in the OS keychain via safeStorage

Scope: base 516f40781da5bbfce69b7a1f897c8e25b8824aec .. HEAD d066087f89a5109a719f763d740711e7d6783eae on `main` (one task commit, d066087, "Add the secrets store"; the commits between are `assume:` task-file commits). Plus the uncommitted test-only changes listed below. Production files were not modified.

Requirements:
- `tasks/secrets-store.md` acceptance criteria and recorded assumptions
- `SPEC.md` (secrets only via safeStorage; `basic_text` warns and defaults to not saving; renderer never sees secrets)
- `docs/ARCHITECTURE.md` "Secrets" bullet under Electron shell
- `docs/QUALITY.md` (report contract)

## Test files changed

- `apps/desktop/src/secrets/store.spec.ts` (new `describe('SecretsStore edge cases')` block)
- `apps/desktop/src/secrets/handlers.spec.ts` (2 tests added)
- `apps/desktop/test/secrets.electron.spec.ts` (new, real Electron with `--password-store=basic`)
- `apps/desktop/test/helpers.ts` (`launchApp` gets an optional, backward-compatible `switches` argument for Chromium switches)

## Tests added or updated

Count: 20 (store.spec.ts: 14 test cases incl. 5 `it.each` rows; handlers.spec.ts: 2; secrets.electron.spec.ts: 4)

Review of the existing tests: they already covered set/get/delete, persistence without plain text, mode 0600, temp-file cleanup, 9 corrupt-file variants, decrypt with a foreign key, `basic_text`/`unknown` -> weak + `ask`, darwin/win32, unavailable, the handlers, and the schema + behaviour halves of "renderer cannot get a secret". Added tests target the remaining gaps:

- `basic_text: a fresh store switches the plain-text key on before the first read` — regression guard with a stricter fake that, like Electron, refuses to decrypt a `basic_text` file until `setUsePlainTextEncryption(true)`; without the `status()` call in `load()` a restart would move every weak user's secrets aside as corrupt.
- corrupt-file variants: missing version, `profiles: null`, a profile entry that is a string / an array, JSON `null`; plus a valid file with an empty profile entry loads (not moved aside).
- a failed re-encryption (`shouldReEncrypt` + encrypt fails) is logged, secrets still served, file untouched.
- a failed write rejects only that call; a queued `get` still sees the old state; later writes work.
- overlapping `set`/`delete` on one profile without awaiting apply in call order (memory and disk).
- while encryption is unavailable, `delete` leaves an existing file untouched (no wipe while the keyring is locked).
- a write into a missing folder (real fs) rejects with ENOENT and leaves nothing behind; a failing temp-file cleanup does not hide the original write error.
- a value with quotes, newline, backslash and non-ASCII round-trips.
- handlers: non-"unavailable" failures of `setSecret` pass through unchanged (not `UNSUPPORTED`, message without the value, nothing stored); `clearSecret` of nothing stored answers `{}`.
- Electron (real `safeStorage`, `--password-store=basic`, temp `--user-data-dir` asserted before any write): status is `{ level: 'weak', backend: 'basic_text', defaultSecretMode: 'ask' }`; `setSecret` answers `secureStorage: false` and writes an encrypted `secrets.bin` (no plain value or profile id in the bytes); `secrets.get` from the renderer is `UNKNOWN_METHOD`; after an app restart the file still decrypts (a `clearSecret` rewrites it, no `secrets.bin.corrupt-*`).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: unit tests with a fake safeStorage: set/get/delete | store.spec.ts `SecretsStore set/get/delete` (12, existing); edge cases: overlapping set/delete in call order, failed write isolation, unavailable delete leaves file, missing folder, cleanup failure, value round-trip; handlers.spec.ts setSecret/clearSecret | `npx vitest run --project desktop --project contract` (repo root) | Pass |
| AC1: file corruption handled | store.spec.ts `SecretsStore with a corrupt file` (13, existing) + 5 new corrupt variants + empty-entry file loads + failed re-encryption | same | Pass |
| AC2: on `basic_text` status reports `weak`, default not saving passwords | store.spec.ts `Linux basic_text is weak...`, `unknown backend counts as weak`, new strict-fake restart test; handlers.spec.ts `profiles.secretStorage...`, `setSecret on basic_text ... secureStorage: false`; secrets.electron.spec.ts `profiles.secretStorage reports weak basic_text and defaultSecretMode ask`, `setSecret still saves (secureStorage: false)...`, `after a restart the basic_text file still decrypts` | unit command above; `npm run test:electron` (repo root, Linux, Electron 45, headless/xvfb per helpers) | Pass |
| AC3: renderer cannot request a secret (contract test) | contract `no-secrets.spec.ts` (all renderer methods, streams, broadcasts; self-tests); desktop `no-secrets-to-renderer.spec.ts`; main/handlers.spec.ts; new handlers test (error message has no value); app.electron.spec.ts privileged-method test; secrets.electron.spec.ts `secrets.get` -> UNKNOWN_METHOD and no value in answers | unit command above; `npm run test:electron` | Pass |

## Focused test execution

Command:

`npx vitest run --project desktop --project contract` (repo root) and `npx vitest run src/secrets` (apps/desktop)

Result:

Pass (12 files, 844 tests before the last two store tests were added; `src/secrets`: 3 files, 60 tests after them; final coverage run: 8 desktop files, 139 tests)

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc for all workspaces, vitest 16 files / 880 tests, renderer `ng test` 5 files / 181 tests) and `npm run test:electron` (repo root)

Result:

Pass (check: all green after formatting the new Electron spec with prettier; test:electron: 3 files, 17 tests, about 7 s)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run directly as above, exit 0)

## Bugs found

None. No test exposed a production defect. The real-Electron run confirmed the assumption that `setUsePlainTextEncryption(true)` on `basic_text` makes the async API available (status `weak`, not `unavailable`) and that the file decrypts again after a restart.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the V8 provider setup has no changed-line report; whole-file numbers are given instead; store.ts, secrets/handlers.ts are entirely new files, so whole-file equals changed-file there).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `secrets-store`; base 516f40781da5bbfce69b7a1f897c8e25b8824aec (from parent); HEAD d066087f89a5109a719f763d740711e7d6783eae; task-owned code commit d066087 (`git diff --stat 516f407..HEAD`, matches the parent's file list).
- Source/test snapshot identifier (including uncommitted inputs): HEAD d066087 + uncommitted test files, sha256: store.spec.ts 096907c8…3774, handlers.spec.ts e6471983…ae64, test/helpers.ts b2566339…bf2e, test/secrets.electron.spec.ts cc8dd9cf…8833; sources store.ts 6334d7c6…25d3, secrets/handlers.ts f10de873…e11e9, main/handlers.ts 0ee093c1…3c980c1dad, contract profiles.ts 1238c4af…99e2.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/secrets/store.ts`, `apps/desktop/src/secrets/handlers.ts`, `apps/desktop/src/main/handlers.ts`, `packages/contract/src/profiles.ts`. Excluded: `apps/desktop/src/secrets/testing.ts` (test fake, not production behaviour); `apps/desktop/src/secrets/index.ts` (re-exports only, no executable statements); `apps/desktop/src/main/index.ts` (Electron entry point, needs the Electron runtime; its secrets wiring is exercised by `npm run test:electron`, not instrumented); `apps/desktop/test/app.electron.spec.ts` and all `*.spec.ts` (tests); `docs/ARCHITECTURE.md` (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: V8 via vitest 5.1.0 (node v24.21.0). In `apps/desktop`: `npx vitest run --coverage --coverage.include=src/secrets/store.ts --coverage.include=src/secrets/handlers.ts --coverage.include=src/main/handlers.ts --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all desktop unit specs). In `packages/contract`: `npx vitest run --coverage --coverage.include=src/profiles.ts --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=coverage/secrets-store` (all contract specs).
- Run start/completion time and exit status: desktop 2026-11-16 19:48:02 (+0100), 628 ms, exit 0; contract 19:48:11, 669 ms, exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/secrets-store/coverage-summary.json` sha256 b51f0557…9237, `apps/desktop/coverage/secrets-store/coverage-final.json` sha256 1944a918…d39a; `packages/contract/coverage/secrets-store/coverage-summary.json` sha256 dcd616e5…d358 (git-ignored by `coverage/`).
- Evidence outputs are fresh and inputs stayed unchanged: vitest cleans the reports directory per run; source and test hashes taken before the desktop run were identical afterwards.
- Final run after latest test additions and production fixes: yes (no production fixes were made; the run is after the last test edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/secrets/store.ts` | 121/123 (98.37%) | 61/64 (95.31%) | 28/30 (93.33%) | 105/105 (100%) |
| `apps/desktop/src/secrets/handlers.ts` | 15/15 (100%) | 2/2 (100%) | 6/6 (100%) | 13/13 (100%) |
| `apps/desktop/src/main/handlers.ts` | 5/5 (100%) | N/A (0/0) | 4/4 (100%) | 4/4 (100%) |
| `packages/contract/src/profiles.ts` | 19/19 (100%) | 3/4 (75%) | 2/2 (100%) | 19/19 (100%) |
| Aggregate (summed counters, 4 files) | 160/162 (98.77%) | 66/70 (94.29%) | 40/42 (95.24%) | 141/141 (100%) |

Aggregate excludes `src/main/index.ts` (not unit-instrumentable, exercised only by the Electron tests), `src/secrets/testing.ts` and `src/secrets/index.ts` (see above).

Before the added tests the desktop scope measured statements 139/143, branches 63/66, functions 36/40, lines 121/122 (store.ts line 28 uncovered).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `store.ts:28` (`nodeFs.rm`), `store.ts:267` (cleanup `.catch`) | write error path: temp file removed, original error kept | Covered now: `a write into a missing folder rejects...`, `a failing temp-file cleanup does not hide the original write error` |
| `store.ts:133-134` (default `log` and `now` when not injected) | none: trivial defaults; `main/index.ts` always passes `log` | Left uncovered, non-material |
| `store.ts:155` (`PLATFORM_BACKENDS[platform] ?? 'unknown'` for a platform other than linux/darwin/win32) | Electron ships only for those three; such a platform would be reported `secure` with backend `unknown` | Left uncovered, not reachable in supported builds |
| `profiles.ts:51` (`?? ''` in `hasPassword`) | pre-existing code, not changed by this task | Out of task scope |

## Unable to test

- macOS Keychain and Windows DPAPI with the real `safeStorage`: only the platform mapping is unit-tested with the fake; this machine is Linux. Follow-up only if CI gains those runners.
- A real "secure" Linux keyring (`gnome_libsecret`/`kwallet`) in Electron: not forced here; the existing `app.electron.spec.ts` test accepts whatever the environment provides. Unit tests cover the secure path with the fake.
- The real "unavailable" path (no encryption at all) cannot be forced in Electron on Linux (`basic_text` always becomes available via the plain-text key); covered by unit tests only.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

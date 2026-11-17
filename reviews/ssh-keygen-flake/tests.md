# Test Report

Date: 2026-11-17

Task: ssh-keygen-flake - Flaky ssh2 ed25519 test host keys (~0.35% unparseable)

Scope: `fddd04fd0a393b3354e640740e8653bb831775aa..25c040ea` (`git diff fddd04fd..HEAD`, one task commit `25c040ea` "ssh-keygen-flake: shared test key helper that retries until ssh2 can parse the key"), branch `main`, plus the new uncommitted test file `packages/backend/src/ssh/testing.spec.ts`.

Requirements:
- `tasks/ssh-keygen-flake.md` acceptance criteria and the recorded assumption
- Parent worker instructions (focused unit test for `generateTestKeyPair`, incl. the retry path)
- `docs/ARCHITECTURE.md` "Coverage"

## Test files changed

- `packages/backend/src/ssh/testing.spec.ts` (new)

## Tests added or updated

Count: 9

- returns a plain ed25519 pair whose private and public halves both parse
- returns an encrypted pair that parses only with its passphrase
- keeps the requested comment on both halves
- keeps the comment on an encrypted pair
- the bad fixture is a real ssh2 key that ssh2 cannot parse (also asserts its public key is 31 bytes)
- retries after an unparseable private key and returns the next parseable pair (options passed on every attempt)
- retries when only the public half is unparseable
- checks an encrypted private key with the given passphrase and retries on a mismatch
- throws after 100 attempts when every generated key is unparseable

The "bad key" fixture is a real ssh2 ed25519 key found in `beforeAll` by calling the original
`ssh2.utils.generateKeyPairSync` until `parseKey` rejects the private key (about 1 in 300; bounded at
100000 tries). The test confirms the root cause stated in the task: its public key is 31 bytes.
The retry tests spy on `ssh2.utils.generateKeyPairSync` through the same default `ssh2` import the
helper uses. No randomness affects the outcome of a test.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: test SSH host keys come from a generator that always yields a parseable key | all 9 tests in `src/ssh/testing.spec.ts` (parse checks for plain/encrypted/comment keys; retry on bad private, bad public, wrong passphrase; bounded failure) | `cd packages/backend && npx vitest run src/ssh/testing.spec.ts` | Pass (9/9) |
| AC1: callers use the helper (spec files) | existing `backend.spec.ts`, `tunnel.spec.ts`, `tunnel-race.spec.ts` (switched by the task commit) | `cd packages/backend && npx vitest run` | Pass (44 files, 1804 tests) |
| AC1: callers use the helper (`test/integration/fixtures/ssh.ts`, `test/e2e/demo/ssh-x509.ts`, `test/integration/ssh.int.spec.ts`) | integration / e2e | - | Not run: parent runs the integration test itself and asked not to run integration tests |
| AC2: `npm run check` passes | whole project check (lint, typecheck, unit tests, incl. the new spec) | `npm run check` (repo root) | Pass (exit 0) |
| AC2: 5000-iteration loop of the helper produces no unparseable key | none (statistical check) | - | Not run by test-writer: the parent reported running it (0 unparseable). Deterministic retry tests above cover the mechanism instead. |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/ssh/testing.spec.ts`

Result:

Pass (9 passed; run several times, all passed)

## Full test execution

Command:

`cd packages/backend && npx vitest run`, and `npm run check` at the repository root

Result:

Pass (backend: 44 files, 1804 tests; `npm run check` exit 0, renderer 102 files / 3355 tests in the same run). Integration and e2e: Not run (parent's instruction).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; ran that command directly, exit 0)

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; the only scoped file is entirely new in this task, so whole-file coverage equals coverage of its added lines.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `ssh-keygen-flake`; base `fddd04fd0a393b3354e640740e8653bb831775aa` (given by parent); measured HEAD `25c040ea`; task-owned commit `25c040ea` (only commit in `fddd04fd..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 `src/ssh/testing.ts` = `b9e095ee18ffd6001049571e5e6e8ccb8a9c90a9c13dfa3252934843b673ba7b`; sha256 `src/ssh/testing.spec.ts` (uncommitted) = `a8ff699e4aaa0f5ea787cc98cfd5ef84167c542997894abde69b743bcbbf87e8`; same hashes before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/ssh/testing.ts` (new test helper; it is the only non-spec source with behavior added by the task). Excluded: `backend.spec.ts`, `tunnel.spec.ts`, `tunnel-race.spec.ts`, `test/integration/ssh.int.spec.ts` (test files); `test/integration/fixtures/ssh.ts`, `test/e2e/demo/ssh-x509.ts` (test fixtures outside any Vitest unit workspace, one-line switches to the helper). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0 (node v24.22.1); `npx vitest run --coverage --coverage.include='src/ssh/testing.ts' src/ssh/testing.spec.ts`; cwd `packages/backend`; selection `src/ssh/testing.spec.ts`.
- Run start/completion time and exit status: 2026-11-17T06:20:08+01:00 to 06:20:11+01:00, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 `e82559ad274b728ce60a74806278e0901ffb04db354c11749c6fd99b0decc5c5`), `packages/backend/coverage/lcov.info` (sha256 `b29a90f0d5e9aa62eb19ae86fd2c3c57dd65e6622ab2db749ca74962b526e0e0`), mtimes 06:20:11 (written by this run).
- Evidence outputs are fresh and inputs stayed unchanged: yes (report mtimes inside the run window; input hashes unchanged after the run).
- Final run after latest test additions and production fixes: yes (no production changes; the test file was not changed after the run).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/ssh/testing.ts` | 9/9 (100%) | 7/7 (100%) | 1/1 (100%) | 8/8 (100%) |

Aggregate (one file, no unmeasured files): same as above.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none | - | - |

## Unable to test

- The integration/e2e callers (`test/integration/fixtures/ssh.ts`, `test/integration/ssh.int.spec.ts`, `test/e2e/demo/ssh-x509.ts`) were not run, per the parent's instruction (the parent runs `ssh.int.spec.ts`). The e2e demo path needs the parent's own verification if a criterion depends on it.
- The 5000-iteration statistical loop (AC2) was not repeated here; the parent reported it. Not added as a unit test because it is slow and probabilistic; the deterministic retry tests cover the mechanism.

## Summary

Tests added and all validation passed.

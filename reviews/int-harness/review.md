# Code Review

Date: 2026-11-16

Task: int-harness - M0: Integration test harness with MongoDB containers

Scope: final review of `git diff d3ca53510ad3e7623e90409aafcfadf5170a4f5b 0e134a1555f7c1664dc2c120d1c3eb1ca1c140db`, excluding `reviews/` and `tasks/`. Commits: f0c342f (fixtures and `npm run test:int`), 87c1880 (test-writer tests: `test/integration/certs.int.spec.ts`, foreign-CA test in `test/integration/tls.int.spec.ts`), cfe65b5 (fixes for CR-1/CR-2 of the first review), 0e134a1 (test-writer tests: `test/integration/global-setup.int.spec.ts`). This third pass focuses on 0e134a1, the only code change since the second review of cfe65b5; f0c342f..cfe65b5 was reviewed in full in the first two passes and its findings and dispositions are kept below. Working tree: only `reviews/int-harness/review.md` and `reviews/int-harness/tests.md` modified (helper reports, not reviewed code).

Requirements:
- `tasks/int-harness.md` acceptance criteria and recorded assumptions (mongo:8.2 for 8.x, node-forge certs, Ryuk off on Podman, TLS on standalones only)
- `SPEC.md` section 7 (Testing)
- `docs/ARCHITECTURE.md` (Install, Commands, Integration tests)
- `AGENTS.md`, `docs/QUALITY.md`
- `reviews/int-harness/fixes.md` (fix description for CR-1/CR-2), `reviews/int-harness/tests.md` (test-writer evidence)

Git range:
- Branch: main
- HEAD: 0e134a1555f7c1664dc2c120d1c3eb1ca1c140db
- Base/start: d3ca53510ad3e7623e90409aafcfadf5170a4f5b
- Commits reviewed: 4 (f0c342f, 87c1880, cfe65b5, 0e134a1)

Summary: 0 P0, 0 P1, 0 P2, 1 P3 open (CR-3, new); CR-1 and CR-2 from the first review resolved

## Commands run

Third pass (0e134a1):
- `git show 0e134a1` -> one new file, `test/integration/global-setup.int.spec.ts` (180 lines); read in full together with `test/integration/fixtures/global-setup.ts`, `fixtures/mongo.ts` (exports, `FIXTURE_SPECS`), `test/integration/vitest.config.ts`, `tsconfig.json`
- `npx eslint test/integration --max-warnings 0` -> clean (no output)
- `npx tsc -p tsconfig.json` -> no errors (root tsconfig includes `test/integration/**/*.ts`)
- `npx prettier --check test/integration/global-setup.int.spec.ts` -> all files use Prettier code style
- `npx vitest run --config test/integration/vitest.config.ts global-setup` -> not run by the reviewer (command not permitted in this session; it also starts the real fixtures through `globalSetup`). Execution evidence from `reviews/int-harness/tests.md`: focused run 4 passed; `npm run test:int` 4 files, 28 tests passed on rootless Podman, no mongo containers left afterwards.

Earlier passes (still valid for unchanged code):
- `git diff d3ca535 cfe65b5` reviewed; `npx eslint test/integration`, `npx prettier --check test/integration docs/ARCHITECTURE.md`, `npm run typecheck` -> clean
- `git ls-files | grep -Ei '\.(pem|key|crt|p12)$'` -> no matches; `git grep` for PEM headers -> only regexes in `certs.int.spec.ts` and text in review reports. 0e134a1 adds no key or certificate material (the CA PEM it checks is generated at test time and written to a temp dir).

## Verification of previous findings

- CR-1 (P3, TLS SANs only cover local host names): Resolved by documentation in cfe65b5, as decided by the parent. Comment at `test/integration/fixtures/global-setup.ts:28-30` and a bullet in `docs/ARCHITECTURE.md` "Integration tests". Unchanged in 0e134a1.
- CR-2 (P3, temp dir and silent stop failures): Fixed in cfe65b5 (`global-setup.ts:31-61`). 0e134a1 now adds regression tests for both parts: CA write failure removes the temp dir and starts no container; a failing `stop()` produces one `console.warn` naming fixture and container id while the other containers are still stopped and the dir removed.

## Review of 0e134a1 (`test/integration/global-setup.int.spec.ts`)

- Correctness: the real `setup()` is called with `startFixture` replaced by a partial module mock (names and specs stay real) and `mkdtemp`/`writeFile` wrapped as spies around the real functions, so certificate generation, the temp dir and the CA file are real. The fake `startFixture` maps a spec back to its fixture name through the call index; this works because `setup()` calls `startFixture` synchronously in `FIXTURE_NAMES` order and every `FIXTURE_SPECS` entry is a distinct object, and `vi.clearAllMocks()` in `afterEach` resets the call list between tests. The assertions match the implementation: one shared cert set, `provide('mongo')` keyed by every name with that fixture's own info (guards the name/fixture pairing reworked in cfe65b5), CA file content and mode, error message naming exactly the failed fixtures (`not.toContain('mongo8:')` does not falsely match `mongo8rs:`), started fixtures stopped and failed ones not, nothing provided on failure.
- Cleanup: no container is started by these tests. Each test that creates a temp dir removes it through the code under test (teardown in a `finally` in the first test, teardown called directly in the third, setup's own error paths in the second and fourth) and asserts the dir is gone. A dir could only remain if the code under test regressed, which the tests would then report. The `console.warn` spy is restored in `afterEach`.
- Secrets: none committed; error strings are fictitious, the CA is generated per run.
- Placement: like `certs.int.spec.ts`, this spec needs no container but runs only under `npm run test:int`, whose `globalSetup` starts the real fixtures. Accepted in the second pass for the harness's own tests; not a finding.

## Acceptance criteria check

1. `npm run test:int` with Podman, sample test connects to each fixture: `fixtures.int.spec.ts` covers all five fixtures with the Node driver plus a transaction on `mongo8rs`. Run evidence from tests.md (28 passed); not repeated by the reviewer.
2. TLS without CA fails, with CA succeeds: covered for `mongo8tls` and `mongo7tls`, with a certificate-error assertion, plus the wrong-CA case. Met.
3. No certificate/key committed; Install section documents the Podman env vars: verified (see commands). Met.
4. Parallel start, reuse via global setup, < 3 min: `Promise.allSettled` over all fixtures in the global setup, shared via `provide`/`inject`, now also tested directly in `global-setup.int.spec.ts`; about 15 s with cached images per tests.md. Met; timing from the helpers' runs.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | CA file mode assertion fails on Windows**
    - File: `test/integration/global-setup.int.spec.ts:122`
    - Category: Tests
    - Problem: `expect((await stat(caFile)).mode & 0o777).toBe(0o600)` assumes POSIX permissions. On Windows Node ignores the `mode` argument of `writeFile` apart from the read-only bit and `stat` reports `0o666` for a writable file, so this assertion fails there.
    - Why it matters: `docs/ARCHITECTURE.md` (Install table, "Containers for `test:int`") lists Docker Desktop or Podman Desktop on Windows as a supported way to run `npm run test:int`. On Windows the suite would fail on a test-only assumption rather than a harness defect. Linux, the configuration the task verifies, is unaffected.
    - Suggested fix: run the mode check only when `process.platform !== 'win32'` (or move it into a test skipped on Windows); keep the content check unconditional.
- [x] **CR-1 | TLS server certificate only covers local host names** - Resolved (documented limitation) in cfe65b5: `test/integration/fixtures/global-setup.ts:28-30`, `docs/ARCHITECTURE.md` "Integration tests".
- [x] **CR-2 | Setup/teardown failures can leave a temp dir or containers behind silently** - Fixed in cfe65b5: `test/integration/fixtures/global-setup.ts:31-61`; regression tests added in 0e134a1.

## Review conclusion

No material issues found. CR-1 and CR-2 are resolved and CR-2 now has regression tests. The new spec in 0e134a1 is correct, cleans up after itself, contains no secrets, and passes lint, type check and Prettier. The only open item is CR-3 (P3): a POSIX-only file mode assertion that would fail on the Windows `test:int` setup that `docs/ARCHITECTURE.md` documents. Fix it or record why it is left. It does not block the Linux/Podman criteria of this task. Criterion 1 and the timing part of criterion 4 rely on the `npm run test:int` runs recorded in `reviews/int-harness/tests.md`; the reviewer could not repeat them in this session.

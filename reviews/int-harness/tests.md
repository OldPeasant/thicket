# Test Report

Date: 2026-11-16

Task: int-harness - M0: Integration test harness with MongoDB containers

Scope: base `d3ca53510ad3e7623e90409aafcfadf5170a4f5b` .. HEAD `cfe65b55caf809701ee9d2a5f9bb6b116f22e5a5` (final revision, branch `main`), task-owned commits `f0c342f` (fixtures, `npm run test:int`), `87c1880` (cert and foreign-CA tests, review reports), `cfe65b5` (CR-1/CR-2 fixes in `fixtures/global-setup.ts` and `docs/ARCHITECTURE.md`), supplied by the parent worker and checked with `git log --oneline d3ca535..HEAD`. Changed: `test/integration/{vitest.config.ts,fixtures.int.spec.ts,tls.int.spec.ts,certs.int.spec.ts,fixtures/certs.ts,fixtures/mongo.ts,fixtures/global-setup.ts}`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `docs/ARCHITECTURE.md`, `.gitignore`, `reviews/int-harness/*`. Plus the uncommitted test file of this pass (`test/integration/global-setup.int.spec.ts`). This is the second test-writer pass; the first pass described `f0c342f` and its tests were committed in `87c1880`.

Requirements:
- `tasks/int-harness.md` acceptance criteria and recorded assumptions (mongo:8.2 instead of 8.0, node-forge certs, Ryuk off on Podman, TLS fixtures with `tlsAllowConnectionsWithoutCertificates`)
- `docs/ARCHITECTURE.md` "Install", "Integration tests", "Coverage"; `AGENTS.md` project notes (no secrets in fixtures, certs generated at test time)
- `reviews/int-harness/fixes.md` (CR-2 intended behavior: no temp dir left behind on setup errors, per-fixture warning when a container fails to stop; CR-1: documented SAN limitation)

## Test files changed

- `test/integration/global-setup.int.spec.ts` (new in this pass, uncommitted)
- From the first pass, already committed in `87c1880`: `test/integration/certs.int.spec.ts` (new), `test/integration/tls.int.spec.ts` ("unrelated CA" case). Neither needed changes for `cfe65b5`: the fix does not change any exported API, fixture spec, certificate content or provided context shape.

## Tests added or updated

Count: 4 in this pass (16 in total across both passes: 12 from the first pass, 4 now)

`global-setup.int.spec.ts` calls the real global `setup()` with `startFixture` replaced by fakes (`vi.mock('./fixtures/mongo.ts')`, partial: specs and names stay real) and `mkdtemp`/`writeFile` wrapped by spies of the real `node:fs/promises` functions. No container is started by these tests; the real certificate generation and real temp dir in the OS temp directory are used. Tests:

- `starts every fixture with one certificate set and provides their info and the CA file`: `startFixture` called once per `FIXTURE_NAMES` entry with one shared certificate set; `provide('mongo', ...)` maps every fixture name to its own info (guards the reworked name/fixture pairing in `cfe65b5`); `tlsCaFile` contains exactly the CA PEM and has mode 0600; teardown stops every container once and removes the cert dir.
- `stops the started fixtures, removes the cert dir and names the failed ones when a start fails`: two of five starts reject; setup rejects with a message naming exactly the failed fixtures and their errors, the three started containers are stopped, failed ones are not, nothing is provided, the temp dir is gone.
- `warns with the fixture name and container id when a container fails to stop, and stops the rest` (CR-2b regression): one `stop()` rejects; teardown still resolves, `console.warn` is called once with the fixture name, container id and error, all other containers are stopped, the temp dir is removed. Would fail on `87c1880` (rejections were silently discarded).
- `removes the temp dir and starts no container when writing the CA file fails` (CR-2a regression): `writeFile` rejects once; setup rejects with that error, no fixture is started, nothing is provided, the created `thicket-int-*` dir is removed. Would fail on `87c1880` (the dir was left behind).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:int` passes with Podman; a sample test connects to each fixture with the Node driver | `MongoDB fixtures > %s accepts a Node driver connection` (mongo8, mongo8rs, mongo7, mongo8tls, mongo7tls), `replica set fixture supports transactions` | `npm run test:int` (DOCKER_HOST set to the rootless Podman socket `unix:///run/user/1000/podman/podman.sock`, Fedora kernel 6.19.10) | Pass: 4 files, 28 tests, 14.48 s |
| AC2: TLS fixture: without the CA fails, with the CA succeeds | `TLS fixture %s > rejects a TLS connection without the test CA`, `> with an unrelated CA > rejects a TLS connection that trusts a different CA`, `> rejects a plain connection`, `> accepts a TLS connection with the test CA` (mongo8tls, mongo7tls); cert properties in `certs.int.spec.ts`; CA file content/mode in `integration global setup > starts every fixture ...` | `npm run test:int` | Pass |
| AC3a: no certificate or key committed | `certs.int.spec.ts` (fresh material per call); `global-setup.int.spec.ts` (CA written only to a temp dir that is removed on teardown and on setup errors); `.gitignore` ignores `*.pem`, `*.key`, `*.crt` (unchanged since the first pass, where `git ls-files '*.pem' '*.key' '*.crt' '*.p12' '*.pfx'` and `git grep` for PEM headers were empty; `cfe65b5` adds no such file) | `npm run test:int` | Pass |
| AC3b: docs/ARCHITECTURE.md Install section has the exact Podman env vars | Not a test; the Install block (`DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`, `TESTCONTAINERS_RYUK_DISABLED=true`) is unchanged by `cfe65b5`, which only adds the SAN limitation bullet under "Integration tests" | inspection of `git diff 87c1880 cfe65b5 -- docs/ARCHITECTURE.md` | Not testable (documentation); content verified by reading |
| AC4: fixtures start in parallel and are reused across files (global setup); run < 3 min | `integration global setup > starts every fixture ...` (all fixtures started from one setup call, one shared cert set, all provided); 3 container-using files share them via `inject`; timing 14.48 s (14.73 s with coverage) with cached images | `npm run test:int` | Pass (< 3 min with cached images; a first run including image pulls was not measured) |
| CR-2 (fix intent, `fixes.md`): no temp dir or silent container leak on setup/teardown errors | `integration global setup > stops the started fixtures ...`, `> warns with the fixture name and container id ...`, `> removes the temp dir and starts no container ...` | `npx vitest run --config test/integration/vitest.config.ts global-setup` (4 passed) and `npm run test:int` | Pass |
| Containers removed after the run | `podman ps -a --filter ancestor=docker.io/library/mongo:8.2 --filter ancestor=docker.io/library/mongo:7.0` after `npm run test:int` and after the coverage run | shell | Pass: header only, no containers |

## Focused test execution

Command:

`npx vitest run --config test/integration/vitest.config.ts global-setup`

Result:

Pass - Test Files 1 passed (1), Tests 4 passed (4), 2.86 s.

## Full test execution

Command:

`npm run test:int` (DOCKER_HOST exported to the Podman socket), then `npm run check` (eslint + prettier --check, tsc incl. `test/integration`, `vitest run` unit tests)

Result:

Pass - `npm run test:int`: Test Files 4 passed (4), Tests 28 passed (28), 14.48 s, started 18:57:28. `podman ps -a --filter ancestor=docker.io/library/mongo:8.2 --filter ancestor=docker.io/library/mongo:7.0` afterwards: no containers. `npm run check`: Pass (lint and type check include the new spec after `npx prettier --write test/integration/global-setup.int.spec.ts`), unit tests 5 files, 5 tests passed.

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`, which passed (see above). Not invoked through `tasks.py`.

## Bugs found

None. No production defect was found in the task scope; the CR-2 behavior of `cfe65b5` works as described in `fixes.md`.

Observations (not defects, no fix required):
- With Ryuk disabled on Podman, a hard-killed run (SIGKILL, crash) can still leave containers behind; teardown now at least warns when a regular stop fails. Documented trade-off in the task's assumptions.
- If `rm(certDir)` itself fails inside the CA-write error path, that error replaces the original write error. Very unlikely for a fresh temp dir; not tested.
- `isIpLiteral` treats any string containing `:` as an IPv6 literal; acceptable for the hosts the harness passes.

## Coverage

Status: verified for `fixtures/certs.ts` and `fixtures/global-setup.ts`; partial for `fixtures/mongo.ts` (its container-start path runs only in Vitest's main process during globalSetup, which the V8 provider does not instrument; in the new spec `startFixture` is faked).

Metric: whole-file coverage of task-changed production files (the harness sources under `test/integration/fixtures/`; the task has no application production code).
Changed-line coverage: not measured separately; all three files are new in this task (added in `f0c342f`, `global-setup.ts` modified again in `cfe65b5`), so every executable line is a changed line and whole-file coverage equals changed-line coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `int-harness`; base `d3ca53510ad3e7623e90409aafcfadf5170a4f5b`; HEAD `cfe65b55caf809701ee9d2a5f9bb6b116f22e5a5`; commits `f0c342f`, `87c1880`, `cfe65b5` supplied by the parent worker and checked with `git log` / `git show --stat`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `cfe65b5` + uncommitted `test/integration/global-setup.int.spec.ts` (sha256 `5ab4ed251b75ad891ef6d514f651fef48ed78e0125d5b096c0f7c81d169eb256`). Committed, unchanged from HEAD: `fixtures/certs.ts` `59fe23b4...8d576d`, `fixtures/mongo.ts` `42c5bfa6...6b368`, `fixtures/global-setup.ts` `62f31aef...e1b0`, `certs.int.spec.ts` `3844a8fd...a5c`, `fixtures.int.spec.ts` `1ffbb386...7c6`, `tls.int.spec.ts` `9596b601...eb1`. (`reviews/int-harness/review.md` was modified in the working tree by another helper; not an input to the run.)
- Exact included files; renamed/deleted/excluded files and reasons: included `test/integration/fixtures/certs.ts`, `fixtures/mongo.ts`, `fixtures/global-setup.ts`. Excluded: `test/integration/vitest.config.ts` (config, loaded by Vitest before instrumentation), `*.int.spec.ts` (tests), `package.json`/`package-lock.json`/`tsconfig.json`/`eslint.config.mjs` (configuration), `docs/ARCHITECTURE.md`, `.gitignore`, `reviews/**` (non-executable). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with Vitest 5.1.0, Node 24.21.0; `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.provider=v8 --coverage.include='fixtures/**' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory=../../coverage/int-harness --coverage.clean`, from the repo root (Vitest root `test/integration`); all 4 integration spec files; DOCKER_HOST set to the Podman socket.
- Run start/completion time and exit status: started 2026-11-16 18:57:53 (+0100), duration 14.73 s; 4 files / 28 tests passed, exit status 0.
- Generated report paths and report hashes/run identifier: `coverage/int-harness/coverage-summary.json` (git-ignored), sha256 `2e8ba4adf1ce15e3879544ace874470982513b824ec9d5fa5c703aa2e87aaebe`; `coverage/int-harness/coverage-final.json`.
- Evidence outputs are fresh and inputs stayed unchanged: `--coverage.clean` into the task directory; the hashes above were taken immediately before the run and no file was edited until the report was written.
- Final run after latest test additions and production fixes: yes (after `cfe65b5` and after adding `global-setup.int.spec.ts`).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/integration/fixtures/certs.ts` | 26/26 (100 %) | 6/6 (100 %) | 5/5 (100 %) | 26/26 (100 %) |
| `test/integration/fixtures/global-setup.ts` | 27/27 (100 %) | 6/6 (100 %) | 7/7 (100 %) | 27/27 (100 %) |
| `test/integration/fixtures/mongo.ts` | 12/39 (30.76 %) | 3/14 (21.42 %) | 1/4 (25 %) | 11/33 (33.33 %) |
| Aggregate (summed counters, all 3 files; no file missing or excluded) | 65/92 (70.65 %) | 15/26 (57.69 %) | 13/16 (81.25 %) | 64/86 (74.41 %) |

`global-setup.ts` was 0/22 statements in the first pass (main-process only, uninstrumented); it is now measured through the worker-side tests of this pass.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `fixtures/mongo.ts:69-128` (TLS command/args, container start, URI, replica set initiation, error cleanup) | AC1, AC2, AC4: fixtures start and are reachable | Runs in the globalSetup main process, not instrumented by V8 worker coverage. Exercised end to end: every fixture's connection test (incl. rs `setName` and a transaction) and the TLS tests fail if it is broken. The `catch` cleanup after a failed container start (lines 103-105) and the 60 s "no primary" timeout (line 126) are untested failure paths; inducing them needs a broken container or daemon, a justified gap for an M0 test harness. |

## Unable to test

- AC4 timing on a fresh machine (image pulls) was not measured: images were cached; with cached images the run takes about 15 s.
- Container-level failure paths in `mongo.ts` (container fails to start, replica set never gets a primary): would need a deliberately broken image or daemon; justified gap, no follow-up required for M0. The global-setup reaction to such failures is now tested with fakes.
- Coverage of the real (main-process) globalSetup run: not instrumented by the configured V8 worker coverage; `global-setup.ts` is measured via the worker-side tests instead.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found. The CR-2 fixes of `cfe65b5` are covered by regression tests, `global-setup.ts` is now 100 % covered, and the remaining `mongo.ts` gap is the main-process container-start path, which is exercised end to end by the integration tests.

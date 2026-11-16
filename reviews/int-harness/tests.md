# Test Report

Date: 2026-11-16

Task: int-harness - M0: Integration test harness with MongoDB containers

Scope: base `d3ca53510ad3e7623e90409aafcfadf5170a4f5b` .. task commit `f0c342f2f91cc45589e0e93a42097847bdcac37a` (HEAD on `main`, one task-owned commit, supplied by the parent worker). Changed: `test/integration/{vitest.config.ts,fixtures.int.spec.ts,tls.int.spec.ts,fixtures/certs.ts,fixtures/mongo.ts,fixtures/global-setup.ts}`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `docs/ARCHITECTURE.md`, `.gitignore`. Plus the uncommitted test changes of this report (see Coverage evidence).

Requirements:
- `tasks/int-harness.md` acceptance criteria and recorded assumptions (mongo:8.2 instead of 8.0, node-forge certs, Ryuk off on Podman, TLS fixtures with `tlsAllowConnectionsWithoutCertificates`)
- `docs/ARCHITECTURE.md` "Install", "Integration tests", "Coverage"; `AGENTS.md` project notes (no secrets in fixtures, certs generated at test time)

## Test files changed

- `test/integration/certs.int.spec.ts` (new)
- `test/integration/tls.int.spec.ts` (added an "unrelated CA" case)

## Tests added or updated

Count: 12 (10 in `certs.int.spec.ts`; 2 in `tls.int.spec.ts`: one new test x 2 TLS fixtures)

- `generateTestCertificates` (pure, uses `node:crypto` `X509Certificate`): one CA PEM, one server cert PEM followed by its key, no key in the CA PEM; CA has `CA:TRUE` and is self-signed, server cert is a leaf; server cert is signed by the CA (`checkIssued`, `verify`); bundled private key matches the server cert (`checkPrivateKey`, SPKI equality, RSA 2048); SANs: `localhost` as DNS, `127.0.0.1` and `::1` as IP (`checkHost`/`checkIP`, not as DNS), foreign host/IP rejected; EKU serverAuth + clientAuth; validity backdated > 1 h and at most 3 days ahead; every call yields a new CA, key and positive serial, and another run's CA does not verify this run's cert; CN = first host, `localhost` fallback for an empty host list.
- `startFixture` refuses a TLS spec without certificates (throws before any container is started).
- `TLS fixture mongo8tls|mongo7tls > with an unrelated CA > rejects a TLS connection that trusts a different CA` - same CA name and hosts, different key: verifies the fixture trusts only the per-run CA, rather than relying solely on the "no CA" case (which only proves the system trust store does not contain it).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:int` passes with Podman; a sample test connects to each fixture with the Node driver | `MongoDB fixtures > %s accepts a Node driver connection` (mongo8, mongo8rs, mongo7, mongo8tls, mongo7tls: ping, buildInfo major version, `hello.setName`, insert/count), `replica set fixture supports transactions` | `npm run test:int` (DOCKER_HOST=unix:///run/user/1000/podman/podman.sock, rootless Podman 5.8, Fedora kernel 6.19.10) | Pass: 3 files, 24 tests, 15.1 s |
| AC2: TLS fixture: without the CA fails, with the CA succeeds | `TLS fixture %s > rejects a TLS connection without the test CA`, `> with an unrelated CA > rejects a TLS connection that trusts a different CA` (new), `> rejects a plain connection`, `> accepts a TLS connection with the test CA`, for mongo8tls and mongo7tls; cert properties in `certs.int.spec.ts` | `npm run test:int` | Pass |
| AC3a: no certificate or key committed | `git ls-files '*.pem' '*.key' '*.crt' '*.p12' '*.pfx'` -> empty; `git grep -l -e "PRIVATE KEY-----" -e "BEGIN CERTIFICATE"` -> empty; `.gitignore` ignores `*.pem`, `*.key`, `*.crt`; `certs.int.spec.ts` checks fresh material per call | shell commands listed + `npm run test:int` | Pass |
| AC3b: docs/ARCHITECTURE.md Install section has the exact Podman env vars | Not a test: manual inspection of the diff, the block lists `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` and `TESTCONTAINERS_RYUK_DISABLED=true`, matching the environment used for the run above | inspection | Not testable (documentation); content verified by reading |
| AC4: fixtures start in parallel and are reused across files (global setup); run < 3 min | Structural: `globalSetup` starts all 5 fixtures with `Promise.allSettled`; 3 test files share them via `inject`. Timing: whole run 15.1 s (14.9 s with coverage) with images already pulled | `npm run test:int` | Pass (< 3 min with cached images; a first run including image pulls was not measured) |

## Focused test execution

Command:

`npm run test:int`

Result:

Pass - Test Files 3 passed (3), Tests 24 passed (24), Duration 15.11 s. Afterwards `podman ps -a --filter ancestor=docker.io/library/mongo:8.2 --filter ancestor=docker.io/library/mongo:7.0` -> no containers.

## Full test execution

Command:

`npm run check` (eslint + prettier --check, tsc for root incl. `test/integration` and all workspaces, `vitest run`)

Result:

Pass (after `npx prettier --write test/integration/certs.int.spec.ts` for formatting of the new file) - unit tests: 5 files, 5 tests passed.

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`, which passed (see above). Not invoked through `tasks.py`.

## Bugs found

None. No production defect was found in the task scope.

Observations (not defects, no fix required):
- With Ryuk disabled on Podman, containers are stopped only by the global-setup teardown; a hard-killed run (SIGKILL, crash) can leave containers behind. This is the documented trade-off in the task's assumptions.
- `isIpLiteral` treats any string containing `:` as an IPv6 literal; acceptable for the hosts the harness passes (`localhost`, `127.0.0.1`, `::1`).

## Coverage

Status: partial - measured with the project's configured provider; `fixtures/certs.ts` fully measured; `global-setup.ts` and the container-start path of `mongo.ts` execute in the Vitest main process (globalSetup), which the V8 coverage provider does not instrument (it collects from test workers only), so their 0 % / low numbers reflect missing instrumentation, not untested behavior.

Metric: whole-file coverage of task-changed production files (here: the harness sources under `test/integration/fixtures/`; the task has no application production code).
Changed-line coverage: not measured (all three files are new in this task, so whole-file coverage equals changed-line coverage for them).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `int-harness`; base `d3ca53510ad3e7623e90409aafcfadf5170a4f5b`; HEAD `f0c342f2f91cc45589e0e93a42097847bdcac37a`; task-owned commit `f0c342f` and file list supplied by the parent worker and checked against `git show --stat HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `f0c342f` + uncommitted `test/integration/certs.int.spec.ts` (sha256 `3844a8fd507b0d32075272768263c1ac49ef713ae804a59d2de8654acbb01a5c`) and modified `test/integration/tls.int.spec.ts` (sha256 `9596b60110ea13c3ab1a3602e60ff40304bad4dd1df78f1837b7fbe9dc4f3eb1`); sources unchanged from HEAD: `fixtures/certs.ts` `59fe23b4...d576d`, `fixtures/mongo.ts` `42c5bfa6...b6368`, `fixtures/global-setup.ts` `38719112...f6253`.
- Exact included files; renamed/deleted/excluded files and reasons: included `test/integration/fixtures/certs.ts`, `fixtures/mongo.ts`, `fixtures/global-setup.ts`. Excluded: `test/integration/vitest.config.ts` (config, loaded by Vitest itself before instrumentation), `*.int.spec.ts` (tests), `package.json`/`package-lock.json`/`tsconfig.json`/`eslint.config.mjs` (configuration), `docs/ARCHITECTURE.md`, `.gitignore` (non-executable).
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with Vitest 5.1.0, Node 24.21.0; `npx vitest run --config test/integration/vitest.config.ts --coverage.enabled --coverage.provider=v8 --coverage.include='fixtures/**' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reportsDirectory=../../coverage/int-harness --coverage.clean`, run from the repo root (Vitest root `test/integration`); all 3 integration spec files.
- Run start/completion time and exit status: started 2026-11-16 18:53:25 (+0100), duration 14.94 s; 3 files / 24 tests passed, exit status 0.
- Generated report paths and report hashes/run identifier: `coverage/int-harness/coverage-summary.json` (git-ignored), sha256 `3ddc8c54eb656f70d17b697f6c64de5c762cb932b2fdaf58c6f5ee66e9a97f3d`.
- Evidence outputs are fresh and inputs stayed unchanged: fresh directory with `--coverage.clean`; no source or test file was edited between the run and hashing.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/integration/fixtures/certs.ts` | 26/26 (100 %) | 6/6 (100 %) | 5/5 (100 %) | 26/26 (100 %) |
| `test/integration/fixtures/mongo.ts` | 12/39 (30.76 %) | 3/14 (21.42 %) | 1/4 (25 %) | 11/33 (33.33 %) |
| `test/integration/fixtures/global-setup.ts` | 0/22 (0 %) | 0/6 (0 %) | 0/7 (0 %) | 0/20 (0 %) |
| Aggregate (summed counters, all 3 files; no file missing) | 38/87 (43.67 %) | 9/26 (34.61 %) | 6/16 (37.5 %) | 37/79 (46.83 %) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `fixtures/mongo.ts:69-128` (TLS command/args, container start, URI, replica set initiation, error cleanup) | AC1, AC2, AC4: fixtures start and are reachable | Runs in the globalSetup main process, not instrumented by V8 worker coverage. Behavior is exercised end to end: every fixture's connection test (incl. rs `setName` and a transaction) and the TLS tests would fail if it were broken. The `catch` cleanup after a failed start (lines 103-105) and the 60 s "no primary" timeout (line 126) are untested failure paths; inducing them needs a broken container, not worth it for a test harness. |
| `fixtures/global-setup.ts:29-57` (cert generation, parallel start, failure teardown, provide) | AC4: parallel start, reuse across files | Main-process code, uninstrumented. Reuse is exercised (3 files inject the same fixtures in one 15 s run); the startup-failure branch (lines 44-50) is untested for the same reason as above. |

## Unable to test

- AC4 timing on a fresh machine (image pulls) was not measured: images were already cached; with cached images the run takes about 15 s.
- Startup-failure paths of the fixtures (container fails, replica set never gets a primary): would need a deliberately broken image or daemon; left as a justified gap, no follow-up required for M0.
- Coverage of globalSetup code: not measurable with the configured V8 worker coverage without configuration changes outside this helper's authority.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient for the acceptance criteria; no production defects found. Coverage numbers for `mongo.ts`/`global-setup.ts` are limited by globalSetup running outside the instrumented workers, not by missing behavioral tests.

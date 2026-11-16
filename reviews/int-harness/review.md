# Code Review

Date: 2026-11-16

Task: int-harness - M0: Integration test harness with MongoDB containers

Scope: `git diff d3ca535 f0c342f` (single task commit f0c342f "Add MongoDB Testcontainers fixtures and npm run test:int"). Uncommitted test-writer work in the working tree (`test/integration/tls.int.spec.ts` modification, untracked `test/integration/certs.int.spec.ts`) is outside this scope and was not reviewed.

Requirements:
- `tasks/int-harness.md` acceptance criteria and recorded assumptions (mongo:8.2 for 8.x, node-forge certs, Ryuk off on Podman, TLS on standalones only)
- `SPEC.md` section 7 (Testing)
- `docs/ARCHITECTURE.md` (Install, Commands, Integration tests)
- `AGENTS.md`, `docs/QUALITY.md`

Git range:
- Branch: main
- HEAD: f0c342f2f91cc45589e0e93a42097847bdcac37a
- Base/start: d3ca53510ad3e7623e90409aafcfadf5170a4f5b
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Commands run

- `git diff d3ca535 f0c342f` (all files; lockfile inspected for removed entries: the removed `node_modules/*` hunks are reordering, e.g. `node_modules/eslint` is present in both revisions) -> reviewed
- `git ls-files | grep -Ei '\.(pem|key|crt|p12)$'` and `git grep -l "BEGIN .*PRIVATE KEY\|BEGIN CERTIFICATE" f0c342f` -> no matches (no committed certificate or key)
- `npx eslint test/integration/fixtures test/integration/fixtures.int.spec.ts test/integration/vitest.config.ts` -> clean
- `npm run lint` on the working tree -> 8 ESLint errors; the only files differing from f0c342f are the test-writer's in-progress files, and the committed integration files lint clean (previous command), so these were not attributed to this commit
- Read `node_modules/testcontainers/build/wait-strategies/wait-for-container.js`: a failed wait strategy stops and removes the container itself, so `startFixture` does not leak a container when `start()` rejects
- `npm run test:int` -> not run by the reviewer (the command was not permitted in this review session); the parent reports 12 tests passing in about 10 s under rootless Podman

## Acceptance criteria check

1. `npm run test:int` with Podman, sample test connects to each fixture: `fixtures.int.spec.ts` connects with the Node driver to all five fixtures (ping, buildInfo major version, hello setName, insert/count) plus a transaction on `mongo8rs`. Execution evidence is the parent's run; not independently re-run here.
2. TLS without CA fails, with CA succeeds: `tls.int.spec.ts` covers both TLS fixtures; the no-CA case asserts a certificate error, not just any error. Met.
3. No certificate/key committed; ARCHITECTURE Install has the Podman env vars: verified (no PEM content in the tree, `.gitignore` covers `*.pem/*.key/*.crt`, `DOCKER_HOST` and `TESTCONTAINERS_RYUK_DISABLED` documented with the socket command). Met.
4. Parallel start, reuse via global setup, < 3 min: `global-setup.ts` starts all fixtures with `Promise.allSettled` once and shares them through `provide`/`inject`. Met by design; timing from the parent's run.

Cert generation reviewed: CA has critical `basicConstraints cA` and `keyCertSign`; server cert has SANs for `localhost`, `127.0.0.1`, `::1` (IP SANs as type 7), `serverAuth`, positive 16-byte serial, validity from now-1 day. Correct for the local-runtime case.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | TLS server certificate only covers local host names; fixtures fail on a remote or non-local container host**
    - File: `test/integration/fixtures/global-setup.ts:31`
    - Category: Integration
    - Problem: The SAN list is hard-coded to `['localhost', '127.0.0.1', '::1']`, but the URI host comes from `started.getHost()` (`test/integration/fixtures/mongo.ts:87`), which is the container runtime host. With a remote `DOCKER_HOST=tcp://...`, Docker-in-Docker CI, or a runtime that reports a VM IP, the driver's hostname check fails and the TLS fixtures (and the "accepts with CA" tests) fail although everything else works.
    - Why it matters: The harness is meant to run with Docker or Podman on several OSes and in CI; this failure would look like a TLS bug rather than a configuration gap.
    - Suggested fix: Add the runtime host to the SAN list before generating the certificate (e.g. via `getContainerRuntimeClient()` from testcontainers, `client.info.containerRuntime.host`), or document the local-runtime limitation in `docs/ARCHITECTURE.md` "Integration tests". Disposition suggestion: accepted or deferred; not needed for this machine.

- [ ] **CR-2 | Setup/teardown failures can leave a temp dir or containers behind silently**
    - File: `test/integration/fixtures/global-setup.ts:30-42`
    - Category: Quality
    - Problem: (a) `mkdtemp` runs before `generateTestCertificates` and `writeFile`; if either throws, `teardown` does not exist yet and the `thicket-int-*` directory is left in the temp dir. (b) `teardown` uses `Promise.allSettled` on `container.stop()` and discards rejections; with Ryuk disabled (the Podman default set in `vitest.config.ts`), a failed stop leaves a running MongoDB container with no message.
    - Why it matters: Small, but on Podman nothing else reaps the containers, so a silent stop failure accumulates running containers across runs.
    - Suggested fix: Wrap the pre-start steps in `try { ... } catch { await rm(certDir, ...); throw }` (or create the dir after cert generation), and log rejected `stop()` results (container id and reason) in `teardown`. Disposition suggestion: fixed if cheap, otherwise accepted.

## Review conclusion

No material issues found. The two P3 findings are non-blocking; the parent decides their disposition. Criterion 1 and the timing part of criterion 4 rely on the parent's recorded `npm run test:int` run, which the reviewer could not repeat in this session.

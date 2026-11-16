# Code Review

Date: 2026-11-16

Task: conn-manager - M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard

Scope: `git diff afb33934c586d6ee50ea8b1f8495038dd102ba66..223127210621cbb62f4cfbfc8ede2364de03753a` (committed changes only)

Requirements:
- tasks/conn-manager.md (goal, 4 acceptance criteria, recorded assumptions)
- SPEC.md: M1 Safety, section 4 (API contract, error codes, write rules), section 6 (security)
- docs/ARCHITECTURE.md: Electron shell section incl. the new "Connections" and "Write guard" bullets
- AGENTS.md
- mongodb driver 7.9.0 sources in node_modules/mongodb (error classes, MongoClient connect/close)

Git range:
- Branch: main
- HEAD: 223127210621cbb62f4cfbfc8ede2364de03753a
- Base/start: afb33934c586d6ee50ea8b1f8495038dd102ba66
- Commits reviewed: 5

Summary: 0 P0, 0 P1, 3 P2, 1 P3

Verification run by the reviewer:
- `npx vitest run` in packages/backend -> 8 files, 221 tests passed
- `npm run test:int -- conn-manager` (Podman MongoDB fixtures) -> 1 file, 23 tests passed

All four acceptance criteria are covered by tests that pass: SCRAM ok and wrong password,
TLS without a CA, unknown host and SRV, replica set and standalone (int); the guard refusing
every `WRITE_METHODS` method on read-only profiles and on production profiles without
`confirmed: true` (unit); masked logs captured in unit and int tests; several connections
opened together and closed one at a time (int). `tasks.py verify conn-manager` shows no
criterion recorded yet. The parent still has to record evidence, so this is not a finding.

Checked with no finding: the privileged `profiles.forConnect` is in `privilegedMethods` only.
Renderer ports are served with the `methods` table and `serve` refuses names that aren't in it,
so the renderer can't call it. The guard fails closed: an unknown profile or a missing main link
throws, an unreadable pipeline counts as a write, and a conditional method without a predicate
counts as a write. Messages and log lines are redacted with `maskText` plus the connect's secret
values. `SERVER_ERROR` detail carries only the code and code name.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Cancelling a connect during SRV resolution or CA-file loading leaks a live, authenticated MongoClient**
    - File: `packages/backend/src/connections/manager.ts:119` (also `:130`, and `test()` at `:71`/`:83`)
    - Category: Correctness
    - Problem: When the request's signal aborts, `abortable()` rejects at once. The catch then calls
      `closeQuietly(entry.client)` (or the `finally` does in `test()`), but `client.connect()` keeps
      running. In driver 7.9, `MongoClient._close()` returns early when `this.topology == null`
      (node_modules/mongodb/lib/mongo_client.js:349-351). `_connect()` creates the topology only
      after it reads `tlsCAFile` and resolves the SRV record (lines 215-249), so it creates and
      connects a topology afterwards. Nothing closes that client again. The `close()` path
      re-checks `entries.get(profileId) !== entry` after the connect and closes then, but the
      abort path doesn't do that.
    - Why it matters: if a user cancels a slow `mongodb+srv://` connect, a client stays connected
      with monitoring sockets and timers and the profile's credentials. It runs for the rest of the
      backend's life, and `conn.status` doesn't show it.
    - Suggested fix: when the signal cancels, still close the client after the driver's connect
      settles, e.g. `connectPromise.finally(() => closeQuietly(client))`, in both `connect()` and
      `test()`. Add a unit test with a fake client whose `close()` is a no-op until `connect()`
      has run.

- [ ] **CR-2 | `conn.test` with a draft that has an `id` sends that profile's stored secrets to a renderer-chosen endpoint**
    - File: `packages/backend/src/connections/manager.ts:200` (with `:63-65`)
    - Category: Security
    - Problem: `secretsFor()` loads the stored secrets whenever `profile.id !== undefined`, and for
      `conn.test` with `profile`, that `id` comes from the renderer's draft. The contract allows
      it (`profileDraft` has an optional `id`). The draft's own `connectionString`, `tls` and auth
      settings are used with the stored password and `tlsKeyPassphrase` of the saved profile. A
      draft can change the host, turn TLS off, or set allow-invalid flags and still use the saved
      credentials. This isn't recorded as an assumption, isn't in ARCHITECTURE.md (it only
      describes stored secrets for "profiles with an id"), and has no test (manager.spec.ts:399
      only covers a draft without an id).
    - Why it matters: SPEC section 6 keeps secrets inside backend/main, and the renderer is treated
      as untrusted. With SCRAM the password isn't sent in clear text, but a server the draft points
      to gets a SCRAM exchange it can use to guess the password offline, possibly over a
      connection without TLS. Once PLAIN/LDAP is supported (M5), this path would send the stored
      password in clear text. It may be the intended "test the edited profile with its saved
      password" feature, but then a human should decide it explicitly.
    - Suggested fix: record it as an assumption, or limit it. For example, only use stored
      secrets for a draft when its host list and TLS settings match the saved profile, or require
      a typed `password` for drafts. Add a test for whichever behaviour is chosen.

- [ ] **CR-3 | Concurrent `conn.open` calls share the first caller's AbortSignal and password**
    - File: `packages/backend/src/connections/manager.ts:95` (with `:99`, `:119`, `:133-134`)
    - Category: Correctness
    - Problem: A second `open()` for a profile that is still connecting returns
      `current.opening`. That promise is bound to the first request's `signal` and `password`.
      If the first request is cancelled (another window, or the user cancels), the shared connect
      rejects with `CANCELLED`, the entry is removed, and the second caller also gets `CANCELLED`
      even though it didn't cancel. The second caller's `password` is ignored too. The unit test
      at manager.spec.ts:138 only covers the case where both callers succeed.
    - Why it matters: another request's cancellation fails this request. That breaks the
      request-identity rule for async state. With several windows on the same profile, an open
      can fail for no visible reason.
    - Suggested fix: don't tie the shared connect to one caller's signal. Run the connect without
      a signal, have each caller wait on it through its own `abortable(opening, signal)`, and
      close and forget the connect only when every waiter has cancelled, or never. Add a test
      where the first of two concurrent opens is aborted.

## P3 Low

- [ ] **CR-4 | `conn.close` during a real driver connect answers the pending open with NETWORK_ERROR instead of CANCELLED**
    - File: `packages/backend/src/connections/manager.ts:119-124` (classification in `packages/backend/src/connections/errors.ts:151`)
    - Category: Correctness
    - Problem: After the topology exists, `client.close()` drains the server selection wait queue
      with `MongoTopologyClosedError` (node_modules/mongodb/lib/sdam/topology.js:257). So
      `client.connect()` rejects before the `entries.get(profileId) !== entry` check that throws
      `CANCELLED` is reached. The error has no specific cause and its name starts with `Mongo`, so
      `classifyCode` returns `NETWORK_ERROR` ("Server could not be reached: Topology is closed").
      The unit test at manager.spec.ts:204 uses a fake whose connect resolves after close, so it
      doesn't cover this. The state is still correct, because the entry is already gone.
    - Why it matters: the renderer gets a misleading connection error for an open the user
      cancelled with close, and ARCHITECTURE/tests document `CANCELLED` for this case.
    - Suggested fix: in the catch, when `this.entries.get(profileId) !== entry`, answer
      `CANCELLED` whatever the driver error is.

## Review conclusion

Material issues found; fix before completing the task. There are no P0 or P1 findings, and
every acceptance criterion is covered by tests that pass. CR-1 to CR-3 are resilience and
security issues in the connection manager. Fix them or record them as assumptions, and CR-2
needs an explicit decision.

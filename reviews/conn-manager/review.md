# Code Review

Date: 2026-11-16

Task: conn-manager - M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard

Scope: second-pass review of the final revision, `git diff f6af91e1db62d43837d86d20009b03eca9a2daf2..201286293a9006c7f0e6a15365c8447c782d7e9e`, limited to the conn-manager commits (b6594e7, 8b42546, 347b81a, 973401f, 81f4d00, caa0306, 2012862), excluding `tasks/` and `reviews/`. Committed changes only.

Reviewed revision: 201286293a9006c7f0e6a15365c8447c782d7e9e

Requirements:
- tasks/conn-manager.md (goal, 4 acceptance criteria, recorded assumptions)
- SPEC.md: M1 Safety, section 4 (API contract, error codes, write rules), section 6 (security)
- docs/ARCHITECTURE.md: "Connections" and "Write guard" bullets
- AGENTS.md
- reviews/conn-manager/fixes.md (fixes of the first-pass findings)

Git range:
- Branch: main
- HEAD: 201286293a9006c7f0e6a15365c8447c782d7e9e
- Base/start: f6af91e1db62d43837d86d20009b03eca9a2daf2
- Commits reviewed: 7 (the conn-manager commits; the range also contains merged main work from other tasks, which is out of scope)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Verification run by the reviewer:
- `npx vitest run` in packages/backend -> 8 files, 247 tests passed
- `npm run test:int -- conn-manager` (Podman MongoDB fixtures) -> 1 file, 23 tests passed

## Status of the first-pass findings

- CR-1 (cancelled connect leaks a MongoClient): resolved. `test()` keeps the driver's connect
  promise and, when the connect hadn't finished, closes the client again once it settles
  (manager.ts:100-110). `open()`'s shared `connect()` no longer races a signal: it always awaits
  `client.connect()` and closes the client if the entry was closed or replaced meanwhile
  (manager.ts:182-187). It also re-checks the entry after loading the profile and secrets
  (manager.ts:174). Covered by the CR-1 tests in manager.spec.ts (lines 269, 286, 727, 741, 891, 905).
- CR-2 (draft with `id` gets stored secrets for another endpoint): resolved. `matchesSaved()`
  (manager.ts:282-297) hands out stored secrets only when the connection string, auth, TLS and SSH
  equal the saved profile. It fails closed for unknown ids and passes other errors through. The
  remaining fields that `clientConfig()` reads (appName, readPreference, timeouts) don't change
  the target or the credentials. The rule is documented in ARCHITECTURE.md:170-172 and tested
  (manager.spec.ts:534-605, 928, 963).
- CR-3 (concurrent opens share the first caller's signal): resolved. `waitFor()`
  (manager.ts:139-163) gives each caller its own `abortable` wait and counts waiters. The connect
  is closed only when the last waiting caller cancels while the entry is still `connecting` and
  current. A caller without a signal keeps the connect alive. The behavior that a later caller's
  password is ignored is documented in the `open()` comment and in ARCHITECTURE.md. Tested at
  manager.spec.ts:297-363, 830, 874.
- CR-4 (close during connect answers NETWORK_ERROR): resolved. The `connect()` catch answers
  `CANCELLED` whenever the entry is no longer current (manager.ts:194-197). Tested at
  manager.spec.ts:248. The earlier test at :234 was updated to expect `CANCELLED`, which is what
  the approved fix requires, and it still checks that the newer open stays `connected`.

## New-issue check on the final code

Checked with no finding:
- Waiter accounting. `leave` is removed in `finally`, so a waiter that settles normally or with
  an error never triggers a close later. The close only runs for an entry that is current and
  still `connecting`. A new `open()` after every caller cancelled creates a fresh entry, and the
  old connect can't overwrite it (`entries.get(profileId) !== entry` checks).
- Error paths always clean up. They close the client, set `error` state or forget the entry on
  `CANCELLED`, and log masked. `opening` is cleared in `finally`, so a later open after `error`
  starts a new connect.
- In `test()`, the abandoned `connecting` promise has a rejection handler, so no unhandled
  rejection occurs (also covered by the test at :905).
- The write guard, the privileged-only `profiles.forConnect` and the masking are unchanged since
  the first pass and still fail closed.
- ARCHITECTURE.md matches the final behavior.

Acceptance criteria: all four are covered by tests that pass in this run. Those are the int
tests for SCRAM, wrong password, TLS without a CA, unknown host, replica set, standalone and
several concurrent connections; the guard unit tests for every `WRITE_METHODS` method; and the
captured-log masking tests. `python tasks.py verify conn-manager` still shows no criterion
recorded. The parent worker has to record the evidence before `done`. That is a workflow step,
not a code finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. The first-pass findings CR-1 to CR-4 are resolved in revision
201286293a9006c7f0e6a15365c8447c782d7e9e, and the backend unit tests and the conn-manager
integration tests pass.

# Test Report

Date: 2026-11-17

Task: shell-open-close-race: Shell opening during conn.close/tunnel loss outlives the connection

Scope: `git diff d6a2fdab5cfd18b8fec3a1734e60888620ba7e76..663f7f643e84549458d3906e0f2716639c5d8fdb -- packages` (one task commit, 663f7f6, on branch `main`) plus uncommitted test additions in `packages/backend/src/shell/host.spec.ts`. Production files changed: `packages/backend/src/shell/host.ts`. Test files changed by the task: `packages/backend/src/shell/host.spec.ts`.

Requirements:
- `tasks/shell-open-close-race.md` acceptance criteria
- Parent instructions (edge cases: abort between worker answer and continuation, several pending opens, map cleanup)
- `docs/ARCHITECTURE.md` "Coverage"; `AGENTS.md`

## Test files changed

- `packages/backend/src/shell/host.spec.ts`

## Tests added or updated

Count: 5 tests added (plus the helper `openingOf`, which reads the host's private `opening` map through a cast, as an existing test in this file already does for `createWorker`). The 4 tests in the task commit are unchanged.

Added, in `describe('ShellHost.close / closeProfile / closeAll')`:
- `closeProfile cancels every pending open of the profile and terminates each worker`: three pending opens on one profile all answer CANCELLED ("connection was closed"), each worker is terminated once, late `opened` replies register nothing, and the map is empty.
- `closeProfile at any point after the worker answered leaves no session and no live worker`: the worker answers, then `closeProfile` runs after 0..8 microtask yields. Every timing must end with no session, a terminated worker and an empty map. A rejection must be CANCELLED "connection was closed". The test also asserts that at least one timing hit the window between the answer and the open's continuation (the `if (closing.signal.aborted)` branch after `startWorker`, identified by the missing "open failed" log). Coverage shows that branch ran twice.
- `a new open of the profile started while a cancelled one settles is still tracked`: this is a regression guard for the `this.opening.get(profileId) === pending` check. A reopen that registers before the cancelled open's `finally` runs must still be cancelled by a later `closeProfile`.
- `pending opens are forgotten once they settle (opened, failed or cancelled)`: checks the map cleanup after a successful open, an `openFailed`, and a user-signal abort.
- `an open whose signal is already aborted answers CANCELLED without posting`: covers the `signal?.aborted` pre-check. The message is the plain cancellation, the worker is terminated, nothing is posted and the map is clean.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: conn.close / status error/disconnected while `shell.open` is pending makes the open answer CANCELLED and terminates its worker | host.spec.ts: `closeProfile while an open waits for its worker answers CANCELLED and terminates the worker`, `closeProfile while the credential provider is pending cancels the open before posting`, `closeProfile cancels every pending open of the profile and terminates each worker`, `closeProfile at any point after the worker answered leaves no session and no live worker`; wiring conn.close / status error/disconnected → `closeProfile` (pre-existing): backend.spec.ts closeProfile spy tests | `cd packages/backend && npx vitest run src/shell/host.spec.ts` and `npx vitest run` | Pass |
| AC2: a shell opened after a reconnect is unaffected | `a shell opened after closeProfile (reconnect) is unaffected`, `a new open of the profile started while a cancelled one settles is still tracked` (a reopen gets its own registration), `closeProfile while an open waits ...` (another profile's open unaffected) | same | Pass |
| Map cleanup / no leak of pending opens (parent edge case) | `pending opens are forgotten once they settle ...`, plus map assertions in the tests above | same | Pass |
| Open cancelled by its own signal keeps the plain CANCELLED message | `an open cancelled by its own signal still answers CANCELLED ...`, `an open whose signal is already aborted answers CANCELLED without posting` | same | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/shell/host.spec.ts`

Result:

Pass (1 file, 69 tests)

## Full test execution

Command:

`cd packages/backend && npx vitest run`

Result:

Pass (39 files, 1684 tests)

## .taskcheck

Result:

Pass (`sh .taskcheck` runs `npm run check`: lint, type check, unit tests including renderer 100 files / 3254 tests; exit 0)

## Bugs found

None. No production defect was found against the acceptance criteria.

Observation, not a defect against this task's criteria, for the parent to decide on: `ShellHost.closeAll()` (backend shutdown) does not abort pending opens. An open in flight during `closeAll` can still register a session after it. The task only names conn.close and status error/disconnected, so no test was added for this.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured from `coverage/coverage-final.json` (v8, source-mapped) for statements, branches and functions whose start line lies in the added hunks of `git diff -U0 d6a2fdab..663f7f6 -- packages/backend/src/shell/host.ts` (lines 82-86, 112-137, 279-281, 470-476). Results: statements 28/29 (96.55%), branches 14/14 (100%), functions 2/3 (66.67%), lines with executable statements 24/24 executed. The one uncovered item is the inline `.catch(() => undefined)` callback at host.ts:124 (the terminate call itself runs).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: shell-open-close-race; base d6a2fdab5cfd18b8fec3a1734e60888620ba7e76 (from the parent); HEAD 663f7f643e84549458d3906e0f2716639c5d8fdb; task commit 663f7f6 (the only commit in base..HEAD).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 663f7f6 plus the uncommitted `packages/backend/src/shell/host.spec.ts` sha256 e0eae3829defa6e02f9cb5e22450a96e458788c0a851ac09e2e9190a707571a0; `host.ts` sha256 7ae0fb2b18aded7f21fc22a5daec39a0bf1470dddcc47d1c9a2a068ad5bac59b. Both hashes were identical before and after the runs.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/shell/host.ts`. Excluded `host.spec.ts` (a test file). No renames or deletions.
- Provider/version, command, working directory, and test selection: vitest 5.1.0 with @vitest/coverage-v8 5.1.0 on node v24.21.0; `npx vitest run --coverage --coverage.include='src/shell/host.ts' --coverage.clean=true --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=json src/shell/`; cwd `packages/backend`; selection is all specs under `src/shell/`.
- Run start/completion time and exit status: 2026-11-17 04:54:19 to 04:54:23 UTC, exit 0. An earlier identical run at 04:51 UTC produced the same summary hash.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` sha256 9e30421b6be3e41d3dceeeb82b910ca61271b562cb94cb9e16815a8c104044e0; `packages/backend/coverage/coverage-final.json` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. Each run used `--coverage.clean=true`, and the input hashes matched before and after.
- Final run after latest test additions and production fixes: yes. No production fixes were made.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/shell/host.ts` | 236/247 (95.54%) | 104/116 (89.65%) | 50/57 (87.71%) | 206/207 (99.51%) |

Aggregate is the single file above; no scoped files are unmeasured or excluded.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `host.ts:124` `.catch(() => undefined)` callback | A `terminate()` rejection in the abort-after-answer path is swallowed | Justified gap: defensive. The fake worker's `terminate` never rejects, and the same pattern is used elsewhere in the file. |
| `host.ts:95,98` default `createWorker` / log | Not task code; constructor defaults | Pre-existing, outside task scope |
| `host.ts:187, 309, 325, 333, 379/382, 398-399, 430` and branches at 205, 223, 256, 316, 368, 484 | Pre-existing eval/complete/close/restart paths | Pre-existing, outside task scope; not changed by this task |

## Unable to test

- Real `worker_threads` / real MongoDB timing of the race. Unit tests use the existing `FakeWorker`, as the acceptance criteria ask for unit tests. No follow-up is needed for this task.

## Summary

Tests added and all validation passed.

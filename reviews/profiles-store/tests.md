# Test Report

Date: 2026-11-16

Task: profiles-store - M1: Connection profiles store (connections.json)

Scope: second pass (see "Second pass" below; it supersedes the first pass's coverage numbers): `git diff 28a9e75dec84fc123e5df40b33588064274b81cb..8381359662d6eb04136d589cccd11f5f682c7429`, task commits `dd88233`, `1255a4d`, `8381359` (plus `f929c33`, which only adds the review). First pass: `git diff 28a9e75dec84fc123e5df40b33588064274b81cb..dd88233f12f478726360ffd24c957fab460f0642` (one task commit `dd88233`, given by the parent worker; branch `main`, HEAD `dd88233`). Production files in scope: `apps/desktop/src/profiles/store.ts`, `apps/desktop/src/profiles/handlers.ts`, `apps/desktop/src/profiles/index.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/main/index.ts`. Also changed: the fixture `apps/desktop/src/profiles/fixtures/connections.v0.json`, the spec `apps/desktop/src/profiles/store.spec.ts` and `docs/ARCHITECTURE.md` (documentation, not tested). The only uncommitted changes are the test edits listed below.

Requirements:
- `tasks/profiles-store.md`: acceptance criteria and the three recorded assumptions (v0 layout, save/duplicate/secretMode semantics, corrupt/unreadable/newer-version handling)
- `SPEC.md`, and the "Profiles (src/profiles/)" and "Coverage" sections of `docs/ARCHITECTURE.md`
- Parent instructions: mainHandlers wiring, failure paths when secrets cannot be deleted, migration edge cases

## Test files changed

- `apps/desktop/src/profiles/store.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`

## Tests added or updated

Count: 33 new test cases (26 `it`/`it.each` blocks in `store.spec.ts`, which expand to 31 cases, and 2 `it` blocks in `handlers.spec.ts`). No existing test was changed or removed. The two spec files went from 32 to 65 test cases.

Added to `store.spec.ts`:
- `secrets.bin failures`: delete removes the profile even when its secrets cannot be removed (logged); switching to "ask" still saves the profile when the password cannot be removed; saving a profile that keeps secretMode "saved" does not touch its password; creating a new profile never deletes secrets; switching secretMode to "none" clears the saved password; an invalid save does not delete the saved password or change the profile; a save whose write crashes does not delete the saved password.
- `write failures`: a failed temp write removes the temp file and keeps state, and the next save works; a crashed delete or duplicate keeps the profile and its secrets; the write error is reported, not the cleanup error, when no temp file was created; a read error without an error code fails the operation instead of starting empty; a failed operation does not block later ones in the queue; the store logs and continues when a stale temp file cannot be removed.
- `migration edge cases`: an empty v0 array becomes an empty version-1 file; a v0 username without a password asks for it, and an empty id gets a new one; askPassword without a username gets "ask" auth and stores no secret; empty color/group and non-boolean flags are not carried over; an undecodable password or username is kept as written; splitPassword leaves a string that is not a mongodb URI unchanged; a password containing "@" is split at the last "@"; a v0 file with any of 6 invalid shapes is moved aside and no secret is moved (a non-object entry, no name, a non-mongodb URI, no scheme but a password, no URI, duplicate ids); a failed rewrite keeps the v0 file and retries on the next operation, with secrets moved first; migrate() rejects non-integer and non-number versions and passes newer ones through.
- `newer file versions`: drops profiles that are invalid in this version (including one with a password in its URI) and still refuses changes (save/duplicate), and the file stays unchanged.
- `handlers without secrets handlers`: no `profiles.setSecret` is offered, and unexpected errors pass through unmapped; delete/duplicate/save of unknown ids map to NOT_FOUND.

Added to `main/handlers.spec.ts` (`main handlers with a ProfilesStore`):
- serves profiles.* only when a ProfilesStore is given, and none of these methods overlap with the privileged port;
- `profiles.setSecret` over the real main port (`serve` with the renderer contract) is NOT_FOUND for an unknown profile and stores nothing. After `profiles.save` it succeeds, `profiles.list` answers, and no response contains the secret.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Unit tests: CRUD | `ProfilesStore CRUD` (all), `refuses unknown ids`, `map delete/duplicate/save of unknown ids to NOT_FOUND`, `handlers answer within the contract and map errors`, `serves profiles.* only when a ProfilesStore is given` | `npx vitest run apps/desktop/src/profiles apps/desktop/src/main/handlers.spec.ts` | Pass |
| AC1 duplicate drops secrets | `duplicate copies everything but the id, name and secrets`, `a crashed delete or duplicate keeps the profile and its secrets` | same | Pass |
| AC1 migration from a v0 fixture | `migrates the v0 fixture, moving passwords into secrets.bin`, `asks for the password when secrets.bin cannot take it`, all `migration edge cases` | same | Pass |
| AC2 saved password only in secrets.bin (inspects both files) | `a saved profile with a password writes it only to secrets.bin`, `profiles.setSecret for an unknown profile is NOT_FOUND and stores nothing`, `gates profiles.setSecret on the profile existing (over the main port)`, `a failed rewrite keeps the v0 file ...` | same | Pass |
| AC3 atomic writes (temp + flush + rename; crash between write and rename) | `writes through a flushed temp file renamed over connections.json`, `a crash between write and rename keeps the previous file and state`, `a temp file left by a real crash is removed on the next start`, `a failed temp write removes the temp file ...`, `a crashed delete or duplicate ...`, `a save whose write crashes does not delete the saved password`, `reports the write error, not the cleanup error ...` | same | Pass |
| Assumption: switching secretMode away from saved deletes the saved password | `removes a saved password when the profile switches to "ask each time"`, `switching secretMode to "none" clears ...`, `... keeps secretMode "saved" does not touch its password`, `creating a new profile never deletes secrets`, `switching to "ask" still saves ... cannot be removed` | same | Pass |
| Assumption: corrupt / unreadable / newer version | `corrupt files` (all), `a read error without an error code ...`, `drops profiles invalid in this version ...`, `a newer file version is readable but changes are UNSUPPORTED` | same | Pass |
| mainHandlers wiring (`src/main/handlers.ts`) | `serves profiles.* only when a ProfilesStore is given`, `gates profiles.setSecret ...` | same | Pass |
| `src/main/index.ts` creates the store in `userData/connections.json` | none | - | Not testable in unit tests: Electron bootstrap. It would need `npm run test:electron`, which the criteria do not name. |

## Focused test execution

Command:

`npx vitest run apps/desktop/src/profiles apps/desktop/src/main/handlers.spec.ts`

Result:

Pass (2 files, 65 tests)

## Full test execution

Command:

`npx vitest run apps/desktop/src` (9 files, 217 tests), and the full root suite as part of `npm run check` (`vitest run`: 29 files, 1589 tests; renderer `ng test`: 5 files, 181 tests)

Result:

Pass

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`. The first run failed in `prettier --check` because of formatting in the new tests. I ran `npx prettier --write` on the two spec files only (formatting, no behavior change), and the rerun passed lint, typecheck and all tests.

## Bugs found

None. No test found production behavior that contradicts the acceptance criteria or the recorded assumptions.

Observation from the first pass, since resolved by `1255a4d`, which now drops such passwords. The test `a password without a username is dropped, not moved into secrets.bin` covers this. Original text: a v0 entry with a password but no username and no `askPassword` (`mongodb://:pw@host`) gets its password moved to secrets.bin, but the migrated profile has no `auth` block, so that saved password is never used. The next save of the profile removes it, because the profile is not in `saved` mode. The parent may want to record this as an assumption or leave it as is.

## Coverage

Status: verified. These are the second-pass numbers: a fresh run on HEAD `8381359` plus the uncommitted second-pass tests, exit 0. They replace the first-pass numbers, which described the pre-fix revision `dd88233`. `apps/desktop/src/main/index.ts` is measured but not exercised; see below.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. Three of the four measured files are new in this task, so for them whole-file coverage equals changed-line coverage. `main/handlers.ts` changed 5 of its lines and is fully covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `profiles-store`; base `28a9e75dec84fc123e5df40b33588064274b81cb`; HEAD `8381359662d6eb04136d589cccd11f5f682c7429`; task commits `dd88233`, `1255a4d` and `8381359` (`f929c33` contains only `reviews/`). The coordinator supplied the commits, and I checked them against `git diff --stat dd88233..HEAD` and `git log`.
- Source/test snapshot identifier (including uncommitted inputs), sha256: `profiles/store.ts` d85ec84e…61f6, `profiles/handlers.ts` e2632235…c397, `profiles/index.ts` 9a494c05…f54, `main/handlers.ts` 940b0894…8f54, `main/index.ts` 84196aa9…d3dd3, `profiles/store.spec.ts` (uncommitted second-pass edits) 768029da…9bd7, `main/handlers.spec.ts` (committed) bec6ac85…c56a.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/profiles/store.ts`, `src/profiles/handlers.ts`, `src/profiles/index.ts`, `src/main/handlers.ts` and `src/main/index.ts` (paths relative to `apps/desktop`). Excluded: the spec files, the JSON fixture (data), `docs/ARCHITECTURE.md` (documentation) and `reviews/`. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0); working directory `apps/desktop`; `npx vitest run --coverage --coverage.include='src/profiles/store.ts' --coverage.include='src/profiles/handlers.ts' --coverage.include='src/profiles/index.ts' --coverage.include='src/main/handlers.ts' --coverage.include='src/main/index.ts' --coverage.reportsDirectory=coverage/profiles-store-20261116-pass2 --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=json`; the whole desktop workspace suite ran (9 files, 223 tests).
- Run start/completion time and exit status: started 2026-11-16 20:16:52 (local time), took 927 ms, exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/profiles-store-20261116-pass2/coverage-summary.json` (sha256 549ff28c634c5483e196e5883537a65614eea15dbdfaadeba91e58c576a99940) and `coverage-final.json` in the same directory (sha256 b089cf4be9d5b3c92372394c9dfdce7ffdb6a724cd99af56934450b880f6cd72), both git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The run wrote to a new report directory, and the `store.ts` and `store.spec.ts` hashes were the same before and after it.
- Final run after latest test additions and production fixes: yes. It ran after fixer commit `8381359` and after the last test edit (Prettier reported no change).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/profiles/store.ts` | 188/190 (98.9%) | 109/112 (97.3%) | 43/45 (95.6%) | 159/159 (100%) |
| `apps/desktop/src/profiles/handlers.ts` | 25/25 (100%) | 9/9 (100%) | 12/12 (100%) | 20/20 (100%) |
| `apps/desktop/src/profiles/index.ts` | N/A (0/0, re-exports only) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 7/7 (100%) | 2/2 (100%) | 4/4 (100%) | 6/6 (100%) |
| `apps/desktop/src/main/index.ts` | 0/57 (0%) | 0/18 (0%) | 0/23 (0%) | 0/51 (0%) |

Aggregate (summed counters) over `profiles/store.ts`, `profiles/handlers.ts` and `main/handlers.ts`: statements 220/222 (99.1%), branches 120/123 (97.6%), functions 59/61 (96.7%), lines 185/185 (100%). This aggregate leaves out `main/index.ts`, which is measured at 0% (Electron bootstrap, see the gaps below). With `main/index.ts` included, the aggregate over all 5 files is statements 220/279 (78.9%), branches 120/141 (85.1%), functions 59/84 (70.2%), lines 185/236 (78.4%). `profiles/index.ts` has no executable code.

First pass, for history (revision `dd88233`, report `coverage/profiles-store-20261116-final2`): `store.ts` was at statements 184/186, branches 107/110, functions 42/44, lines 156/156.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/profiles/store.ts:232-233` (the default `log` and `now` lambdas in the constructor) | None: these are defaults that are used only when the caller omits the option | Gap left on purpose. Every test injects `log` and `now`, so the logs and backup names can be checked. |
| `apps/desktop/src/profiles/store.ts:407` (the false branch of `if (owner?.auth)` in the migration's "unavailable" fallback) | Defensive code: since `1255a4d`, a v0 password is only moved when the URI has a username, and every such profile gets an `auth` block, so this branch can't be reached. | Gap left on purpose. Correction to the first pass: its row for the same branch (then at line 391) wrongly called it the ENOENT else in `removeStaleTemp`. At `dd88233` the branch was reachable (a password without a username on a system where secret storage is unavailable). |
| `apps/desktop/src/main/index.ts:42-167` (whole file) | The Electron entry point. In this task it only creates the lazy `profilesStore()` and passes it to `mainHandlers` | Not unit-testable: it needs Electron `app`/`utilityProcess`. The wiring this file relies on, `mainHandlers` with `profiles`, is covered in `main/handlers.spec.ts`. The parent should check it with `npm run test:electron` if needed. |

## Unable to test

- `apps/desktop/src/main/index.ts`: that the Electron app creates the ProfilesStore at `userData/connections.json`. This is Electron bootstrap code and the unit runner has no Electron. Follow-up is optional: an Electron smoke test (`npm run test:electron`), which no acceptance criterion requires.
- A real crash of the process (power loss) between write and rename cannot be simulated in unit tests. The tests simulate it in two ways: a rename that throws after the flushed temp write, and a leftover `.tmp` file on the next start. AC3 asks for exactly these, with "as in app-settings".

## Second pass

Date: 2026-11-16. Reason: production code changed after the first pass. `1255a4d` (parent) drops a v0 password that has no username instead of moving it. `8381359` (fixer) gives an id-less v0 entry the deterministic id `v0-<sha-256>` (CR-1). It also makes migration fall back to `ask` only on `SecretStorageUnavailableError` and rethrow every other error from secrets.bin (CR-2).

Tests reviewed for the changed behavior:
- 1255a4d: `a password without a username is dropped, not moved into secrets.bin` (added by the parent) covers it.
- CR-1: `a retried migration gives an id-less entry the same id, so no secret is orphaned` (fixer), plus the fixture and edge-case tests, which now expect `/^v0-[0-9a-f]{32}$/`.
- CR-2: `a secrets.bin write error other than "unavailable" keeps the v0 file and retries` (fixer), and `asks for the password when secrets.bin cannot take it` (real `SecretsStore` on an unavailable `FakeSafeStorage`).

Tests added in this pass (`apps/desktop/src/profiles/store.spec.ts`, uncommitted), count 3:
- `only the profile whose password secrets.bin refuses as unavailable switches to "ask"` (CR-2). On `SecretStorageUnavailableError` for one profile, only that profile becomes `ask`, the migration keeps going and still moves the other profile's password, the failure is logged, and connections.json holds neither password.
- `a non-"unavailable" error on a later secret keeps the v0 file; the retry moves all` (CR-2). One password is already stored when the next `set` fails with ENOSPC. The load then rejects and the v0 file stays as it was. The retry stores both passwords and both profiles stay `saved`.
- `the id of an id-less v0 entry does not depend on its password` (CR-1). The same entry with a different password gets the same id, and a different name gets a different id. The id therefore carries no value derived from the password, and changing the password between attempts does not orphan a secret. An explicit v0 id is kept as is.

Both CR-2 tests and the CR-1 test would fail against `dd88233`. The old code switched to `ask` on any error, so the load would not reject. It also assigned ids with `newId`/`randomUUID`, so the ids would not be stable.

Commands and results:
- `npx vitest run apps/desktop/src`: Pass (9 files, 223 tests).
- Task-scoped coverage (command and evidence in "Coverage" above): Pass, exit 0. Numbers are in the Coverage table.
- `npm run check` (`.taskcheck`): Pass. eslint and `prettier --check` are clean, typecheck passes, root vitest passed 29 files with 1595 tests, and the renderer `ng test` passed 5 files with 181 tests.

Bugs found in this pass: none.

## Summary

Tests added and all validation passed (second pass on HEAD `8381359` plus 3 uncommitted tests). Task-scoped coverage is sufficient and no production defects were found. The only unmeasured file is the Electron bootstrap `main/index.ts`.

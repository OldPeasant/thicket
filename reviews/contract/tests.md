# Test Report

Date: 2026-11-16

Task: contract - M0: Typed IPC contract (envelope, errors, all method groups)

Scope: second pass on the final code. `git diff 721a27361eadde378e1225eb2d7fd03043ae1c7e..a414a09494d73ba47f92c19d9ccb4d3d97e32414` on branch `main`, HEAD a414a09. Task-owned commits (given by the parent worker, matching `touches: [packages/contract]`): bfebc59 "Add typed IPC contract", 7bf1c08 "Add contract tests and review reports", a414a09 "Fix contract review findings". Other commits in the range (int-harness, heartbeat/claim/verify/assume commits) belong to other tasks and are excluded. Production scope: `packages/contract/src/*.ts` except spec files (17 files). Focus of this pass: the fixer's changes (see `reviews/contract/fixes.md`): `ejsonDocumentOrArray` for `docs.updateMany` `update` (TW-1), `hasPassword()` and the password refine on `profile.connectionString` (CR-1), new `profiles.chooseFile` (CR-2), `docs.find` paging refines (CR-4), `ejsonValue` whitespace rejection (TW-obs), comment-only changes (CR-3, CR-5). Uncommitted inputs: `packages/contract/src/methods.spec.ts` (tests added in this pass).

Requirements:
- `tasks/contract.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 4 (API contract) and the secrets rules ("Secrets ... only in the OS keychain", "Secrets never leave the backend/main processes")
- `docs/ARCHITECTURE.md` ("API between parts", "Coverage")
- `reviews/contract/review.md` / `fixes.md` for the intent of each fix

## Test files changed

- `packages/contract/src/methods.spec.ts`

## Tests added or updated

Count: 2 new test cases, 1 extended (596 contract tests in total, previously 594).

Review of the fixer's tests: TW-1 (`docs.updateMany explains ...`, `accepts both an update document and an update pipeline`), CR-1 (`profile connection strings`: srv, multi-host, username only, `:` in query options, percent-encoded password, rejection in `profiles.save`, `conn.test`, `profiles.list`, `profiles.importUris`), CR-2 (`profiles.chooseFile`), CR-4 (`docs.find rejects after together with before`, `rejects skip together with range paging`), TW-obs (`ejsonValue rejects whitespace-only text`) are present and meaningful. Gaps closed in this pass:

- `profile connection strings > ignores "@" and ":" outside the authority (query, path, fragment) and in IPv6 hosts` (new): `@` in a query option (`appName=a@b:c`, `x=y@z` after username-only userinfo with a multi-host list), in the path and in a fragment; IPv6 hosts `[::1]:27017` with and without username-only userinfo and a multi-host list; percent-encoded `@` and `:` in a username; bare `mongodb://`. All are `hasPassword() === false`, and three are accepted by `profiles.save`.
- `profile connection strings > detects a password with an empty username, an unescaped "@", IPv6 hosts or an srv URI` (new): `:pw@host`, `alice:p@ss@host` (unescaped `@` in the password: the last `@` ends the userinfo), password with IPv6 multi-host, `mongodb+srv` with and without a path/query containing `@`. All are `hasPassword() === true` and rejected by `profiles.save`.
- `profiles.chooseFile > is served by main and takes a known purpose` (extended): an unknown purpose is rejected; a non-null `path` result is accepted.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: every method has a schema (66 methods incl. `profiles.chooseFile`; `-t "has params and result schemas"` -> 66 passed) | index.spec `method table > %s has params and result schemas and a sample`; methods.spec `has a result sample for exactly the methods of the contract`, `every method with a stream has stream samples` | `cd packages/contract && npx vitest run` | Pass |
| AC1: valid sample params parse | index.spec `%s accepts its valid sample`; methods.spec `docs.updateMany accepts both an update document and an update pipeline`, `profile connection strings` (accept cases), `profiles.chooseFile`, `docs.find` single-paging cases | same | Pass |
| AC1: invalid params fail with a readable message | index.spec `%s rejects its invalid sample with a readable message`; methods.spec `readable params messages` incl. TW-1 test (now "update must be canonical EJSON text ..."), `docs.find rejects after together with before`, `rejects skip together with range paging`, `rejects a password in the userinfo with a readable message`, `ejsonValue rejects whitespace-only text with a readable message` | same | Pass |
| CR-1: no password in `profile.connectionString` (params, drafts, results) | methods.spec `profile connection strings` (5 tests: 2 new in this pass) | same | Pass |
| AC2: documents are canonical EJSON strings, no object doc fields | index.spec `documents travel as EJSON text > %s has no object or free-form document fields`; methods.spec `EJSON text helpers` incl. `ejsonDocumentOrArray accepts text starting with "{" or "["` | same | Pass |
| AC3: writes carry profileId and optional boolean confirmed; a test lists all writes | index.spec `writes > the write list matches the contract`, `%s requires profileId and takes an optional boolean confirmed`; methods.spec `write params` | same | Pass (`profiles.chooseFile` is correctly not a write) |
| AC4: `npm run check` passes | lint, prettier, typecheck, unit tests | `npm run check` (repo root) | Fail in this clone, not caused by the contract task: root `tsc -p tsconfig.json` fails on `test/integration/*` (int-harness task) because `mongodb`, `testcontainers` and `node-forge` are declared in `package.json` (commit b77af59) but not installed in `node_modules`. Every other step passes when run separately (see below). Needs `npm install` (not allowed for this helper). |
| AC4: no `any` in the package (lint rule on) | `npx eslint packages/contract` clean; lint step of `npm run check` | listed commands | Pass |
| Route helper (task goal) | index.spec `route`; methods.spec `profiles.chooseFile > is served by main ...`, `routes io.import (a write) to main ...` | `cd packages/contract && npx vitest run` | Pass |

## Focused test execution

Command:

`cd packages/contract && npx vitest run`

Result:

Pass: 2 files, 596 tests passed.

Also: `npx prettier --check packages/contract/src/methods.spec.ts` -> clean; `npx eslint packages/contract` -> no findings.

## Full test execution

Command:

`npm run check` (repo root)

Result:

Fail at the typecheck step, outside the task scope. Lint (`eslint . --max-warnings 0 && prettier --check .`): pass. Root `tsc -p tsconfig.json`: 7 errors, all in `test/integration/` (`Cannot find module 'mongodb'` / `'testcontainers'` / `'node-forge'`, plus one implicit `any` that follows from the missing `mongodb` types); `npx tsc -p tsconfig.json | grep -v ^test/integration` shows no other errors. The modules are listed in the root `package.json` (int-harness commit b77af59, merged into main) but absent from `node_modules`; this helper may not install dependencies.

Remaining steps run separately because `npm run check` stops at the first failure:
- `npm run typecheck --workspaces --if-present` -> pass (contract, backend, renderer).
- `npm run test` -> pass: `vitest run` 5 files, 599 tests; renderer `ng test` 2 files, 46 tests.

## .taskcheck

Result:

Not run separately: it runs `npm run check` (result above). Expected to pass once `npm install` has been run in this clone; the parent must run it before `done`.

## Bugs found

None in the contract task's code.

### Observation (not filed as a defect; parent's decision)

`hasPassword()` (`packages/contract/src/profiles.ts:49`) ends the authority at the first `/`, `?` or `#`. A malformed URI whose password contains an unescaped `/`, `?` or `#` (e.g. `mongodb://alice:pa/ss@db.example.test`) is therefore not detected: the authority becomes `alice:pa` with no `@`, so `profiles.save` accepts it and the password text would be stored in `connections.json`. Such URIs are invalid (RFC 3986 and the MongoDB connection string spec require these characters to be percent-encoded, and the driver refuses them), so the profile would also be unusable. The contract guard is defense in depth, and parsing pasted URIs belongs to the uri-model task, so no failing test was added. If the parent wants the contract to fail closed here too, a stricter rule (e.g. reject when any `@` before the first `?`/`#` is preceded by a `:` after the scheme) would cover it.

## Coverage

Status: verified.

Metric: whole-file coverage of task-changed production files (all 17 files under `packages/contract/src/*.ts` except spec files; all were added or rewritten by the task).
Changed-line coverage: not measured separately. Every executable line in scope was added or changed by the task commits (`index.ts` rewritten, the rest new), so whole-file and changed-line coverage are the same set.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `contract`; base 721a27361eadde378e1225eb2d7fd03043ae1c7e; HEAD a414a09494d73ba47f92c19d9ccb4d3d97e32414; task-owned commits bfebc59, 7bf1c08, a414a09 (from the parent worker; consistent with `touches: [packages/contract]`).
- Source/test snapshot identifier (including uncommitted inputs): tracked files at a414a09; the only uncommitted change is `packages/contract/src/methods.spec.ts` (+37 lines), sha256 `b0a50a87caa8ec0637052f1ee8ad17a63335cf82518936d21973a9487143b0c2` (unchanged between the coverage run and this report).
- Exact included files; renamed/deleted/excluded files and reasons: included admin.ts, agg.ts, app.ts, coll.ts, common.ts, conn.ts, db.ts, define.ts, docs.ts, envelope.ts, errors.ts, idx.ts, index.ts, io.ts, profiles.ts, schema.ts, shell.ts. Excluded: `*.spec.ts` (tests); `docs/ARCHITECTURE.md` (documentation); `eslint.config.mjs`, `package.json`, `package-lock.json` (configuration/manifests). No renames or deletions. No scoped file missing from the report.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` (v8) with vitest 5.1.0, node v24.21.0; `npx vitest run --coverage --coverage.include='src/*.ts'` in `packages/contract`; all tests (index.spec.ts, methods.spec.ts), none deselected.
- Run start/completion time and exit status: started 2026-11-16 19:04:10 local time, duration 247 ms, 596 passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/contract/coverage/coverage-summary.json` sha256 `6df7b25a01b691cf6a2922914661cb1e0660c468845f3d620d62d8f607d06871`; `packages/contract/coverage/lcov.info` (branch locations). The folder is Git-ignored and cleaned by vitest before each run.
- Evidence outputs are fresh and inputs stayed unchanged: yes; read immediately after the run, no source or test edits after it.
- Final run after latest test additions and production fixes: yes (after the fixer's commit a414a09 and after all tests added in this pass).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/admin.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/contract/src/agg.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| `packages/contract/src/app.ts` | 6/6 (100%) | N/A | N/A | 6/6 (100%) |
| `packages/contract/src/coll.ts` | 7/7 (100%) | N/A | N/A | 7/7 (100%) |
| `packages/contract/src/common.ts` | 30/30 (100%) | 6/6 (100%) | 9/9 (100%) | 30/30 (100%) |
| `packages/contract/src/conn.ts` | 7/7 (100%) | N/A | 1/1 (100%) | 7/7 (100%) |
| `packages/contract/src/db.ts` | 2/2 (100%) | N/A | N/A | 2/2 (100%) |
| `packages/contract/src/define.ts` | 1/1 (100%) | N/A | 1/1 (100%) | 1/1 (100%) |
| `packages/contract/src/docs.ts` | 8/8 (100%) | 5/5 (100%) | 2/2 (100%) | 8/8 (100%) |
| `packages/contract/src/envelope.ts` | 10/10 (100%) | N/A | N/A | 10/10 (100%) |
| `packages/contract/src/errors.ts` | 7/7 (100%) | 2/2 (100%) | 1/1 (100%) | 7/7 (100%) |
| `packages/contract/src/idx.ts` | 4/4 (100%) | N/A | N/A | 4/4 (100%) |
| `packages/contract/src/index.ts` | 23/23 (100%) | 14/14 (100%) | 8/8 (100%) | 19/19 (100%) |
| `packages/contract/src/io.ts` | 4/4 (100%) | N/A | N/A | 4/4 (100%) |
| `packages/contract/src/profiles.ts` | 17/17 (100%) | 3/4 (75%) | 2/2 (100%) | 17/17 (100%) |
| `packages/contract/src/schema.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| `packages/contract/src/shell.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| **Total (summed counters, 17 of 17 scoped files, none unmeasured or excluded)** | 136/136 (100%) | 30/31 (96.77%) | 24/24 (100%) | 132/132 (100%) |

Note: V8 counts each schema declaration (e.g. a whole `defineMethods({...})` table) as one statement, so these percentages say little about the schema files; the per-method tests (params, results, streams, structural EJSON walk for all 66 methods) are the evidence for them.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/contract/src/profiles.ts:51` branch 1 (`?? ''` in `hasPassword`: `rest.split(/[/?#]/, 1)[0] ?? ''`) | none: `String.prototype.split` with limit 1 always returns one element, so the fallback only satisfies `noUncheckedIndexedAccess` | justified gap, unreachable; the empty-authority input (`mongodb://`) is tested and takes the other side |

## Unable to test

- `npm run check` as a single command could not pass in this clone because int-harness dependencies are not installed (see Full test execution). Follow-up for the parent: run `npm install`, then `.taskcheck`.
- Runtime enforcement (the backend requiring `confirmed`, main serving `profiles.chooseFile` with a native dialog) belongs to later tasks.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All fixer changes (TW-1, CR-1, CR-2, CR-4, TW-obs) are tested and pass; this pass added `hasPassword` edge cases (`@`/`:` in query, path, fragment; IPv6 and multi-host; empty username; unescaped `@`; srv) and `profiles.chooseFile` purpose/result checks. 596 contract tests pass; coverage of the 17 files in scope is 100% statements/lines/functions and 30/31 branches (the one gap is unreachable). `npm run check` fails only at the root typecheck on int-harness files because `mongodb`/`testcontainers`/`node-forge` are not installed here; all other check steps pass. One low-risk observation (unescaped `/`, `?`, `#` in a password evades `hasPassword`) is left to the parent.

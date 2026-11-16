# Test Report

Date: 2026-11-16

Task: contract - M0: Typed IPC contract (envelope, errors, all method groups)

Scope: `git diff 721a27361eadde378e1225eb2d7fd03043ae1c7e..692c9ac0df74dae2a7a9fd1c9683414797e59f87` (one task commit, 692c9ac "Add typed IPC contract: envelope, error codes, all method groups"), on branch `main`, HEAD 692c9ac. Production scope: `packages/contract/src/*.ts` (admin, agg, app, coll, common, conn, db, define, docs, envelope, errors, idx, index, io, profiles, schema, shell). Also in the diff but outside the test scope: `docs/ARCHITECTURE.md` (documentation), `eslint.config.mjs` (lint configuration, checked through `npm run check` and `eslint --print-config`), `package-lock.json` and `packages/contract/package.json` (dependency manifest). Uncommitted inputs: only the new test file `packages/contract/src/methods.spec.ts` (untracked).

Requirements:
- `tasks/contract.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 4 (API contract)
- `docs/ARCHITECTURE.md` ("API between parts", "Coverage")
- `eslint.config.mjs` (no-explicit-any pinned for packages/contract)

## Test files changed

- `packages/contract/src/methods.spec.ts` (new; `packages/contract/src/index.spec.ts` unchanged)

## Tests added or updated

Count: 280 test cases in 1 new file (32 test definitions; 6 of them are `it.each` over every method, every write method or every streaming method).

What the new file adds on top of the existing `index.spec.ts` (298 cases):

- Result schemas: a typed valid and invalid result sample for every one of the 66 methods (`RESULTS`, typed with the `ResultOf` helper per method name so a new method without a sample fails the type check). Invalid samples mostly pass documents as objects, so the EJSON-text rule is checked at runtime on results, not only structurally. Also: unknown result keys are accepted (the forward-compatibility assumption), and only `profiles.importCompass` and `io.previewImport` accept `null`.
- Stream schemas: valid and invalid `data` payloads for every streaming method (docs.find, agg.run, io.export, io.import, shell.eval with all 4 output kinds, admin.watch), typed with the `StreamDataOf` helper per stream method. Also `streamEnd`, `streamError`, `end` events and an empty `cancel`.
- Writes: for every write method, `confirmed: false` is accepted, `null`/`1`/`'true'`/`{}` are rejected, an empty `profileId` fails with "profileId must be a non-empty string → at profileId", and a misspelt `confirm` key fails with `Unrecognized key: "confirm"`. agg.run without `confirmed` is still accepted (conditional write). shell.eval is not a write and rejects `confirmed`.
- Readable messages: conn.test with both `profileId` and `profile`; array positions reported as string path segments (`docs[1]`, `['docs','1']`); every problem reported, not only the first; unknown keys inside nested strict objects (`profile.auth`); discriminator values named; docs.updateMany accepts an update document and an update pipeline but rejects an object.
- EJSON helpers: `ejsonDocument`/`ejsonArray`/`ejsonValue` accept and reject the right shapes (empty, whitespace only, wrong bracket, non-strings), register the right kind in `ejsonSchemas`, and use their exact messages including the default descriptions.
- Error payloads: `conflictDetail` (EJSON text or null, never an object), `serverErrorDetail`, `errorSummary`, unknown error code.
- `isMethodName` rejects prototype names and near misses. `route` sends `io.import` and `io.previewImport` to main.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: every method has a schema | index.spec `method table > %s has params and result schemas and a sample` (66), `has no sample for a method that does not exist`; methods.spec `result schemas > has a result sample for exactly the methods of the contract`, `stream schemas > every method with a stream has stream samples` | `cd packages/contract && npx vitest run` | Pass |
| AC1: valid sample params parse | index.spec `params validation > %s accepts its valid sample` (66) | same | Pass |
| AC1: invalid params fail with a readable message | index.spec `%s rejects its invalid sample with a readable message` (66), `names the field and the expectation`; methods.spec `readable params messages` (7 tests) | same | **Fail**: 1 test (`docs.updateMany explains that update must be EJSON text of a document or pipeline`), see TW-1; all others pass |
| AC1 (results and streams, beyond the minimum) | methods.spec `%s accepts a well-formed result` (66), `%s rejects a malformed result as INTERNAL with a readable message` (66), `%s tolerates unknown result keys` (66), `%s data payloads validate` (6) | same | Pass |
| AC2: documents are canonical EJSON strings, no object doc fields | index.spec `documents travel as EJSON text > %s has no object or free-form document fields` (66) plus walker self-test; methods.spec invalid result and stream samples with object documents, `EJSON text helpers` (4), `CONFLICT detail carries the current document as EJSON text or null` | same | Pass |
| AC3: writes carry profileId and optional boolean confirmed; a test lists all writes | index.spec `writes > the write list matches the contract`, `only agg.run writes conditionally`, `%s requires profileId and takes an optional boolean confirmed` (19); methods.spec `write params` (19 + 19 + 19 + 2) | same | Pass |
| AC4: `npm run check` passes | lint, typecheck, unit tests | `npm run check` (repo root) | **Fail**: lint and typecheck pass; tests fail only on the TW-1 test (580 passed, 1 failed). Without the new failing test the suite passes (see focused run). |
| AC4: no `any` in the package (lint rule on) | `npx eslint --print-config packages/contract/src/index.ts` shows `@typescript-eslint/no-explicit-any: [2]`; `npx eslint packages/contract` clean; `grep -rnwE "any\|ZodAny" packages/contract/src` finds only comments and the walker's `z.ZodAny` check; index.spec walker rejects `z.any()`/`z.unknown()` in method schemas | listed commands | Pass |
| Route helper (task goal) | index.spec `route` (2); methods.spec `routes io.import (a write) to main because of its native dialog`, `isMethodName only knows own contract methods` | `cd packages/contract && npx vitest run` | Pass |

## Focused test execution

Command:

`cd packages/contract && npx vitest run src/methods.spec.ts`

Result:

Fail: 279 passed, 1 failed (TW-1).

Command:

`cd packages/contract && npx vitest run`

Result:

Fail: 2 files, 577 passed, 1 failed (TW-1). `index.spec.ts` alone: 298 passed (run before adding tests).

Also: `cd packages/contract && npx tsc -p tsconfig.json` -> no errors; `npx eslint packages/contract` -> no findings; `npx prettier --write packages/contract/src/methods.spec.ts` (new test file only).

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, `tsc` for all workspaces, `vitest run && npm run test -w packages/renderer`)

Result:

Fail. Lint: pass. Prettier: pass. Typecheck: pass. `vitest run`: 5 files, 580 passed, 1 failed (the TW-1 test). The renderer test step (`npm run test -w packages/renderer`) did not run because `vitest run` failed first.

## .taskcheck

Result:

Not run separately: it runs `npm run check`, whose result is above (Fail, only because of TW-1).

## Bugs found

### docs.updateMany: a non-EJSON `update` gets the message "Invalid input"

Finding ID:

`TW-1`

Test:

`packages/contract/src/methods.spec.ts > readable params messages > docs.updateMany explains that update must be EJSON text of a document or pipeline`

Production source:

`packages/contract/src/docs.ts:189` (`update: z.union([ejsonDocument('update'), ejsonArray('update pipeline')])`)

Requirement:

AC1: "invalid ones fail with a readable message". Every other EJSON field explains what it expects (e.g. "filter must be canonical EJSON text of a document (starting with "{")").

Expected behavior:

`parseParams('docs.updateMany', { profileId, db, coll, filter: '{}', update: 'x' })` fails with a message that says what `update` must be, e.g. "update must be canonical EJSON text of an update document ("{...}") or pipeline ("[...]")".

Actual behavior:

```
Invalid params for docs.updateMany:
✖ Invalid input
  → at update
```
and `detail: [{ path: ['update'], message: 'Invalid input' }]`. zod 4 collapses a union whose options all fail into one generic `invalid_union` issue, so the two EJSON messages are lost. This is the only `z.union` over EJSON fields in the contract (discriminated unions give readable messages).

Severity:

Low (the request still fails closed; only the message is unhelpful). It does make AC1 and `npm run check` fail as long as the test is in place.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` One way: replace the union with a single string schema refined on the first non-blank character being `{` or `[`, registered in `ejsonSchemas` (or a custom `error` on the union).

### Observation (not a defect under the recorded assumption)

`ejsonValue` (e.g. `_id` in docs.get/update/replace/delete, `opId`, `hint`) accepts whitespace-only text such as `"   "`, because it only checks `min(1)`. The assumption "EJSON fields only check the outer shape (... or non-empty)" covers this, so no failing test was added. A `trim().length > 0` check would reject it with a readable message instead of a parse error in the backend. Parent's decision.

## Coverage

Status: verified for the passing suite. The run that includes the TW-1 test exits 1 and vitest writes no coverage report for it, so the numbers come from a second run that deselects only that test (selection below).

Metric: whole-file coverage of task-changed production files (all 17 files under `packages/contract/src/*.ts` except spec files; all were added or rewritten by the task commit).
Changed-line coverage: not measured separately. Every executable line in scope was added or changed by 692c9ac (`index.ts` was rewritten; the rest are new), so whole-file and changed-line coverage are the same set here.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `contract`; base 721a27361eadde378e1225eb2d7fd03043ae1c7e; HEAD 692c9ac0df74dae2a7a9fd1c9683414797e59f87; task-owned commit 692c9ac (given by the parent worker, matches `touches: [packages/contract]` and `git diff --stat 721a273..692c9ac`).
- Source/test snapshot identifier (including uncommitted inputs): tracked files at 692c9ac (`git status` shows no tracked changes); untracked `packages/contract/src/methods.spec.ts` sha256 `8cc4853275a3efe24d91fc0e6b1f37b814678c5f14a1c16a0a9a8d0d9e902aba` (after prettier, before the coverage run; unchanged afterwards).
- Exact included files; renamed/deleted/excluded files and reasons: included admin.ts, agg.ts, app.ts, coll.ts, common.ts, conn.ts, db.ts, define.ts, docs.ts, envelope.ts, errors.ts, idx.ts, index.ts, io.ts, profiles.ts, schema.ts, shell.ts. Excluded: `*.spec.ts` (tests), docs/ARCHITECTURE.md (documentation), eslint.config.mjs, package.json, package-lock.json (configuration/manifests without runtime behavior of the package). No renames or deletions. No scoped file is missing from the report.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0; working directory `packages/contract`; `npx vitest run --coverage --coverage.include='src/*.ts' --coverage.reporter=text --coverage.reporter=json-summary -t '^(?!.*explains that update must be EJSON)'` (all tests of index.spec.ts and methods.spec.ts except the one TW-1 test: 577 passed, 1 skipped).
- Run start/completion time and exit status: started 2026-11-16 18:58:17 (local time), duration 238 ms, exit 0. The preceding run without the `-t` filter (18:58:14) exited 1 with 1 failed test and produced no coverage report.
- Generated report paths and report hashes/run identifier: `packages/contract/coverage/coverage-summary.json`, sha256 `4d29854ab9b0fc5c75a964cce5602c5a50c23910ec66772ea9157c11deb0d88b` (vitest cleans the folder before each run; the folder is Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; the summary was read straight after the run, and no source or test file changed between the snapshot and the run.
- Final run after latest test additions and production fixes: yes for the test additions. No production fix has been made yet; after the TW-1 fix, coverage must be measured again.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/admin.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/contract/src/agg.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| `packages/contract/src/app.ts` | 6/6 (100%) | N/A | N/A | 6/6 (100%) |
| `packages/contract/src/coll.ts` | 7/7 (100%) | N/A | N/A | 7/7 (100%) |
| `packages/contract/src/common.ts` | 25/25 (100%) | 3/3 (100%) | 6/6 (100%) | 25/25 (100%) |
| `packages/contract/src/conn.ts` | 7/7 (100%) | N/A | 1/1 (100%) | 7/7 (100%) |
| `packages/contract/src/db.ts` | 2/2 (100%) | N/A | N/A | 2/2 (100%) |
| `packages/contract/src/define.ts` | 1/1 (100%) | N/A | 1/1 (100%) | 1/1 (100%) |
| `packages/contract/src/docs.ts` | 6/6 (100%) | N/A | N/A | 6/6 (100%) |
| `packages/contract/src/envelope.ts` | 10/10 (100%) | N/A | N/A | 10/10 (100%) |
| `packages/contract/src/errors.ts` | 7/7 (100%) | 2/2 (100%) | 1/1 (100%) | 7/7 (100%) |
| `packages/contract/src/idx.ts` | 4/4 (100%) | N/A | N/A | 4/4 (100%) |
| `packages/contract/src/index.ts` | 23/23 (100%) | 14/14 (100%) | 8/8 (100%) | 19/19 (100%) |
| `packages/contract/src/io.ts` | 4/4 (100%) | N/A | N/A | 4/4 (100%) |
| `packages/contract/src/profiles.ts` | 11/11 (100%) | N/A | N/A | 11/11 (100%) |
| `packages/contract/src/schema.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| `packages/contract/src/shell.ts` | 3/3 (100%) | N/A | N/A | 3/3 (100%) |
| **Total (summed counters, 17 of 17 scoped files, none unmeasured)** | 123/123 (100%) | 19/19 (100%) | 17/17 (100%) | 119/119 (100%) |

Note: V8 counts each schema declaration (e.g. a whole `defineMethods({...})` table) as one statement, so these percentages show little about the schema files. The evidence for them is the per-method tests above (params, results, streams and the structural EJSON walk for all 66 methods).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none (no uncovered lines, branches or functions) | message readability of the `docs.updateMany` `update` union (`docs.ts:189`) is covered but wrong | test added; TW-1 |

## Unable to test

- Nothing in the acceptance criteria was left untested. Runtime use of the contract (the backend enforcing `confirmed`/read-only, main serving its routes) belongs to later tasks and is out of this task's scope.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Low): `docs.updateMany` gives "Invalid input" for a non-EJSON `update`, which breaks AC1 ("readable message") and makes `npm run check` fail through the new test. Apart from that, all acceptance criteria pass: lint (no-explicit-any on), typecheck, every method's params/result/stream schemas, EJSON-only document fields and the write list. Task-scoped coverage is 100% on all metrics for the 17 files in scope (passing suite, TW-1 test deselected).

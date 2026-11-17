# Test Report

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: base 759d4d63be8ab2bdb90c5924083099dae40bec14, task commits cf3696e, 19e5210, b048e55
(HEAD b048e552a760c7ba813844b2a438830621fb9807, branch main), as named by the parent worker; diff
`git diff 759d4d6..HEAD`. Uncommitted inputs: the test changes listed below (no production changes).

Requirements:
- `tasks/profiles-import-export.md` acceptance criteria and the three recorded assumptions
  (Compass format from memory; encrypted entries imported without credentials plus a notice;
  export format `Thicket Connections` v1, saved -> ask, secret URI options stripped)
- `docs/ARCHITECTURE.md` "Coverage" and conventions; parent instructions (edge cases to cover)

## Test files changed

- `apps/desktop/src/profiles/import/import.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`
- `packages/contract/src/methods.spec.ts`
- `packages/renderer/src/app/connections/import/import-export-page.spec.ts`
- `packages/renderer/src/app/connections/connections-page.spec.ts`

## Tests added or updated

Count: 56 added (desktop import 44, main handlers 2, contract 2, import page 7, connections page 1);
no existing test changed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Unit tests with Compass export fixtures | existing fixture tests plus new `parseImportFile (Compass edge cases)` (BOM, EJSON `$numberInt/$numberLong/$numberDouble` versions, EJSON/plain/string SSH ports and invalid port -> 22, SSH without host/user skipped, SSH + SOCKS5 proxy skipped without leaking secrets, key file over password, non-object entries, colors, invalid URI without password echo, encrypted + plain credentials) and `parseImportFile (Thicket export)` | `cd apps/desktop && npx vitest run src/profiles/import` | Pass except 2 TW-1 tests (Fail, production bug) |
| AC2 Export file contains no password/passphrase/token | existing grep tests plus `secret stripping (odd casing, repeated options, unparsed properties)` (upper/mixed-case option names, repeated `proxyPassword`/`tlsCertificateKeyFilePassword`, `authMechanismProperties` kept verbatim in `extra`, repeated session tokens, percent-encoded option name, unparseable URI), `exportFile (shape)`, `profiles.export writes UTF-8 with mode 0644; the file re-imports as new profiles` | same | Pass |
| Encrypted Compass entries imported without credentials, with notice (assumption #2, contract `notices`) | `reports the encrypted-credentials notice through the handler (contract-valid)`, `keeps plain credentials of an entry that also has encrypted ones, with a notice`, contract `import results (profiles.importCompass / importUris)` (2 tests) | desktop command above; `cd packages/contract && npx vitest run src/methods.spec.ts` | Pass |
| Secrets saved only on a secure keychain; failures fall back to ask (assumption #2) | `keeps secretMode when a non-password secret fails or is dropped on a weak keychain`, `a failing password secret turns saved into ask in the stored profile and the result`, `does not ask the keychain when no entry has a secret` | desktop command | Pass |
| Re-import adds nothing (assumption #2) | `skips duplicates inside one import, keeping the first`, export -> re-import test | desktop command | Pass |
| Oversize file refused before reading | `refuses a file larger than MAX_IMPORT_FILE_BYTES before reading it` (limit + 1 refused, exactly at the limit read) | desktop command | Pass |
| RPC error mapping (INVALID_PARAMS, UNSUPPORTED for read-only store) | `maps a BOM-prefixed file, a non-JSON file and a read-only store correctly`, `returns null when the open dialog gives no file; ...` | desktop command | Pass |
| `mainHandlers` registers import/export only with profiles and dialogs | `import/export ... are served only when both a ProfilesStore and native dialogs are given`, `import connection strings over the main port: password to secrets.bin only` (real ProfilesStore + SecretsStore) | `cd apps/desktop && npx vitest run src/main` | Pass |
| Import/export page (busy guard, errors, selection, sidebar reload, empty state) and manager link | 7 new page tests, `links to the import and export page` | `cd packages/renderer && npx ng test --include='src/app/connections/**/*.spec.ts' --include='src/app/layout/welcome.spec.ts' --watch=false` | Pass |
| AC3 e2e: import -> profiles appear in the sidebar | not changed by this run | Not run: e2e file unchanged; parent reported `npm run test:e2e -- profiles-import` -> 1 passed | Not run: unchanged |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/profiles/import src/main`

Result:

Fail: 122 passed, 2 failed (both TW-1, intentionally kept).

Command:

`cd packages/contract && npx vitest run src/methods.spec.ts`

Result:

Pass (311 tests).

Command:

`cd packages/renderer && npx ng test --include='src/app/connections/**/*.spec.ts' --include='src/app/layout/welcome.spec.ts' --watch=false`

Result:

Pass (6 files, 217 tests).

## Full test execution

Command:

`sh .taskcheck` (`npm run check`: lint, typecheck, `vitest run`, renderer tests) and, because the
`&&` chain stopped before it, `npm run test -w packages/renderer`

Result:

Fail: lint and typecheck pass; `vitest run` 3594 passed, 2 failed (the TW-1 tests, 65 files);
renderer 81 files, 2437 tests passed.

## .taskcheck

Result:

Fail, only because of the 2 TW-1 tests (lint, prettier and typecheck pass).

## Bugs found

### A Compass color named like an Object property breaks the import

Finding ID:

`TW-1`

Test:

`parseImportFile (Compass edge cases) > leaves out a color named like an object property (toString, constructor, __proto__)`;
`importExportHandlers (edge cases) > imports a Compass entry with a color named "constructor" instead of failing the import`

Production source:

`apps/desktop/src/profiles/import/compass.ts:89` (`return COMPASS_COLORS[color];`), surfacing at
`apps/desktop/src/profiles/import/handlers.ts:99` (`structuredClone(entry.draft)`)

Requirement:

Assumption #1: `favorite.color` keys `color1..color10` are mapped to hex values; other colors are
not part of the format. A malformed entry must not break the whole import (entries are skipped or
imported one by one).

Expected behavior:

An unknown color such as `toString`, `constructor`, `__proto__` or `hasOwnProperty` is left out, as
`color11` or `red` already are, and the entry is imported without a color.

Actual behavior:

`COMPASS_COLORS` is a plain object literal, so inherited keys resolve: `draft.color` becomes a
function (or `Object.prototype` for `__proto__`). `profiles.importCompass` then throws
`DataCloneError: function Object() { [native code] } could not be cloned` from `structuredClone`,
after the earlier entries of the file were already saved, so the user gets a generic error and a
partial import. Only a malformed or hand-crafted file triggers it.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified (desktop: test selection excludes only the 2 failing TW-1 tests, exit 0; contract
and renderer: full selection, exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: profiles-import-export; base 759d4d63be8ab2bdb90c5924083099dae40bec14; HEAD b048e552a760c7ba813844b2a438830621fb9807; commits cf3696e, 19e5210, b048e55 from the parent; files from `git diff --name-only 759d4d6..HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD above plus uncommitted test changes, `git diff | sha256sum` = e23a66dc819f1083eb375221bdf14117d65a86c80ba036a0530745b5042da38b (the same before and after the coverage runs). No production files changed.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/profiles/import/{uri,compass,export,handlers,index}.ts`, `apps/desktop/src/profiles/index.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/main/index.ts`, `packages/contract/src/profiles.ts`, `packages/renderer/src/app/connections/import/import-export-page.ts`, `packages/renderer/src/app/app.routes.ts`, `packages/renderer/src/app/layout/navigation.ts`. `main/index.ts` is measured (0%) but is the Electron entry point (1 changed line, `dialogs: nativeDialogs`); unit tests can't load it, and the e2e covers it. Excluded: `test/e2e/profiles-import.e2e.ts` (a test), fixtures JSON, HTML/CSS templates (not instrumented by v8; the page specs exercise them). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`.
  (1) `apps/desktop`: `npx vitest run src/profiles/import src/main -t '^(?!.*(named like an object property|named "constructor")).*$' --coverage --coverage.include=<each desktop file above> --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcovonly` (122 passed, 2 skipped by the filter).
  (2) `packages/contract`: `npx vitest run --coverage --coverage.include='src/profiles.ts' --coverage.reporter=text --coverage.reporter=json-summary` (733 passed).
  (3) `packages/renderer`: `npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --coverage --coverage-include=<each renderer file above> --watch=false` (35 passed).
- Run start/completion time and exit status: (1) 2026-11-17 03:58:22, exit 0; (2) 03:58:34, exit 0; (3) 03:58:43, exit 0 (local time, each about 2 s).
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` sha256 7a56e0f27fa57b7ce2e336b2238c6ade9d771b0854069a8d3235f521dd340fcc, `apps/desktop/coverage/lcov.info` sha256 600f25f1e2ab8a2cacdaa6fa9b88bbc1d1031bdd3f9945eaa53d61086111f50f; `packages/contract/coverage/coverage-summary.json`; `packages/renderer/coverage/renderer/{coverage-summary.json,lcov.info}` (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. Vitest cleans the reports directory on each run, the reports list exactly the included files, and the snapshot hash matched before and after.
- Final run after latest test additions and production fixes: yes for the test additions; no production fix has been made yet (TW-1 open), so a fix needs a fresh run.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/profiles/import/uri.ts` | 131/132 (99.24%) | 130/136 (95.59%) | 17/17 (100%) | 109/109 (100%) |
| `apps/desktop/src/profiles/import/compass.ts` | 110/110 (100%) | 100/101 (99.01%) | 18/18 (100%) | 100/100 (100%) |
| `apps/desktop/src/profiles/import/handlers.ts` | 76/76 (100%) | 43/44 (97.73%) | 17/17 (100%) | 65/65 (100%) |
| `apps/desktop/src/profiles/import/export.ts` | 7/7 (100%) | 2/2 (100%) | 2/2 (100%) | 6/6 (100%) |
| `apps/desktop/src/profiles/import/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/profiles/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 12/12 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/69 (0%) | 0/30 (0%) | 0/26 (0%) | 0/62 (0%) |
| `packages/contract/src/profiles.ts` | 22/22 (100%) | 3/4 (75%) | 2/2 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/connections/import/import-export-page.ts` | 71/73 (97.26%) | 34/36 (94.44%) | 26/26 (100%) | 59/59 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 5/13 (38.46%) | N/A (0/0) | 4/12 (33.33%) | 3/7 (42.86%) |
| `packages/renderer/src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |

Aggregate (summed counters, all 12 files, including `main/index.ts` and `app.routes.ts`):
statements 440/520 (84.62%), branches 324/365 (88.77%), functions 93/127 (73.23%), lines
380/446 (85.20%). Without `main/index.ts` (Electron entry, not loadable in unit tests): statements
440/451 (97.56%), branches 324/335 (96.72%), functions 93/101 (92.08%), lines 380/384 (98.96%).
Baseline before the new tests (same desktop files, without `main/index.ts`): `uri.ts` 90/132
statements and 97/136 branches; `compass.ts` 79/101 branches; `handlers.ts` 38/44 branches;
`main/handlers.ts` 11/12 branches; import page 32/36 branches.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/profiles/import/uri.ts:95-96` (several kept `authMechanismProperties` values in `extra`), `:199` (tag set with an empty tag name), `:204-206` (write concern with only some of `w`/`journal`/`wtimeoutMS`) | Branch combinations of option mirroring; secret stripping itself is covered | Justified gap: the token-stripping paths are covered; the remaining branch arms only pick the shape of non-secret fields |
| `apps/desktop/src/profiles/import/compass.ts:93` (`messageOf` with a non-Error throw) | Defensive | Justified gap: `profileFromUri` only throws `Error`s |
| `apps/desktop/src/profiles/import/handlers.ts:106` (weak keychain, entry with secrets but no `auth`) | Covered behavior-wise by the weak keychain SSH tests (optional chain arm) | Justified gap |
| `apps/desktop/src/main/index.ts` (whole file; the task changed 1 line) | Wiring `dialogs: nativeDialogs` | Not unit-testable (Electron app entry); the `mainHandlers` wiring is unit-tested, and the e2e (parent: passed) exercises the real wiring |
| `packages/contract/src/profiles.ts:52` | Pre-existing code, not changed by this task | Out of scope |
| `packages/renderer/src/app/connections/import/import-export-page.ts:111,123` (empty-input early returns in `importUris`/`exportSelected`) | Unreachable from the UI: both buttons are disabled when nothing is entered or selected (tested) | Justified gap |
| `packages/renderer/src/app/app.routes.ts:16,27,34,53` | Lazy loaders of other routes, not changed by this task; the changed import route loader is covered (`welcome.spec.ts`) | Out of scope |

## Unable to test

- AC3 (e2e import -> sidebar) was not re-run: the e2e file is unchanged; the parent reported it
  passing. No follow-up beyond re-running it after the TW-1 fix if the parent wants to.
- The Compass format can't be verified against real Compass output (assumption #1: fixtures were
  written from memory). These tests prove behavior against the assumed format only.
- Observation, not a failing test: a hand-edited Thicket file with `secretMode: 'saved'` is
  imported as `saved` with no stored secret (`parseThicket` keeps it; `exportFile` never writes
  it). No requirement covers this, so it is left to the parent to decide.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.

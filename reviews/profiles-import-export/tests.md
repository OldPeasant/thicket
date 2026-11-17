# Test Report

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: base 759d4d63be8ab2bdb90c5924083099dae40bec14 to the final reviewed revision 38344fc39df87eac14ae6104047028ea58c1fa4f
(branch main). The task commits are cf3696e, 19e5210 and b048e55 (implementation), 715df6d
(earlier tests and reports) and 38344fc (fixes for CR-1..CR-5 and TW-1), as named by the parent
worker. Uncommitted inputs: the new tests in `apps/desktop/src/profiles/import/import.spec.ts` (second
round). This run made no production changes.

Requirements:
- `tasks/profiles-import-export.md` acceptance criteria and the three recorded assumptions
  (Compass format from memory; encrypted entries imported without credentials plus a notice;
  export format `Thicket Connections` v1, saved -> ask, secret URI options stripped)
- `docs/ARCHITECTURE.md` "Coverage" and conventions; parent instructions (edge cases first; second
  round: fill the gaps the fixes left, e.g. `stripUriSecrets` and `parseThicket` notices)
- `reviews/profiles-import-export/fixes.md` (CR-1..CR-5, TW-1)

## Test files changed

- `apps/desktop/src/profiles/import/import.spec.ts` (round 1 and round 2)
- `apps/desktop/src/main/handlers.spec.ts` (round 1)
- `packages/contract/src/methods.spec.ts` (round 1)
- `packages/renderer/src/app/connections/import/import-export-page.spec.ts` (round 1)
- `packages/renderer/src/app/connections/connections-page.spec.ts` (round 1)

## Tests added or updated

Count: 62 added by the test-writer, no existing test changed.
- Round 1 (56): desktop import 44, main handlers 2, contract 2, import page 7, connections page 1.
- Round 2 (6), on 38344fc:
  - `stripUriSecrets` (4 tests): an unchanged URI that isn't in canonical form, the password only,
    every kind in any case and repeated, and an invalid URI without the password echoed.
  - `parseImportFile (Thicket export)` (2 tests): a URI that passes the contract but can't be
    parsed is skipped, and a session token plus unused secrets are stripped and named in the notice.

The fixer added 4 tests of its own (CR-1, CR-2, CR-3 log wiring, CR-5 handler); these were run but
are not counted here.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Unit tests with Compass export fixtures | fixture tests, `parseImportFile (Compass edge cases)` (BOM; EJSON `$numberInt/$numberLong/$numberDouble` versions; EJSON, plain and string SSH ports, invalid port -> 22; SSH without host/user skipped; SSH + SOCKS5 proxy skipped without leaking secrets; key file over password; non-object entries; colors; invalid URI without password echo; encrypted + plain credentials) | `cd apps/desktop && npx vitest run src/profiles/import src/main` | Pass |
| TW-1 inherited color keys (`toString`, `constructor`, `__proto__`) | `leaves out a color named like an object property (...)`, `imports a Compass entry with a color named "constructor" instead of failing the import` | same | Pass (fixed in 38344fc) |
| AC2 Export file contains no password/passphrase/token | grep tests in `exportFile`, `secret stripping (odd casing, repeated options, unparsed properties)`, `exportFile (shape)`, `profiles.export writes UTF-8 with mode 0644; the file re-imports as new profiles` | same | Pass |
| CR-1 a shared Thicket file never stores secret URI options | fixer's CR-1 and CR-5 tests; `stripUriSecrets` (4 tests); `strips a session token and secrets the profile does not use, naming them in the notice`; `skips a profile whose URI passes the contract but cannot be parsed; the rest is imported` | same | Pass |
| CR-2 Thicket `secretMode: 'saved'` becomes `ask` | fixer's CR-2 test; CR-5 handler test | same | Pass |
| CR-3 failures to save an imported secret are logged without the secret | fixer's `passes its log to the import (...)` | same | Pass |
| Encrypted Compass entries imported without credentials, with notice; contract `notices` | `reports the encrypted-credentials notice through the handler (contract-valid)`, `keeps plain credentials of an entry that also has encrypted ones, with a notice`, contract `import results (profiles.importCompass / importUris)` (2 tests) | desktop command; `sh .taskcheck` (contract suite) | Pass |
| Secrets stored only on a secure keychain; failures fall back to `ask` | `keeps secretMode when a non-password secret fails or is dropped on a weak keychain`, `a failing password secret turns saved into ask in the stored profile and the result`, `does not ask the keychain when no entry has a secret` | desktop command | Pass |
| Re-import adds nothing | `skips duplicates inside one import, keeping the first`, the export -> re-import test | desktop command | Pass |
| Oversize file refused before reading | `refuses a file larger than MAX_IMPORT_FILE_BYTES before reading it` (limit + 1 refused, exactly at the limit read) | desktop command | Pass |
| RPC error mapping | `maps a BOM-prefixed file, a non-JSON file and a read-only store correctly`, `returns null when the open dialog gives no file; ...` | desktop command | Pass |
| `mainHandlers` serves import/export only with both profiles and dialogs | `import/export ... are served only when both a ProfilesStore and native dialogs are given`, `import connection strings over the main port: password to secrets.bin only` | desktop command | Pass |
| Import/export page and the connections manager link | 7 page tests, `links to the import and export page` | `cd packages/renderer && npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --coverage ... --watch=false` | Pass |
| AC3 e2e: import -> profiles appear in the sidebar | none (e2e not changed by the test-writer) | Not run: the parent reported `npm run test:e2e -- profiles-import` -> 1 passed | Not run: e2e file unchanged by test-writer |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/profiles/import src/main`

Result:

Pass (5 files, 134 tests) on 38344fc plus the round-2 tests.

## Full test execution

Command:

`sh .taskcheck` (`npm run check`: eslint, prettier --check, typecheck, `vitest run`, renderer `ng test`)

Result:

Pass: lint, Prettier and typecheck clean; `vitest run` 65 files, 3606 tests passed; renderer
81 files, 2436 tests passed.

## .taskcheck

Result:

Pass

## Bugs found

### A Compass color named like an Object property breaks the import (fixed)

Finding ID:

`TW-1`

Test:

`parseImportFile (Compass edge cases) > leaves out a color named like an object property (toString, constructor, __proto__)`;
`importExportHandlers (edge cases) > imports a Compass entry with a color named "constructor" instead of failing the import`

Production source:

`apps/desktop/src/profiles/import/compass.ts` `colorOf` (was line 89, `return COMPASS_COLORS[color];`)

Requirement:

Assumption #1: only `color1..color10` and hex colors are colors. A malformed entry must not break
the whole import.

Expected behavior:

An inherited key is left out, and the entry imports without a color.

Actual behavior:

At b048e55, the inherited value (a function) reached `structuredClone` in `handlers.ts`.
`profiles.importCompass` failed with `DataCloneError` after the earlier entries were already saved.
Since 38344fc, `colorOf` uses `Object.hasOwn`, and both tests pass.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` Done in 38344fc and verified
by the tests above; nothing is open.

No new production defects were found in round 2.

## Coverage

Status: verified. Every run exited 0 with the full selection; no failing tests remain.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: profiles-import-export; base 759d4d63be8ab2bdb90c5924083099dae40bec14; HEAD 38344fc39df87eac14ae6104047028ea58c1fa4f; commits cf3696e, 19e5210, b048e55, 715df6d, 38344fc from the parent; files from `git diff --name-only 759d4d6..38344fc -- '*.ts'` without specs.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 38344fc plus uncommitted changes, `git diff | sha256sum` = 627df676fa57fead01a2b1fb6bd0f868a265945ae0249dcf4c8bfe89bcb82315, the same before and after the runs. The diff holds only the round-2 test file and the reviewer's own uncommitted `review.md`; no production files are in it.
- Exact included files; renamed/deleted/excluded files and reasons:
  - Included: `apps/desktop/src/profiles/import/{uri,compass,export,handlers,index}.ts`, `apps/desktop/src/profiles/index.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/main/index.ts`, `packages/contract/src/profiles.ts`, `packages/renderer/src/app/connections/import/import-export-page.ts`, `packages/renderer/src/app/app.routes.ts`, `packages/renderer/src/app/layout/navigation.ts`.
  - Deleted: `packages/renderer/src/app/layout/planned-page.ts` (CR-4) can't be instrumented at HEAD.
  - Not instrumented by v8: `test/e2e/profiles-import.e2e.ts` (a test), JSON fixtures, HTML/CSS templates (the page specs exercise them).
  - No renames.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`.
  (1) `apps/desktop`: `npx vitest run src/profiles/import src/main --coverage --coverage.include=<each desktop file above> --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcovonly` (134 passed, no filter).
  (2) `packages/contract`: `npx vitest run --coverage --coverage.include='src/profiles.ts' --coverage.reporter=text-summary --coverage.reporter=json-summary` (733 passed).
  (3) `packages/renderer`: `npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --coverage --coverage-include=<each renderer file above> --watch=false` (35 passed).
- Run start/completion time and exit status: (1) 2026-11-17 04:05:23, exit 0; (2) 04:05:28, exit 0; (3) 04:05:31, exit 0 (local time, each about 1-3 s).
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` sha256 e2b00c78482fbdeba5f03ea3cf01e9e4de8cb8410a785f4d429af93bf2bab61e, `apps/desktop/coverage/lcov.info` sha256 8742d4838d1ddfb31db5d05589151d16912441e1e9f82e38b31376cdcb59ebad; `packages/contract/coverage/coverage-summary.json`; `packages/renderer/coverage/renderer/{coverage-summary.json,lcov.info}` (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. Each run regenerated its reports directory, the reports list exactly the included files, and the snapshot hash matched before and after.
- Final run after latest test additions and production fixes: yes (38344fc with all round-2 tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/profiles/import/uri.ts` | 136/137 (99.27%) | 134/140 (95.71%) | 19/19 (100%) | 114/114 (100%) |
| `apps/desktop/src/profiles/import/compass.ts` | 121/121 (100%) | 107/109 (98.17%) | 19/19 (100%) | 110/110 (100%) |
| `apps/desktop/src/profiles/import/handlers.ts` | 76/76 (100%) | 43/44 (97.73%) | 17/17 (100%) | 65/65 (100%) |
| `apps/desktop/src/profiles/import/export.ts` | 7/7 (100%) | 2/2 (100%) | 2/2 (100%) | 6/6 (100%) |
| `apps/desktop/src/profiles/import/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/profiles/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 14/14 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/70 (0%) | 0/30 (0%) | 0/27 (0%) | 0/63 (0%) |
| `packages/contract/src/profiles.ts` | 22/22 (100%) | 3/4 (75%) | 2/2 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/connections/import/import-export-page.ts` | 71/73 (97.26%) | 34/36 (94.44%) | 26/26 (100%) | 59/59 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 5/13 (38.46%) | N/A (0/0) | 4/12 (33.33%) | 3/7 (42.86%) |
| `packages/renderer/src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |

Aggregates use summed counters over all 12 files (`index.ts` files have 0/0):

| Scope | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All 12 files, including `main/index.ts` and `app.routes.ts` | 456/537 (84.92%) | 337/379 (88.92%) | 96/131 (73.28%) | 395/462 (85.50%) |
| Without `main/index.ts` (Electron entry, not loadable in unit tests; 2 task lines) | 456/467 (97.64%) | 337/349 (96.56%) | 96/104 (92.31%) | 395/399 (98.99%) |

The deleted file `planned-page.ts` is not measured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/profiles/import/compass.ts:224-225` (an unparseable Thicket URI) and `uri.ts` `stripUriSecrets` password branch (were uncovered after 38344fc) | CR-1: shared-file secrets and invalid URIs | Covered in round 2: `stripUriSecrets` tests and `skips a profile whose URI passes the contract but cannot be parsed; ...` |
| `apps/desktop/src/profiles/import/uri.ts:95-96` (several kept `authMechanismProperties` values in `extra`), `:215` (tag set with an empty tag name), `:220-222` (write concern with only some of `w`/`journal`/`wtimeoutMS`) | Branch arms that shape non-secret fields; token stripping itself is covered | Justified gap |
| `apps/desktop/src/profiles/import/compass.ts:99` (`messageOf` with a non-Error throw), `:232` (`?? kind` fallback for a kind outside `URI_SECRET_OPTIONS`) | Defensive: the parser throws only `Error`s, and `takeSecrets` only yields kinds listed in `URI_SECRET_OPTIONS` | Justified gap |
| `apps/desktop/src/profiles/import/handlers.ts:106` (weak keychain, entry with secrets but no `auth`) | Optional-chain arm; the weak keychain SSH tests cover the behavior | Justified gap |
| `apps/desktop/src/main/index.ts` (whole file; the task changed 2 lines: `dialogs`, `log`) | Wiring | Not unit-testable (Electron entry). The `mainHandlers` wiring, including `log` (fixer's CR-3 test), is unit-tested; the e2e exercises the real entry |
| `packages/contract/src/profiles.ts:52` | Code from before this task | Out of scope |
| `packages/renderer/src/app/connections/import/import-export-page.ts:111,123` (empty-input early returns) | Unreachable from the UI: the buttons are disabled when there is nothing to import or export (tested) | Justified gap |
| `packages/renderer/src/app/app.routes.ts:16,27,34,53` | Lazy loaders of other routes, not changed by this task; the changed import route is covered by `welcome.spec.ts` | Out of scope |

## Unable to test

- AC3 (e2e import -> sidebar) was not re-run by the test-writer; the e2e file is unchanged by
  the test-writer, and the parent reported it passing. The fixes in 38344fc touch the main-side
  import, so the parent may want to re-run it before `done`.
- The Compass format can't be checked against real Compass output (assumption #1); the tests prove
  behavior against the assumed format only.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. TW-1, found in round
1, is fixed in 38344fc and verified; round 2 on 38344fc found no new defects and `.taskcheck` passes.

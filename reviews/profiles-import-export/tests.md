# Test Report

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: base b739b48d188a45b25e68023ffc6cc61f3479e17e to a367adbecef63c970fefd4f6d80249a018b2ec4c
(HEAD, branch main). The parent worker named the task commits 8ffdd31..a367adb: 8ffdd31, 82538c9 and
411d3e0 (implementation and e2e), fe744c6 (round-1 tests and reports), 1ba14e5 (fixes CR-1..CR-5,
TW-1), 509cfa9 (round-2 tests and reports) and a367adb (fix CR-6). Uncommitted inputs: this round's
new tests in two spec files (listed below). This round made no production changes. The whole task
is covered here; the focus is the CR-6 change.

Requirements:
- `tasks/profiles-import-export.md`: the acceptance criteria and the three recorded assumptions
  (Compass format written from memory; encrypted entries imported without credentials plus a
  notice; export format `Thicket Connections` v1, with saved turned into ask and secret URI options
  stripped)
- `reviews/profiles-import-export/review.md` CR-6 and `fixes.md` CR-6: only the database `password`
  is asked when connecting; SSH, client key and proxy secrets are entered in the connection editor;
  the AWS session token can't be entered in the app
- `docs/ARCHITECTURE.md` "Coverage"; parent instructions

## Test files changed

- `apps/desktop/src/profiles/import/import.spec.ts` (rounds 1, 2 and 3)
- `apps/desktop/src/main/handlers.spec.ts` (round 1)
- `packages/contract/src/methods.spec.ts` (round 1)
- `packages/renderer/src/app/connections/import/import-export-page.spec.ts` (rounds 1 and 3)
- `packages/renderer/src/app/connections/connections-page.spec.ts` (round 1)

## Tests added or updated

Count: 3 added in this round (round 3, on a367adb). No existing test was changed. Total from the
test-writer across all rounds: 65 (56 in round 1, 6 in round 2, 3 in round 3).

Round 3:
- `importExportHandlers (edge cases) > weak keychain: each notice says where its dropped secrets are entered (CR-6)`.
  On the plain Compass fixture with a weak keychain, it checks four things:
  - The password notice ends with "the password is asked when connecting", and that profile is
    stored with `ask`.
  - The SSH password notice and the client key and SSH key passphrase notice point to the
    connection editor and never say "when connecting".
  - The old wording "enter it when connecting" is gone.
  - No fake secret appears in any notice.
- `importExportHandlers (edge cases) > secure keychain: a password and an SSH password that both fail get both pieces of advice (CR-6)`.
  When both saves fail, it checks the exact combined notice and that `secretMode` becomes `ask`.
- `ImportExportPage > explains that only the password is asked; other encrypted secrets go into the editor (CR-6)`.
  It checks the new hint text on the import page.

The fixer wrote its own CR-6 tests (the `secretAdvice` unit test and the updated notice assertions).
They were run here but are not counted above.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Unit tests with Compass export fixtures | fixture tests in `parseImportFile (Compass export)`; `parseImportFile (Compass edge cases)`: BOM, EJSON versions, SSH ports, SSH without host or user, SSH plus proxy, key file over password, non-object entries, colors including TW-1, invalid URI without echoing the password, encrypted plus plain credentials | `cd apps/desktop && npx vitest run src/profiles src/main` | Pass |
| AC2 Export file contains no password/passphrase/token (grep) | `exportFile > contains no password, passphrase or token (grep of the output)`, `secret stripping (...)`, `exportFile (shape)`, `profiles.export writes UTF-8 with mode 0644; the file re-imports as new profiles` | same | Pass |
| AC3 e2e: import -> profiles appear in the sidebar | `test/e2e/profiles-import.e2e.ts` `import a Compass export and connection strings: the profiles appear in the sidebar; export has no secrets` | `npm run test:e2e -- profiles-import` (Electron/Playwright, built app) | Pass (1 passed) |
| CR-6 notices say where each secret is entered (only the password is asked) | fixer's `says where each dropped secret is entered: only the password is asked (CR-6)`, the updated notice assertions in `falls back to asking when storing the password fails`, `strips secret URI options from a shared file and says so (CR-1)` and `keeps secretMode when a non-password secret fails or is dropped on a weak keychain`; round 3: `weak keychain: each notice says where ...`, `secure keychain: a password and an SSH password that both fail ...` | desktop command | Pass |
| CR-6 import page hint | `explains that only the password is asked; other encrypted secrets go into the editor (CR-6)` | `cd packages/renderer && npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --watch=false` | Pass |
| CR-1 a shared Thicket file never stores secret URI options | CR-1 and CR-5 tests, `stripUriSecrets` (4 tests), the Thicket parse tests | desktop command | Pass |
| CR-2 Thicket `secretMode: 'saved'` becomes `ask` | `imports secretMode saved as ask: no secret is stored for it (CR-2)`, the CR-5 handler test | desktop command | Pass |
| CR-3 a failure to save an imported secret is logged without the secret | `passes its log to the import (...)` in `handlers.spec.ts` | desktop command | Pass |
| TW-1 inherited color keys | `leaves out a color named like an object property (...)`, `imports a Compass entry with a color named "constructor" instead of failing the import` | desktop command | Pass |
| Encrypted Compass entries imported without credentials, with a notice; contract `notices` | `imports encrypted entries without credentials and with a notice`, `reports the encrypted-credentials notice through the handler (contract-valid)`, contract `import results` (2 tests) | desktop command; `sh .taskcheck` (contract suite) | Pass |
| Secrets are stored only on a secure keychain; failures fall back to `ask` | weak-keychain and save-failure tests, including round 3 | desktop command | Pass |
| Re-import adds nothing; oversize file refused; RPC error mapping; `mainHandlers` wiring | `skips duplicates ...`, `refuses a file larger than MAX_IMPORT_FILE_BYTES ...`, `maps a BOM-prefixed file ...`, `import/export ... are served only when ...` | desktop command | Pass |
| Import/export page and the link from the connections manager | 8 page tests (7 earlier, 1 new), `links to the import and export page`, `welcome.spec.ts` route | renderer command | Pass |

## Focused test execution

Commands:

- `cd apps/desktop && npx vitest run src/profiles src/main`
- `cd packages/renderer && npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --watch=false`

Result:

Pass. Desktop: 6 files, 200 tests. Renderer: 3 files, 36 tests. Both ran on a367adb with the round-3
tests.

## Full test execution

Command:

`sh .taskcheck`, which runs `npm run check`: eslint with `--max-warnings 0`, `prettier --check .`,
typecheck, `vitest run` and the renderer `ng test`.

Result:

Pass (exit 0). `vitest run`: 65 files, 3624 tests passed. Renderer: 81 files, 2448 tests passed.

Also run: `npm run test:e2e -- profiles-import`, 1 passed.

## .taskcheck

Result:

Pass

## Bugs found

No new production defects were found in round 3. The CR-6 wording matches the behavior:
- `password` is the only secret the sidebar prompts for, because `secretMode` is `ask`. In every
  path where the notice says it is asked, the profile is stored with `ask`, and the tests check
  this.
- SSH, client key and proxy secrets are entered in the connection editor.
- The AWS secret access key is imported as the `password` kind. The backend uses a typed password
  as the secret key, so `awsSecretAccessKey` is never produced by the import.

TW-1 was found in round 1 and fixed in 1ba14e5. It is still covered and passing; nothing is open.

### A Compass color named like an Object property breaks the import (fixed)

Finding ID:

`TW-1`

Test:

`parseImportFile (Compass edge cases) > leaves out a color named like an object property (toString, constructor, __proto__)`;
`importExportHandlers (edge cases) > imports a Compass entry with a color named "constructor" instead of failing the import`

Production source:

`apps/desktop/src/profiles/import/compass.ts` `colorOf`

Requirement:

Assumption #1: only `color1..color10` and hex colors count as colors. A malformed entry must not break the whole import.

Expected behavior:

The inherited key is left out, and the entry imports without a color.

Actual behavior:

Before the fix, `profiles.importCompass` failed with `DataCloneError`. Fixed in 1ba14e5 by using
`Object.hasOwn`. Both tests pass at a367adb.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` Done in 1ba14e5 and verified at a367adb; nothing is open.

## Coverage

Status: verified. Every run exited 0 with the full selection, and no tests fail.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The tooling has no changed-line reporter, and the helper
script that would intersect `lcov.info` with the diff could not be written: the sandbox denied
writing to `/tmp`. The changed lines from CR-6 were checked by hand against the lcov data and are
all executed, except the branch at `compass.ts:270` (see below).

Evidence:
- Task id, base, measured HEAD, and task-owned commits/file-scope source: profiles-import-export;
  base b739b48d188a45b25e68023ffc6cc61f3479e17e; HEAD a367adbecef63c970fefd4f6d80249a018b2ec4c.
  The parent named the commits 8ffdd31..a367adb. The file list comes from
  `git diff --name-only b739b48..HEAD -- '*.ts'`, without specs and e2e files.
- Source/test snapshot identifier (including uncommitted inputs): HEAD a367adb plus uncommitted
  test changes. `git diff | sha256sum` was
  01d669ff372a5352cf51d4e670cf9915c3024b0d56bfbfeec4bfc886f3b2113d, identical before the coverage
  runs and after `.taskcheck`. The diff contains only the two spec files.
- Included files:
  - `apps/desktop/src/profiles/import/{uri,compass,export,handlers,index}.ts`
  - `apps/desktop/src/profiles/index.ts`
  - `apps/desktop/src/main/handlers.ts`
  - `apps/desktop/src/main/index.ts`
  - `packages/contract/src/profiles.ts`
  - `packages/renderer/src/app/connections/import/import-export-page.ts`
  - `packages/renderer/src/app/app.routes.ts`
  - `packages/renderer/src/app/layout/navigation.ts`
- Deleted, excluded and renamed files:
  - Deleted: `packages/renderer/src/app/layout/planned-page.ts` (CR-4). It can't be instrumented
    at HEAD.
  - Not instrumented by v8: JSON fixtures and HTML/CSS templates (the page specs exercise the
    templates) and `test/e2e/profiles-import.e2e.ts` (a test).
  - No renames.
- Provider/version, commands, working directories, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` on node v24.21.0.
  1. In `apps/desktop`: `npx vitest run src/profiles src/main --coverage --coverage.include=<each desktop file above> --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=lcovonly`. 200 passed, no filter.
  2. In `packages/contract`: `npx vitest run --coverage --coverage.include='src/profiles.ts' --coverage.reporter=text-summary --coverage.reporter=json-summary`. 733 passed.
  3. In `packages/renderer`: `npx ng test --include='src/app/connections/import/**/*.spec.ts' --include='src/app/connections/connections-page.spec.ts' --include='src/app/layout/welcome.spec.ts' --coverage --coverage-include=<each renderer file above> --watch=false`. 36 passed.
- Run start/completion times (local) and exit status:
  1. Started 04:11:11, reports written at 04:11:13, exit 0.
  2. Started 04:11:39, exit 0.
  3. Started 04:11:44, reports written at 04:11:46, exit 0.
- Generated report paths and hashes (all Git-ignored):
  - `apps/desktop/coverage/coverage-summary.json`, sha256 fdbd1d32cc7b19a2f05763f0b8b131b3b4a7035d894f3911cb5aef8dbf98f350
  - `apps/desktop/coverage/lcov.info`, sha256 100dedc8b58a3dbf64187472a19ad693f275ccd02c98ef96cd31814bafc8877b
  - `packages/contract/coverage/coverage-summary.json`, sha256 0b389c1d46f1f5744b4fa3ffe1d6c47f16fe484748792578537105fef22d30b0
  - `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 ef7b2834d01d830e16c1486f0c4a5cbd382bce0bb4dcc59655e65386789fbbbd
  - `packages/renderer/coverage/renderer/lcov.info`, sha256 e29c188a558813af003cb72f88a91172b1af905dc7dd0f1fba89d5e5b69f2409
- Evidence outputs are fresh and inputs stayed unchanged: yes. Each run regenerated its reports
  directory (file times match the runs), and each report lists exactly the included files. The
  snapshot hash was the same before and after.
- Final run after the latest test additions and production fixes: yes. The runs used a367adb, the
  CR-6 fix, with all round-3 tests.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/profiles/import/uri.ts` | 136/137 (99.27%) | 134/140 (95.71%) | 19/19 (100%) | 114/114 (100%) |
| `apps/desktop/src/profiles/import/compass.ts` | 139/139 (100%) | 115/117 (98.29%) | 24/24 (100%) | 121/121 (100%) |
| `apps/desktop/src/profiles/import/handlers.ts` | 76/76 (100%) | 43/44 (97.73%) | 18/18 (100%) | 65/65 (100%) |
| `apps/desktop/src/profiles/import/export.ts` | 7/7 (100%) | 2/2 (100%) | 2/2 (100%) | 6/6 (100%) |
| `apps/desktop/src/profiles/import/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/profiles/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 14/14 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/70 (0%) | 0/30 (0%) | 0/27 (0%) | 0/63 (0%) |
| `packages/contract/src/profiles.ts` | 22/22 (100%) | 3/4 (75%) | 2/2 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/connections/import/import-export-page.ts` | 71/73 (97.26%) | 34/36 (94.44%) | 26/26 (100%) | 59/59 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 5/13 (38.46%) | N/A (0/0) | 4/12 (33.33%) | 3/7 (42.86%) |
| `packages/renderer/src/app/layout/navigation.ts` | 2/2 (100%) | N/A (0/0) | 1/1 (100%) | 2/2 (100%) |

The aggregates below add up the counters of all 12 files; the two `index.ts` files have 0/0. The
deleted file `planned-page.ts` is not measured.

| Scope | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All 12 files, including `main/index.ts` and `app.routes.ts` | 474/555 (85.41%) | 345/387 (89.15%) | 102/137 (74.45%) | 406/473 (85.84%) |
| Without `main/index.ts` (Electron entry, can't be loaded in unit tests; the task changed 2 lines there) | 474/485 (97.73%) | 345/357 (96.64%) | 102/110 (92.73%) | 406/410 (99.02%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/profiles/import/compass.ts:270` (`URI_SECRET_OPTIONS[kind] ?? kind`, the fallback arm; changed line in CR-6's notice) | The fallback would only apply when `password` is removed from a Thicket URI. The contract refuses such profiles before this point (`skips a hand-edited profile with a password in its URI without echoing it`). | Justified gap: defensive and unreachable through `parseImportFile` |
| `apps/desktop/src/profiles/import/compass.ts:136` (`messageOf` with a non-Error throw) | Defensive: the parsers only throw `Error`s | Justified gap |
| `apps/desktop/src/profiles/import/handlers.ts:97` (`storage?.backend ?? 'unknown'`) | Defensive: `storage` is always set when an entry has secrets | Justified gap |
| `secretAdvice([])` (returns `''`) | Never called with an empty list: every caller checks first that the list is non-empty | Justified gap (the branch counters are already covered) |
| `apps/desktop/src/profiles/import/uri.ts:95-96`, `:215`, `:220-222` | Branch arms that shape non-secret fields; token stripping itself is covered | Justified gap (unchanged since round 2) |
| `apps/desktop/src/main/index.ts` (whole file; the task changed 2 lines, `dialogs` and `log`) | Wiring | Can't be unit-tested (Electron entry). The `mainHandlers` wiring is unit-tested, and the e2e test, which passed, exercises the real entry. |
| `packages/contract/src/profiles.ts:52` | Code from before this task | Out of scope |
| `packages/renderer/src/app/connections/import/import-export-page.ts:111,123` (early returns on empty input) | Unreachable from the UI: the buttons are disabled when there is nothing to import or export, and that is tested | Justified gap |
| `packages/renderer/src/app/app.routes.ts:16,27,34,53` | Lazy loaders of other routes, not changed by this task. The changed import route is covered by `welcome.spec.ts`. | Out of scope |

## Unable to test

- The Compass format can't be checked against real Compass output (assumption #1). The tests
  prove the behavior against the assumed format only.
- Changed-line coverage was not measured; see the Coverage section for why.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. Round 3 added 3 tests
for the CR-6 wording, covering the weak-keychain advice for each kind of secret, the combined
advice when saves fail, and the page hint. The focused suites, `.taskcheck` and the import e2e all
pass at a367adb with the new tests. The new tests are uncommitted and must be committed by the
parent worker.

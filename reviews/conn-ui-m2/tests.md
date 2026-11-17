# Test Report

Date: 2026-11-17

Task: conn-ui-m2 — M2: Connection editor for SSH, X.509, proxy and read preference

Scope: `git diff f94e6cf312b7efef453e423d6a70bafc02d1e8ab..7fceb46` on branch `main` (task commits
a9c1310, 0c7ce7e, 7fceb46, supplied by the parent worker), plus the uncommitted test-file changes
listed below. No uncommitted production changes.

Requirements:
- `tasks/conn-ui-m2.md` acceptance criteria and notes (CR-2: no `tls.keyFile` without
  `tls.certificateKeyFile`; CR-3: no `readPreferenceTags` with `primary`/unset; proxy password =
  secret kind `proxyPassword`; recorded assumptions about secret storage, host key dialog in AppShell,
  copy with masked password, tag set text format)
- `SPEC.md` (SSH tunnel: host, port, user; password, private key with passphrase, or agent)
- `docs/ARCHITECTURE.md` "Coverage"
- Parent worker instructions (gaps to look at: partial setSecret failure, AppShell inert, tag set
  removal, SSH port parse)

## Test files changed

- `packages/renderer/src/app/connections/connection-editor.spec.ts`
- `packages/renderer/src/app/connections/host-key-dialog.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

## Tests added or updated

Count: 27 (20 in `connection-editor.spec.ts` "M2 gaps (test-writer)", 6 in
`host-key-dialog.spec.ts` "test-writer", 1 in `app-shell.spec.ts`). No existing test was changed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e SSH-tunnelled profile created and connected, host key dialog accepted | `test/e2e/ssh.e2e.ts` (parent's) | not run by the test-writer; parent reports `npx playwright test ssh.e2e.ts` passes | Not run: by the test-writer (parent's own evidence) |
| AC2: field validation, SSH (server, user, key file, port parse incl. text/0/65536/22.5, trimmed 2222 saved) | `SSH port: a trimmed number is saved; text, 0 and 65536 are refused`, existing `shows SSH field problems ...`, model `M2 options: validation` | `npx ng test --include src/app/connections/connection-editor.spec.ts` | Pass |
| AC2: validation, proxy (invalid port, empty port = 1080, user without host) | `the proxy port: empty uses 1080, an invalid one is refused`, `a proxy user without a proxy host is refused` | same | Pass |
| AC2: validation, SSH and proxy together refused | existing `refuses SSH together with a proxy` | same | Pass |
| AC2 / CR-2: key file needs certificate; X.509 needs TLS + certificate | existing `a key file without a client certificate cannot be saved (CR-2)`, `X.509: ...` | same | Pass |
| AC2 / CR-3: tags need a non-primary read preference; tag needs a name; removing all tags makes primary valid again | `a tag without a name is refused in the form`, `removing every tag set lets a primary read preference be saved again`, existing CR-3 test | same | Pass |
| AC2: URI sync, tag sets (edit, remove the middle set, order kept) | `tag sets: editing and removing the middle one keeps the others in order` | same | Pass |
| AC2: URI sync, write concern (invalid wtimeout dropped, empty w/journal removed) | `write concern: invalid timeouts and empty fields are left out` | same | Pass |
| AC2: URI sync, proxy route display / SRV target | `the route shows the proxy hop and the SRV target` | same | Pass |
| Secrets: partial failure of several setSecret calls; failed one kept for retry, succeeded one shown as saved, retry updates the same profile | `one of several secrets fails: the others are stored, the failed one is kept for a retry` | same | Pass |
| Secrets: DB password store failure stops before extra secrets | `a failed database password store stops before the other secrets are stored` | same | Pass |
| Secrets: only kinds the settings use are stored | `secrets typed for settings that are no longer used are not stored`, `turning TLS off hides the key passphrase and does not store it` | same | Pass |
| Secrets: saved secret not re-stored; placeholder says saved | `a saved secret that is not retyped is not stored again; ...` | same | Pass |
| Secrets: sshKeyPassphrase with key file | `an SSH key passphrase is stored as sshKeyPassphrase together with the key file` | same | Pass |
| Secrets: store finishing after profile switch leaves the new profile alone | `an SSH password store that finishes after switching profiles leaves the new profile alone` | same | Pass |
| Secret fields disabled without encryption | `secret fields are disabled when no encryption is available` | same | Pass |
| File choosers: key file purpose, failure/cancel | `the private key file chooser fills the separate key file`, `a failed certificate or SSH key chooser is reported and keeps the field` | same | Pass |
| Copy: failure message, copy from URI tab, disabled when URI cannot be written | `a failed copy says so; ...`, `copy is disabled while the connection string cannot be written` | same | Pass |
| Host key dialog: focus trap, focus return, busy state (no double answer), retry after error, fingerprint without prefix, next queued question after timeout | 6 tests in `HostKeyDialog > test-writer` | `npx ng test --include src/app/connections/host-key-dialog.spec.ts` | Pass |
| AppShell inert while the host key dialog is open; shortcuts swallowed; inert lifted after answer | `while the SSH host key dialog is open, the rest of the window is inert and shortcuts do nothing` | `npx ng test --include src/app/layout/app-shell.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/connections/host-key-dialog.spec.ts --include src/app/layout/app-shell.spec.ts --include src/app/connections/connection-editor.spec.ts`
(then `--include src/app/connections/connection-editor.spec.ts` again after the last two tests were added: 69 passed)

Result:

Pass (3 files, 136 tests; editor spec alone after final additions: 69 tests)

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck, `vitest run` and `ng test`)

Result:

Pass (root vitest 62 files / 3465 tests; renderer 73 files / 2220 tests; lint and Prettier clean)

## .taskcheck

Result:

Not run separately: `.taskcheck` runs `npm run check`, which was run directly and passed (above).

## Bugs found

None. No test exposed behavior that violates the acceptance criteria or the task notes.

Observations for the parent (not filed as defects, no failing test):

- Empty SSH port: clearing `field-ssh-port` (placeholder "22") makes the form refuse saving with
  "The SSH port is a whole number from 1 to 65535.", while an empty proxy port falls back to 1080
  and `profileDraftFromState` itself falls back to 22. The model spec asserts this behavior on
  purpose (`port: undefined` is a problem), so it was not treated as a bug; the parent may want to
  decide whether empty should mean 22, consistent with the placeholder and the proxy field.
- `storeSecrets` doc comment says "a typed field is cleared once its secret is stored"; on a partial
  failure the successfully stored field keeps its typed value (it is re-stored on retry, harmless).
  The test only asserts that the stored kind is shown as saved.

## Coverage

Status: verified (task-changed TypeScript files; template/CSS files are not instrumented separately)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `conn-ui-m2`;
  base `f94e6cf312b7efef453e423d6a70bafc02d1e8ab`; HEAD `7fceb46`; task commits a9c1310, 0c7ce7e,
  7fceb46 supplied by the parent and matched against `git diff --stat f94e6cf..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production files unchanged from
  HEAD (sha256: connection-form.model.ts `5d698f34…`, connection-editor.ts `fef6b1c4…`,
  host-key-dialog.ts `e6f54777…`, host-key.service.ts `65c82794…`, app-shell.ts `f20ab98e…`);
  uncommitted specs: connection-editor.spec.ts `4ebab07c889d8c7b8c09567c4e808e3639ae3ccd6129f283fe17b30e2f064b22`,
  host-key-dialog.spec.ts `cf1972fd64c84245be16c49391581165153feeeab7f19e8127fd4e273ea36396`,
  app-shell.spec.ts `b866e6af538c6ad6f1a87c46678ed20890f8fa85a4d4154d823ecaa068b66195`.
- Exact included files: `packages/renderer/src/app/connections/connection-form.model.ts`,
  `connection-editor.ts`, `host-key-dialog.ts`, `host-key.service.ts`,
  `packages/renderer/src/app/layout/app-shell.ts`. Excluded: `connection-editor.html` and the CSS
  files (template/styles, exercised through the component tests but not separate coverage units),
  the spec files, `test/e2e/ssh.e2e.ts` and `test/integration/fixtures/ssh.ts` (test code).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 via
  `ng test`; `npx ng test --coverage --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/host-key-dialog.ts' --coverage-include='src/app/connections/host-key.service.ts' --coverage-include='src/app/layout/app-shell.ts'`
  in `packages/renderer`; whole renderer suite (73 files, 2220 tests).
- Run start/completion time and exit status: started 2026-11-17 03:28:03 +0100, ~12 s, all tests
  passed, report written.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `81fa204c0891b55f450c19d64822addd2c42bbca3cd007d71654011dbd488f85`),
  `packages/renderer/coverage/renderer/lcov.info` (sha256 `8b13ffb080eafad27b2addfa5b36a785e14163ddbfdb6ca686e36bb725a651f1`).
- Evidence outputs are fresh and inputs stayed unchanged: the summary differs from the previous run's
  (hash `65fe0588…`, before the last two tests) and its counters match this run's console summary;
  spec and production hashes were taken after the run and match the inputs.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/connections/connection-editor.ts` | 433/441 (98.18%) | 205/229 (89.51%) | 130/130 (100%) | 357/359 (99.44%) |
| `packages/renderer/src/app/connections/connection-form.model.ts` | 313/315 (99.36%) | 296/301 (98.33%) | 41/41 (100%) | 256/257 (99.61%) |
| `packages/renderer/src/app/connections/host-key-dialog.ts` | 104/107 (97.19%) | 51/58 (87.93%) | 10/11 (90.9%) | 75/75 (100%) |
| `packages/renderer/src/app/connections/host-key.service.ts` | 49/49 (100%) | 18/21 (85.71%) | 12/12 (100%) | 36/36 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 121/122 (99.18%) | 78/78 (100%) | 25/26 (96.15%) | 89/89 (100%) |
| Aggregate (5 files, summed counters) | 1020/1034 (98.64%) | 648/687 (94.32%) | 218/220 (99.09%) | 813/816 (99.63%) |

Aggregate excludes `connection-editor.html` and the CSS files (not instrumented as separate units).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `connection-editor.ts:438` (chooseFile catch), `:817` (store finishing after a profile switch) | error path of the new choosers; race on secret store | Covered now: `a failed certificate or SSH key chooser ...`, `an SSH password store that finishes after switching profiles ...` |
| `connection-editor.ts:253, 411` and branches at 167–355, 495–626, 680–735 | pre-existing M1 code paths (load, TLS flag, test/save races) in the same file | Not task behavior; left as is |
| `connection-form.model.ts:323, 427, 532` | `readable()` non-Error fallback; URI error only reported when no other problem; empty-string `w` | Defensive / pre-existing; not material |
| `host-key-dialog.ts` mousedown listener on backdrop; template branches 91–144 | backdrop click does nothing; compiled-template null checks | Non-material (no behavior beyond preventDefault) |
| `host-key.service.ts:55` (timeout of a queued, non-current question), `:57`, `:77` (error arriving after the question was already removed) | edge races of the queue | Low risk; not tested (queued-question timeout of the *current* one is tested) |
| `app-shell.ts` one anonymous function | pre-existing | Not task behavior |

## Unable to test

- AC1 (e2e with the sshd container and the host key dialog) was not run by the test-writer; the parent
  reports it passes with `npx playwright test ssh.e2e.ts`. It needs to be recorded as the parent's
  own evidence.
- Real clipboard access in Electron (tested with a stubbed `navigator.clipboard`).
- Visual/token compliance (no hard-coded colors) is not covered by component tests.

## Summary

Tests added and all validation passed. No production defects found; two observations (empty SSH port
refused despite the "22" placeholder; stored field not cleared on partial failure) are left for the
parent to judge.

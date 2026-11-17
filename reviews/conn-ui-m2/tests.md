# Test Report

Date: 2026-11-17

Task: conn-ui-m2 — M2: Connection editor for SSH, X.509, proxy and read preference

Scope: `git diff f94e6cf312b7efef453e423d6a70bafc02d1e8ab..aa77cf816cbef0c84eaf4d15d1c6f8ae824c2cea`
on branch `main`. Task code commits: a9c1310, 0c7ce7e, 7fceb46 (implementation, tests, e2e),
c05e8df (test-writer tests and report, first pass), aa77cf8 (fixer: review findings CR-1..CR-4);
2df263b only adds the review report. Supplied by the parent worker. Plus uncommitted test-file
changes of this second pass (listed below). No uncommitted production changes.
This report replaces the first-pass report (revision 7fceb46) and describes revision aa77cf8.

Requirements:
- `tasks/conn-ui-m2.md` acceptance criteria and notes (CR-2/CR-3 of x509-proxy: no `tls.keyFile`
  without `tls.certificateKeyFile`; no `readPreferenceTags` with `primary`/unset; proxy password =
  secret kind `proxyPassword`; recorded assumptions about secret storage, host key dialog in AppShell,
  copy with masked password, tag set text format)
- `reviews/conn-ui-m2/fixes.md` (fixer's CR-1..CR-4 of this task's review: empty SSH port = 22;
  X.509 never writes authSource; host key dialog keeps/restores focus around busy/error; the
  dropped-secrets note only points to a field when one exists)
- `SPEC.md` (SSH tunnel: host, port, user; password, private key with passphrase, or agent)
- `docs/ARCHITECTURE.md` "Coverage"
- Parent worker instructions (partial setSecret failure, AppShell inert, tag set removal, SSH port
  parse; second pass: re-check coverage of the fixed behavior)

## Test files changed

First pass (committed in c05e8df):
- `packages/renderer/src/app/connections/connection-editor.spec.ts`
- `packages/renderer/src/app/connections/host-key-dialog.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Second pass (uncommitted, for revision aa77cf8):
- `packages/renderer/src/app/connections/connection-editor.spec.ts`
- `packages/renderer/src/app/connections/host-key-dialog.spec.ts`

## Tests added or updated

Count: 31 by the test-writer in total (first pass 27: 20 editor, 6 host key dialog, 1 AppShell;
second pass 4: 2 editor, 2 host key dialog). No existing test was weakened. The fixer extended the
test-writer's SSH port test with the CR-1 empty-port case (accepted: it matches the fixed behavior).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e SSH-tunnelled profile created and connected, host key dialog accepted | `test/e2e/ssh.e2e.ts` (parent's) | not run by the test-writer; parent reports `npx playwright test ssh.e2e.ts` passes | Not run: by the test-writer (needs the parent's own evidence on aa77cf8) |
| AC2: SSH validation and port parse (text/0/65536/22.5 refused, ` 2222 ` saved, empty = 22 per CR-1) | `SSH port: a trimmed number is saved; text, 0 and 65536 are refused` (incl. fixer's CR-1 part), existing `shows SSH field problems ...`, model `M2 options: validation` | `npx ng test --include src/app/connections/connection-editor.spec.ts --include src/app/connections/connection-form.model.spec.ts` | Pass |
| AC2: proxy validation (invalid port, empty = 1080, user without host) | `the proxy port: empty uses 1080, an invalid one is refused`, `a proxy user without a proxy host is refused` | same | Pass |
| AC2: SSH and proxy together refused | existing `refuses SSH together with a proxy` | same | Pass |
| AC2 / x509-proxy CR-2: key file needs certificate; X.509 needs TLS + certificate | existing `a key file without a client certificate cannot be saved (CR-2)`, `X.509: ...` | same | Pass |
| Review CR-2 (this task): X.509 never writes authSource (switching mechanism, pasted URI, loaded saved profile) | fixer's `switching to X.509 drops the hidden auth source`, model `X.509 never writes an authSource ...`, new `a saved X.509 profile holding an authSource is saved without it (CR-2 re-check)` | same | Pass |
| AC2 / x509-proxy CR-3: tags need non-primary read preference; tag needs a name; removing all sets makes primary valid | `a tag without a name is refused in the form`, `removing every tag set lets a primary read preference be saved again`, existing CR-3 test | same | Pass |
| AC2: URI sync of tag sets (edit, remove the middle set, order kept) | `tag sets: editing and removing the middle one keeps the others in order` | same | Pass |
| AC2: URI sync of write concern (invalid wtimeout dropped, empty w/journal removed) | `write concern: invalid timeouts and empty fields are left out` | same | Pass |
| AC2: route display (proxy hop, SRV target) | `the route shows the proxy hop and the SRV target` | same | Pass |
| Review CR-4: dropped-secrets note points to a field only when one exists | fixer's `a dropped secret without a field of its own does not point to one`, new `a dropped client key password alone still points to its field (CR-4 re-check)` | same | Pass |
| Secrets: partial failure of several setSecret calls; failed one kept for retry, stored one shown as saved, retry updates the same profile | `one of several secrets fails: ...` | same | Pass |
| Secrets: DB password failure stops before extra secrets | `a failed database password store stops before the other secrets are stored` | same | Pass |
| Secrets: only kinds the settings use are stored; saved ones not re-stored; sshKeyPassphrase; store after profile switch; disabled without encryption | `secrets typed for settings that are no longer used are not stored`, `turning TLS off ...`, `a saved secret that is not retyped ...`, `an SSH key passphrase is stored ...`, `an SSH password store that finishes after switching profiles ...`, `secret fields are disabled ...` | same | Pass |
| File choosers (key file purpose, failure/cancel) | `the private key file chooser fills the separate key file`, `a failed certificate or SSH key chooser ...` | same | Pass |
| Copy (failure, from URI tab, disabled when URI invalid; masked password) | `a failed copy says so; ...`, `copy is disabled ...`, existing `copies the connection string with the password masked` | same | Pass |
| Host key dialog: focus trap, focus return, busy state, retry, fingerprint without prefix, queued question after timeout | 6 first-pass tests in `HostKeyDialog > test-writer` | `npx ng test --include src/app/connections/host-key-dialog.spec.ts` | Pass |
| Review CR-3: focus kept in the dialog while busy, back on "Don't trust" after an error, but left where the user moved it inside the dialog; late error of a question that is gone not shown on the next one | fixer's `keeps the focus in the dialog while busy ...`, new `after a failed answer, focus the user moved inside the dialog stays there (CR-3 re-check)`, new `a failed answer to a question that is gone meanwhile does not move the focus to the next one` | same | Pass |
| AppShell inert while the host key dialog is open; shortcuts swallowed; inert lifted after answer | `while the SSH host key dialog is open, the rest of the window is inert and shortcuts do nothing` | `npx ng test --include src/app/layout/app-shell.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/connections/host-key-dialog.spec.ts --include src/app/connections/connection-editor.spec.ts --include src/app/connections/connection-form.model.spec.ts --include src/app/layout/app-shell.spec.ts`

Result:

Pass (4 files, 236 tests) on aa77cf8 plus the second-pass tests.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck, `vitest run`, `ng test`)

Result:

Pass on aa77cf8 plus the second-pass tests (root vitest 62 files / 3465 tests; renderer 73 files /
2228 tests; lint and Prettier clean).

## .taskcheck

Result:

Not run separately: `.taskcheck` runs `npm run check`, which was run directly and passed (above).

## Bugs found

None. No test exposes behavior that violates the acceptance criteria, the task notes or the fixed
review findings. The two first-pass observations are resolved by aa77cf8: the empty SSH port now
means 22 (CR-1), and the `storeSecrets` comment now states that typed values are kept until the whole
save succeeds.

## Coverage

Status: verified (task-changed TypeScript files on aa77cf8; template/CSS files are not instrumented separately)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `conn-ui-m2`;
  base `f94e6cf312b7efef453e423d6a70bafc02d1e8ab`; HEAD `aa77cf816cbef0c84eaf4d15d1c6f8ae824c2cea`;
  task commits a9c1310, 0c7ce7e, 7fceb46, c05e8df, aa77cf8 (supplied by the parent, matched against
  `git log` and `git diff --stat 7fceb46..aa77cf8`).
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD
  aa77cf8 (`git status` shows no production changes); uncommitted specs (sha256):
  connection-editor.spec.ts `65aacd3e3cb6ad0ae4a87ae8ef4fc4c8ae9229386220de02b072b6bb7fdcc903`,
  host-key-dialog.spec.ts `8709bcd41e1da04e5fa8b99a2b2f3a2d99341102c841e561700b0635599af8c2`;
  committed specs: app-shell.spec.ts `b866e6af…`, connection-form.model.spec.ts `90b2202b…`.
  (`reviews/conn-ui-m2/review.md` is also modified in the working tree, not by the test-writer; it is
  not a test input.)
- Exact included files: `packages/renderer/src/app/connections/connection-form.model.ts`,
  `connection-editor.ts`, `host-key-dialog.ts`, `host-key.service.ts`,
  `packages/renderer/src/app/layout/app-shell.ts`. Excluded: `connection-editor.html` and the CSS
  files (template/styles, exercised through the component tests, not separate coverage units), the
  spec files, `test/e2e/ssh.e2e.ts` and `test/integration/fixtures/ssh.ts` (test code).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 via
  `ng test`; `npx ng test --coverage --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/host-key-dialog.ts' --coverage-include='src/app/connections/host-key.service.ts' --coverage-include='src/app/layout/app-shell.ts'`
  in `packages/renderer`; whole renderer suite (73 files, 2228 tests).
- Run start/completion time and exit status: started 2026-11-17 03:34:46 +0100, ~12 s, all tests
  passed, report written.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `5b9d6ed3a8fe70c7a472c3137ac2405c3ecd49edf08171a3845b4ea6d9258672`),
  `packages/renderer/coverage/renderer/lcov.info` (sha256 `be3ca9f345a4e31617f99f91cbd63485c91e5d4bf32bbd32c9378abc126de7df`).
- Evidence outputs are fresh and inputs stayed unchanged: totals (1058 statements, 714 branches)
  differ from the first-pass run on 7fceb46 (1034/687) because the fixed code is larger; counters
  match this run's console summary; spec hashes were taken after the run.
- Final run after latest test additions and production fixes: yes (after aa77cf8 and the
  second-pass tests).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/connections/connection-editor.ts` | 439/446 (98.43%) | 211/235 (89.79%) | 132/132 (100%) | 360/362 (99.45%) |
| `packages/renderer/src/app/connections/connection-form.model.ts` | 315/317 (99.37%) | 302/307 (98.37%) | 41/41 (100%) | 258/259 (99.61%) |
| `packages/renderer/src/app/connections/host-key-dialog.ts` | 121/124 (97.58%) | 66/73 (90.41%) | 13/14 (92.86%) | 90/90 (100%) |
| `packages/renderer/src/app/connections/host-key.service.ts` | 48/49 (97.96%) | 18/21 (85.71%) | 12/12 (100%) | 36/36 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 121/122 (99.18%) | 78/78 (100%) | 25/26 (96.15%) | 89/89 (100%) |
| Aggregate (5 files, summed counters) | 1044/1058 (98.68%) | 675/714 (94.54%) | 223/225 (99.11%) | 833/836 (99.64%) |

Aggregate excludes `connection-editor.html` and the CSS files (not instrumented as separate units).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `connection-editor.ts` chooseFile catch, store finishing after a profile switch | error path of the new choosers; race on secret store | Covered (first pass) |
| `connection-editor.ts:259, 419` and branches at 167–361, 516–634, 688–743 | pre-existing M1 code paths (load, TLS flag, test/save races) in the same file | Not task behavior; left as is |
| `connection-form.model.ts:326, 432, 537` | `readable()` non-Error fallback; URI error only reported when no other problem; empty-string `w` | Defensive / pre-existing; not material |
| `host-key-dialog.ts` backdrop mousedown listener; branches 91–124 (compiled template null checks), 168/176 (Tab with a modifier; no focusable items) | backdrop does only preventDefault; defensive | Non-material |
| `host-key-dialog.ts:140` CR-3 "focus moved inside the dialog" branch | review CR-3 | Covered now: `after a failed answer, focus the user moved inside the dialog stays there (CR-3 re-check)` |
| `host-key.service.ts:77` error after the question was removed | late error must not show on the next question | Covered now: `a failed answer to a question that is gone meanwhile ...` |
| `host-key.service.ts:67` busy guard | now unreachable from the dialog, which checks `busy()` first (aa77cf8) | Defensive; left uncovered |
| `host-key.service.ts:55, 57` (removing a queued question that is not shown) | queue edge case | Low risk; not tested |
| `app-shell.ts` one anonymous function | pre-existing | Not task behavior |

## Unable to test

- AC1 (e2e with the sshd container and the host key dialog) was not run by the test-writer; it needs
  the parent's own run on the final revision (aa77cf8 changed the host key dialog's focus handling).
- Real clipboard access in Electron (tested with a stubbed `navigator.clipboard`).
- Visual/token compliance (no hard-coded colors) is not covered by component tests.

## Summary

Tests added and all validation passed. The fixer's CR-1..CR-4 changes are covered by tests on
revision aa77cf8; no production defects found.

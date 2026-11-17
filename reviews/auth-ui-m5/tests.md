# Test Report

Date: 2026-11-17

Task: auth-ui-m5 - M5: Connection editor for LDAP, OIDC and AWS

Scope: `git diff 384a448fa59547d3354caf30d43b3d18da210f3f 043e9e6026daede4a61a662621972beca0d2ea87 -- packages test`
(task code commits b5b55b2 and 043e9e6; the commits in between only touch `tasks/`). Branch `main`,
HEAD 043e9e6026daede4a61a662621972beca0d2ea87. No uncommitted production changes; the only
uncommitted files are the test files listed below.

Requirements:
- `tasks/auth-ui-m5.md` acceptance criteria and the three recorded ASSUMPTION notes (AWS key ID /
  secret / session token handling, `$external` mechanisms drop authSource, OIDC sign-in panel).
- `SPEC.md` / `docs/ARCHITECTURE.md` ("Coverage", "Conventions": tests next to the code, no secrets in fixtures).
- Contract `packages/contract/src/conn.ts` (`oidcPrompt`) and `packages/contract/src/profiles.ts` (`OIDC_FLOWS`, auth schema).
- Parent instructions (model round trips, applyConnectionString, stripUriSecrets, editorProblems, oidc-sign-in spec).

## Test files changed

- `packages/renderer/src/app/connections/connection-form.model.spec.ts` (new describe block "connection-form.model M5: LDAP (PLAIN), OIDC and AWS IAM (test-writer)")
- `packages/renderer/src/app/connections/oidc-sign-in.spec.ts` (new)
- `packages/renderer/src/app/layout/app-shell.spec.ts` (one test added)

No existing test was changed, weakened, skipped or removed. No production file was modified.

## Tests added or updated

Count: 70 (37 model tests, 32 OIDC sign-in service/panel tests, 1 app-shell test)

Model (`connection-form.model.spec.ts`):
- mechanism helpers: FORM_MECHANISMS offers PLAIN/OIDC/AWS; `usesExternalSource` true only for X.509, PLAIN, OIDC, AWS, GSSAPI; `usesPassword` includes AWS, not OIDC/GSSAPI; `awsKeys` / `passwordInUse` table incl. whitespace-only key ID; `usedSecretKinds` lists `awsSessionToken` only for AWS with a key ID.
- LDAP (PLAIN) round trip profile → state → draft (and stable on reload): user and secret mode kept, `$external` and another authSource dropped from form, string and draft; profile without `auth` takes PLAIN from the string with the fallback secret mode; typed LDAP password shown as MASK, never in the draft.
- OIDC round trip: user name, `oidcFlow` (deviceCode, authCode) and `oidcTrustedEndpoint` kept; default `auto`/false left out of the draft (also when saved explicitly); no user in the string without user name; secret mode always `none`; OIDC settings not saved when another mechanism is chosen.
- AWS round trip: key ID in `auth.username`, never in the connection string (exact string asserted); typed secret neither masked nor present in string/draft; default chain saved with `none` while the editor keeps the fallback mode, which is saved once a key ID is entered; saved `ask` kept; key ID trimmed, blank = default chain; authSource dropped; a saved string with `AWS_SESSION_TOKEN` loads without it and keeps the key.
- applyConnectionString: AWS edit keeps key/secret/secret mode; AWS default chain edit adds nothing; unchanged tab text round-trips to the same draft; pasted `key:secret@` replaces both and they leave the string; pasted key without secret clears the old secret; pasted `AWS_SESSION_TOKEN` dropped (reported in `droppedSecrets`) while keys stay; pasted authSource dropped; SCRAM → AWS string does not turn the DB user/password into AWS keys; AWS → SCRAM string does not keep the AWS secret as DB password; PLAIN string moves the password, drops `$external`, `none` becomes `ask`; OIDC string gives secret mode `none`, drops authSource, keeps other mechanism properties and the OIDC form settings; a password pasted with OIDC is never shown or saved.
- GSSAPI (behavior changed by `usesExternalSource`): not offered by the form, a loaded profile keeps the mechanism and saves no authSource.
- editorProblems: AWS without key ID (or blank key ID) and AWS with keys are valid; PLAIN needs a user name; OIDC does not.

OIDC sign-in (`oidc-sign-in.spec.ts`), using `FakeThicketBridge.emit` on `BROADCAST_STREAMS.oidcPrompt` and fake timers with a fixed clock:
- Service: initial empty state; browser prompt stored as is; other streams / non-data events ignored; device prompt gets `expiresAt`; browser → device fallback with the same promptId replaces it; a repeated prompt shown once; several sign-ins show the latest, hiding it shows the previous; `finished` removes and records ok/failed; `finished` for unknown or hidden sign-ins records nothing; `finished` of one leaves others; a new prompt clears the note; device code expires exactly at `expiresInSeconds`; hide clears its timer; a replacing device prompt does not expire on the old timer; a browser prompt replacing a device prompt cancels the expiry; destroy unsubscribes and clears timers.
- Panel: nothing shown initially; browser panel (profile name, non-modal dialog role, Copy link → clipboard, "Link copied"); device panel (code, verification page, "10 minutes", Copy code / Copy link); `verificationUriComplete` used for Copy link; refused clipboard shows the alert and claims nothing; browser → device fallback replaces the content and resets the "copied" state; Hide (browser and device) hides without a note, also when `finished` arrives later; "Signed in" note disappears after 4 s; a second "Signed in" note gets its own full 4 s; a failed note stays until Close; a new prompt replaces the note; countdown in minutes (rounded up) from 120 s, seconds below, panel gone at expiry with no interval left; no countdown/timer for the browser flow; no timer left after destroy.

App shell (`app-shell.spec.ts`): `app-oidc-sign-in` is mounted; with a sign-in shown nothing is inert and Ctrl+W still closes a tab; while the SSH host-key modal is open the panel host is inert, and not after it closes.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: component tests for each mechanism's fields and URI sync (LDAP/PLAIN) | editor "M5" block (parent): "LDAP: user name and password ...", "LDAP needs a user name", "LDAP from the connection string ..."; model: "LDAP (PLAIN) round trip" (4), applyConnectionString "PLAIN: ...", editorProblems "LDAP needs a user name, OIDC does not" | `cd packages/renderer && npx ng test --coverage ...` (full renderer suite, 85 files) | Pass |
| AC1: OIDC fields and URI sync | editor "OIDC: optional user name, sign-in flow and trusted endpoint", "OIDC settings of a saved profile ..."; model "OIDC round trip" (6), applyConnectionString "OIDC: ..." (2) | same | Pass |
| AC1: AWS IAM fields and URI sync | editor "AWS: ..." (5) and "switching to or from AWS ..."; model "AWS IAM round trip" (7), applyConnectionString "AWS: ..." (8 incl. SCRAM/AWS switches), editorProblems "AWS without an access key ID ...", mechanism helpers (5) | same | Pass |
| AC1 (assumption): OIDC sign-in state panel fed by `oidc.prompt` | `oidc-sign-in.spec.ts` (32), app-shell "hosts the OIDC sign-in panel ..." | `npx ng test --include src/app/connections/oidc-sign-in.spec.ts` and full renderer suite | Pass |
| AC1 (assumption): secrets (AWS secret, session token) never in string or draft | model "a typed secret access key appears nowhere ...", "AWS: a session token in a pasted string is dropped ...", "a saved AWS profile with a session token ..." | full renderer suite | Pass |
| AC2: e2e LDAP profile connects against the fixture | `test/e2e/ldap.e2e.ts` "an LDAP profile: created in the editor, tested, saved and connected" | `npm run test:e2e -- ldap.e2e.ts` (Podman fixture, Playwright, real build path) | Pass (1 passed, 7.4 s), run by test-writer at 2026-11-17T03:52Z |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/connections/oidc-sign-in.spec.ts --include src/app/connections/connection-form.model.spec.ts`
and `cd packages/renderer && npx ng test --include src/app/layout/app-shell.spec.ts`

Result:

Pass (2 files, 160 tests; app-shell 55 tests). One new test initially failed because of a mistake in
the test itself (the `finished()` helper always used the first profile name); the test was
corrected, not the production code.

## Full test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include=... (six files, see Coverage)`;
`npm run lint`; `npm run typecheck -w packages/renderer`

Result:

Pass: renderer 85 files / 2738 tests passed; lint (eslint --max-warnings 0 + prettier --check) passed;
typecheck (ngc + tsc spec config) passed.

## .taskcheck

Result:

Pass: `sh .taskcheck` (`npm run check`: lint, typecheck, tests) at 2026-11-17T03:52:31Z to 03:54:18Z,
root projects 73 files / 4038 tests passed, renderer 85 files / 2738 tests passed.

## Bugs found

None. No production defect was found against the acceptance criteria or the recorded assumptions.

Observation for the parent (not a requirement violation, no failing test kept):
`packages/renderer/src/app/connections/oidc-sign-in.ts:142` renders "The code expires in 1 seconds."
for the last second of a device code (plural for 1). Cosmetic, Low; the tests deliberately assert
2 seconds so they do not encode this wording.

## Coverage

Status: verified (whole-file coverage of the six task-changed TypeScript production files; changed-line coverage measured separately).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured. Method: added lines from `git diff -U0 384a448 HEAD` for the six
files intersected with lcov `DA` records (executable, source-mapped lines only; removed lines not
counted); branches counted from lcov `BRDA` records located on added lines (an approximation
of changed-branch coverage, reported separately). Result: lines 177/177 (100%); branch records on
changed lines 163/165 (98.79%), uncovered at `oidc-sign-in.ts:139` and `oidc-sign-in.ts:169` (see table).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: auth-ui-m5; base 384a448fa59547d3354caf30d43b3d18da210f3f (given by the parent, = task merge-base); HEAD 043e9e6026daede4a61a662621972beca0d2ea87; task code commits b5b55b2, 043e9e6 (`git log 384a448..HEAD`, other commits only `tasks/`); file scope from `git diff --stat 384a448 HEAD -- packages test`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 043e9e6 plus uncommitted test files, sha256: `connection-form.model.spec.ts` 6f8a5f65308023460d9520d5bb04df81a3c27e0ba3a3e4bb49f99f171910b277, `oidc-sign-in.spec.ts` d5c0c08f5b85c3bbd91d715bc7bc9fa59a3ddd777849f7cc5059f122a815e99d, `app-shell.spec.ts` de62f10ccba3db0b1594432263dc2b3eaf74304352ab1309468aca620c70c5fe. Production files unchanged from HEAD (e.g. `connection-form.model.ts` 53ca159f..., `oidc-sign-in.ts` e3499355..., `oidc-sign-in.service.ts` 1a705454...).
- Exact included files: `src/app/connections/connection-form.model.ts`, `src/app/connections/connection-editor.ts`, `src/app/connections/oidc-sign-in.service.ts`, `src/app/connections/oidc-sign-in.ts`, `src/app/api/api.service.ts`, `src/app/layout/app-shell.ts` (paths relative to `packages/renderer`). Excluded: `connection-editor.html` (Angular template, not instrumented by v8; its behavior is exercised by the editor component tests), `oidc-sign-in.css` (styles, not executable), `connection-editor.spec.ts` and `test/e2e/ldap.e2e.ts` (tests). No renames or deletions in scope.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0 via the Angular builder; `npx ng test --coverage --coverage-include='src/app/connections/connection-form.model.ts' --coverage-include='src/app/connections/connection-editor.ts' --coverage-include='src/app/connections/oidc-sign-in.service.ts' --coverage-include='src/app/connections/oidc-sign-in.ts' --coverage-include='src/app/api/api.service.ts' --coverage-include='src/app/layout/app-shell.ts'`; working directory `packages/renderer`; full renderer suite (85 files).
- Run start/completion time and exit status: started 2026-11-17T03:51:13Z, report written 03:51:46Z; exit status 0; 85 files / 2738 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 cc9963e714598aa04538a59d12cd69976b3eb0cf2a8e0ab73293817d3ea5af7b; `packages/renderer/coverage/renderer/lcov.info` sha256 2ba2691209770bc78c7e2acd21a0cfa5cdf9f3337b8bb9bc725c8738fb2af54d (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped 03:51:46Z, after the run start and replacing the previous run (03:49:01Z); all production and test file hashes taken at 03:50:57Z were identical after the run and after `.taskcheck`.
- Final run after latest test additions and production fixes: yes (no production fixes were made; the run includes all added tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/connections/connection-form.model.ts` | 341/343 (99.41%) | 346/351 (98.57%) | 45/45 (100%) | 278/279 (99.64%) |
| `packages/renderer/src/app/connections/connection-editor.ts` | 470/477 (98.53%) | 231/255 (90.58%) | 142/142 (100%) | 386/388 (99.48%) |
| `packages/renderer/src/app/connections/oidc-sign-in.service.ts` | 43/43 (100%) | 17/17 (100%) | 14/14 (100%) | 32/32 (100%) |
| `packages/renderer/src/app/connections/oidc-sign-in.ts` | 117/118 (99.15%) | 40/42 (95.23%) | 17/17 (100%) | 85/85 (100%) |
| `packages/renderer/src/app/api/api.service.ts` | 134/135 (99.25%) | 70/71 (98.59%) | 23/23 (100%) | 113/113 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 122/123 (99.18%) | 78/78 (100%) | 25/26 (96.15%) | 90/90 (100%) |
| Aggregate (summed counters, 6 measured files; excluded: `connection-editor.html`, `oidc-sign-in.css`) | 1227/1239 (99.03%) | 782/814 (96.06%) | 266/267 (99.62%) | 984/987 (99.69%) |

Percentages are the provider's `pct` values from `coverage-summary.json` (two decimals, truncated).

Before the last added tests (run at 03:48:23Z, same six files): model branches 345/351, `oidc-sign-in.ts` statements 116/118 and branches 39/42; the additions covered model line 437 (AWS default-chain edit) and the note-timer paths of the panel.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `oidc-sign-in.ts:139` (true branch of `expiresAt === undefined`) | Defensive: `expiry()` is only rendered in the device branch, where `expiresAt` is always set | Justified gap: not reachable through the template |
| `oidc-sign-in.ts:169` (timer fires after `last` changed) | Defensive guard; the note effect already clears the timer whenever `last` changes | Justified gap; the observable behavior (second note keeps its full time) is tested by "a second Signed in note gets its own full time" |
| `connection-editor.ts:318, 489` and 24 branch locations (222, 235, 249, 261, 292, 308, 328, 368-386, 401, 420, 488, 586, 618-626, 665, 704, 757, 769, 812) | Pre-existing lines not added by this task (changed-line coverage of the file is 31/31 lines, 35/35 branch records) | Outside the task's changed lines; not chased. Note 222 (mechanism not in the form list) is now reachable only by GSSAPI, whose model behavior is covered by the new GSSAPI test |
| `connection-form.model.ts:400-401` (non-`ConnectionStringError` message), `523`, `636` | Pre-existing lines (changed-line coverage of the file is 28/28 lines, 71/71 branch records) | Outside the task's changed lines |
| `api.service.ts:146`, `app-shell.ts` anonymous function 25 | Pre-existing; the task's change in `api.service.ts` is type-only (0 executable changed lines) and `app-shell.ts` changed only the template (1 changed executable line, covered) | Outside the task's changed lines |

## Unable to test

- Copy-to-clipboard against the real Electron clipboard: tested with a stubbed `navigator.clipboard` (success and refusal), as other renderer specs do. No follow-up needed.
- OIDC and AWS end-to-end connections against real identity providers / AWS: not part of this task's criteria (AC2 names only LDAP); the panel is tested from the broadcast contract. No follow-up for this task.
- The visual layout of the panel (CSS) is not asserted by unit tests.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

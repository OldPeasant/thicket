# Code Review

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: whole task, `git diff b739b48..a1e78d2` (tasks/ changes excluded). Commits: 8ffdd31, 82538c9, 411d3e0 (implementation and e2e), fe744c6 (test-writer tests, first review), 1ba14e5 (fixes CR-1..CR-5, TW-1), 509cfa9 (re-review and re-test reports, tests), a367adb (fix CR-6), a1e78d2 (tests and test report for CR-6). This final review read the whole task's code and focused on what changed since the previous review (`509cfa9..a1e78d2`).

Reviewed revision: a1e78d240796d94f84bdfd6b77772bfbe9a12d7d

Requirements:
- tasks/profiles-import-export.md (acceptance criteria and the three recorded assumptions)
- SPEC.md ("Import connections from Compass (exported JSON file) and from a list of connection strings; export profiles as JSON without secrets")
- docs/ARCHITECTURE.md (profiles store, secrets storage, import/export module, layout routes, connection editor)
- AGENTS.md (project notes: no secrets in renderer, logs or committed fixtures)
- reviews/profiles-import-export/fixes.md (claimed fixes, each checked against the code)
- Parent instructions (verify CR-1..CR-6; review the final code)

Git range:
- Branch: main
- HEAD: a1e78d240796d94f84bdfd6b77772bfbe9a12d7d
- Base/start: b739b48d188a45b25e68023ffc6cc61f3479e17e
- Commits reviewed: 8
- Uncommitted changes: none at the start of the review

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Evidence I checked myself:
- I read the full production files `apps/desktop/src/profiles/import/{compass,uri,export,handlers,index}.ts`, the renderer page `import-export-page.{ts,html}`, the wiring in `apps/desktop/src/main/{handlers,index}.ts`, the contract change in `packages/contract/src/profiles.ts`, the routes, the ARCHITECTURE.md changes, the fixtures, and the e2e test `test/e2e/profiles-import.e2e.ts`.
- I read the diff `509cfa9..a1e78d2`. The production changes are `compass.ts`, `handlers.ts` and the page's hint text. The other changes are specs and reports.
- `cd apps/desktop && npx vitest run src/profiles src/main`: 6 files, 200 tests passed.
- I checked how the backend uses each secret kind (`packages/backend/src/ssh/tunnel.ts`, `connections/options.ts`, `auth/aws/aws.ts`) and how the sidebar asks for the password (`SidebarTreeService.asksPassword`: `secretMode === 'ask'`). The new notice wording matches this behavior.
- I did not run `npm run check` or the e2e suite myself. `tests.md` reports `npm run test:e2e -- profiles-import` as 1 passed, and `fixes.md` reports `npm run check` as passing after CR-6.
- `python tasks.py verify profiles-import-export` shows no criterion recorded yet. Recording evidence is the parent worker's next step, and no criterion is claimed without evidence.

## Disposition of earlier findings

- [x] **CR-1 (P2, Security) | Thicket-format import stored secret URI options: Resolved.** `parseThicket` (`compass.ts:235-279`) passes each connection string through `stripUriSecrets` (`uri.ts:314-322`). The removed values are dropped (`secrets: []`), and a notice names the removed options. A URI that can't be parsed is skipped, and the message does not contain the password.
- [x] **CR-2 (P3) | `saved` kept without a stored secret: Resolved.** `compass.ts:275` turns `saved` into `ask`.
- [x] **CR-3 (P3) | Secret-save failures not logged: Resolved.** `MainHandlerDeps.log` (`main/handlers.ts:28-29`) is forwarded to the import, and `main/index.ts:171` passes it with a `profiles:` prefix. A test checks that the log does not contain the password.
- [x] **CR-4 (P3) | Stale architecture note and unused `PlannedPage`: Resolved.** The file is deleted and nothing references it. ARCHITECTURE.md documents the module, the export format, the route and the page.
- [x] **CR-5 (P3, Tests) | Untested handler paths: Resolved.** Tests cover the size limit, the read-only store, and a Thicket file through `profiles.importCompass`.
- [x] **TW-1 | `colorOf` resolved inherited keys: Resolved.** `compass.ts:95` uses `Object.hasOwn`.
- [x] **CR-6 (P3) | Notices told users to enter non-password secrets "when connecting": Resolved.** `secretAdvice` (`compass.ts:123-133`) now picks the advice by secret kind:
    - `password`: asked when connecting. This matches the sidebar's `secretMode: 'ask'` prompt.
    - SSH, client key and proxy secrets: entered in the connection editor.
    - Other kinds, such as the AWS session token: can't be entered in Thicket.

  The weak-keychain notice (`handlers.ts:93-99`), the save-failure notice (`handlers.ts:120-123`) and the Thicket stripped-options notice (`compass.ts:266-273`) all use it. The Compass encrypted-credentials notice (`compass.ts:196-204`) and the page hint (`import-export-page.html:194-199`) use matching wording. Tests check the exact wording, the combined advice, and that the old phrase "enter it when connecting" is gone.

## Acceptance criteria

1. Unit tests with Compass export fixtures: met. The hand-written fixtures `fixtures/compass-plain.json` and `compass-encrypted.json` are exercised in `import.spec.ts`. The source is recorded with `assume` in the task file. Every secret in the fixtures is an obviously fake value.
2. Export file contains no password, passphrase or token: met. `exportFile` strips the URI secrets and turns `saved` into `ask`. The unit test `exportFile > contains no password, passphrase or token (grep of the output)` greps the output for each fake value and for secret-named keys. The e2e test greps the real exported file too.
3. e2e: import, then the profiles appear in the sidebar: the test exists and asserts the profiles in `tree-conn` and a working connection. `tests.md` reports it as run and passed. The parent still needs to record this with `verify`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. CR-1..CR-6 and TW-1 are resolved at a1e78d2, and I verified each fix in the code and with the focused unit tests (200 passed). The implementation meets the acceptance criteria, SPEC.md and docs/ARCHITECTURE.md. The parent worker still has to record the criterion evidence with `tasks.py verify`.

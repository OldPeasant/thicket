# Code Review

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: `git diff 759d4d6..HEAD` (tasks/ changes excluded), re-review after fixes. Commits: cf3696e, 19e5210 and b048e55 (implementation), 715df6d (test-writer tests), 38344fc (fixes for CR-1..CR-5 and TW-1). The re-review focused on `715df6d..38344fc`.

Reviewed revision: 38344fc39df87eac14ae6104047028ea58c1fa4f

Requirements:
- tasks/profiles-import-export.md (acceptance criteria and recorded assumptions)
- SPEC.md ("Import connections from Compass (exported JSON file) and from a list of connection strings; export profiles as JSON without secrets", `profiles.*` method list)
- docs/ARCHITECTURE.md (Profiles store, secrets storage, main window layout, connection editor)
- AGENTS.md (project notes: no secrets in renderer, logs or committed fixtures)
- Parent instructions (secret handling, file handling in main, contract/handler/renderer conventions)
- reviews/profiles-import-export/fixes.md (claimed fixes, each checked against the code)

Git range:
- Branch: main
- HEAD: 38344fc39df87eac14ae6104047028ea58c1fa4f
- Base/start: 759d4d63be8ab2bdb90c5924083099dae40bec14
- Commits reviewed: 5

Summary: 0 P0, 0 P1, 0 P2, 1 P3 (open). CR-1..CR-5 from the first review are resolved.

Evidence I checked myself:
- I read the full fix diff `715df6d..38344fc`.
- 715df6d changes only spec files and review reports; it has no production code.
- `npx vitest run apps/desktop/src/profiles apps/desktop/src/main`: 6 files, 191 tests passed.
- `git grep PlannedPage|planned-page` in packages, apps and docs finds nothing.
- I did not re-run `npm run check` or the e2e suite. The fixer reports that `npm run check` passed.

## Disposition of the first-review findings

- [x] **CR-1 (P2, Security) | Thicket-format import stores secret URI options in connections.json: Resolved.** `parseThicket` (`apps/desktop/src/profiles/import/compass.ts:217-238`) now passes every entry's connection string through the new `stripUriSecrets` (`apps/desktop/src/profiles/import/uri.ts:116-130`). That function reuses `takeSecrets`, so the Compass and URI paths use the same rules. The removed values are dropped, never stored (`secrets: []`), and a notice names the removed options. A URI that can't be parsed is skipped, and the error message never contains the password. A URI without secrets is returned byte-identical, so re-import deduplication still works. Tests cover the parse level (all three options, grep of the output) and the handler level, including the stored profile.
- [x] **CR-2 (P3) | `secretMode: 'saved'` kept without a stored secret: Resolved.** `compass.ts:237` turns `saved` into `ask`; `none` and `ask` are kept. Tested.
- [x] **CR-3 (P3) | Import secret-save failures not logged: Resolved.** `MainHandlerDeps.log` (`apps/desktop/src/main/handlers.ts:28-29`) is forwarded to `importExportHandlers`. `index.ts:171` passes the main logger with a `profiles:` prefix. A test checks that the failure is logged and that the log contains no password.
- [x] **CR-4 (P3) | Stale architecture note and unused `PlannedPage`: Resolved.** `planned-page.ts` is deleted and nothing references it any more. ARCHITECTURE.md now documents the import/export module, the export format, the `@thicket/core/uri` dependency, the route and `ImportExportPage`.
- [x] **CR-5 (P3, Tests) | Untested handler paths: Resolved.** The test-writer's tests cover the size limit and the read-only store via `importUris`. The new handler test covers a Thicket file through `profiles.importCompass`: invalid entry skipped, secret stripped with a notice, `saved` becoming `ask`, no secret stored, and `UNSUPPORTED` for a read-only store.
- [x] **TW-1 (from tests.md) | `colorOf` resolved inherited keys: Resolved.** `compass.ts:95` now looks keys up only through `Object.hasOwn`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | Import notices say "enter it when connecting" for secrets that are never asked for at connect time**
    - File: `apps/desktop/src/profiles/import/compass.ts:233` (new Thicket notice), `apps/desktop/src/profiles/import/handlers.ts:101-106` and `handlers.ts:130-133` (keychain-not-secure and save-failed notices)
    - Category: Correctness
    - Problem: The notices name proxy passwords, client key passphrases, AWS session tokens and SSH secrets, and tell the user to "enter it when connecting". The sidebar prompt only handles the main password with `secretMode: 'ask'`. A profile with a proxy user and no stored `proxyPassword` fails instead: `packages/backend/src/connections/options.ts:136-140` throws `AUTH_FAILED` "No password for proxy user ...: save it in the profile". These secrets can only be entered in the connection editor (`connection-editor.html:471`, `:690`).
    - Why it matters: For these kinds of secret, the notice tells the user to do something the app does not support. The user then hits an authentication error instead of seeing a prompt.
    - Suggested fix: When the removed or dropped secrets include anything other than the main password, word the notice differently, for example "enter it in the connection editor". Alternatively, use one neutral wording for all of them ("not imported; enter it in the connection editor or when asked").

## Review conclusion

No material issues found. All findings from the first review (CR-1..CR-5) and TW-1 are fixed at 38344fc, and I verified each fix in the code and with tests. The only open item, CR-6, is a low-priority wording issue in user notices. It does not block completing the task.

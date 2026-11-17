# Code Review

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: `git diff 759d4d6..HEAD` (tasks/ changes excluded): commits cf3696e, 19e5210, b048e55

Requirements:
- tasks/profiles-import-export.md (acceptance criteria and recorded assumptions)
- SPEC.md ("Import connections from Compass (exported JSON file) and from a list of connection strings; export profiles as JSON without secrets", `profiles.*` method list)
- docs/ARCHITECTURE.md (Profiles store, secrets storage, main window layout, connection editor)
- AGENTS.md (project notes: no secrets in renderer, logs or committed fixtures)
- Parent instructions (secret handling, file handling in main, contract/handler/renderer conventions)

Git range:
- Branch: main
- HEAD: b048e552a760c7ba813844b2a438830621fb9807
- Base/start: 759d4d63be8ab2bdb90c5924083099dae40bec14
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 1 P2, 4 P3

Evidence that was checked: all changed source files were read in full. `npx vitest run apps/desktop/src/profiles/import` passed (18 tests). `python tasks.py verify profiles-import-export` lists all three criteria as still unverified. Recording that evidence is up to the parent worker, so this report does not count it as a finding.

What was confirmed:
- Compass and URI imports take the userinfo password, `proxyPassword`, `tlsCertificateKeyFilePassword`, `AWS_SESSION_TOKEN` and the SSH password or passphrase out of the URI and store them as secrets.
- Secrets are saved to `secrets.bin` only when the keychain is `secure`. In every other case they are dropped with a notice.
- Export drops ids, turns `saved` into `ask` and removes secrets from the URI again.
- File paths are chosen only through native dialogs in main. The renderer never sends a path.
- Notices name URI entries by their masked URI.
- The contract change (optional `notices`) is backward compatible.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Thicket-format import stores secret URI options in connections.json**
    - File: `apps/desktop/src/profiles/import/compass.ts:183-205`
    - Category: Security
    - Problem: `parseThicket` checks each entry only with `profileDraft.safeParse` and passes the draft on unchanged with `secrets: []`. The contract's `hasPassword` checks only the userinfo. So a shared or hand-edited "Thicket Connections" file whose `connectionString` contains `proxyPassword=...`, `tlsCertificateKeyFilePassword=...` or `authMechanismProperties=AWS_SESSION_TOKEN:...` is saved as-is to `connections.json` through `profiles.save`, and the profile list sends it to the renderer. The Compass and URI paths strip exactly these options (`takeSecrets` in `uri.ts`), and `exportFile` strips them on the way out. The import side of the shared format is the only path without this protection.
    - Why it matters: The task and the architecture require that no secret reaches `connections.json` or the renderer. Files in this format are explicitly meant to be shared within a team (recorded assumption), so this is untrusted input. Because the Compass path removes these options, a user would expect the Thicket path to do the same.
    - Suggested fix: Clean each Thicket entry's `connectionString` the way the other paths do. Either pass it through `uriWithoutSecrets`, or reuse `takeSecrets` and return the values as `ImportedSecret`s so `saveEntries` stores them under the keychain rules. Add a notice when a secret is dropped. Add a unit test that imports a Thicket file with such options and checks that the saved profile has none of them.

## P3 Low

- [ ] **CR-2 | Thicket import keeps `secretMode: 'saved'` without any stored secret**
    - File: `apps/desktop/src/profiles/import/compass.ts:203-205`
    - Category: Correctness
    - Problem: A Thicket-format entry with `auth.secretMode: 'saved'` is imported unchanged, but the import never stores a secret for it. Files written by `exportFile` always use `ask`, so this only happens with hand-written files or files from another version. The resulting profile says its password is saved when none is. The sidebar shows a password prompt only for `ask`, so connecting fails authentication and the user is not asked for the password.
    - Suggested fix: In `parseThicket`, change `saved` to `ask`, as `exportFile` does.

- [ ] **CR-3 | Failures to save imported secrets are never logged in the app**
    - File: `apps/desktop/src/main/handlers.ts:38-42` (with `apps/desktop/src/profiles/import/handlers.ts:81`)
    - Category: Quality
    - Problem: `importExportHandlers` accepts a `log`, which `saveEntries` uses when `secrets.set` fails. `mainHandlers` never passes one, so in production `log` falls back to a no-op. The other main stores do receive the `[main]` logger (`index.ts:94,106`).
    - Suggested fix: Add `log` to `MainHandlerDeps` (or pass the main logger in) and forward it, for example with a `profiles import:` prefix.

- [ ] **CR-4 | Stale architecture note and unused `PlannedPage`**
    - File: `docs/ARCHITECTURE.md:387-388`, `packages/renderer/src/app/layout/planned-page.ts`
    - Category: Quality
    - Problem: ARCHITECTURE.md still says `NAV.importCompass` leads to "a `PlannedPage` placeholder that profiles-import-export replaces". That route now goes to `ImportExportPage`, and `PlannedPage` is no longer used anywhere: its last route and its spec were removed. The Profiles section also does not mention the new `src/profiles/import` module, its file format, or the new `@thicket/core` dependency of the desktop app.
    - Suggested fix: Update the layout and Profiles sections of ARCHITECTURE.md. Delete `planned-page.ts` (and its export, if any), or note why it is kept.

- [ ] **CR-5 | Untested handler paths: Thicket file through the handler, oversized file, read-only store**
    - File: `apps/desktop/src/profiles/import/import.spec.ts:330-432`
    - Category: Tests
    - Problem: The handler tests cover only Compass files and URI lists. Three error-mapping branches are untested: the size limit (`MAX_IMPORT_FILE_BYTES` returns `INVALID_PARAMS`), `ProfilesReadOnlyError` returning `UNSUPPORTED`, and a Thicket-format file read through `profiles.importCompass`, including entries skipped because they fail validation. Thicket files are tested only as a direct `parseImportFile` round trip.
    - Suggested fix: Add focused handler tests for these three cases. The CR-1 test can share the Thicket-file setup.

## Review conclusion

Material issues found; fix before completing the task. CR-1 must be fixed: one import path still lets secrets reach connections.json. The P3 items are small cleanups.

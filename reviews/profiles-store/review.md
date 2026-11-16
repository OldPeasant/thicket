# Code Review

Date: 2026-11-16

Task: profiles-store - M1: Connection profiles store (connections.json)

Scope: first pass `git diff 28a9e75dec84fc123e5df40b33588064274b81cb..1255a4d` (commits dd88233, 1255a4d; `tasks/` assume commits ignored); second pass `git diff 1255a4d..38f8b82` (commits 8381359, 38f8b82) plus the final `apps/desktop/src/profiles/store.ts` as a whole; third pass `git diff 38f8b82 30ff843 -- apps/desktop/src/main apps/desktop/src/profiles` (merge 51e51c5 of main with app-settings, commit 30ff843), limited to the task's own lines

Requirements:
- tasks/profiles-store.md acceptance criteria and the three recorded assumptions
- SPEC.md (Connections: secrets only via safeStorage, "ask for password each time"; data on disk: connections.json versioned with migrations, secrets.bin keyed by profile id)
- docs/ARCHITECTURE.md "Electron shell" Secrets and Profiles bullets
- docs/QUALITY.md (report contract)
- packages/contract/src/profiles.ts (profile schema, `hasPassword`, profiles.* methods)
- apps/desktop/src/secrets/{store.ts,handlers.ts} (SecretsStore integration)
- origin/wip/app-settings `apps/desktop/src/settings/store.ts` (reference atomic-write pattern)

Git range:
- Branch: main
- HEAD: 30ff843 for the code (working tree at ac52434, whose later commits change only `tasks/`); first pass 1255a4d, second pass 38f8b82
- Base/start: 28a9e75dec84fc123e5df40b33588064274b81cb
- Commits reviewed: 6 (dd88233, 1255a4d, 8381359, 38f8b82, the task-side resolution of merge 51e51c5, 30ff843)

Summary: 0 P0, 0 P1, 0 P2, 4 P3 (CR-1..CR-3 fixed in 8381359; CR-4 accepted by the parent worker; no new findings in the third pass)

Commands run:
- First pass, at 1255a4d: `npx vitest run src/profiles src/main/handlers.spec.ts` (in apps/desktop) -> 2 files, 66 tests passed
- Second pass, at 38f8b82 (clean working tree): `npx vitest run src/profiles src/main/handlers.spec.ts` (in apps/desktop) -> 2 files, 71 tests passed
- Third pass, at ac52434 (code identical to 30ff843, clean working tree): `npx vitest run src/profiles src/main` (in apps/desktop) -> 5 files, 119 tests passed
- Third pass: `git diff --stat 38f8b82 30ff843 -- apps/desktop/src/profiles` -> empty; `git diff 51e51c5^2 30ff843 -- apps/desktop/src/main/handlers.ts apps/desktop/src/main/index.ts apps/desktop/src/main/window.ts` -> only the task's profiles lines differ from main's side

Criteria check (still true at 30ff843):
- AC1 (CRUD, duplicate drops secrets, v0 fixture migration): implemented in `ProfilesStore` and covered by `store.spec.ts` ("creates, lists, gets, updates and deletes", "duplicate copies everything but the id, name and secrets", "migrates the v0 fixture, moving passwords into secrets.bin").
- AC2 (password only in secrets.bin): `profile` schema refuses passwords in `connectionString`; test "a saved profile with a password writes it only to secrets.bin" reads connections.json and secrets.bin (raw and decrypted).
- AC3 (atomic writes as in app-settings): same temp file + `flush: true` + rename + stale-temp removal as `SettingsStore`; tests trace the call order, simulate a crash before rename and a leftover temp file.
- Error mapping: `ProfileNotFoundError` -> `NOT_FOUND`, `ProfilesReadOnlyError` -> `UNSUPPORTED`, other errors pass through to the RPC layer (`INTERNAL`); `profiles.setSecret` is overridden by the gated version in `mainHandlers` (profiles spread after secrets).
- Concurrency: every store operation, including the lazy load and migration, runs through one promise queue; a failed operation does not block the queue; in-memory state changes only after a successful rename.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [x] **CR-1 | Retried v0 migration orphans passwords of id-less entries in secrets.bin** (fixed in 8381359)
    - File: `apps/desktop/src/profiles/store.ts:118` (first-pass line)
    - Category: Correctness
    - Problem: `migrateV0` assigned `newId()` (a random UUID in production) to v0 entries without an `id`, and `load()` moves their passwords into secrets.bin before rewriting the file. If the rewrite failed, the next operation migrated again with a different id, so the password stored under the first id belonged to no profile and was never removed.
    - Why it matters: an encrypted copy of a password stays in secrets.bin indefinitely with no way for the user to clear it.
    - Suggested fix: derive a deterministic id for id-less v0 entries, and add a test with an id-less entry and a failing rename.

- [x] **CR-2 | Any secrets.bin error during migration permanently discards the migrated password** (fixed in 8381359; see CR-4 for the remaining locked case)
    - File: `apps/desktop/src/profiles/store.ts:382-395` (first-pass lines)
    - Category: Correctness
    - Problem: every error from `secrets.set` during migration, including transient write failures such as EACCES or ENOSPC, switched the profile to `secretMode: 'ask'` and the v0 file was then overwritten without the password.
    - Why it matters: avoidable loss of user data.
    - Suggested fix: fall back to `ask` only for `SecretStorageUnavailableError`; rethrow other errors so the migration is retried with the v0 file intact.

- [x] **CR-3 | ARCHITECTURE.md Secrets bullet still says the profiles store applies defaultSecretMode** (fixed in 8381359)
    - File: `docs/ARCHITECTURE.md:129-131` (Secrets bullet)
    - Category: Quality
    - Problem: the Secrets bullet said the profiles store uses `status().defaultSecretMode` for new profiles; the implementation leaves that to the renderer form (recorded assumption).
    - Why it matters: a later connection-form task could rely on main enforcing the weak-keychain default.
    - Suggested fix: document that the renderer form takes `defaultSecretMode` from `profiles.secretStorage`.

- [x] **CR-4 | A secrets.bin that is only locked for the session still makes migration discard the password** (accepted by the parent worker, see third pass)
    - File: `apps/desktop/src/profiles/store.ts:400-407`
    - Category: Correctness
    - Problem: the CR-2 fix treats every `SecretStorageUnavailableError` as permanent. `SecretsStore` also throws that class with `LOCKED_MESSAGE` (`apps/desktop/src/secrets/store.ts:74-76, 217`) when secrets.bin was encrypted with an OS keyring that "is not available now; saved secrets cannot be read or changed until it is available again", which by its own wording is a temporary state. In that session the migration switches the profile to `ask` and overwrites the v0 file, so the password is lost although the next session with the keyring could have stored it.
    - Why it matters: the remaining case of the CR-2 data loss; narrow (needs a v0 file, a keyring-encrypted secrets.bin and a session without the keyring at the same time) and the password can be re-entered, hence P3.
    - Suggested fix: distinguish the locked case (e.g. a separate error class or a `locked` flag on the error, or check `status()`) and rethrow it so the v0 file is kept for a later session, or record the current behavior as an assumption.

Second pass (38f8b82):
- CR-1 fixed: `v0Id` (`store.ts:120`) derives a `v0-` id (first 32 hex characters of a SHA-256) from the entry index and the entry with its password removed from `uri`, so a retry (also after a restart) gives the same id, identical entries at different positions get different ids, and the id does not depend on the password. `migrate()` no longer takes `newId`; `newId` is still used for new and duplicated profiles. Covered by "a retried migration gives an id-less entry the same id, so no secret is orphaned" and "the id of an id-less v0 entry does not depend on its password". A collision with an explicit id in the same file would hit the existing duplicate-id check (file moved aside, never silently merged).
- CR-2 fixed: `store.ts:400` rethrows every error other than `SecretStorageUnavailableError`, so the load fails, the v0 file stays and the next operation retries; re-setting a secret that already moved is idempotent. Covered by "a secrets.bin write error other than unavailable keeps the v0 file and retries", "only the profile whose password secrets.bin refuses as unavailable switches to ask" and "a non-unavailable error on a later secret keeps the v0 file; the retry moves all". Residual locked case reported as CR-4.
- CR-3 fixed: the Secrets bullet now says the store never rewrites `secretMode` and the renderer form takes `defaultSecretMode` from `profiles.secretStorage`; the Profiles bullet describes the unavailable-only fallback and the deterministic v0 ids, matching the code.
- Final `store.ts` read as a whole: the new import of `SecretStorageUnavailableError` from `../secrets` adds no import cycle (secrets imports only the contract and Node modules); the save/delete/duplicate/write/load paths are unchanged from the first pass. Updated tests replace the fixed `id-1` expectations with the `v0-` pattern and do not weaken other assertions. No new findings besides CR-4.

Third pass (30ff843):
- Profiles code unchanged: `git diff --stat 38f8b82 30ff843 -- apps/desktop/src/profiles` is empty, so the second-pass review of `store.ts`, `handlers.ts`, `index.ts`, the fixture and the tests still applies.
- Merge resolution, task lines only: compared with main's side of the merge (`51e51c5^2`), `main/handlers.ts` differs only by the `profilesHandlers` import, the optional `profiles` dependency on `MainHandlerDeps`, and building `secretsHandlers` once so the gated `profiles.setSecret` from `profilesHandlers` is spread after (and overrides) the ungated one. The `app.settings.get/set` handlers are added afterwards under different names, so they cannot replace a profiles or secrets handler. `main/index.ts` differs only by the `ProfilesStore` import, the lazy `profilesStore()` singleton and passing `profiles: profilesStore()` next to main's `settings`; `window.ts` and `broadcast.ts` are main's code with no task lines. The singleton reads `app.getPath('userData')` when the first window is created, after main's `THICKET_USER_DATA` override is applied at module load, so connections.json lives in the same folder as settings.json and secrets.bin.
- 30ff843 tests ("together with a settings store" in `main/handlers.spec.ts`): the first asserts that the handler names with both profiles and settings are exactly the union of the two separate sets, all main-routed contract methods, none on the privileged port; the second serves both through the real `serve` and contract table on one fake port and checks `profiles.list`, `app.settings.get` and that `profiles.setSecret` for an unknown profile still answers `NOT_FOUND` and writes nothing to disk. The settings store there is a fake, which is adequate because only coexistence is under test (the real store is covered by main's own test in the same file).
- CR-4 disposition: accepted by the parent worker. `tasks/profiles-store.md` at ac52434 has no assumption specific to the locked case; only the general wording of the first assumption ("switches to secretMode ask if secrets.bin can't take it") covers it. If the acceptance is meant to be visible to humans as a decision, record a dedicated assumption; this does not affect the code verdict.
- No new findings.

## Review conclusion

No material issues found. All three acceptance criteria are implemented and verified by tests (119 passing across src/profiles and src/main at 30ff843). CR-1..CR-3 are fixed, CR-4 (P3) is accepted, and the merge with main's app-settings work keeps the profiles handlers, the setSecret existence gate and the store wiring intact.

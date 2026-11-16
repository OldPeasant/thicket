# Code Review

Date: 2026-11-16

Task: profiles-store - M1: Connection profiles store (connections.json)

Scope: `git diff 28a9e75dec84fc123e5df40b33588064274b81cb..1255a4d` (commits dd88233, 1255a4d; `tasks/` assume commits ignored)

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
- HEAD: 1255a4d
- Base/start: 28a9e75dec84fc123e5df40b33588064274b81cb
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 0 P2, 3 P3

Commands run:
- `npx vitest run src/profiles src/main/handlers.spec.ts` (in apps/desktop) -> 2 files, 66 tests passed

Criteria check:
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

- [ ] **CR-1 | Retried v0 migration orphans passwords of id-less entries in secrets.bin**
    - File: `apps/desktop/src/profiles/store.ts:118`
    - Category: Correctness
    - Problem: `migrateV0` assigns `newId()` (a random UUID in production) to v0 entries without an `id`, and `load()` moves their passwords into secrets.bin before rewriting the file (`store.ts:382-395`). If the rewrite fails (disk full, rename error), `this.data` stays unset and the next operation migrates again, generating a different id and storing the password a second time. The password stored under the first id belongs to no profile and is never removed (profile delete only clears its own id). The test "a failed rewrite keeps the v0 file and retries" uses an entry with an explicit id, so it does not catch this.
    - Why it matters: an encrypted copy of a password stays in secrets.bin indefinitely with no way for the user to clear it, against the intent that deleting profiles removes their secrets.
    - Suggested fix: derive a deterministic id for id-less v0 entries (e.g. from the entry index plus name/uri hash), or remove the secrets already set when the migration rewrite fails; add a test with an id-less entry and a failing rename.

- [ ] **CR-2 | Any secrets.bin error during migration permanently discards the migrated password**
    - File: `apps/desktop/src/profiles/store.ts:382-395`
    - Category: Correctness
    - Problem: every error from `secrets.set` during migration (not only `SecretStorageUnavailableError`, but also a transient write failure such as EACCES or ENOSPC on secrets.bin) switches the profile to `secretMode: 'ask'` and then the v0 file is overwritten without the password. The password is gone even though the failure might have succeeded on the next start.
    - Why it matters: avoidable loss of user data (the user must find and re-enter the password). The recorded assumption covers "secrets.bin can't take it", which fits the unavailable/locked case but not transient I/O errors.
    - Suggested fix: fall back to `ask` only for `SecretStorageUnavailableError`; rethrow other errors so the load fails and the migration is retried with the v0 file intact (as already done when the connections.json rewrite fails). Alternatively record this broader behavior as an assumption.

- [ ] **CR-3 | ARCHITECTURE.md Secrets bullet still says the profiles store applies defaultSecretMode**
    - File: `docs/ARCHITECTURE.md:129-131` (Secrets bullet, "status().defaultSecretMode for new profiles")
    - Category: Quality
    - Problem: the Secrets bullet states that the profiles store uses `status().defaultSecretMode` for new profiles. The implementation does not (the recorded assumption leaves it to the renderer form via `profiles.secretStorage`), and the new Profiles bullet added in this diff does not mention it either, so the document now contradicts the code.
    - Why it matters: a later task (connection form) may rely on the documented behavior and assume main enforces the weak-keychain default required by SPEC ("default to don't save password").
    - Suggested fix: update the Secrets bullet to say the renderer form takes `defaultSecretMode` from `profiles.secretStorage` for new profiles, matching the assumption.

## Review conclusion

No material issues found. All three acceptance criteria are implemented and covered by meaningful tests; the three P3 findings are non-blocking improvements to migration robustness and documentation.

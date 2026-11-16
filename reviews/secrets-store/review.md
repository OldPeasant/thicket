# Code Review

Date: 2026-11-16

Task: secrets-store - M1: Secrets in the OS keychain via safeStorage

Scope: `git diff 516f407..d066087` (one task commit on top of the task base), committed changes only

Requirements:
- tasks/secrets-store.md acceptance criteria and recorded assumptions
- SPEC.md (secrets in `safeStorage`, `basic_text` warning and "don't save password" default, `secrets.bin` keyed by profile id, secrets never leave backend/main)
- docs/ARCHITECTURE.md (privileged port, new "Secrets" bullet)
- docs/QUALITY.md (report contract), AGENTS.md
- Electron 45.3.3 `safeStorage` typings in node_modules/electron/electron.d.ts

Git range:
- Branch: main
- HEAD: d066087
- Base/start: 516f40781da5bbfce69b7a1f897c8e25b8824aec
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Commands run (read-only):
- `npx vitest run apps/desktop/src/secrets apps/desktop/src/main/handlers.spec.ts packages/contract/src` -> 8 files, 757 tests passed

Checked without findings:
- Electron 45 async API usage (`isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync` with `shouldReEncrypt`, `getSelectedStorageBackend`, `setUsePlainTextEncryption`) matches the installed typings; the store is first constructed inside `app.whenReady()` (via `host.start()`/`createWindow()`), so the Linux backend is not read as `unknown` before ready, and `unknown` is treated as weak, never secure.
- Renderer isolation: `secrets.get` exists only in `privilegedMethods`, is not routable, and is served only on the privileged port; renderer-facing results (`secretStorage`, `setSecret`, `clearSecret`) carry no values. Both the schema walker (`packages/contract/src/no-secrets.spec.ts`) and the behavioural port test (`apps/desktop/src/secrets/no-secrets-to-renderer.spec.ts`) cover criterion 3.
- File handling: temp file created with mode 0600 then renamed; temp removed on failure; operations serialized through one queue; profile ids held in a `Map` (no prototype keys); decrypted file strictly validated; read errors other than ENOENT propagate; a valid file is not moved aside while encryption is unavailable.
- Criteria 1 and 2 have unit tests with `FakeSafeStorage` (set/get/delete, nine corruption variants, key mismatch, `basic_text` -> `weak` + `defaultSecretMode: 'ask'`).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | clearSecret reports success but removes nothing while encryption is unavailable**
    - File: `apps/desktop/src/secrets/store.ts:186` (with `load()` at `apps/desktop/src/secrets/store.ts:215`)
    - Category: Correctness
    - Problem: When `status().level` is `unavailable` (keyring locked or missing at startup), `load()` returns a fresh empty map without reading the file, so `delete()` finds no entry and returns without writing. `profiles.clearSecret` then answers `{}` (success). The secret stays in `secrets.bin`, and in a later session where the keyring works it is decrypted again and handed to the backend through `secrets.get`. The same silent no-op applies to the planned `delete(id)` on profile deletion (ARCHITECTURE "Secrets" bullet). `set()` correctly refuses with `SecretStorageUnavailableError` in this state; `delete()` does not.
    - Why it matters: a user who explicitly asks to forget a password is told it was forgotten, but it is still stored and used later. The status is cached for the whole session, so this lasts until restart.
    - Suggested fix: in `delete()`, when the level is `unavailable` and the file exists, throw `SecretStorageUnavailableError` (mapped to `UNSUPPORTED` in `clearSecret` like `setSecret`), or document and test an alternative such as recording a pending deletion. Add a unit test next to "no encryption: unavailable, set refuses, ..." that calls `delete`/`clearSecret` with an existing file and asserts the outcome.

## P3 Low

- [ ] **CR-2 | On a weak backend, a keyring-encrypted file is moved aside as "corrupt"**
    - File: `apps/desktop/src/secrets/store.ts:238`
    - Category: Correctness
    - Problem: If the app once ran with a real keyring and later starts on Linux with `basic_text` (e.g. a session without D-Bus/keyring, or `--password-store=basic`), decryption of the existing file fails and the file is renamed to `secrets.bin.corrupt-<time>`. The next `set()` creates a new `secrets.bin`, so when the keyring is available again the app reads the new file and never returns to the old secrets (they remain only in the moved-aside file, which nothing reads). This matches the recorded assumption ("encrypted with another keychain key" is treated as corrupt), so it is a deliberate choice, but in the weak case a decryption failure most likely means a key mismatch rather than corruption.
    - Why it matters: saved passwords silently become unreachable across a one-off weak session; the user must re-enter them all with only a log line as explanation.
    - Suggested fix: when the level is `weak` and decryption fails, leave the file in place (as for `unavailable`) instead of moving it aside, or let the human reviewer of the assumption confirm the current behavior; either way add a test for the chosen behavior.

## Review conclusion

Material issues found; fix before completing the task.

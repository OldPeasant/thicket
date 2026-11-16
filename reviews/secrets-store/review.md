# Code Review

Date: 2026-11-16

Task: secrets-store - M1: Secrets in the OS keychain via safeStorage

Scope: second pass over the whole task diff at the final revision, `git diff 516f407..e5b36ac -- . ':!reviews' ':!tasks'`, restricted to the task's own commits (b7fbbdb implementation, 1a34c24 tests, e5b36ac fixes for CR-1/CR-2). Other files in that range come from other tasks merged into main and are out of scope. Committed changes only; the working tree was clean.

Reviewed revision: e5b36ac5b7a0ab7f8652a5ce8c09f75b046255bd

Requirements:
- tasks/secrets-store.md acceptance criteria and recorded assumptions, including the 19:52 refinement of the move-aside assumption
- SPEC.md (secrets in `safeStorage`, `basic_text` warning and "don't save password" default, `secrets.bin` keyed by profile id, secrets never leave backend/main)
- docs/ARCHITECTURE.md ("Secrets" bullet, privileged port)
- docs/QUALITY.md (report contract), AGENTS.md
- First-pass review (CR-1, CR-2) and reviews/secrets-store/fixes.md

Git range:
- Branch: main
- HEAD: e5b36ac5b7a0ab7f8652a5ce8c09f75b046255bd
- Base/start: 516f40781da5bbfce69b7a1f897c8e25b8824aec
- Commits reviewed: 3 task code commits (b7fbbdb, 1a34c24, e5b36ac); the rest of the range is task-state commits and other tasks

Summary: 0 P0, 0 P1, 1 P2, 0 P3

Commands run (read-only):
- `npx vitest run apps/desktop/src/secrets apps/desktop/src/main/handlers.spec.ts packages/contract/src` -> 8 files, 780 tests passed

Status of first-pass findings:
- CR-1 (clearSecret reported success while encryption was unavailable): resolved. `delete()` (`apps/desktop/src/secrets/store.ts:219`) now throws `SecretStorageUnavailableError` when the level is `unavailable` and `secrets.bin` exists. It is still a no-op when there is no file. `profiles.clearSecret` maps the error to `UNSUPPORTED` (`apps/desktop/src/secrets/handlers.ts:29`). The store and handler tests cover the refusal, the unchanged file, a later read of the secret once encryption works, and the no-file no-op.
- CR-2 (keyring-encrypted file moved aside on a weak backend): resolved as written. On a `weak` backend, a decrypt failure leaves the file in place and locks the store (`store.ts:276`). Invalid content that does decrypt is still moved aside. The assumption was refined to match, and ARCHITECTURE.md was updated. The fix introduces CR-1 below.

Checked without new findings:
- The lock is set only inside `load()`, after the result is cached in `this.data`, so it lasts for the whole session and is logged once. `set` and `delete` check the lock after `load()`, and `get`/`kinds` read empty, as documented.
- Before the `fileExists()` probe, `delete()` checks whether the level is `unavailable`, so it never decrypts or moves anything aside in that state. Read errors other than ENOENT still propagate.
- The handlers still return no secret values. `secrets.get` remains privileged-only, so criterion 3's evidence is unaffected.
- The secure-backend move-aside path and the re-encryption path are unchanged apart from the refactor into `decrypted`/`parsed`. Their existing tests still pass.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | On a weak backend a genuinely corrupt secrets.bin now locks the store permanently, with no recovery in the app**
    - File: `apps/desktop/src/secrets/store.ts:276`
    - Category: Correctness
    - Problem: The fix treats every `decryptStringAsync` failure on a `weak` backend as "written with a keyring not available now". The store then locks: `set`/`delete` throw, and `setSecret`/`clearSecret` answer `UNSUPPORTED` with the message "secrets.bin was encrypted with an OS keyring that is not available now". Some failures have another cause: a file written with the `basic_text` key that was later damaged (truncated or bit-flipped on disk, partial copy during a backup restore), or any non-ciphertext bytes. On a machine that only ever has `basic_text`, such as a Linux desktop without a keyring (the configuration the Electron tests run in), the keyring never "comes back". So the store stays locked in every later session, and the user can never save a password again unless they find and delete `secrets.bin` by hand. The error message also points them at the wrong cause. Before the fix, criterion 1 ("file corruption handled") was met on every level by moving the file aside. Now it is met only on `secure` backends and for files that decrypt but hold invalid content. The new tests (`store.spec.ts:183`, `handlers.spec.ts:122`) cover only the keyring-ciphertext case. No test covers corrupt bytes on a weak backend.
    - Why it matters: A one-off file corruption becomes a permanent loss of the "save password" feature on weak-backend Linux installations. The app shows a misleading explanation and offers no way out.
    - Suggested fix: Lock only when the file plausibly comes from a keyring. For example, check the ciphertext's version prefix: on Linux, Chromium's OS-crypt marks keyring-key data `v11` and hard-coded-key data `v10`. Verify this against the Electron 45 behavior before relying on it. Move anything else aside, as on a secure backend. Alternatively, keep the lock but give `set` an explicit recovery path that moves the locked file aside (for example, a confirmed "reset saved secrets" action). Either way, add a weak-backend test with corrupt, non-keyring bytes, and update the assumption and the ARCHITECTURE "Secrets" bullet to describe the chosen behavior.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

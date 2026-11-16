# Fix Report

Date: 2026-11-16

Task: secrets-store - M1: Secrets in the OS keychain via safeStorage

Scope: current task; findings CR-1 and CR-2 from `reviews/secrets-store/review.md`, using the approach the parent worker approved

## Fixed findings

### CR-1 — clearSecret reported success but removed nothing while encryption was unavailable

Files changed:
- `apps/desktop/src/secrets/store.ts`
- `apps/desktop/src/secrets/handlers.ts`
- `apps/desktop/src/secrets/store.spec.ts`
- `apps/desktop/src/secrets/handlers.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
With `level: 'unavailable'`, `load()` returned an empty map without reading the file. `delete()` then found nothing and returned, so `profiles.clearSecret` answered `{}` while the secret stayed in `secrets.bin`. A later session would serve that secret again.

Fix:
When the level is `unavailable`, `delete()` now checks whether `secrets.bin` exists. If it does, it throws `SecretStorageUnavailableError`. If it doesn't, nothing happens. Read errors other than ENOENT are passed on. `profiles.clearSecret` maps `SecretStorageUnavailableError` to `RpcError('UNSUPPORTED')`, the same way `setSecret` does. The existing test-writer test "while encryption is unavailable, delete leaves an existing file untouched" now expects the rejection. It still checks that the file is unchanged, and it now also checks that the secret can be read again once encryption works. New tests:
- the store's "delete without a file is a no-op" case;
- handlers.spec "profiles.clearSecret without encryption fails with UNSUPPORTED when a file exists".

Validation:
- `npx vitest run --project desktop --project contract` — Pass (12 files, 851 tests)

### CR-2 — On a weak backend, a keyring-encrypted file was moved aside as "corrupt"

Files changed:
- `apps/desktop/src/secrets/store.ts`
- `apps/desktop/src/secrets/store.spec.ts`
- `apps/desktop/src/secrets/handlers.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
Every decryption failure moved the file aside. On a `weak` backend (Linux `basic_text`/`unknown`), a decryption failure most likely means the file was written with a real keyring that this session can't reach. Moving it aside made those secrets unreachable once the keyring came back.

Fix:
`load()` now keeps two cases apart: the file can't be decrypted, or it decrypts but the content is invalid.
- Decryption fails on a `weak` backend: the file stays in place and the store is locked for the session. `get()` returns `null` and `kinds()` returns `[]`. `set()` and `delete()` throw `SecretStorageUnavailableError` with a message saying secrets.bin was encrypted with an OS keyring that is not available now, and the handlers turn that into `UNSUPPORTED`. The lock is logged once, because the load result is cached.
- Decryption fails on a `secure` backend: the file is still moved aside, as before.
- The file decrypts but the content is invalid: it is moved aside on any level, as before.

`SecretStorageUnavailableError` now takes an optional message; its default message is unchanged. I updated the class doc comment and the "Secrets" bullet in `docs/ARCHITECTURE.md`. New tests:
- weak backend with an undecryptable file: the file is byte-for-byte unchanged and still the only file, reads are empty, `set`/`delete` are refused with the keyring message, and the lock is logged exactly once with no "moved aside" message;
- weak backend with a file that decrypts but is invalid: the file is still moved aside;
- handlers.spec: `clearSecret` on a weak backend with an undecryptable file returns `UNSUPPORTED`.

The existing secure-backend test is now named "a file from another keychain key (decrypt throws) on a secure backend is moved aside".

Validation:
- `npx vitest run --project desktop --project contract` — Pass (12 files, 851 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run --project desktop --project contract` — Pass (12 files, 851 tests)
- `npm run test:electron` — Pass (3 files, 17 tests)

Full test suite:
- `npm run check` (eslint --max-warnings 0, prettier --check, tsc for all workspaces, vitest 16 files / 885 tests, renderer ng test 5 files / 181 tests) — Pass

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, which passed as shown above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

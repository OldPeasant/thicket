# Code Review

Date: 2026-11-16

Task: secrets-store - M1: Secrets in the OS keychain via safeStorage

Scope: third pass over the task's code at the final revision, `git diff 516f407..f4b5bd2 -- apps packages docs`, restricted to the task's own commits:
- 32980b6 implementation
- 495019c tests
- 293ff55 first fixes
- 01d5d3e second-pass tests
- 4ca6a19 fix for the second-pass P2
- f4b5bd2 third-pass tests

Other commits in that range belong to other tasks merged into main and are out of scope. The production code was reviewed at 4ca6a19. f4b5bd2 changes only tests: `apps/desktop/src/secrets/store.spec.ts`, +35 lines, plus the report files. That delta (`git diff 4ca6a19..f4b5bd2 -- apps`) was reviewed separately and has no findings. Only committed changes were reviewed. The only uncommitted change in the working tree is a task-state edit to `tasks/secrets-store.md`, which is out of scope.

Reviewed revision: f4b5bd2a015581ed583967c052140bf7ea4f669e

Requirements:
- tasks/secrets-store.md acceptance criteria and recorded assumptions, including the 19:52 lock refinement and the 19:56 `v11`/`v10` prefix assumption
- SPEC.md: secrets in `safeStorage`, the `basic_text` warning and "don't save password" default, `secrets.bin` keyed by profile id, secrets never leave backend/main
- docs/ARCHITECTURE.md: the "Secrets" bullet and the privileged port
- docs/QUALITY.md (report contract), AGENTS.md
- Earlier review passes (first pass CR-1, CR-2; second pass CR-1)

Git range:
- Branch: main
- HEAD: f4b5bd2a015581ed583967c052140bf7ea4f669e
- Base/start: 516f40781da5bbfce69b7a1f897c8e25b8824aec
- Commits reviewed: 6 task commits that change code or tests (32980b6, 495019c, 293ff55, 01d5d3e, 4ca6a19, f4b5bd2). The rest of the range is task-state commits and other tasks.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Commands run (read-only):
- `npx vitest run apps/desktop/src/secrets apps/desktop/src/main/handlers.spec.ts` at 4ca6a19 plus the then-uncommitted spec edit -> 4 files, 78 tests passed
- `npx vitest run apps/desktop/src/secrets` at f4b5bd2 (clean code tree) -> 3 files, 79 tests passed

Status of the second-pass finding:
- Second-pass CR-1 (on a weak backend, any decrypt failure locked the store permanently): resolved.
    - `load()` now locks only when all three hold: decryption fails, the file starts with the `v11` keyring prefix, and the level is `weak` (`apps/desktop/src/secrets/store.ts:288`; `isKeyringCiphertext` at `store.ts:85`).
    - Any other undecryptable file is moved aside to a timestamped `secrets.bin.corrupt-...` file and the store starts empty, as on a secure backend. This covers garbage bytes, a damaged `v10` basic_text file and plaintext. Criterion 1 ("file corruption handled") therefore holds again on weak backends.
    - Committed tests cover these cases:
        - `store.spec.ts:211`: garbage, `v10-truncated` and plain JSON are moved aside, not locked, and a later `set` persists across a reopen.
        - `store.spec.ts:183` and `handlers.spec.ts:122`: the `v11` lock.
        - `apps/desktop/test/secrets.electron.spec.ts:68` (real Electron): basic_text writes `v10`, which is the premise the check relies on.
    - The FakeSafeStorage now writes `v10` or `v11` prefixes depending on the backend, so its files match the real format.
    - The assumption and the ARCHITECTURE "Secrets" bullet describe the new behavior accurately.

Test-only delta 4ca6a19..f4b5bd2 (reviewed, no findings):
- `store.spec.ts:225` checks that the keyring prefix must be exactly `v11` at offset 0. On a weak backend, these files are moved aside, are not locked, log no keyring message, and saving works afterwards:
    - an empty file;
    - a file shorter than the prefix (`v1`);
    - `V11`;
    - `v11` not at the start;
    - `v12`.
  This matches `isKeyringCiphertext` exactly.
- `store.spec.ts:242` checks that a bare `v11` file on basic_text, and a `v11` file on the `unknown` backend (also weak by `WEAK_LINUX_BACKENDS`), lock the store. In both cases reads are empty, `set` is refused with `SecretStorageUnavailableError`, and the file is left byte-for-byte in place.
- The tests assert observable behavior: the folder contents, the file bytes, the errors and the log. They do not test implementation details.
- No existing test was removed or weakened.
- `FakeSafeStorageOptions.backend` is typed `string`, so the mixed-type `it.each` rows type-check.

Checked without new findings:
- Residual risk accepted by the recorded 19:56 assumption: while no keyring is reachable, a corrupt `v11` file looks the same as a healthy keyring file. Such a file still locks the store on a weak backend. This is inherent to the design and documented, not a defect of the fix. The meaning of `v11` comes from Chromium source and can't be verified here without a keyring; the assumption says so.
- The prefix check runs only after a decrypt failure at the `weak` level, which is reported only on Linux. macOS and Windows also use the `v10` prefix in os_crypt, but they never reach this check.
- For empty or short files, the check compares a zero-length subarray without error, so those files are moved aside.
- The fix leaves these unchanged:
    - secure-backend move-aside;
    - the `unavailable` refusal for `delete`/`set`;
    - re-encryption;
    - operation serialization;
    - the handlers' `UNSUPPORTED` mapping.
- Handlers still return no secret values, and `secrets.get` remains privileged-only (criterion 3).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

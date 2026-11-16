# Code Review

Date: 2026-11-16

Task: secrets-store - M1: Secrets in the OS keychain via safeStorage

Scope: third pass over the task's code at the final revision, `git diff 516f407..4ca6a19 -- apps packages docs`, restricted to the task's own commits (32980b6 implementation, 495019c tests, 293ff55 first fixes, 01d5d3e second-pass tests, 4ca6a19 fix for the second-pass P2). Other commits in that range belong to other tasks merged into main and are out of scope. Committed changes only. At review time the working tree had an uncommitted edit to `apps/desktop/src/secrets/store.spec.ts` (+32 lines of extra prefix edge-case tests, apparently from the concurrent test-writer pass). It was not reviewed as part of the revision.

Reviewed revision: 4ca6a194051c7731c2a1fc22ddd5a4ff2853b00b

Requirements:
- tasks/secrets-store.md acceptance criteria and recorded assumptions, including the 19:52 lock refinement and the 19:56 `v11`/`v10` prefix assumption
- SPEC.md (secrets in `safeStorage`, `basic_text` warning and "don't save password" default, `secrets.bin` keyed by profile id, secrets never leave backend/main)
- docs/ARCHITECTURE.md ("Secrets" bullet, privileged port)
- docs/QUALITY.md (report contract), AGENTS.md
- Earlier review passes (first pass CR-1, CR-2; second pass CR-1)

Git range:
- Branch: main
- HEAD: 4ca6a194051c7731c2a1fc22ddd5a4ff2853b00b
- Base/start: 516f40781da5bbfce69b7a1f897c8e25b8824aec
- Commits reviewed: 5 task code commits (32980b6, 495019c, 293ff55, 01d5d3e, 4ca6a19). The rest of the range is task-state commits and other tasks.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Commands run (read-only):
- `npx vitest run apps/desktop/src/secrets apps/desktop/src/main/handlers.spec.ts` -> 4 files, 78 tests passed (this run includes the uncommitted spec edit)

Status of the second-pass finding:
- Second-pass CR-1 (on a weak backend any decrypt failure locked the store permanently): resolved. `load()` now locks only when decryption fails, the file starts with the `v11` keyring prefix and the level is `weak` (`apps/desktop/src/secrets/store.ts:288`, `isKeyringCiphertext` at `store.ts:85`). Any other undecryptable file is moved aside to a timestamped `secrets.bin.corrupt-...` file and the store starts empty, as it does on a secure backend. This includes garbage bytes, a damaged `v10` basic_text file and plaintext. So criterion 1 ("file corruption handled") again holds on weak backends. Committed tests cover these cases. `store.spec.ts:211` checks that garbage, `v10-truncated` and plain JSON are moved aside, not locked, and that a later `set` persists across a reopen. `store.spec.ts:183` and `handlers.spec.ts:122` still cover the `v11` lock. The real-Electron test (`apps/desktop/test/secrets.electron.spec.ts:68`) asserts that basic_text writes `v10`, which guards the premise the check relies on. The FakeSafeStorage now writes `v10`/`v11` prefixes by backend, so its files match the real format. The assumption and the ARCHITECTURE "Secrets" bullet describe the new behavior accurately.

Checked without new findings:
- Residual risk accepted by the recorded 19:56 assumption: a `v11` file that is itself corrupt cannot be told apart from a healthy keyring file while no keyring is reachable, so it still locks the store on a weak backend. This is inherent to the design and documented, not a defect of the fix. The `v11` meaning comes from Chromium source and is not verifiable here without a keyring, which the assumption states.
- The prefix check is reached only after a decrypt failure on a `weak` level. The weak level is only ever reported on Linux, so platforms whose os_crypt also uses `v10` (macOS, Windows) are unaffected.
- The check compares a zero-length subarray for empty or short files without error, so those files are moved aside.
- Secure-backend move-aside, the `unavailable` refusal for `delete`/`set`, re-encryption, operation serialization and the handlers' `UNSUPPORTED` mapping are unchanged by the fix. Handlers still return no secret values, and `secrets.get` remains privileged-only (criterion 3).

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

# Code Review

Date: 2026-11-17

Task: ssh-keygen-flake - Flaky ssh2 ed25519 test host keys (~0.35% unparseable)

Scope: `git diff 527d89b1..590b3f4f` (committed changes only; working tree clean)

Requirements:
- `tasks/ssh-keygen-flake.md` acceptance criteria and the recorded assumption (helper in `packages/backend/src/ssh/testing.ts`, also used by `test/integration/fixtures/ssh.ts` and `test/e2e/demo/ssh-x509.ts`)
- `AGENTS.md` project notes (no secrets in fixtures)
- Parent worker instructions and recorded evidence
- Existing conventions (`packages/backend/src/server/testing.ts` as test-only helper precedent; root `tsconfig.json` type-checks `test/integration` and `test/e2e`)

Git range:
- Branch: main
- HEAD: 590b3f4f3d968e0ee3c1deb53862d3898028b7e1
- Base/start: 527d89b1
- Commits reviewed: 3 (fddd04fd assumption record, 25c040ea implementation, 590b3f4f helper tests + test-writer report)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review notes

- Criterion 1: `generateTestKeyPair` (`packages/backend/src/ssh/testing.ts`) retries `ssh2.utils.generateKeyPairSync('ed25519', options)` until `ssh2.utils.parseKey` accepts the private half (with the passphrase when one is given) and the public half, and throws after 100 attempts. With a ~1/300 failure rate per attempt, exhausting 100 attempts is practically impossible, and failure would be loud rather than flaky. `git grep generateKeyPair` shows every ed25519 generation in specs, integration fixtures and the e2e demo fixture now goes through the helper. The only other ssh2 generator call left is an ecdsa key at `test/integration/ssh.int.spec.ts:289`, which the task does not cover (the flaw only affects ed25519).
- Default `ssh2` import keeps the helper loadable under Node's ESM loader (used by the Playwright e2e fixture). The `.ts`-suffixed imports in `test/integration/fixtures/ssh.ts` and `test/e2e/demo/ssh-x509.ts` follow the existing style in those files. The root `tsconfig.json` type-checks both.
- No production module imports `ssh/testing.ts`. It follows the `server/testing.ts` precedent. Production SSH code is unchanged.
- Tests (`packages/backend/src/ssh/testing.spec.ts`): they cover the plain, encrypted and comment paths, retries on a real unparseable ssh2 key (found at test time and checked to be the 31-byte public-key case), a bad public half only, and a wrong passphrase, plus the 100-attempt limit. Mocks spy on the same `ssh2.utils` object the helper calls through, so the retry tests exercise the real control flow. The passphrases and comments are fictitious. No keys are committed.
- Criterion 2 evidence named by the parent (`npm run check` passed; a 5000-iteration helper loop produced 0 unparseable keys; the integration SSH spec passed 15 tests) matches the criterion's wording. Before `done`, the parent must record that evidence with `tasks.py verify`.

## Review conclusion

No material issues found.

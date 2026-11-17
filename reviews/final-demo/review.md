# Code Review

Date: 2026-11-17

Task: final-demo - Release: full demo script end to end

Scope: second review pass on the final code. Range 91218ed8e8f0b763fd2ff7dd6cc545d995ee3ced (merge-base with origin/main) .. 287f9b85f151283db7c0a7e98b8fa3892fdfdfa9 (HEAD), `git diff 91218ed..HEAD -- ':!reviews'`. These are committed changes only, and the working tree was clean at the start. Since the first pass, the test-writer added a fixture test in `test/integration/fixtures.int.spec.ts` (commit 59266c1). The fixer then changed `test/e2e/demo/demo.e2e.ts` for CR-1, CR-2 and TW-1 (commit 8348a54), and the screenshots were regenerated (commit 287f9b8).

Requirements:
- tasks/final-demo.md acceptance criteria: (1) `npm run test:e2e -- demo` passes against the AppImage; (2) screenshots of every step in Business light and Tron dark are committed under reviews/final-demo/
- SPEC.md section 2 (demo script, steps 1-11)
- docs/ARCHITECTURE.md (e2e harness), AGENTS.md project notes (no committed secrets; keys generated at test time), docs/QUALITY.md (report contract)
- Parent instructions: verify the CR-1 and CR-2 fixes, check the new integration test, and report only validated findings
- First review (CR-1, CR-2), reviews/final-demo/fixes.md, reviews/final-demo/tests.md

Git range:
- Branch: main
- HEAD: 287f9b85f151283db7c0a7e98b8fa3892fdfdfa9
- Base/start: 91218ed8e8f0b763fd2ff7dd6cc545d995ee3ced
- Commits reviewed: 7 (8baa8d8, c39ca5f, fb2b298, 7dd35af, 59266c1, 8348a54, 287f9b8)

Commands run (read-only):
- `git log --oneline 91218ed..HEAD` -> 7 commits
- `git diff --stat 91218ed..HEAD -- ':!reviews'` -> 8 files, +959/-8: test/e2e/demo/{demo.e2e.ts,ssh-x509.ts}, test/e2e/harness/{app.ts,fixtures.ts}, test/integration/fixtures.int.spec.ts, test/integration/fixtures/{mongo,socks,ssh}.ts. There are no production source changes.
- `git diff 59266c1..8348a54 -- test` -> the fixer's diff, limited to demo.e2e.ts
- `git show 59266c1 -- test/integration/fixtures.int.spec.ts` -> the new parameterised fixture test
- Read the context: demo.e2e.ts imports, `beforeAll`/`afterAll`, `shot()`, the test header; the `stop()` implementation in ssh-x509.ts; `FIXTURE_NAMES`/`FIXTURE_SPECS` in test/integration/fixtures/mongo.ts
- `git diff --stat 7dd35af..287f9b8 -- reviews` -> the screenshots were regenerated in both themes
- Viewed reviews/final-demo/tron-dark/step-02-production.png (the checked "Production" option is now visible) and tron-dark/step-10-ssh-x509-form.png (the SSH tunnel section is visible, and the URI preview contains no password)
- I did not re-run the e2e or integration suites. The parent recorded `npm run dist` (AppImage OK) and then `npm run test:e2e -- demo` -> AppImage mtime 2026-11-17T04:56:49.217Z logged, 2 passed. The test-writer recorded `npx vitest run --config test/integration/vitest.config.ts fixtures.int.spec.ts ssh.int.spec.ts proxy.int.spec.ts` -> 36 passed and `npm run check` -> pass.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Disposition of earlier findings

- CR-1 (P3, Tron dark step-02 screenshot did not show the Production checkbox): **resolved**. `shot(window, name, scrollTo?)` now calls `scrollTo.scrollIntoViewIfNeeded()` after each `setTheme`, before that theme's screenshot (demo.e2e.ts:237-246). Step 2 passes the Production checkbox (line 345) and step 10 passes `field-ssh` (line 646). The old one-time scroll calls are gone. The regenerated tron-dark/step-02-production.png shows "Production" checked with its description.
- CR-2 (P3, stale AppImage could go unnoticed; a failed fixture start leaked the other fixture): **resolved**. (a) The test logs and annotates the AppImage path and mtime after the skip checks (lines 296-300), so the AppImage is known to exist when `statSync` runs. The parent's run shows the logged mtime. (b) `beforeAll` uses `Promise.allSettled` (lines 128-143). On any rejection it stops whichever fixture started, with its own `allSettled` so that a failing stop cannot mask the original error, and then rethrows the first rejection. `server`/`bastion` are assigned only when both start, so `afterAll` does not double-stop. If `seed()` fails afterwards, `afterAll` still stops both, because they are already assigned.

## Verification notes (no finding)

- New integration test (`fixtures.int.spec.ts:37-54`): for each of the 5 fixtures, the 8.x fixtures must report `getParameter tcmallocEnableBackgroundThread` = `false`, and the 7.0 fixtures' `getCmdLineOpts` argv must not contain the parameter. It uses the existing `client()` helper, so the `afterEach` closes the client, and it passes TLS options for the TLS fixtures. The check matches the `MONGOD_8_ARGS` change in fixtures/mongo.ts and fails fast if that change regresses. It asserts behavior (the server's runtime parameter), not implementation.
- Everything noted in the first pass still holds: AppImage only with no dev fallback (`app.isPackaged` asserted); each step from 2 to 11 asserts its observable result; passwords, the PKI and the SSH key are generated at run time into a mkdtemp folder that `stop()` deletes; there are no fixed sleeps except the theme-settle delay in `shot()`.
- No secrets in the diff or in the inspected screenshots. The URI preview in step 10 contains only certificate file paths under /tmp, and the step-02 password stays masked.
- Criterion 2: 22 screenshots per theme are committed with matching names. The parent regenerated them from the AppImage rebuilt at HEAD.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. The fixes for CR-1 and CR-2 are correct and introduce no new issues. The new fixture integration test is sound and checks the task's mongod 8.x fixture change.

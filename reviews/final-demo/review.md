# Code Review

Date: 2026-11-17

Task: final-demo - Release: full demo script end to end

Scope: the four task commits on top of main. The parent's range was 2c3fefc..a751b3d. During the review the branch was rebased onto main, so the same commits now sit on merge-base d6a2fda (commits 1b98fdd, 4527cd3, c6949e6, 1b29213). The code diff is unchanged: the same 7 files and +921/-8 lines, excluding `reviews/`. I reviewed the committed changes only. One uncommitted working-tree change exists (`test/integration/fixtures.int.spec.ts`, +19, probably from the test-writer). It was not part of this review.

Requirements:
- tasks/final-demo.md acceptance criteria (1) `npm run test:e2e -- demo` passes against the AppImage, (2) screenshots of every step in Business light and Tron dark under reviews/final-demo/
- SPEC.md section 2 (demo script, steps 1-11) and section 3 (sidebar counts and sizes "on demand")
- docs/ARCHITECTURE.md (status bar, e2e harness), AGENTS.md project notes (no committed secrets, keys generated at test time)
- Parent instructions (AppImage only with no dev fallback, flaky waits, secrets in fixtures and screenshots, fixture safety for integration tests)

Git range:
- Branch: main
- HEAD: 1b29213fdb446d26007422986482d7438a258540
- Base/start: d6a2fdab5cfd18b8fec3a1734e60888620ba7e76 (merge-base with origin/main; the parent supplied 2c3fefc before the rebase)
- Commits reviewed: 4

Commands run (read-only):
- `git log --oneline 2c3fefc..HEAD`, `git merge-base HEAD origin/main` -> rebased; 4 task commits on d6a2fda
- `git diff d6a2fda..HEAD -- ':!reviews'` -> 7 files: test/e2e/demo/{demo.e2e.ts,ssh-x509.ts}, test/e2e/harness/{app.ts,fixtures.ts}, test/integration/fixtures/{mongo,socks,ssh}.ts
- Read every changed file in full, plus playwright.config.ts, package.json `test:e2e`, test/integration/fixtures/mongo.ts, packages/renderer/src/app/layout/status-bar.ts and status.service.ts
- `ls reviews/final-demo/*` -> 22 PNGs in each of business-light/ and tron-dark/ (step-01 to step-11)
- Inspected these screenshots: business-light step-02-form-filled, step-02-production, step-03-sidebar, step-10-ssh-x509-form; tron-dark step-02-production, step-05-document, step-06-production-confirm, step-07-conflict, step-08-export-node, step-10-ssh-x509-form, step-11-shell
- `grep -rn "MONGO_IMAGES\["` -> every mongo 8 container in the integration and e2e fixtures (fixtures/mongo.ts, socks.ts, ssh.ts, demo/ssh-x509.ts) now gets MONGOD_8_ARGS; the Enterprise 8.0 images (ldap.ts, oidc.ts) are unchanged
- I did not re-run the e2e suite: it needs the AppImage build and containers, and the parent recorded that run

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Verification notes (no finding)

- AppImage only: `findAppImage()` uses `$THICKET_APPIMAGE`, otherwise the newest `apps/desktop/release/*.AppImage`. Without one the test is skipped and never falls back to the dev build. `launchApp` drops `appDir` from the args when `executable` is set. Step 1 asserts `app.isPackaged === true` and a `thicket://app/` URL, so a dev-build run would fail.
- Every step from 2 to 11 asserts the behavior the spec describes, not just a screenshot:
  - Step 2: form fields after the paste, a masked password, no password in `uri-preview`, `connections.json` or `secrets.bin` (plain text), Production checked, test connection, connected state.
  - Step 3: stats `40 000 docs, …` through `menu-stats`, which matches SPEC section 3 "counts and sizes on demand", and the production class.
  - Step 4: 50 rows, page 3 = 101-150, filter and sort checked in the raw output, exact count equal to the driver's count.
  - Step 5: ObjectId, Date and Decimal128 badges; nested pager 1-100 and 101-200 of 2,000.
  - Step 6: "2 changes", a confirm dialog with `$set` and both fields, and the server value checked with the driver.
  - Step 7: a driver update, then a conflict view with local and server values side by side, and the server value unchanged.
  - Step 8: three stages, a preview per stage, Run results equal to the driver's aggregate, shell and Node export, no password in the code.
  - Step 9: COLLSCAN, then index creation behind the production confirm, then IXSCAN on `status_1_total_1`.
  - Step 10: X.509 URI fields, SSH key-file settings persisted, host-key dialog, connected through the tunnel, the fleet collection listed and read.
  - Step 11: `db.orders.countDocuments()` equals the driver's count.
- Secrets: the demo user password and the X.509 fixture's root password come from `randomBytes` at run time. The PKI and the ed25519 SSH key are generated per run into a mkdtemp folder (mode 0600), which `stop()` deletes. In the inspected screenshots, the password field shows dots and the URI preview shows `****`. The Node export shows the URI with the user name only. I found no secrets in the committed files.
- Waits: `waitForTimeout(400)` appears only in `shot()` to settle the theme switch before a screenshot, and no assertion depends on it. Step 11 waits for `shell-running` to clear before the second input. The other waits are web-first `expect` polls.
- Fixture change: `MONGOD_8_ARGS` is added only for `spec.version === '8'`, and `MONGO_IMAGES['8']` is mongo:8.2, which supports `tcmallocEnableBackgroundThread`. 7.0 and the Enterprise 8.0 fixtures are untouched. The change is safe for the other integration tests.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Tron dark screenshot of step 2 does not show the Production checkbox**
    - File: `test/e2e/demo/demo.e2e.ts:324` (with `shot()` at `test/e2e/demo/demo.e2e.ts:222`)
    - Category: Tests
    - Problem: The test calls `production.scrollIntoViewIfNeeded()` once, in Business light, before `shot()`. `shot()` then switches to Tron dark, whose larger type makes the form taller. In `reviews/final-demo/tron-dark/step-02-production.png` the view ends at "Read-only" and the checked "Production" option is below the fold. The Business light copy shows it correctly. The same pattern can hide the subject of any shot that relies on a scroll position (it is also used for step 10, where the Tron shot is still fine).
    - Why it matters: Criterion 2 asks for screenshots of every step in both themes. For the "mark production" part of step 2, the Tron dark evidence does not show what the step is about. Step 3's shot does show the production accent in Tron, which is why this is only P3.
    - Suggested fix: Let `shot()` take an optional locator and call `scrollIntoViewIfNeeded()` on it after each `setTheme`. Then regenerate the step-02-production pair.

- [ ] **CR-2 | A stale AppImage, or a failed fixture start, can go unnoticed**
    - File: `test/e2e/demo/demo.e2e.ts:78-95` and `test/e2e/demo/demo.e2e.ts:128-131`
    - Category: Quality
    - Problem: (a) `npm run test:e2e` rebuilds the renderer and desktop dev bundles, but the demo test runs the newest `release/*.AppImage` by mtime and does not check that it was built from the current sources. A run after code changes without `npm run dist` passes or fails against old code, and nothing says so. (b) `[server, bastion] = await Promise.all([...])`: if one fixture rejects, the other one that started is never assigned. `afterAll` therefore cannot stop it, and under Podman (`TESTCONTAINERS_RYUK_DISABLED=true`, set at line 127) its containers and network are left running.
    - Why it matters: (a) weakens criterion 1 as repeatable evidence: the command in the header comment only works if the user remembers `npm run dist`. (b) leaks containers on a fixture failure, which makes later runs slower or less reliable.
    - Suggested fix: (a) Log the AppImage path and mtime in the test output, or fail or warn when the AppImage is older than `apps/desktop/dist/main.cjs` or the renderer build. (b) Use `Promise.allSettled` and assign whichever fixtures started, as `startSshX509Fixture` already does internally, so `afterAll` stops them.

## Review conclusion

No material issues found. The suite runs the packaged AppImage without a dev fallback and checks the observable result of every demo step from 2 to 11. Test credentials and keys are generated at run time, and the change to the mongo 8.x fixtures is safe for the other integration tests. The two P3 findings are optional improvements to the evidence quality and to test robustness.

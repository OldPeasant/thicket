# Code Review

Date: 2026-11-17

Task: packaged-hardening - Harden the packaged app: Electron fuses (RunAsNode, NODE_OPTIONS, asar-only), ignore THICKET_DEV_SERVER/THICKET_RENDERER_DIR when packaged

Scope: second round, final code at d11e7a1. The whole task diff `git diff c74ea81..d11e7a1 -- . ':!package-lock.json'` was inspected. That range also contains other tasks merged from main (schema-analysis, raw-cmd-read-pref, other task files). Those changes are outside this task's scope and were not reviewed. In scope are the task commits ca33e962 (implementation), 8ce242e6 (test-writer tests and first-round reports; this is the rebased form of the f5cb02b tests the parent mentioned) and d11e7a1 (fixes for CR-1/CR-2). Files in scope: `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, `apps/desktop/scripts/smoke-packaged.mjs`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/renderer-source.ts`, `apps/desktop/src/main/renderer-source.spec.ts`, `apps/desktop/src/packaging.spec.ts`, `docs/ARCHITECTURE.md` (Packaging paragraph), and the `@electron/fuses` devDependency entry in `package-lock.json`.

Requirements:
- tasks/packaged-hardening.md (acceptance criteria and recorded assumptions, including the CR-2 remote-debugging-port assumption)
- reviews/packaging/review.md CR-3 (origin)
- SPEC.md / docs/ARCHITECTURE.md (Electron shell, Packaging)
- AGENTS.md (Evidence, quality gate)
- reviews/packaged-hardening/review.md (round 1) and fixes.md

Git range:
- Branch: main
- HEAD: d11e7a1a (reviewed revision d11e7a1)
- Base/start: c74ea8166f401f147ac6917a4a7a5ec65cbc789d
- Commits reviewed: 3 task code commits (ca33e962, 8ce242e6, d11e7a1a); the remaining commits in the range are tasks.py bookkeeping or other tasks merged from main
- Uncommitted changes: none

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Verification of round-1 findings

- CR-1 (smoke page race): fixed. `smoke-packaged.mjs:171-173` now takes the app's first page (`context.pages()[0]`, otherwise `waitForEvent('page')`), waits with `page.waitForURL((url) => url.protocol !== 'about:')` and only then runs `waitForLoadState('load')`, the pings and the URL assertion. A target that is still on about:blank at attach time is now selected and waited on. The pings can no longer run on the blank document. An env-override regression (for example a load from `http://127.0.0.1:9`) still leaves about:, so it reaches the unchanged `thicket://app/` URL check and is reported with the wrong URL rather than as a bare timeout. The fixer reports a passing smoke run and a failing negative control after the change.
- CR-2 (remote-debugging-port undocumented): fixed. The `electronFuses` comment in `electron-builder.yml:37-40` and the Packaging paragraph in `docs/ARCHITECTURE.md` state that `--remote-debugging-port` is not fuse-controlled, is still accepted by packaged builds, allows driving the renderer including `thicket.request`, is an accepted residual risk, and could be refused in a follow-up. The matching assumption is recorded in tasks/packaged-hardening.md (06:17), so humans can review it.

## Verification notes (whole task at d11e7a1)

- AC1 (fuses): `electron-builder.yml` sets `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true` and `enableEmbeddedAsarIntegrityValidation: true`. The inspect decision (off, smoke test moved to CDP) is recorded as an assumption, as the criterion asks. `packaging.spec.ts` asserts the exact fuse config and `asar !== false`. The smoke script's expected-fuse map and the fuse-wire byte decoding are unchanged since round 1, and I checked them against `@electron/fuses` then.
- AC2 (env overrides): `rendererSource` ignores the environment when `packaged` is true. `index.ts:55-61` uses it for both `rendererDir` and the CSP's `devServer`, and no other read of the two variables remains in `index.ts` (only the doc comment mentions them). Dev behaviour is unchanged.
- AC3 (dist:dir + smoke, run-as-node): the recorded evidence (smoke OK, run-as-node probe ignored, negative control with the fuses flipped back on failing) matches the code. I did not re-run the packaged binary. Bash execution of the build is outside this read-only review.
- Tests added in 8ce242e6 (`renderer-source.spec.ts`): each override is ignored separately when packaged, the packaged path does not depend on `distDir`, each dev override applies separately, a packaged `THICKET_DEV_SERVER` cannot widen the CSP `connect-src` (this uses the real `contentSecurityPolicy`), and a source-text regression guard checks that `index.ts` reads the overrides only through `rendererSource({ packaged: app.isPackaged, ...`. The guard strips comments before matching. Its `//` stripping would also cut string literals that contain `://`, but that cannot hide a `THICKET_*` identifier read, so the guard stays effective. These tests assert behaviour. The source-text guard is a deliberate structural check and is documented as such in the test.
- `THICKET_USER_DATA` is still honoured in packaged builds. The task names only `THICKET_DEV_SERVER` and `THICKET_RENDERER_DIR`, and that variable changes no loaded code, so this is not a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. Both round-1 findings (CR-1, CR-2) are resolved at d11e7a1. The acceptance criteria are implemented, and the recorded evidence matches the code.

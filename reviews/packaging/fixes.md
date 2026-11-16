# Fix Report

Date: 2026-11-16

Task: packaging - M0: electron-builder packaging for the current OS

Scope: current task; approved findings CR-1, CR-2, CR-4 from `reviews/packaging/review.md`
(base commit 4ae2ad2, task code commit 7637221, HEAD afa57fa). CR-3 deferred by the parent worker.
Changes are uncommitted in the working tree, together with the test-writer's untracked
`apps/desktop/src/packaging.spec.ts` (kept; updated where the fixes change what it asserts).

## Fixed findings

### CR-1 - macOS `identity: null` ships a modified, unsigned bundle

Files changed:
- `apps/desktop/electron-builder.yml`
- `apps/desktop/src/packaging.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`mac.identity: null` skips code signing entirely, so the bundle electron-builder modifies (renamed
executable, rewritten Info.plist, added app.asar) carries a broken Electron signature; Apple Silicon
then likely reports quarantined downloads as "damaged" instead of the bypassable Gatekeeper warning.

Fix:
`identity: '-'` (ad-hoc signing) with the existing `hardenedRuntime: false`; the comment explains why.
Verified in the installed app-builder-lib 26.18.0 source: `macPackager.js` `sign()` only takes the
skip path for `identity === null`; otherwise `MacTargetHelper.findSigningIdentity` with qualifier
`"-"` creates `new Identity("-")` (ad-hoc) when no keychain identity matches, warning only if
hardened runtime is on; `options/macOptions.d.ts` documents `"-"` as "opt in to ad-hoc signing
explicitly" and recommends `hardenedRuntime: false` with it. `dmg.sign: false` is unchanged (the
dmg container itself stays unsigned; the app inside is ad-hoc signed). The spec now asserts
`identity === '-'` and `hardenedRuntime === false`; ARCHITECTURE notes the ad-hoc signing.
Caveat for release-ci: the qualifier is matched as a substring against `security find-identity`
lines first, so on a runner whose keychain has a real identity whose line contains `-`, that
identity would be used. CI runners without imported certificates are unaffected. Signing only runs
on macOS (`isSignAllowed`), so the actual Gatekeeper behaviour cannot be verified on this Linux host.

Validation:
- `npx vitest run src/packaging.spec.ts` (in `apps/desktop`) - Pass (21 tests)
- `npm run check` (root) - Pass
- Running the ad-hoc signed dmg on macOS - Not run (no macOS here; belongs to installer-smoke / release-ci)

### CR-2 - Workspace `dist` / `dist:dir` can package a missing or stale renderer

Files changed:
- `apps/desktop/package.json`
- `package.json`
- `apps/desktop/src/packaging.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
Only the root `dist` script built `packages/renderer`; `npm run dist -w apps/desktop` and `dist:dir`
packaged whatever was in `packages/renderer/dist` (electron-builder only warns if it is missing).

Fix:
Both workspace scripts now start with `npm run build -w @thicket/renderer` (the workspace is named by
package name, which npm resolves from the root or from inside `apps/desktop`; the path form
`-w packages/renderer` fails from the workspace dir with "No workspaces found"). Root `dist` is now
just `npm run dist -w apps/desktop`, so the renderer is built once. The spec asserts the new script
prefix and the plain delegation; ARCHITECTURE mentions the delegation and documents `dist:dir`.

Validation:
- `npm run build -w @thicket/renderer` run from `apps/desktop` - Pass (bundle written to `packages/renderer/dist`)
- `npm run dist:dir -w apps/desktop` (root) - Pass; log shows `> npm run build -w @thicket/renderer && node scripts/build.mjs && electron-builder ...`, then `ng build`, then packaging to `release/linux-unpacked`
- `node scripts/smoke-packaged.mjs release/linux-unpacked/thicket release/smoke-fixer.png` (in `apps/desktop`, with a display) - Pass: `smoke: OK`, url `thicket://app/#/`, name `Thicket`, packaged `true`, window visible, mainPing `main`, backendPing `backend`
- `npx vitest run src/packaging.spec.ts` - Pass

### CR-4 - Smoke script: launch failure bypasses cleanup and diagnostics

Files changed:
- `apps/desktop/scripts/smoke-packaged.mjs`

Problem:
`_electron.launch(...)` ran before the `try`, so a launch failure was an unhandled rejection: no
`smoke: FAILED` line and the `thicket-smoke-*` temp userData dir was left behind.

Fix:
The launch and the output listeners moved inside the `try`; `app` is declared before it and the
`finally` closes it with `app?.close()`, so launch errors go through the same failure path
(error printed, `smoke: FAILED`, exit 1) and the temp dir is always removed. Listeners still attach
right after launch; Playwright's launch error already includes its call log, so the reviewer's
"early output" remark is covered for launch failures without a larger restructure.

Validation:
- `node scripts/smoke-packaged.mjs /nonexistent/thicket` (in `apps/desktop`) - prints `smoke: Error: electron.launch: Failed to launch: Error: spawn /nonexistent/thicket ENOENT` (with call log) and `smoke: FAILED`, exit 1
- Same run with `TMPDIR` pointed at an empty scratch dir under the git-ignored `release/` (throwaway helper, deleted afterwards) - `exit=1 failedLine=true leftoverTempDirs=0`
- Successful path unchanged: the linux-unpacked smoke run above - `smoke: OK`

## Not fixed

### CR-3 - Packaged app keeps default Electron fuses and dev-only env hooks

Status:
Out of scope

Reason:
Deferred by the parent worker to a follow-up task; no change made.

## Validation summary

Focused tests:
- `npx vitest run src/packaging.spec.ts` (in `apps/desktop`) - Pass, 21 tests
- `npm run dist:dir -w apps/desktop` - Pass (renderer built first, Linux unpacked app in `apps/desktop/release/linux-unpacked`)
- `node scripts/smoke-packaged.mjs release/linux-unpacked/thicket release/smoke-fixer.png` - `smoke: OK`
- `node scripts/smoke-packaged.mjs /nonexistent/thicket` - `smoke: FAILED`, exit 1, no temp dir left

Full test suite:
- `npm run check` (root: eslint, prettier, type check, vitest 35 files / 2187 tests, renderer 27 files / 437 tests) - Pass

Lint/type-check/build:
- Included in `npm run check` - Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, which passed)

Remaining unresolved findings:
1 (CR-3, deferred out of scope)

## Final status

All validated findings fixed and validation passed.

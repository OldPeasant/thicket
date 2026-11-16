# Code Review

Date: 2026-11-16

Task: packaging - M0: electron-builder packaging for the current OS

Scope: final revision 88c680395d4a146b272f5a20aba42438f63243ac, `git diff 4ae2ad2..88c6803 -- . ':!tasks' ':!reviews'` (second review round on the final code, after the fixer's changes and the test-writer's `apps/desktop/src/packaging.spec.ts`)

Requirements:
- `tasks/packaging.md` acceptance criteria and recorded assumptions
- `SPEC.md` section "Release" (unsigned installers, Gatekeeper warning), section 6 Security
- `docs/ARCHITECTURE.md` Electron shell / Packaging section
- `AGENTS.md` (task protocol, evidence rules, quality gate)
- First-round report (CR-1..CR-4), `reviews/packaging/fixes.md`, `tasks/packaged-hardening.md`
- Parent instructions for this round

Git range:
- Branch: main
- HEAD: 88c680395d4a146b272f5a20aba42438f63243ac
- Base/start: 4ae2ad2b7a439a8aab3309240ede2a5ac361fc6e
- Commits reviewed: 3 (7637221 packaging code; afa57fa tasks-only, no code; 88c6803 review fixes, config spec, reports, new task); working tree clean, no uncommitted changes reviewed

Summary: 0 P0, 0 P1, 0 P2, 1 P3 open (first-round CR-1, CR-2, CR-4 fixed; CR-3 deferred to `tasks/packaged-hardening.md`)

## Commands run (read-only)

- `git log --oneline 4ae2ad2..88c6803`, `git diff --stat ...`, `git diff 4ae2ad2..88c6803 -- . ':!tasks' ':!reviews' ':!package-lock.json' ':!apps/desktop/build/icon.png'` -> 13 files; electron-builder.yml, package.json files, smoke-packaged.mjs, make-icon.mjs, main/index.ts hunk, packaging.spec.ts, ARCHITECTURE, ignore files reviewed in full.
- electron-builder 26.18 source inspected for CR-1: `app-builder-lib/out/macPackager.js` `sign()` (lines 323-344: `identity === null` -> skip; otherwise `findSigningIdentity`), `out/mac/MacTargetHelper.js` (lines 20-51: qualifier `"-"` with no matching keychain identity -> `new Identity("-")`, ad-hoc), `out/codeSign/macCodeSign.js` `isSignAllowed` (darwin only; skipped on PR builds unless `CSC_FOR_PULL_REQUEST`).
- `npm --prefix apps/desktop exec -- vitest run --root apps/desktop src/packaging.spec.ts` -> 1 file, 21 tests passed (0.6 s).
- `npm run check` (root) -> eslint `--max-warnings 0` + prettier clean, typecheck clean, vitest 35 files / 2187 tests passed, renderer 27 files / 437 tests passed.
- `node_modules/app-builder-lib/package.json` / `builder-util/package.json` -> versions 26.18.0 / 26.16.0, no `exports` map; `electron-builder/out/index.d.ts` does not re-export `getConfig` / `validateConfiguration` (basis for CR-5).
- `ls -la apps/desktop/release` -> `linux-unpacked` rebuilt at 20:33 (after the CR-2 fix, `dist:dir`), AppImage/deb/rpm from 20:19-20:22, `smoke-fixer.png` 20:33.
- Re-running `scripts/smoke-packaged.mjs` against `release/linux-unpacked/thicket` in this round was denied by the sandbox; the packaged runtime check therefore rests on the first-round smoke run by this reviewer (`smoke: OK`) and the fixer's post-fix run recorded in `fixes.md`. Runtime-relevant code (`main/index.ts`, electron-builder file layout) is unchanged between those runs except for `mac.identity`, which does not affect Linux.

## Verification of first-round findings

- **CR-1 (P2) mac `identity: null` -> Fixed.** `apps/desktop/electron-builder.yml:52-58` now sets `identity: '-'` with `hardenedRuntime: false`; `dmg.sign: false` kept (container unsigned, app inside ad-hoc signed). Confirmed in the installed source that `'-'` reaches the ad-hoc branch when no keychain identity matches, and that `hardenedRuntime: false` avoids the library-validation warning path. The comment explains the choice. The spec asserts both values. Residual, not a finding: `findIdentity` first substring-matches `'-'` against keychain identities, so on a Mac with real certificates a matching identity may be used instead of ad-hoc, and PR builds skip signing entirely. Both concern release-ci runners, are documented in `fixes.md`, and actual Gatekeeper behaviour still needs a macOS run (criterion 3 skip, installer-smoke/release-ci).
- **CR-2 (P3) workspace `dist`/`dist:dir` stale renderer -> Fixed.** `apps/desktop/package.json:28-29` both start with `npm run build -w @thicket/renderer` (package name verified in `packages/renderer/package.json`); root `dist` delegates (`package.json:28`), so the renderer is built once. ARCHITECTURE documents delegation and `dist:dir`. Fixer's log shows `ng build` ran before packaging; the 20:33 `linux-unpacked` timestamp is consistent.
- **CR-3 (P3) Electron fuses / dev env hooks -> Deferred.** No change in this task; tracked by `tasks/packaged-hardening.md` (deps `packaging`, touches `electron-builder.yml` and `src/main`), whose criteria cover the fuses, ignoring `THICKET_DEV_SERVER`/`THICKET_RENDERER_DIR` when packaged, and keeping the Playwright smoke test working. Acceptable disposition: SPEC does not require it for M0.
- **CR-4 (P3) smoke script launch failure -> Fixed.** `apps/desktop/scripts/smoke-packaged.mjs:27-84`: `app` declared before the `try`, launch inside it, `finally` does `app?.close()` (safe when undefined: optional chain short-circuits the `.catch`) and always removes the temp userData dir; launch errors reach the `smoke: FAILED` / exit 1 path. Fixer's evidence (`/nonexistent/thicket` -> FAILED, exit 1, no leftover temp dir) matches the code.

## Checked with no finding

- `packaging.spec.ts` uses electron-builder's own loader and schema validation, so it tests the effective config rather than YAML text; assertions match the config and the criteria (app id, product name, Linux/mac/win targets and archs, icon path, asar file set, extraResources -> `resources/renderer`, native rebuild, artifact naming, package.json metadata, dist scripts, PNG validity). `crc32` from `node:zlib` is fine for the required Node `>=24.15` (`package.json` engines, `.nvmrc` 24).
- `main/index.ts` packaged renderer path, productName/userData change, Windows config, native-module story, icon generator: unchanged since round one, no finding (see first-round notes; still valid).
- No secrets, credentials or personal data in the diff; maintainer address is a noreply placeholder recorded as an assumption.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | macOS `identity: null` ships a modified, unsigned bundle; Apple Silicon users likely get "damaged" instead of a bypassable Gatekeeper warning**
    - File: `apps/desktop/electron-builder.yml:58`
    - Category: Integration
    - Problem: (round one) `identity: null` skipped signing entirely after electron-builder modified the Electron bundle.
    - Why it matters: SPEC "Release" requires usable unsigned arm64/x64 dmgs with an explainable Gatekeeper warning.
    - Suggested fix: ad-hoc signing with `identity: '-'`, `hardenedRuntime: false`.
    - Status: Fixed in 88c6803 (verified against app-builder-lib 26.18 source; macOS runtime behaviour to be verified by installer-smoke/release-ci).

## P3 Low

- [ ] **CR-5 | Config spec depends on undeclared transitive packages and an internal electron-builder path**
    - File: `apps/desktop/src/packaging.spec.ts:12-13`
    - Category: Tests
    - Problem: the spec imports `app-builder-lib/out/util/config/config.js` (an internal `out/` file, not part of the public `electron-builder`/`app-builder-lib` index) and `builder-util`, neither of which is declared in `apps/desktop/package.json`; they resolve only because npm hoists electron-builder's dependencies to the root `node_modules`. `electron-builder` is a caret range (`^26.18.0`), so a minor update that moves or renames `out/util/config/config.js` (or a dedupe change that stops hoisting) breaks `npm run check` with a module-not-found error unrelated to any behaviour change.
    - Why it matters: `npm run check` is the gate for every task; a breakage here would block unrelated agents. Low likelihood, easy to harden.
    - Suggested fix: pin `electron-builder` exactly (as electron already is) or add `app-builder-lib`/`builder-util` as devDependencies with the same versions, and keep a short comment that the import is an internal path to revisit on upgrades.

- [x] **CR-2 | Workspace `dist` / `dist:dir` can package a missing or stale renderer without failing**
    - File: `apps/desktop/package.json:28-29`
    - Category: Quality
    - Problem: (round one) only the root `dist` built the renderer.
    - Why it matters: easy to package and smoke-test the wrong renderer.
    - Suggested fix: build the renderer in the workspace scripts.
    - Status: Fixed in 88c6803.

- [ ] **CR-3 | Packaged app keeps default Electron fuses and dev-only env hooks**
    - File: `apps/desktop/electron-builder.yml` (no `electronFuses`), `apps/desktop/src/main/index.ts:49-55`
    - Category: Security
    - Problem: default fuses (`RunAsNode`, `NODE_OPTIONS`, no asar-only/integrity) and `THICKET_DEV_SERVER`/`THICKET_RENDERER_DIR` honoured in packaged builds.
    - Why it matters: defence in depth for distributed builds; not required by SPEC for M0.
    - Suggested fix: `electronFuses` and ignoring the env hooks when `app.isPackaged`.
    - Status: Deferred (accepted) to `tasks/packaged-hardening.md`; still open in the code at 88c6803.

- [x] **CR-4 | Smoke script: launch failure bypasses cleanup and diagnostics**
    - File: `apps/desktop/scripts/smoke-packaged.mjs:27-84`
    - Category: Quality
    - Problem: (round one) launch ran outside `try`, so failures skipped cleanup and the FAILED line.
    - Why it matters: the documented packaged-build check should explain its failures.
    - Suggested fix: move launch inside `try`, guard close.
    - Status: Fixed in 88c6803.

## Notes for the parent worker (not findings)

- `python tasks.py verify packaging` shows all three criteria still unrecorded; record evidence (criterion 3: skip with reason for macOS/Windows) before `done`.
- `reviews/packaging/tests.md` describes the pre-fix state (e.g. "unsigned dmg", root `dist` building the renderer); since code changed after it, the test-writer must run again on 88c6803 per AGENTS.md step 6.
- `apps/desktop/release/` contains a local Windows build (`thicket-0.0.0-win-x64.exe` of 217 KB next to a leftover `@thicketdesktop-0.0.0-x64.nsis.7z`), which looks like an incomplete NSIS build on Linux. It is git-ignored and not evidence for criterion 3; do not cite it as Windows verification.

## Review conclusion

No material issues found. The fixes for CR-1, CR-2 and CR-4 are correct and complete; CR-3 is properly deferred to `tasks/packaged-hardening.md`. The new config spec is meaningful and passes, and `npm run check` passes at 88c6803. CR-5 (P3) is an optional hardening of the spec's imports.

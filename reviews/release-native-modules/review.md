# Code Review

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: committed task change `git diff f6b1b122..574bc497` (one commit). HEAD is now f15d3456, the same commit rebased; `git diff 574bc497..f15d3456` touches only `tasks/*.md`, so the reviewed code is the same. An uncommitted change to `apps/desktop/src/build/native-addons.spec.ts` (probably test-writer work in progress) was not reviewed.

Requirements:
- tasks/release-native-modules.md (goal, 4 acceptance criteria, recorded assumptions, verify evidence)
- AGENTS.md (Evidence rules, OS-neutral code and tests)
- apps/desktop/electron-builder.yml and apps/desktop/scripts/build.mjs conventions
- node_modules sources: ssh2/lib/protocol/crypto.js, @mongodb-js/devtools-connect/dist/connect.js, system-ca/lib/impl.js, @mongodb-js/devtools-proxy-support/dist/system-ca.js; package-lock.json `hasInstallScript` entries

Git range:
- Branch: main
- HEAD: f15d3456ddc0adb51377187a8161aa15d4d88c93 (rebased copy of 574bc4978e4edf895e84284e3213bf24dd5bc015)
- Base/start: f6b1b1225b680609226e3caa422fb0f5038b2e46
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Verified as correct:
- Stubbing addons is safe for every reachable `*.node` require I could inspect. ssh2 `crypto.js:29-33` requires `sshcrypto.node` in `try {} catch {}` and falls back to Node crypto. devtools-connect `connect.js:136-149` and `:226-234` require `os-dns-native` in try/catch, so `resolveDnsHelpers` stays undefined and the driver's own SRV lookup runs. system-ca's win/macOS exporters rethrow, but devtools-proxy-support `system-ca.js:136-139` catches that and falls back to `tls.rootCertificates`.
- os-dns-native and the win/macOS exporters are not installed locally, so I could not read their sources. The contrary-evidence check rests on the recorded container build: the shell-worker contains the os-dns-native stub and the bundles build.
- Of the other `hasInstallScript` packages, kerberos, mongodb-client-encryption and cpu-features are already external. The rest are dev-only or build tools (esbuild, @parcel/watcher, lmdb, msgpackr-extract, fsevents, electron-winstaller, protobufjs).
- onResolve runs before filesystem resolution, so builds with and without a toolchain give the same output. This matches the recorded "byte-identical main/preload/backend" evidence.
- The CI `bundle` job is consistent with release.yml: same `.nvmrc` Node, the AppArmor userns sysctl, headless Ozone because ubuntu-latest has no DISPLAY, `connectOverCDP` so no Playwright browser download is needed, a 60 s smoke timeout inside a 30 min job, and `permissions: contents: read` inherited. Recorded evidence: run 44127846813 green, actionlint clean, container before/after build, smoke OK on the container-built AppImage, and the SSH e2e test passed. This covers criteria 1-4 as written.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Blanket `*.node` stub turns any future native addon into a silent runtime failure, so the new CI job no longer catches "such failures"**
    - File: `apps/desktop/src/build/native-addons.ts:33-39` (also `.github/workflows/check.yml:52-55`, `apps/desktop/scripts/build.mjs:24-27`)
    - Category: Architecture
    - Problem: `onResolve({ filter: /\.node$/ })` replaces every addon require in every bundle, with no list of known addons and no build output. If a dependency added or upgraded later requires an addon it cannot work without, or one with no JS fallback, esbuild now builds it without complaint. The stub then throws `MODULE_NOT_FOUND` at runtime, and only on the code path that loads it. The spec test "an unguarded require of an addon throws when the module is loaded, not at build time" documents this. The check.yml comment says the job "catches such failures on every push". After this change it catches only a missing toolchain, or an addon loaded during the smoke test's startup path. The safety argument "every addon the bundles reach is optional, with a JS fallback" was checked by hand for today's three packages and is not enforced.
    - Why it matters: The release failure was loud, at build time, and pointed at the exact file. The new behavior is silent and shows up only at runtime for users, for example as a feature that only fails on Windows or macOS. That contradicts the task goal of making CI catch the next such issue.
    - Suggested fix: Keep a short allowlist of the vetted optional addons (ssh2 `sshcrypto.node`, `os_dns_native.node`, plus anything reached through `bindings`, if relevant), matched on package and file name using `args.resolveDir`. Make any other `*.node` import fail the build with a message pointing to electron-builder.yml's "mark external / ship" instructions. Alternatively, at least log every omitted addon so a new one shows in the CI log. Add a spec case for an unlisted addon.

## P3 Low

- [ ] **CR-2 | Stub module identity and message use only the raw specifier**
    - File: `apps/desktop/src/build/native-addons.ts:35`
    - Category: Quality
    - Problem: `{ path: args.path, namespace: NAMESPACE }` keys the stub by the relative specifier, for example `../build/Release/binding.node`. Two packages that use the same relative path share one stub module. The error message, which is the only runtime clue logged by handlers such as devtools-connect's `missing-optional-dependency`, then does not say which package's addon was omitted.
    - Why it matters: Behavior is the same today because every stub throws. Diagnostics are weaker, and the shared identity would matter if the stub ever varied by addon (CR-1).
    - Suggested fix: Use `join(args.resolveDir, args.path)`, or the package-relative path, as the stub path and in the message.

## Review conclusion

Material issues found; fix before completing the task. CR-1 is a P2 design concern that conflicts with the task's "CI catches this" goal. The parent worker may instead record it as an accepted follow-up, using `tasks.py assume` or a new task. All four acceptance criteria are met and have recorded evidence.

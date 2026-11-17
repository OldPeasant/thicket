# Code Review

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: full task diff on the final code, `git diff f6b1b122..0f63ea94 -- . ':!tasks' ':!reviews'`. It covers 5 files: .github/workflows/check.yml, apps/desktop/electron-builder.yml, apps/desktop/scripts/build.mjs, apps/desktop/src/build/native-addons.ts and apps/desktop/src/build/native-addons.spec.ts. This re-review follows the fixer's changes for CR-1 and CR-2 from the first review. It also covers the test-writer's commit 0f63ea94, which adds two tests to native-addons.spec.ts and changes no production code (`git diff bb4a42ff..0f63ea94 -- apps` touches only the spec). The working tree is clean.

Requirements:
- tasks/release-native-modules.md: goal, 4 acceptance criteria, recorded assumptions and verify evidence
- AGENTS.md: Evidence rules, OS-neutral code and tests
- The first review (CR-1 P2, CR-2 P3), reviews/release-native-modules/fixes.md and reviews/release-native-modules/tests.md
- package-lock.json `hasInstallScript` entries and node_modules/ssh2/lib/protocol/crypto.js
- Parent evidence: a container build (node:24, compiled addons) at bb4a42ff gave DIST_EXIT=0, with stubs for ssh2 sshcrypto and for os-dns-native Release and Debug. Production code is unchanged at 0f63ea94.

Git range:
- Branch: main
- HEAD: 0f63ea94451b657937fb0eb4c48d0da9335cd7d9
- Base/start: f6b1b1225b680609226e3caa422fb0f5038b2e46
- Commits reviewed: 4 code commits (f15d3456, 9eaa96f9, bb4a42ff, 0f63ea94). The other commits in the range touch only tasks/ or reviews/.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Status of earlier findings

- [x] **CR-1 (P2) | A blanket `*.node` stub hid future addons. Resolved.**
    - `native-addons.ts:32-37` now holds an explicit `OPTIONAL_ADDONS` allow-list.
    - `onResolve` (`:99-113`) returns an esbuild error for any `.node` import that is not on the list. This includes addons outside node_modules and unlisted file names inside allow-listed packages.
    - The decision depends only on the specifier and resolveDir, not on whether the file exists. Builds with and without a toolchain therefore still give the same result.
    - Tests cover an unlisted package, an unlisted file of an allow-listed package (compiled and missing), an addon outside node_modules, and an entry-point addon with no importer.
    - The comments in check.yml and build.mjs now describe this correctly, so the "bundle" job catches a new addon at build time.
- [x] **CR-2 (P3) | Stub identity and error message. Resolved.**
    - The stub path is now `<package>/<path inside package>` (`:112`).
    - Identical relative specifiers in different packages get distinct stub modules and messages (spec "gives identical relative addon paths in different packages distinct stubs").

## Verification of the fix

- **Allow-list correctness.** The `hasInstallScript` packages in package-lock.json fall into four groups:
    - ssh2: its only `.node` literal is `crypto.js:30`, `sshcrypto.node`;
    - os-dns-native, win-export-certificate-and-key (win32) and @mongodb-js/macos-export-certificate-and-key (darwin);
    - cpu-features, kerberos and mongodb-client-encryption, which are already `external` in build.mjs;
    - dev-only build tools.

  The allow-list covers exactly the addons the bundles can reach, so no release OS should newly fail the build. The `'any'` entries for the two certificate exporters are broader than file-name matching. They are acceptable: both exporters are platform-restricted optional dependencies, they load their addon through `bindings`, and a comment says why.
- **Windows path handling.** `resolve(args.resolveDir, args.path)` returns native separators. `addonLocation` splits on `[\\/]+` and uses the innermost `node_modules`, so nested and pnpm-style layouts work. Unit tests cover paths with Windows separators.
- **Bare specifiers.** These are mapped through `node_modules/<specifier>`, so the first segment (two for a scoped name) is the package. Tested.
- **Scoped packages.** `@scope/name` is detected and must be followed by a file. This is tested for both stubbing and `addonLocation`'s undefined cases.
- **Error clarity.** The build error names:
    - the specifier;
    - the importer, or resolveDir when there is none;
    - the package, when known;
    - the file that holds the allow-list;
    - both remedies: mark the package external and ship it, or add it to the allow-list after confirming a try/catch fallback.

  The spec asserts these.
- **Observation, not a finding.** A Windows-style relative specifier such as `.\\x.node` does not start with `./` or `../`, so it is treated as bare and resolves to package `.`. The build still fails, so the case is not silent. No dependency uses such a specifier.

## The two tests added in 0f63ea94

- **"stubs an allow-listed addon required by absolute path, with its package path in the message"**
    - Exercises the `isAbsolute` branch with a `path.join`-built path, which is a drive-letter path on Windows. `tryLoadAll` embeds it through `JSON.stringify`, so backslashes are escaped correctly.
    - Asserts behaviour, not implementation: the fake addon bytes are not in the bundle, and requiring the addon throws MODULE_NOT_FOUND with the package-relative message. It reuses the shared SSH2 fixture and is OS-neutral.
- **"fails the build for an unlisted addon given as an entry point, naming the working directory"**
    - Covers the `args.importer || args.resolveDir` fallback, which was the only uncovered branch.
    - If the build unexpectedly succeeds, `error` is undefined and `toContain` fails, so the test cannot pass vacuously.
    - The expected string is built with `path.join`, so it is separator-neutral.
    - The test expects esbuild to report resolveDir exactly as passed in `absWorkingDir`, without resolving symlinks. On macOS the temp dir is under `/var`, which is a symlink to `/private/var`. I am not raising this as a finding because I have no evidence esbuild resolves it. The parent should still confirm that this test passes in the macOS and Windows `check` run for `wip/release-native-modules` before `done`, as AGENTS.md requires anyway.
- **Results.** tests.md records the focused run (`npx vitest run src/build`, 21/21 passed) and `npm run check` (vitest 5238 passed, renderer 4137 passed), both including these tests. The sandbox refused my own test run, so for results I rely on that recorded evidence.

## Acceptance criteria evidence

All four criteria have recorded, repeatable evidence:
- the container dist build before and after the fix, re-run by the parent at bb4a42ff with the same production code;
- the smoke test on the container-built AppImage and the SSH e2e test;
- the check.yml bundle job in GitHub run 44127846813, plus actionlint;
- `npm run check`.

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

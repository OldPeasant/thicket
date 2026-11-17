# Code Review

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: full task diff on the final code, `git diff f6b1b122..bb4a42ff -- . ':!tasks' ':!reviews'` (5 files: .github/workflows/check.yml, apps/desktop/electron-builder.yml, apps/desktop/scripts/build.mjs, apps/desktop/src/build/native-addons.ts, apps/desktop/src/build/native-addons.spec.ts). This is a re-review after the fixer addressed CR-1 and CR-2 from the previous review. The working tree has one uncommitted change, 27 added lines in native-addons.spec.ts: two more test cases, probably test-writer work. It is outside the committed scope and was not reviewed as part of the revision. It changes no production code.

Requirements:
- tasks/release-native-modules.md (goal, 4 acceptance criteria, recorded assumptions, verify evidence)
- AGENTS.md (Evidence rules, OS-neutral code and tests)
- Previous review (CR-1 P2, CR-2 P3) and reviews/release-native-modules/fixes.md
- package-lock.json `hasInstallScript` entries; node_modules/ssh2/lib/protocol/crypto.js
- Parent evidence: container build (node:24, compiled addons) at bb4a42ff -> DIST_EXIT=0, with stubs for ssh2 sshcrypto and os-dns-native Release/Debug

Git range:
- Branch: main
- HEAD: bb4a42ff4cec40525760c77f80b1b579a777a8cb
- Base/start: f6b1b1225b680609226e3caa422fb0f5038b2e46
- Commits reviewed: 3 code commits (f15d3456, 9eaa96f9, bb4a42ff). The other commits in the range touch only tasks/.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Status of earlier findings

- [x] **CR-1 (P2) | Blanket `*.node` stub hides future addons. Resolved.** `native-addons.ts:32-37` now has an explicit `OPTIONAL_ADDONS` allow-list. `onResolve` (`:99-113`) returns an esbuild error for any `.node` import that is not on the list, including addons outside node_modules and unlisted file names of allow-listed packages. The decision depends only on the specifier and resolveDir, not on whether the file exists, so builds with and without a toolchain still give the same result. Tests cover an unlisted package, an unlisted file of an allow-listed package (compiled and missing), and an addon outside node_modules (spec `:202-236`). The comments in check.yml and build.mjs now describe this correctly, so the "bundle" job does catch a new addon at build time.
- [x] **CR-2 (P3) | Stub identity and message. Resolved.** The stub path is `<package>/<path inside package>` (`:112`). Identical relative specifiers in different packages therefore get distinct stub modules and messages (spec `:158-185`).

## Verification of the fix

- **Allow-list correctness.** The `hasInstallScript` packages in package-lock.json that are not dev-only are: ssh2 (the only `.node` literal is `crypto.js:30`, `sshcrypto.node`), os-dns-native, win-export-certificate-and-key (win32), @mongodb-js/macos-export-certificate-and-key (darwin), plus cpu-features, kerberos and mongodb-client-encryption, which are already `external` in build.mjs. All the others are dev-only build tools. The allow-list therefore covers exactly the addons the bundles can reach, and no release OS should newly fail the build. The `'any'` entries for the two certificate exporters are broader than file-name matching. That is acceptable: those packages are platform-restricted optional dependencies loaded through `bindings`, and the comment says why.
- **Windows path handling.** `resolve(args.resolveDir, args.path)` gives native separators. `addonLocation` splits on `[\\/]+` and uses the innermost `node_modules`, so nested and pnpm-style layouts work. Unit tests cover Windows-separator paths (spec `:263-287`).
- **Bare specifiers.** These are mapped through `node_modules/<specifier>`, so the first segment (or the first two for a scoped package) is the package. Covered by spec `:197-200`.
- **Scoped packages.** `@scope/name` is detected and needs a file after the package name. Covered for both the stubbing path and `addonLocation`'s undefined cases.
- **Error clarity.** The build error names the specifier, the importer (or resolveDir when there is none), the package when known, the file holding the allow-list, and both remedies (external and shipped, or allow-listed after confirming a try/catch fallback). Spec `:202-217` asserts this.
- **Observation, not a finding.** A Windows-style relative specifier such as `.\\x.node` does not start with `./` or `../`, so it is treated as bare and resolves to package `.`. The result is still a build error, so it fails safely, not silently. No dependency uses such a specifier, so I am not reporting it.
- **Evidence.** Criteria 1-4 have recorded evidence (container before/after, smoke on the container-built AppImage, SSH e2e, check.yml job run 44127846813, actionlint, and `npm run check`). The parent re-ran the container build at bb4a42ff with DIST_EXIT=0. The fixer reports `npx vitest run src/build` (19 passed) and `npm run check` passing. My own vitest run was refused by the sandbox, so for test results I rely on those recorded runs.

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

# Fix Report

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: current task. Findings CR-1 (P2) and CR-2 (P3) from reviews/release-native-modules/review.md.

## Fixed findings

### CR-1 — Blanket `*.node` stub turns any future native addon into a silent runtime failure

Files changed:
- `apps/desktop/src/build/native-addons.ts`
- `apps/desktop/src/build/native-addons.spec.ts`
- `apps/desktop/scripts/build.mjs` (comment only)
- `.github/workflows/check.yml` (comment only)

Problem:
`onResolve({ filter: /\.node$/ })` stubbed every native addon in every bundle. A new addon with no JS fallback would build without complaint and fail only at runtime.

Fix:
The plugin now stubs only the addons in the exported allow-list `OPTIONAL_ADDONS`:
- ssh2 `sshcrypto.node`
- os-dns-native `os_dns_native.node`, matched by file name, so both build/Release and build/Debug are covered
- every `.node` file of win-export-certificate-and-key and @mongodb-js/macos-export-certificate-and-key

The two certificate exporters are not installed locally, so I could not confirm their addon file names. package-lock.json shows they depend on `bindings`, which builds the addon path at runtime, so esbuild normally never sees a `.node` literal from them. As the parent instructed, the whole package is allow-listed for them.

The plugin resolves the addon's absolute path with `path.resolve(args.resolveDir, args.path)`, or `node_modules/<specifier>` for bare specifiers. `addonLocation()` then splits the path on `/` and `\`, which keeps it OS-neutral. The package is the segment, or the scoped pair of segments, after the innermost `node_modules`.

Any other `*.node` import now fails the build with an esbuild error. The error names the specifier, the importer and the package, and tells the developer to either mark the package external and ship it (scripts/build.mjs / electron-builder.yml) or add it to `OPTIONAL_ADDONS` after confirming it is loaded in try/catch with a JS fallback.

The decision does not depend on whether the `.node` file exists on disk. Allow-listed addons are stubbed whether or not they were compiled, so the toolchain-less behaviour is unchanged. Unlisted addons fail on every machine, so builds with and without a toolchain still give the same result.

Comments in build.mjs and check.yml now describe the allow-list and the build failure.

Validation:
- `cd apps/desktop && npx vitest run src/build` — Pass (19 tests). New cases:
  - an unlisted package's addon fails the build, naming the importer, the package and both remedies
  - an unlisted addon of an allow-listed package fails the build, whether or not the file exists
  - an addon outside node_modules fails the build
  - a bare-specifier addon is stubbed
  - os-dns-native in both Release and Debug is stubbed when never compiled
  - unit tests for `addonLocation`, with POSIX, Windows, nested and scoped paths, and for `isOptionalAddon`
- `cd apps/desktop && node scripts/build.mjs` — Pass. All four bundles build. backend, main and shell-worker contain only the ssh2 sshcrypto stub. os-dns-native is not installed locally, so its stub is exercised only by the CI `bundle` job and the container build.

### CR-2 — Stub module identity and message use only the raw specifier

Files changed:
- `apps/desktop/src/build/native-addons.ts`
- `apps/desktop/src/build/native-addons.spec.ts`

Problem:
The stub was keyed and described by the relative specifier. Identical relative paths in different packages therefore shared one stub, and the error message did not say which package was affected.

Fix:
The stub's namespace path is now `<package>/<path inside package>`, for example `ssh2/lib/protocol/crypto/build/Release/sshcrypto.node`. The MODULE_NOT_FOUND message uses that path: `Cannot find module 'ssh2/lib/protocol/crypto/build/Release/sshcrypto.node' (native addon not bundled into Thicket)`.

Validation:
- `cd apps/desktop && npx vitest run src/build` — Pass. The new case "gives identical relative addon paths in different packages distinct stubs" uses `./build/Release/binding.node` in both the win and macOS exporters and checks that each error message names its own package.

## Not fixed

None.

## Validation summary

Focused tests:
- `cd apps/desktop && npx vitest run src/build` — Pass (19 passed)
- `cd apps/desktop && node scripts/build.mjs` — Pass (main, preload, backend and shell-worker built)

Full test suite:
- `npm run check` (root) — Pass. Lint (eslint and prettier), typecheck in all workspaces, vitest 5236 passed, renderer 4137 passed.

Lint/type-check/build:
- Included in `npm run check` — Pass. Prettier reformatted the two changed TypeScript files once before the passing run.

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check` when package.json exists. That exact command passed. Running `bash .taskcheck` directly was refused by the sandbox permission prompt.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

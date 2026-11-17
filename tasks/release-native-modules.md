---
title: Release: bundle works when native modules (ssh2, os-dns-native) are compiled
status: in_progress
owner: dell26/agent-3
deps: [release-ci]
touches: [apps/desktop/scripts,apps/desktop/electron-builder.yml,.github/workflows/check.yml]
prio: 1
lease_until: 2026-11-17T17:07:14Z
---
## Goal
The release for tag `v0.1.0-rc.1` (GitHub Actions run 44118230764, 2026-11-17) failed on all four builds in `npm run dist`: esbuild in `apps/desktop/scripts/build.mjs` reports `No loader is configured for ".node" files` for `ssh2/lib/protocol/crypto/build/Release/sshcrypto.node` and `os-dns-native/build/Release/os_dns_native.node`. These optional native addons are only compiled where a C/C++ toolchain exists (GitHub runners have one, the agents' machines don't), so local builds pass. Make the bundle work either way: keep the native addons out of the esbuild bundle (external, packaged into the app with electron-builder and loaded at runtime, or deliberately left out where the module has a JS fallback, e.g. ssh2 without sshcrypto) and make sure the packaged app still starts and loads them correctly. Check for other addons in the dependency tree that would hit the same error (`hasInstallScript` packages in package-lock.json). Then make CI catch this on every push: the Linux job of `check.yml` (or a separate job) builds the app bundle with native addons compiled.

## Acceptance criteria
- [x] Reproduce with a toolchain: `podman run --rm -v <clone>:/src:Z -w /src docker.io/library/node:24 sh -c 'npm ci && npm run dist -w apps/desktop -- --linux AppImage'` (copy the clone first or use a separate node_modules volume so the host's node_modules stays untouched) fails before the fix and succeeds after; record both
  - verified (2026-11-17 17:47+0100 by dell26/agent-3): podman run --rm -v <clone>:/src:ro docker.io/library/node:24 (node v24.22.3, gcc 12) sh out/container-dist.sh: copies clone to /work (no node_modules), npm ci compiles cpufeatures/sshcrypto/kerberos/mongocrypt/os_dns_native .node, then npm run dist -w apps/desktop -- --linux AppImage. Before (f6b1b122): esbuild 'No loader is configured for ".node" files: ssh2/.../sshcrypto.node', exit 1. After (574bc497): DIST_EXIT=0, thicket-0.0.0-linux-x86_64.AppImage built; bundles contain the MODULE_NOT_FOUND stand-ins for sshcrypto.node and os_dns_native.node
- [x] The AppImage from that container build starts and connects through an SSH tunnel, or at least passes `node scripts/smoke-packaged.mjs` and loads ssh2 (log line or test)
  - verified (2026-11-17 17:47+0100 by dell26/agent-3): node apps/desktop/scripts/smoke-packaged.mjs <container-built AppImage> on the host -> 'smoke: OK' (thicket://app loaded, mainPing ok, backendPing 'backend' = backend.cjs, which imports ssh2 at load, is running; runAsNode/inspect ignored). Plus the container-built dist/*.cjs (main/preload/backend byte-identical to a toolchain-less local build; shell-worker includes the os-dns-native stub) copied into apps/desktop/dist and npx playwright test test/e2e/ssh.e2e.ts (OpenSSH + replica set containers via podman) -> 1 passed: 'SSH-tunnelled profile ... connected'
- [ ] check.yml builds the desktop bundle with compiled native addons on Linux, so the next such failure shows on every push; actionlint passes
- [ ] `npm run check` passes

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 17:46+0100 by dell26/agent-3): Optional native addons reached by the bundles (ssh2 sshcrypto, os-dns-native, system-ca's win/macos certificate exporters) are deliberately left out rather than shipped: an esbuild plugin turns every *.node require into a stub throwing MODULE_NOT_FOUND. All are required in try/catch with JS fallbacks, so the packaged app behaves exactly like today's toolchain-less builds; shipping them (electron-builder npmRebuild, cross-arch macOS) can be a later task if their speed/OS-cert features are wanted.
- ASSUMPTION (2026-11-17 17:46+0100 by dell26/agent-3): check.yml gets a separate 'bundle' job (ubuntu-latest, npm ci compiles addons, asserts sshcrypto.node/os_dns_native.node exist, npm run dist:dir, headless smoke-packaged on release/linux-unpacked) instead of extending the 3-OS check job, so the per-push matrix stays fast.
- ASSUMPTION (2026-11-17 17:46+0100 by dell26/agent-3): The plugin lives in apps/desktop/src/build/native-addons.ts (imported by scripts/build.mjs via Node 24 type stripping) so it is linted, type-checked and unit-tested like other src code; slightly outside the task's touches list.

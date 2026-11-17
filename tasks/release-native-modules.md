---
title: Release: bundle works when native modules (ssh2, os-dns-native) are compiled
status: in_progress
owner: dell26/agent-3
deps: [release-ci]
touches: [apps/desktop/scripts,apps/desktop/electron-builder.yml,.github/workflows/check.yml]
prio: 1
lease_until: 2026-11-17T16:57:11Z
---
## Goal
The release for tag `v0.1.0-rc.1` (GitHub Actions run 44118230764, 2026-11-17) failed on all four builds in `npm run dist`: esbuild in `apps/desktop/scripts/build.mjs` reports `No loader is configured for ".node" files` for `ssh2/lib/protocol/crypto/build/Release/sshcrypto.node` and `os-dns-native/build/Release/os_dns_native.node`. These optional native addons are only compiled where a C/C++ toolchain exists (GitHub runners have one, the agents' machines don't), so local builds pass. Make the bundle work either way: keep the native addons out of the esbuild bundle (external, packaged into the app with electron-builder and loaded at runtime, or deliberately left out where the module has a JS fallback, e.g. ssh2 without sshcrypto) and make sure the packaged app still starts and loads them correctly. Check for other addons in the dependency tree that would hit the same error (`hasInstallScript` packages in package-lock.json). Then make CI catch this on every push: the Linux job of `check.yml` (or a separate job) builds the app bundle with native addons compiled.

## Acceptance criteria
- [ ] Reproduce with a toolchain: `podman run --rm -v <clone>:/src:Z -w /src docker.io/library/node:24 sh -c 'npm ci && npm run dist -w apps/desktop -- --linux AppImage'` (copy the clone first or use a separate node_modules volume so the host's node_modules stays untouched) fails before the fix and succeeds after; record both
- [ ] The AppImage from that container build starts and connects through an SSH tunnel, or at least passes `node scripts/smoke-packaged.mjs` and loads ssh2 (log line or test)
- [ ] check.yml builds the desktop bundle with compiled native addons on Linux, so the next such failure shows on every push; actionlint passes
- [ ] `npm run check` passes

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

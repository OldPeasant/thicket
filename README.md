# Thicket

An open source desktop client for MongoDB (Linux, macOS, Windows). What it does: [SPEC.md](SPEC.md);
how it is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Dev quick start

1. Install Node 24 LTS (`nvm use` reads `.nvmrc`) and git; see docs/ARCHITECTURE.md "Install".
2. `npm ci` in the repo root installs all workspaces (`apps/*`, `packages/*`).
3. `npm run check` runs lint, type check and unit tests of every workspace (the TFP `.taskcheck`).
4. `npm run coverage` writes `coverage/` (text summary, JSON summary, lcov) in each workspace.
5. `npm run format` applies Prettier; tests live next to the code as `*.spec.ts`.

## License

Apache-2.0, see [LICENSE](LICENSE). "MongoDB" is a trademark of MongoDB, Inc.

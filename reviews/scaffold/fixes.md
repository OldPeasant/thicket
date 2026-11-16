# Fix Report

Date: 2026-11-16

Task: scaffold - M0: Monorepo scaffold with npm workspaces and the check

Scope: current task; findings CR-1 and CR-2 from `reviews/scaffold/review.md` (base HEAD 7d9940c)

## Fixed findings

### CR-1 — Vitest `test.projects` glob picks up every folder under `apps/` and `packages/`

Files changed:
- `vitest.config.ts`

Problem:
`projects: ['apps/*', 'packages/*']` is a directory glob, so any folder under `apps/` or `packages/`
became a Vitest project (with default settings if it had no `vitest.config.ts`), and the list could
drift from the explicit npm `workspaces` list.

Fix:
`test.projects` now lists the five workspace config files explicitly (`apps/desktop`,
`packages/contract`, `packages/core`, `packages/backend`, `packages/renderer`, each
`/vitest.config.ts`), in the same order as `workspaces` in `package.json`, with a comment to keep
both lists in sync.

Validation:
- `npm run check` — Pass (vitest: 5 test files, 5 tests passed)

### CR-2 — Runtime environments configured globally rather than per workspace

Files changed:
- `eslint.config.mjs`
- `apps/desktop/tsconfig.json`
- `packages/backend/tsconfig.json`

Problem:
ESLint applied `globals.node` to every file, including `packages/core` (must be free of Node APIs)
and `packages/renderer` (browser). The core `no-restricted-imports` rule only matched `node:*`, so a
bare `import fs from 'fs'` passed lint. The backend and desktop tsconfigs inherited `"types": []`
from `tsconfig.base.json`, so the two Node workspaces had no Node types.

Fix:
- `globals.node` is limited to `apps/desktop/**/*.ts`, `packages/backend/**/*.ts`, `**/*.config.ts`,
  `**/*.mjs` and `vitest.shared.ts`. `packages/renderer/**/*.ts` gets `globals.browser` (its
  `*.config.ts` files are excluded from that block and keep Node globals). `packages/core` and
  `packages/contract` get no runtime globals beyond ES.
- The core `no-restricted-imports` group is now `[...builtinModules, 'node:*', 'electron',
  'electron/*']`, with `builtinModules` imported from `node:module`.
- `apps/desktop/tsconfig.json` and `packages/backend/tsconfig.json` set
  `"compilerOptions": { "types": ["node"] }`.

Validation:
- Temporary file `packages/core/src/tmp-lint-probe.ts` with `import fs from 'fs'` and
  `import { readFile } from 'fs/promises'`, then `npx eslint packages/core/src/tmp-lint-probe.ts` —
  Pass (exit 1, both imports reported as `no-restricted-imports` errors). The file was deleted afterwards.
- `npm run check` — Pass (eslint, prettier, root and per-workspace tsc, vitest all green)

Note: for `.ts` files typescript-eslint turns off `no-undef`, so the ESLint globals only matter for
rules that read them. The use of Node globals like `process` in core is still caught by `tsc`, because
core has no Node types.

## Not fixed

None.

## Validation summary

Focused tests:
- `npx eslint packages/core/src/tmp-lint-probe.ts` (temporary bare `fs` import) — flagged, 2 errors, as expected
- `npx prettier --write` on the four changed files — unchanged (already formatted)

Full test suite:
- `npm run check` — Pass (5 test files, 5 tests)
- `npm run coverage` — Pass (5 workspaces, each 1 test file passed, v8 coverage summary printed)

Lint/type-check/build:
- Included in `npm run check` (eslint `--max-warnings 0`, `prettier --check .`, `tsc` root + every workspace) — Pass

`.taskcheck`:
- `sh .taskcheck` — Pass (runs `npm run check`; 5 tests passed)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

---

# Fix Report (round 2)

Date: 2026-11-16

Task: scaffold - M0: Monorepo scaffold with npm workspaces and the check

Scope: current task; new finding CR-1 (P3) from `reviews/scaffold/review.md` (reviewed revision 4fc7696)

## Fixed findings

### CR-1 — Core `no-restricted-imports` patterns falsely flag local relative imports

Files changed:
- `eslint.config.mjs`

Problem:
The packages/core rule put every `builtinModules` name into `patterns`, which uses gitignore-style
matching, so names like `util` or `path` also matched relative imports such as `./util` and
`./events/path`. Confirmed before the fix: a probe importing `./util` and `./events/path` got 2
`no-restricted-imports` errors.

Fix:
The builtins moved to `paths` as exact names (`builtinModules.map((name) => ({ name, message }))`).
`patterns` keeps only `node:*`, `electron` and `electron/*`. Bare subpaths stay blocked because
`builtinModules` lists them by exact name (`fs/promises`, `dns/promises`, `path/posix`,
`stream/web`, `util/types` and so on, checked with Node 24).

Validation:
- `npx eslint packages/core/src/probe-a.ts` (imports `./util`, `./events/path`) — Pass (no errors)
- `npx eslint packages/core/src/probe-b.ts` (imports `fs`, `fs/promises`, `node:path`, `electron`) —
  Pass (exit 1, all 4 imports reported as `no-restricted-imports` errors)
- Both probe files deleted afterwards.

## Not fixed

None.

## Validation summary

Focused tests:
- the two probe lint runs above — as expected

Full test suite:
- `npm run check` — Pass (eslint, prettier, tsc root and per workspace, vitest 5 files / 5 tests)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- `sh .taskcheck` — Pass

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

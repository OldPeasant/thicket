# Fix Report

Date: 2026-11-16

Task: ci-check - M0: GitHub Actions runs the check on Linux, macOS and Windows

Scope: current task; uncommitted working-tree changes on top of HEAD 5e901ddb5c44509bcf885726db93f8e5d567731c, limited to `.github/workflows/check.yml`. Findings source: `reviews/ci-check/review.md` (CR-1, CR-2, both P3).

## Fixed findings

### CR-1 — `cancel-in-progress` also cancels runs on `main`

Files changed:
- `.github/workflows/check.yml`

Problem:
`concurrency.cancel-in-progress: true` cancelled earlier runs on `main` too. TFP agents push finished tasks to `main` close together, so earlier tasks lost their own CI result.

Fix:
`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` with a one-line comment explaining why. Runs on `main` now queue instead of being cancelled. Other refs (branches, PRs) still cancel superseded runs.

Validation:
- `npx --yes @action-validator/cli .github/workflows/check.yml` — Pass (exit 0, no output)

### CR-2 — Actions pinned to `@v4` majors on the deprecated Node 20 action runtime

Files changed:
- `.github/workflows/check.yml`

Problem:
`actions/checkout@v4` and `actions/setup-node@v4` run on the deprecated Node 20 action runtime.

Fix:
Bumped to `actions/checkout@v5` and `actions/setup-node@v5`. The inputs (`persist-credentials: false`, `node-version-file: .nvmrc`, `cache: npm`) are unchanged.

Validation:
- `npx --yes @action-validator/cli .github/workflows/check.yml` — Pass (exit 0, no output)
- Not checked here: the run on GitHub with the v5 actions. The parent worker covers this with the criterion 4 run.

## Not fixed

None.

## Validation summary

Focused tests:
- `npx --yes @action-validator/cli .github/workflows/check.yml` — Pass (exit 0)

Full test suite:
- `npm run check` (lint, Prettier, type check, unit tests) — Pass: root vitest 4 files / 4 tests passed; renderer `ng test` 2 files / 46 tests passed

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Not run separately. `.taskcheck` runs `npm run check` when `package.json` is present, and that passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

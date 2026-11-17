# Fix Report

Date: 2026-11-17

Task: win-signing - Release: sign Windows builds with SignPath

Scope: current task; the approved findings CR-1, CR-3 and CR-4 from `reviews/win-signing/review.md`.
CR-2 was not fixed, as the parent worker decided. The test-writer report
(`reviews/win-signing/tests.md`) has no bugs. Its single open risk is the token permissions, which
is the same issue as CR-1.

## Fixed findings

### CR-1 — GITHUB_TOKEN may lack `actions: read` for the SignPath action

Files changed:
- `.github/workflows/release.yml`
- `docs/CODE_SIGNING.md`
- `apps/desktop/src/release-workflow.spec.ts`

Problem:
The `build` job inherited only `contents: read` from the workflow-level block. The SignPath action
reads the uploaded artifact and the run details through the job token, and that probably needs
`actions: read`.

Fix:
Added a job-level `permissions:` block to `build` with `contents: read` and `actions: read`. A
comment explains that job-level permissions replace the workflow-level ones and why `actions: read`
is needed. The `release` job keeps its own `contents: write`. "How the release workflow signs" in
docs/CODE_SIGNING.md now mentions the permission. A new test asserts the exact `build` permissions.

Validation:
- actionlint (podman, `docker.io/rhysd/actionlint:latest -no-color`) — Pass (no output)
- `npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts` (apps/desktop) — Pass

### CR-3 — Second `npm run dist` rebuilds the renderer and bundles for nothing

Files changed:
- `.github/workflows/release.yml`
- `docs/CODE_SIGNING.md`
- `apps/desktop/src/release-workflow.spec.ts`

Problem:
The `--prepackaged` step ran `npm run dist`, which rebuilt the renderer and the bundles. That
output is not used.

Fix:
The step "Build installer and zip from the signed app" now has `working-directory: apps/desktop`.
It runs `npx electron-builder --config electron-builder.yml --publish never $ARGS --prepackaged
release/win-signed "-c.extraMetadata.version=$version"`. These are the same electron-builder options
as the `dist` script, run in the same directory, so the output names do not change. In the spec:
- the fake `npm` is now a fake `npm` and `npx`, and each records its command name before its
  arguments;
- the helper runs a step in its `working-directory`;
- the `--prepackaged` test expects the direct `npx electron-builder` call and checks that the
  `dist` script still uses the same `--config electron-builder.yml --publish never` options;
- the signed-folder test reads the step's `working-directory` instead of assuming `npm -w`.

Step 4 in docs/CODE_SIGNING.md now also says the bundles are not rebuilt.

Validation:
- `npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts` (apps/desktop) — Pass (2 files, 31 tests)
- actionlint — Pass

### CR-4 — Unwrapped long line in install guide

Files changed:
- `docs/user/install.md`

Problem:
One line of about 150 characters was in the intro paragraph.

Fix:
Rewrapped the paragraph to 100 columns or less. The wording did not change.

Validation:
- `npx prettier --check docs/user/install.md` — Pass

## Not fixed

### CR-2 — Third-party action that receives the signing token is pinned to a mutable tag

Status:
Requires decision (deferred by the parent worker)

Reason:
Pinning needs the action's commit SHA, and that can't be looked up without web access. The workflow
keeps `@v1`. docs/CODE_SIGNING.md now has a note that a maintainer may pin the action to a full
commit SHA, with a `# v1.x` comment.

## Validation summary

Focused tests:
- `cd apps/desktop && npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts` — Pass (2 files, 31 tests)
- `npx prettier --check .github/workflows/release.yml docs/CODE_SIGNING.md docs/user/install.md apps/desktop/src/release-workflow.spec.ts` — Pass
- actionlint: `podman run --rm -v <repo>:/repo:ro,Z --workdir /repo docker.io/rhysd/actionlint:latest -no-color` — Pass (no findings)

Full test suite:
- `npm run check` (repo root: lint && typecheck && test) — Pass. The `&&` chain reached the last
  stage, and the renderer `ng test` finished with 102 files and 3355 tests passed. Lint, typecheck
  and the root vitest run therefore passed too. A rerun to capture the exit code was refused by the
  sandbox permission.

Lint/type-check/build:
- Part of `npm run check` — Pass

`.taskcheck`:
- Not run separately. `.taskcheck` runs `npm run check` when `package.json` exists, and that
  command passed (see above).

Remaining unresolved findings:
1 (CR-2, deferred by decision)

## Final status

All validated findings fixed and validation passed. CR-2 is deferred by the parent's decision and
documented.

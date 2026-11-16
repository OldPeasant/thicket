# Code Review

Date: 2026-11-16

Task: scaffold - M0: Monorepo scaffold with npm workspaces and the check

Scope: `git diff 347512b..ef8b880`, as supplied by the parent worker: scaffold commit 5429564, fix commit 4fc7696 (previous CR-1/CR-2) and fix commit ef8b880 (previous-round CR-1, core import ban false positives, see `reviews/scaffold/fixes.md` round 2). The earlier commits were reviewed in previous rounds. This round looks at ef8b880 in detail and checks that it caused no regressions. Uncommitted files (`reviews/`, and the untracked probe files `packages/core/src/tmp-probe-fail.ts` / `tmp-probe-pass.ts`) are not part of the reviewed revision.

Reviewed revision: ef8b8802a312a17eb5f25e7f02a9e4f55bf1d8db

Requirements:
- tasks/scaffold.md acceptance criteria and recorded assumptions
- docs/ARCHITECTURE.md ("Stack", "Layout", "Commands", "Coverage", "Conventions")
- AGENTS.md (project notes, Evidence, quality gate)
- previous review (CR-1 on 4fc7696) and reviews/scaffold/fixes.md round 2

Git range:
- Branch: main
- HEAD: ef8b8802a312a17eb5f25e7f02a9e4f55bf1d8db
- Base/start: 347512bcbf1285bc0464d7c091ea25543318ac39
- Commits reviewed: 3 (5429564, 4fc7696, ef8b880)

Verification of the previous finding:
- CR-1 (bare built-in names in `patterns` match local modules): fixed. `eslint.config.mjs:54-65` now
  puts `builtinModules` into `paths` (exact-name matching) and keeps only `node:*`, `electron`,
  `electron/*` in `patterns`. I confirmed this by linting from stdin as `packages/core/src/x.ts`
  (`npx --no-install eslint --stdin --stdin-filename packages/core/src/x.ts`, no files written):
  `./util` and `some-lib/events` pass, while `util`, `fs/promises`, `node:fs` and `electron/main` are
  reported. Subpath builtins such as `fs/promises` are blocked because `builtinModules` lists them by
  exact name. The diff of ef8b880 only touches `eslint.config.mjs`, so the rest of the task is unchanged.

Acceptance criteria (no regression from ef8b880):
1. `check`: lint, type check and unit tests, unchanged apart from the core rule. I did not re-run the full check or time it. The parent's recorded evidence and fixes.md round 2 cover it (`npm run check` and `sh .taskcheck` pass).
2. Coverage config: unchanged.
3. `.taskcheck`: unchanged.
4. Node pin and README: unchanged.
5. Exclusions of `dashboard/`, TFP files, `tasks/`, `reviews/` and `.claude/`: still present in the ESLint `ignores`.
6. Versions in ARCHITECTURE "Stack": unchanged.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The `electron` pattern still flags local modules whose path contains an `electron` segment**
    - File: `eslint.config.mjs:61`
    - Category: Quality
    - Problem: `patterns` uses gitignore matching. In that syntax, `electron` without a slash matches any path segment with that name. The stdin lint probe above reported `./electron` and `../electron/x` as "packages/core must stay free of Node and Electron APIs". This is the same class of false positive the round-2 fix removed for the built-in names.
    - Why it matters: this is a low risk because core is unlikely to have a local `electron` module. If it did, the error message would be misleading.
    - Suggested fix: move `electron` to `paths` as an exact name, matching how the built-ins are handled. Keep `electron/*` in `patterns`. It contains a slash, so it is anchored. Acceptable to defer.

## Review conclusion

No material issues found. Commit ef8b880 fixes the previous CR-1 correctly, and nothing regressed against the acceptance criteria or docs/ARCHITECTURE.md. The remaining CR-1 is optional cleanup and does not block completion.

Note for the parent worker (outside the reviewed revision): the untracked files `packages/core/src/tmp-probe-fail.ts` and `tmp-probe-pass.ts` exist in the working tree. They must not be committed. Delete them before running `.taskcheck`: the fail probe intentionally breaks lint, and the pass probe imports modules that don't exist.

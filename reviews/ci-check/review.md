# Code Review

Date: 2026-11-16

Task: ci-check - M0: GitHub Actions runs the check on Linux, macOS and Windows

Scope: 75cacd15f85588a66077425f4170634c19619c0b..dc09cde1738dc084b6747e1966e788a602e7d052, committed changes only. The task's code change is a single file, `.github/workflows/check.yml`. This is a re-review of the final code after the fixer changes in dc09cde (see `reviews/ci-check/fixes.md`). The range also contains TFP bookkeeping commits (`tasks/ci-check.md`, `tasks/contract.md`, `tasks/explorer-copy.md`, `reviews/ci-check/fixes.md`). The `tasks/contract.md` and `tasks/explorer-copy.md` changes belong to other agents' tasks and are outside this review.

Requirements:
- `tasks/ci-check.md` acceptance criteria 1-4 and the recorded assumption
- `docs/ARCHITECTURE.md` (Node 24.15+, `.taskcheck` runs in Git for Windows bash on Windows)
- `.taskcheck`, `.nvmrc` (`24`), `package.json` (`engines.node` `>=24.15.0 <25`, `check` script)
- `AGENTS.md`, `docs/QUALITY.md`
- Parent agent instructions (re-review the final code after the fixes for CR-1 and CR-2)

Git range:
- Branch: main
- HEAD: dc09cde1738dc084b6747e1966e788a602e7d052
- Base/start: 75cacd15f85588a66077425f4170634c19619c0b
- Commits reviewed: 2 code commits (5e901dd "ci: GitHub Actions runs npm ci + .taskcheck on Linux, macOS and Windows", dc09cde "ci: keep main runs, move to checkout/setup-node v5"), plus 7 task-state commits in the range
- Uncommitted changes: only the untracked review reports `reviews/ci-check/review.md` and `reviews/ci-check/tests.md`; no code changes

Commands run (read-only):
- `git log --oneline 75cacd1..dc09cde`, `git diff 75cacd1..dc09cde --stat`: 9 commits; the only code file is `.github/workflows/check.yml` (50 lines added)
- `git diff 5e901dd..dc09cde -- .github`: the fixer changed the `cancel-in-progress` expression and moved `actions/checkout` and `actions/setup-node` from v4 to v5. Nothing else changed.
- I read `.nvmrc`, `.taskcheck` and `package.json` (`engines`, `check`) and the full `check.yml`
- I did not run the validator again. The parent reports `npx --yes @action-validator/cli .github/workflows/check.yml` -> exit 0 on dc09cde and `npm run check` -> pass.

## Criteria assessment

1. The workflow validates: the parent's action-validator run on dc09cde returned exit 0. By inspection, the YAML keys and the `${{ }}` expression in `cancel-in-progress` are valid. Met.
2. Same Node major and same command: `setup-node@v5` gets `node-version-file: .nvmrc`, which is `24`. The check step runs `bash .taskcheck`, the same file TFP runs, so there is no difference in the command. Met.
3. Windows runs in bash: `defaults.run.shell: bash` applies to all matrix OSes. On `windows-latest` that is Git for Windows bash. `core.autocrlf false` runs before checkout. Met.
4. Green run on GitHub: skipped with a reason, and an assumption is recorded. Agents may not push, and there is no `gh`/API access. This criterion is not claimed as verified, which is the correct handling. A human must check the first run on main.

Earlier findings:
- CR-1 (previous review, `cancel-in-progress` on main): mostly fixed. Runs on main are no longer cancelled while they are running. A queued run can still be replaced; see the new CR-1 below.
- CR-2 (previous review, v4 actions): fixed. Both actions are now on v5, and the inputs `persist-credentials`, `node-version-file` and `cache` are still supported in v5.

Unchanged, no finding: `permissions: contents: read`, `persist-credentials: false`, `fail-fast: false`, `timeout-minutes: 30`, `cache: npm` keyed on the single root lockfile.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Queued runs on main can still be replaced, so the comment "Never cancel runs on main" overstates the guarantee**
    - File: `.github/workflows/check.yml:14-16`
    - Category: Integration
    - Problem: `group: check-${{ github.ref }}` is the same for every push to main. With `cancel-in-progress: false`, GitHub does not cancel the run in progress. But a concurrency group holds at most one running and one pending run: when a third push arrives, GitHub cancels the pending run and queues the new one in its place. If three or more tasks reach main while one run is in progress, the middle tasks get no CI result. The comment says "each finished task pushed there keeps its own CI result", which is not true in that case.
    - Why it matters: this is the scenario the fix was meant to address (several TFP agents running `done` close together). The latest commit is still checked, so this does not hide breakage. It only makes it harder to tell which task caused it, and the comment gives a false guarantee.
    - Suggested fix: give each main run its own group, for example `group: check-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}`, and keep `cancel-in-progress` as it is. Alternatively, accept the behaviour and change the comment to say that runs in progress on main are not cancelled.

## Review conclusion

No material issues found. Criteria 1-3 are met by the final code and the recorded validation. Criterion 4 is correctly skipped with an assumption, and a human must check the first GitHub run on all three OSes. CR-1 is an optional P3 improvement or a comment correction and does not block completion.

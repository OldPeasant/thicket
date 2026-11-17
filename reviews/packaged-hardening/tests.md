# Test Report

Date: 2026-11-17

Task: packaged-hardening — Harden the packaged app: Electron fuses (RunAsNode, NODE_OPTIONS, asar-only), ignore THICKET_DEV_SERVER/THICKET_RENDERER_DIR when packaged

Scope: `git diff c74ea8166f401f147ac6917a4a7a5ec65cbc789d..d11e7a1a67dd7fcdb9941f8895431a1447b17a1a`
(branch main), round 2. Task code commits: ca33e962 (implementation), 8ce242e6 (tests and
reports), d11e7a1a (fixer: CR-1 smoke page selection in `apps/desktop/scripts/smoke-packaged.mjs`,
CR-2 comments in `apps/desktop/electron-builder.yml` and `docs/ARCHITECTURE.md`). Between round 1
and d11e7a1a, nothing under `apps/desktop/src` changed. Their sha256 values are identical to the
round-1 snapshot (listed under Coverage). The `electron-builder.yml` change adds comment lines only.
No uncommitted inputs except `reviews/packaged-hardening/review.md`, which the reviewer is editing
and which is not a test input.

Requirements:
- `tasks/packaged-hardening.md` acceptance criteria and recorded assumptions (inspect fuse off,
  CDP smoke test; NODE_OPTIONS checked by reading the fuse wire only)
- `docs/ARCHITECTURE.md` ("Packaging", "Coverage")
- `AGENTS.md` (Evidence)
- `reviews/packaged-hardening/fixes.md` (round-2 changes)

## Round 2 (revision d11e7a1a)

I re-ran every validation on the final code. I added no new tests: the fixer only changed the
smoke script, which is itself the test for CR-1, and documentation comments (CR-2) that have no
behavior to test. The smoke run below exercises the new page selection (first page, then
`waitForURL` until the URL leaves `about:`).

| Command | Result |
|---|---|
| `npx --prefix apps/desktop vitest run --root apps/desktop src/main/renderer-source.spec.ts src/packaging.spec.ts` | Pass: 2 files, 30 tests (06:17:54) |
| `node apps/desktop/scripts/smoke-packaged.mjs apps/desktop/release/linux-unpacked/thicket` | Pass: url `thicket://app/#/`, title `Thicket`, fuses RunAsNode/EnableNodeOptionsEnvironmentVariable/EnableNodeCliInspectArguments `DISABLE`, OnlyLoadAppFromAsar/EnableEmbeddedAsarIntegrityValidation `ENABLE`, `runAsNode":"ignored"`, `inspect":"ignored"`, mainPing and backendPing answered, `smoke: OK` |
| `cd apps/desktop && node release/unfused-control.mjs` | Expected failure: fuses `ENABLE`, `runAsNode":"RAN"`, `inspect":"LISTENING"`, `smoke: wrong fuses`, `smoke: FAILED`, `exit=1` |
| `npm run check` (repo root, same as `.taskcheck`) | Pass: lint and typecheck clean; root vitest 84 files / 4417 tests; renderer `ng test` 102 files / 3355 tests |

Notes:
- Packaged build: `apps/desktop/release/linux-unpacked` from 06:02. It contains everything that
  goes into the package. Since then the only change to packaged inputs was comment lines in
  `electron-builder.yml`. The smoke script runs from outside the asar. I did not re-run
  `npm run dist:dir`.
- I ran the smoke from the repo root, so it wrote its screenshot to `release/smoke.png` at the repo
  root. That path is git-ignored.
- The round-1 intermittent SSH failure in `packages/backend/src/ssh/tunnel.spec.ts` did not occur
  this round.

The round-1 sections follow. Results that changed in round 2 are noted inline.

## Test files changed

- `apps/desktop/src/main/renderer-source.spec.ts` (extended; the task's 3 tests are unchanged)

`apps/desktop/src/packaging.spec.ts` (task-updated: fuse config test, renderer path through
`rendererSource`) was reviewed and left as is.

## Tests added or updated

Count: 5 (added to `renderer-source.spec.ts`)

- `packaged: ignores each override on its own too`: only `THICKET_DEV_SERVER` set, then only
  `THICKET_RENDERER_DIR` set; packaged still gives `resources/renderer` and no dev server.
- `packaged: the renderer folder does not depend on distDir`.
- `dev: each override applies independently of the other`: one override set, the other falls back
  to its default.
- `packaged: THICKET_DEV_SERVER cannot widen the CSP connect-src`: combines `rendererSource` with
  `contentSecurityPolicy` as `main/index.ts` does. A packaged app with a hostile dev-server variable
  keeps `connect-src 'self'` and has no mention of the hostile host.
- `main reads the renderer overrides only through rendererSource`: regression guard. After comments
  are stripped, `main/index.ts` must not mention `THICKET_DEV_SERVER`/`THICKET_RENDERER_DIR` and
  must call `rendererSource({ packaged: app.isPackaged, ...`. I ran a mutation check: I put
  `process.env['THICKET_DEV_SERVER']` back into a copy of the source text in memory, and the
  matcher flagged it.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `electronFuses` RunAsNode off, NODE_OPTIONS off, OnlyLoadAppFromAsar on, asar integrity on; inspect decided (off, smoke test replaced) | `packaging.spec.ts` › `flips the Electron fuses: no Node mode, NODE_OPTIONS or --inspect; asar only, validated` (config); packaged smoke reads the fuse wire of the built binary | `cd apps/desktop && npx vitest run src/main/renderer-source.spec.ts src/packaging.spec.ts`; `cd apps/desktop && node scripts/smoke-packaged.mjs release/linux-unpacked/thicket` | Pass: 30/30. Smoke output: fuses RunAsNode/EnableNodeOptionsEnvironmentVariable/EnableNodeCliInspectArguments `DISABLE`, OnlyLoadAppFromAsar/EnableEmbeddedAsarIntegrityValidation `ENABLE`. Asar integrity is only enforced on macOS/Windows, which I could not run here |
| AC2: packaged app ignores THICKET_DEV_SERVER / THICKET_RENDERER_DIR; dev keeps them | 3 task tests plus the 5 new tests in `renderer-source.spec.ts`; `packaging.spec.ts` › `copies the built renderer to resources/renderer, where main looks when packaged`; runtime: the smoke test launches the packaged app with `THICKET_DEV_SERVER=http://127.0.0.1:9` and `THICKET_RENDERER_DIR=userData/no-renderer (a missing folder)` and still lands on `thicket://app/#/`; dev mode: `npm run test:electron -w apps/desktop` | same as above; `npm run test:electron -w apps/desktop` | Pass: unit tests 30/30; smoke `url":"thicket://app/#/"`, `smoke: OK`; electron suite 26/26 |
| AC3: `dist:dir` + smoke OK; `ELECTRON_RUN_AS_NODE=1 thicket -e 1` does not run Node | smoke-packaged.mjs runAsNode probe (`ELECTRON_RUN_AS_NODE=1 thicket -e (marker script)`), inspect probe; negative control with the fuses flipped back on | `cd apps/desktop && node scripts/smoke-packaged.mjs release/linux-unpacked/thicket`; `cd apps/desktop && node release/unfused-control.mjs` | Pass: `runAsNode":"ignored"`, `inspect":"ignored"`, both pings answered, `smoke: OK`. Control: `runAsNode":"RAN"`, `inspect":"LISTENING"`, `wrong fuses`, `smoke: FAILED`, exit=1, so the probes can detect a failure. I did not re-run `npm run dist:dir`: I used the parent's `release/linux-unpacked` build from 06:02 today, which is newer than the last code change. I did not run the binary directly with `ELECTRON_RUN_AS_NODE=1 ... -e 1` from bash; the smoke script runs the same probe through node |
| NODE_OPTIONS at runtime | none (by design, see the task's assumption) | — | Not testable at runtime: Electron already drops `--require` from NODE_OPTIONS in packaged apps even with the fuse on. The fuse wire read stands in for it |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/main/renderer-source.spec.ts src/packaging.spec.ts`
plus `npx eslint src/main/renderer-source.spec.ts && npx prettier --check src/main/renderer-source.spec.ts && npx tsc -p tsconfig.json`

Result:

Pass: 2 files, 30 tests. eslint, Prettier and the desktop typecheck are clean.

## Full test execution

Command:

`sh .taskcheck` (= `npm run check`: lint, typecheck, root vitest, renderer `ng test`);
`npm run test:electron -w apps/desktop`; `cd apps/desktop && npx vitest run --coverage ...`
(the whole desktop workspace, 18 files / 532 tests)

Result:

Pass, after one retry. The first `.taskcheck` run had 1 failure in a file the task does not touch:
`packages/backend/src/ssh/tunnel.spec.ts` › `openSshTunnel: authentication › private key with its
passphrase (sshKeyPassphrase)` ("Malformed OpenSSH private key"). Run on its own, the file passed
43/43, and the next full `.taskcheck` passed: root 80 files / 4306 tests, renderer 100 files / 3273
tests. This looks like an intermittent failure in the backend SSH test (it generates a key at test
time). It is not related to this task; recorded here for the parent. Electron suite: 5 files, 26
tests, pass.

## .taskcheck

Result:

Round 2: Pass on the first run (`npm run check`, 84/4417 root, 102/3355 renderer). Round 1: Pass
on the second run; the first run had the unrelated intermittent SSH failure above.

## Bugs found

None.

## Coverage

Status: verified (unit-level whole-file coverage). `src/main/index.ts` measures 0% because it is
the Electron main entry. Vitest cannot import it without Electron; the electron and packaged smoke
runs exercise it, but they are not instrumented.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: computed by hand from `coverage/lcov.info`. `renderer-source.ts` is a new
file and 4/4 of its executable lines are covered. `index.ts` has one changed executable line, the
`rendererSource({...})` call at DA:55, with hit count 0; the import line is not executable.
Result: 4/5 changed executable lines (80%). Changed-branch coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: packaged-hardening; base c74ea8166f401f147ac6917a4a7a5ec65cbc789d (from the parent); HEAD 99416b500287e066610070a85b6edd9be4304737. Task code commit 99416b5 (a rebase of 1f59518/8cfeed8; the other commits since base are `assume`/`verify`/`heartbeat` changes to `tasks/` only)
- Source/test snapshot identifier (including uncommitted inputs): HEAD 99416b5 plus sha256 `renderer-source.spec.ts` 39f1a3a15b037dd3c89ba8dabf1f4184246847a4a61f4ce8e35cdf183b544bfb; `renderer-source.ts` dabd9fb3684efbd6…, `index.ts` 8e43d281cdbb9ab9…, `packaging.spec.ts` d0dc2067b39e2cb2…, `electron-builder.yml` 04b589f79d6dae56…, `smoke-packaged.mjs` 8afad3e03f0fa0d9…. I re-hashed after all the runs and got the same values
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/main/renderer-source.ts`, `apps/desktop/src/main/index.ts`. Excluded: `electron-builder.yml`, `package.json`, `package-lock.json` (configuration; covered by `packaging.spec.ts` and the smoke run); `scripts/smoke-packaged.mjs` (a test script outside Vitest's scope, run directly instead); `docs/ARCHITECTURE.md` and `tasks/` (documentation); `*.spec.ts` (tests). No renames or deletions
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8`; `npx vitest run --coverage --coverage.include='src/main/renderer-source.ts' --coverage.include='src/main/index.ts'` in `apps/desktop`; the whole desktop workspace (18 files, 532 tests)
- Run start/completion time and exit status: start 2026-11-17 06:08:51 +0100, report written 06:08:53; all tests passed and the summary was printed (exit 0)
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` sha256 b0c68534020c1e1c3070f3c9638b98ec5a7d03b2bc1a001933523b10996901db; `apps/desktop/coverage/lcov.info` sha256 3b945c89c5a06b671ad6b34f4adb6d2acb2d234b8d88c25015a5046768b727e3 (git-ignored)
- Evidence outputs are fresh and inputs stayed unchanged: the report files were modified at 06:08:53, during this run, and the source hashes matched after all the runs
- Final run after latest test additions and production fixes: the coverage run is from round 1 (code at 99416b5). It is still current for d11e7a1a: the fixer changed no file in the coverage scope, and in round 2 `renderer-source.ts` (dabd9fb3…), `index.ts` (8e43d281…), `renderer-source.spec.ts` (39f1a3a1…) and `packaging.spec.ts` (d0dc2067…) hash the same as in round 1. In round 2, `electron-builder.yml` hashes to ded63434079f44d9…, changed by comments only, and `smoke-packaged.mjs` to 71df63ef1847340d…, the CR-1 fix. Both are outside the coverage scope

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/main/renderer-source.ts` | 4/4 (100%) | 6/6 (100%) | 1/1 (100%) | 4/4 (100%) |
| `apps/desktop/src/main/index.ts` | 0/78 (0%) | 0/24 (0%) | 0/34 (0%) | 0/71 (0%) |
| Aggregate (summed counters, both files) | 4/82 (4.87%) | 6/30 (20%) | 1/35 (2.85%) | 4/75 (5.33%) |

No scoped file is missing from the report. The aggregate is dominated by the untestable-in-Vitest
`index.ts`, most of which existed before this task.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts:55` (the `rendererSource({ packaged: app.isPackaged, ... })` call, the only changed executable line) | AC2: main must pass `app.isPackaged` and use the result | Static guard `main reads the renderer overrides only through rendererSource` (unit). Runtime: the packaged smoke run with hostile env overrides still loads `thicket://app`, and the electron dev suite (26 pass) exercises the dev path. Not instrumentable with Vitest unit tests (needs Electron) |
| `apps/desktop/src/main/index.ts` (other lines) | Existing main-process wiring, not changed by this task | Out of task scope |

## Unable to test

- Asar integrity validation at runtime: enforced only on macOS/Windows; no such OS is available here.
  The config is asserted by `packaging.spec.ts`, and the smoke run read the fuse as `ENABLE` in the
  Linux binary. Follow-up only if macOS/Windows builds get verified.
- NODE_OPTIONS at runtime: no probe can observe it (task assumption); the fuse wire read is the
  evidence.
- Running `ELECTRON_RUN_AS_NODE=1 release/linux-unpacked/thicket -e 1` directly from bash: not done
  (the parent reported the sandbox denies it). The smoke script runs the same probe through node and
  reported `ignored`, and the unfused control shows the probe reports `RAN` when the fuse is on.
- A fresh `npm run dist:dir` was not re-run by me; I used the parent's build at 06:02, which is
  newer than the last code change in 1f59518/99416b5.

## Summary

Round 2 (d11e7a1a): all validation passed again on the final code, and no new tests were needed.
Round 1: Tests added and all validation passed. I found no production defects, and task-scoped coverage of
the new logic (`renderer-source.ts`) is 100%. The main-entry change is covered by a static guard and
by the packaged smoke and electron runs. One intermittent failure, unrelated to this task, appeared
in `packages/backend/src/ssh/tunnel.spec.ts`; it passed on rerun.

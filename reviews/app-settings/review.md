# Code Review

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: Fourth pass. It started after main (with the secrets-store task) was merged into the task branch, and was then extended to the final revision 9378018. Reviewed:
1. How the merge 1a9c70f resolved conflicts and combined the task code with main's secrets store: `git show --cc 1a9c70f` and `git diff 523e847 1a9c70f -- apps packages docs`, focusing on `apps/desktop/src/main/handlers.ts`, `index.ts`, `handlers.spec.ts`, `packages/contract/src/no-secrets.spec.ts` and `docs/ARCHITECTURE.md`.
2. The whole task diff, `git diff $(git merge-base HEAD origin/main)..HEAD`, checked for anything the merge broke.
3. The delta `git diff 1a9c70f 9378018`. Its only code change is two test-writer tests in `apps/desktop/src/main/handlers.spec.ts`. The other commits in between change only `tasks/` files.

Only committed changes were reviewed.

Requirements:
- tasks/app-settings.md acceptance criteria and recorded assumptions
- SPEC.md (settings in `userData/settings.json`, `app.*` settings methods)
- docs/ARCHITECTURE.md (main process, settings and secrets paragraphs)
- AGENTS.md, docs/QUALITY.md
- Earlier passes of this report (the CR-1 and CR-2 fixes were verified at 523e847)

Git range:
- Branch: main
- HEAD: 9378018 (app-settings: settings and secrets handlers coexist on the main port); reviewed revision 9378018fa2e7f602ea4b897311db3ad77c355058
- Base/start: c250ef6830c89286f91c8b3c522302a9386ccb41 (`git merge-base HEAD origin/main`). The previous pass covered up to 523e847.
- Commits reviewed since 523e847:
  - cbef273: reports only.
  - c362008: main-side assumption.
  - 1a9c70f: the merge of main (secrets store).
  - 4b3cabf, c96a288, 56085f4, 8f5fd8f, 8d60038 and the main heartbeat commits: `tasks/` only.
  - 9378018: two tests.
  The whole task diff from the base was re-checked.
- Uncommitted changes: at 9378018 the working tree had changes only in `reviews/app-settings/review.md` and `reviews/app-settings/tests.md`. No code or test files had uncommitted changes.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Merge resolution check

- `apps/desktop/src/main/handlers.ts`: `MainHandlerDeps` combines both sides. It keeps the task's optional `settings?: SettingsAccess` and adds main's required `secrets: SecretsStore`. `mainHandlers` spreads `secretsHandlers(deps.secrets)` into the handler map and still adds `app.settings.get/set` only when a store is given. Main's handler names (`profiles.secretStorage/setSecret/clearSecret`) and the task's names (`app.settings.*`) do not collide. `privilegedHandlers` is main's version unchanged: it takes `{ secrets }` and serves the real `secrets.get`.
- `apps/desktop/src/main/index.ts`: `createWindow(settings)` passes `secrets: secretsStore()` and `settings` to `mainHandlers`, and still passes `broadcaster`. Main's lazy `secretsStore()` is used for both the privileged port and the window handlers, so there is one owner. The startup order in `whenReady` is: `SettingsStore.open`, `onChange` → broadcast, protocol and session setup, the secret-storage status log, `host.start()`, `createWindow(settings)`. Both sides keep their behavior, and `activate` still passes `settings`. No leftover conflict markers or duplicate imports.
- `apps/desktop/src/main/handlers.spec.ts`: the task's settings tests now use main's `deps()` helper, which gives a `SecretsStore` on a file that does not exist. This is needed because `secrets` is now required. The assertions did not change.
- `packages/contract/src/no-secrets.spec.ts`: this new file comes from main. The merge adds `[BROADCAST_STREAMS.settingsChanged]: settingsChanged` to its broadcast map. That entry is required, because the test checks that the map's keys equal `Object.values(BROADCAST_STREAMS)` and the task added `settingsChanged` to `BROADCAST_STREAMS`. `app.settings.get/set` results are already covered by the `it.each(methods)` case. The `Settings` schema has no field whose name matches `SECRET_FIELD`.
- `docs/ARCHITECTURE.md`: the merged text keeps the task's settings paragraph unchanged, followed by main's secrets paragraph and main's updated privileged-port text, which no longer calls `secrets.get` a stub. The two paragraphs do not contradict each other. Both stores are under `userData`, in different files (`settings.json` and `secrets.bin`).
- Other callers: the only callers of `mainHandlers`/`privilegedHandlers` are `index.ts`, `handlers.spec.ts` and main's `secrets/no-secrets-to-renderer.spec.ts`. The latter calls without `settings`, which the optional field allows. `window.ts`, `broadcast.ts`, `settings/store.ts` and `test/settings.electron.spec.ts` were not touched by the merge. `test/helpers.ts` gained an optional `switches` parameter with a default, so existing callers, including the task's Electron settings test, are unaffected.
- The task diff from the merge base also lists `tasks/diff-ops.md`, `tasks/explorer-copy.md` and `tasks/shell-syntax.md`. These are other agents' task-state changes that came in with the merged main line. They are not task code.

## Delta 1a9c70f..9378018 (test-writer tests)

Two tests were added to `describe('app.settings handlers')` in `apps/desktop/src/main/handlers.spec.ts`:
- **Settings and secrets handlers coexist.** Giving a settings store adds exactly `app.settings.get/set` to the handler names. The secrets handlers are kept. Every handler name is a renderer method in `methods` with `route(name) === 'main'`. This guards the merge resolution in `mainHandlers` against one set of handlers overwriting or losing the other.
- **One window port answers both.** `profiles.secretStorage` (its result is checked with `parseResult`), `app.settings.get` and a valid `app.settings.set` (`pageSize: 100`) are all answered correctly on the same port.

Both tests check behavior through the real `serve()` and the contract tables. They need nothing outside the test. No production code changed in this delta.

## Notes (not findings)

- Ran `npx vitest run --project desktop --project contract` at 1a9c70f -> 14 files, 932 tests passed. That run included the test-writer's uncommitted edit to `handlers.spec.ts`, which was later committed as 9378018.
- Ran `npx vitest run --project desktop` at 9378018 (no uncommitted code or test changes) -> 10 files, 224 tests passed.
- Could not run a standalone type check or `npm run test:electron` in this pass (shell permission denied). The parent worker's `.taskcheck` (lint, type check, unit tests) on the merged result is the evidence for those. Criterion 3 (the Electron settings test) should be re-run on the merged code, because main's secrets wiring now runs at startup in the same process.
- The earlier findings did not change. The settings store and the CR-1/CR-2 fixes were not touched by the merge or by the delta.

## Review conclusion

No material issues found.

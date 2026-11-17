# Code Review

Date: 2026-11-17

Task: ui-polish-m1 - Round the Test connection latency; status bar shows the active tab's connection

Scope: final task diff `git diff 6f292d81..384c6201 -- packages/`. That is implementation commit 5ac43fd5 (rebased; same patch as cedbb43d, which the earlier review covered) plus test-writer commit 384c6201, which adds tests only. e2c8a06b only adds the unrelated task file tasks/e2e-layout-import-heading.md and is excluded.

Requirements:
- tasks/ui-polish-m1.md acceptance criteria
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md (project notes)
- reviews/m1-e2e/review.md CR-3 (origin of the task)
- Parent instructions: re-review at final revision 384c6201 and focus on the new tests. The production code is unchanged since the previous review. Test-writer evidence: the three spec files had 191 passed, the renderer suite 3373 passed, and `npm run check` passed.

Git range:
- Branch: main
- HEAD: 384c62015958167b76ecd1a4ac5954fcea2fac93
- Base/start: 6f292d816a63579c322a48f7c1a1947fd1e6c4c4 (merge-base with origin/main)
- Commits reviewed: 2 (5ac43fd5, 384c6201)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Acceptance criteria

1. **Rounded latency, with a unit test: met.**
   - `ConnectionEditor.latency()` (connection-editor.ts:343-347) rounds to whole milliseconds and shows "< 1" when the rounded value is below 1.
   - The original spec checks 2.1195... -> "2 ms" and 0.31 -> "< 1 ms".
   - The new `it.each` table (connection-editor.spec.ts:343-359) adds the boundaries 0, 0.49, 0.5, 1.49, 1.5, 12 and 1234.56. The expected values match `Math.round` semantics: 0.5 -> 1 and 1.5 -> 2. The regex is anchored and escapes the version dots, so it would catch a leftover raw float or a missing "ms".
2. **Status bar shows the active collection tab's connection, with a unit test, and the m1 e2e suite still passes: met (production code unchanged since the previous review).**
   - The new status-bar.spec.ts tests (97-147) cover these cases:
     - the `connection` input wins over `StatusService.connection()`, including the name, state, dot, flags and host classes;
     - the input is used when the service has none;
     - clearing the input falls back to the service, the flags and host classes go away, and "No connection" is shown once the service is cleared.
   - The new app-shell.spec.ts tests (1082-1184) map onto the branches of `AppShell.tabConnection` (app-shell.ts:173-185):
     - an unknown profile id falls back to the service;
     - a non-string `profileId` is not looked up;
     - the tab connection wins over the service;
     - a missing conn state shows as Disconnected;
     - `tab.production ?? profile.production` in both directions;
     - switching between tabs of two profiles.
   - The nested `beforeEach` re-registers `profiles.list`/`conn.status` before `start()`, so the fixtures are in place when the shell loads. The `toContain('Connected')` assertions cannot be satisfied by "Disconnected", because the case differs.
   - The parent previously recorded `npm run test:e2e -- m1` -> 1 passed. The new commit changes no production code.

## Test quality

- The tests check rendered DOM text, classes and attributes through the real `StatusService`, `WorkspaceService` and `SidebarTreeService`. Only the IPC bridge is faked (`FakeThicketBridge`). They do not reach into private members, and no existing test was weakened or removed. The diff adds lines only.
- Re-run for this review: `npx ng test --watch=false --include` on the three changed spec files -> 3 files, 191 passed. This matches the test-writer's evidence.

## Other checks, no issues found

- Late-loading profiles, types, architecture (a single owner of connection state in `SidebarTreeService`) and security: no change from the previous review, because the production code is identical.

## Review conclusion

No material issues found.

# Code Review

Date: 2026-11-17

Task: ui-polish-m1 - Round the Test connection latency; status bar shows the active tab's connection

Scope: implementation commit cedbb43d on top of task base afc24644 (claim commit). 3b0262d7 only adds the unrelated task file tasks/e2e-layout-import-heading.md and is excluded.

Requirements:
- tasks/ui-polish-m1.md acceptance criteria
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md (project notes)
- reviews/m1-e2e/review.md CR-3 (origin of the task); reviews/m1-e2e/step-3-sidebar.png (context only, not re-inspected)
- Parent instructions: evidence so far (layout specs 149 passed, connection-editor spec 108 passed, `npm run test:e2e -- m1` 1 passed); the layout.e2e.ts Compass import failure is pre-existing and is tracked as e2e-layout-import-heading

Git range:
- Branch: main
- HEAD: 3b0262d7
- Base/start: afc246447ca97f791328ed3b9b9f06f1e92ea347
- Commits reviewed: 1 (cedbb43da527dc10a248387621856867c07e2ba6)

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
   - `ConnectionEditor.latency()` (connection-editor.ts:343-347) rounds to whole milliseconds and shows "< 1" below 0.5 ms. The template change (connection-editor.html:109) is the only place that renders `latencyMS` in the renderer.
   - The spec (connection-editor.spec.ts:325-341) checks 2.1195470000000114 -> "Connected in 2 ms to MongoDB" and 0.31 -> "Connected in < 1 ms".
2. **Status bar shows the active collection tab's connection, with a unit test, and the m1 e2e suite still passes: met.**
   - `AppShell.tabConnection` (app-shell.ts:173-185) builds a `StatusConnection` from the active tab's `data.profileId`. It takes the profile from `SidebarTreeService.profile()` and the live state from `SidebarTreeService.conn()`, the existing owner of connection state that follows the `conn.status` broadcast. Production comes from `tab.production ?? profile.production` and read-only from `profile.readOnly`.
   - `StatusBar` gets an optional `connection` input. `shown()` falls back to `StatusService.connection()`, so the old `setConnection` callers (dev safety demo, specs) keep working.
   - The production and readonly host classes and the state text all use `shown()`. The shell's production accent (`production`, app-shell.ts:163-166) also prefers `tab.production`, so the status bar and the shell chrome stay in sync.
   - The app-shell spec (app-shell.spec.ts:1030-1080) covers four cases:
     - the name, Connected, Production and Read-only shown for the tab;
     - a live state change through the broadcast;
     - falling back for a tab without a profile and for the start page;
     - reactivating the collection tab.
   - The parent recorded `npm run test:e2e -- m1` -> 1 passed. layout.e2e.ts:30 expects "No connection" at startup, before any tab is open. The change does not affect that case.

## Other checks, no issues found

- Data that loads late: persisted tabs restored before `profiles.list` resolves get `undefined` from `profile()`, so the bar shows the fallback until the profiles load. It then updates reactively, with no crash and no stale state.
- Types: `ConnView.state` uses the same state union as `StatusConnection.state`, and the parent's spec run compiled.
- Architecture: the shell derives the value from the existing sidebar state service. No second owner of connection state is introduced, and the view-pushed `StatusService` API is unchanged.
- Security: the change is display only. No new inputs, logging or secrets.

## Review conclusion

No material issues found.
